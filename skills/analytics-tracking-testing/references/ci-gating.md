# Regression-Gating Tracking in CI

The gate runs the user journeys, captures every beacon (via the fixture in `capture-fixture.md`), diffs the captured events against the tracking-plan baseline, and **fails the build (non-zero exit)** when a previously-firing event stops firing or a required param goes missing.

It runs **pre-merge in PR CI**, not as a manual GA4 DebugView check, not against production-only traffic, and never as a warning that lets the build pass.

## The diff against baseline

The baseline is the set of events the tracking plan says each journey must produce. After capturing, assert every expected event was seen and satisfies the contract:

```ts
import { test, expect } from '../fixtures/analytics';
import { validateEvent } from '../tracking-plan/validate';
import plan from '../tracking-plan/tracking-plan.json';

const EXPECTED_ON_CHECKOUT = ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'];

test('checkout journey emits every planned event with required params', async ({ page, beacons }) => {
  await runCheckoutJourney(page);
  await page.waitForLoadState('networkidle');

  for (const name of EXPECTED_ON_CHECKOUT) {
    const beacon = beacons.find(b => b.destination === 'ga4' && b.eventName === name);
    expect(beacon, `event "${name}" dropped — not captured during checkout`).toBeTruthy();

    const sp = new URLSearchParams(beacon!.params as Record<string, string>);
    const violations = validateEvent(plan, name, sp);
    expect(violations, `required params missing for "${name}": ${JSON.stringify(violations)}`).toEqual([]);
  }
});
```

A dropped event → `toBeTruthy()` fails. A missing required param → `violations` non-empty fails. Either way Playwright exits non-zero and the job goes red.

## GitHub Actions workflow

```yaml
name: tracking-regression-gate
on: [pull_request]
jobs:
  tracking:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Run tracking gate
        run: npx playwright test --project=tracking
        # non-zero exit on any dropped event / missing param fails the job
      - if: always()
        uses: actions/upload-artifact@v4
        with: { name: tracking-report, path: playwright-report/ }
```

## Surfacing failures in the job summary

Write the missing/dropped findings to the step summary so the diff is visible without opening the report:

```ts
// in a custom reporter or afterAll
import fs from 'node:fs';
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary && violations.length) {
  fs.appendFileSync(summary, `## Tracking regressions\n` +
    violations.map(v => `- ${v.event}: ${v.problem} ${v.param ?? ''}`).join('\n') + '\n');
}
```

## What NOT to do

- **GA4 DebugView manual check** — interactive, not automated, never blocks a merge.
- **Production-only monitoring** — catches regressions after users do; use it as a complement (see `synthetic-monitoring`), not as the pre-merge gate.
- **Warn but pass** — a non-failing gate is decoration. The job must exit non-zero.

Prove the gate works once by deliberately breaking a tag (rename a param in a branch) and confirming the build turns red.
