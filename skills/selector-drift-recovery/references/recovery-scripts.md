# Refactor recovery — full playbook and scripts

The executable playbook behind `selector-drift-recovery`. Assumes **Playwright >= 1.50, TypeScript** (trace-viewer DOM-snapshot panel, `ariaSnapshot`, `getByRole().filter()`). Cypress adaptation note at the end — but note the trace-zip, JSON-reporter shape, and `getByRole` ladder are Playwright-specific.

---

## 0. Preconditions

- [ ] You can run the affected suite locally and reproduce the failures.
- [ ] You have the new build deployed (preview) or running locally.
- [ ] You have at least one old-DOM source: a pre-refactor CI trace artifact, a Storybook setup, or a staging env on the old build.
- [ ] You have a feature branch off main for the recovery PR.

Missing any of these → fix it first. The skill cannot generate recovery from no reference point.

---

## 1. Snapshot the old DOM

### Option A — From the last green Playwright trace

```bash
gh run list --branch main --workflow ci.yml --status success --limit 5
gh run download <RUN_ID> -n playwright-traces

# Open a trace; select an action and read the per-action DOM SNAPSHOT panel.
# (There is no "Copy HTML at this step" menu item anymore — read the snapshot panel,
#  or dump it programmatically by replaying, below.)
npx playwright show-trace traces/checkout.zip
```

Programmatic dump (an aria-snapshot is the signal role-first recovery needs; raw HTML optional):

```typescript
// scripts/snapshot-dom.ts  — run against any reachable build (old or new)
import { chromium } from '@playwright/test';
import fs from 'fs';

const [, , baseUrl, outDir] = process.argv;          // e.g. http://localhost:6006  .drift-recovery/old
const routes = ['/checkout', '/cart', '/account'];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  fs.mkdirSync(outDir, { recursive: true });
  for (const route of routes) {
    await page.goto(baseUrl + route);
    await page.waitForLoadState('networkidle');       // snapshot AFTER hydration
    const aria = await page.locator('body').ariaSnapshot();
    const name = route.replace(/\//g, '_') || 'root';
    fs.writeFileSync(`${outDir}/${name}.aria.yml`, aria);
    fs.writeFileSync(`${outDir}/${name}.html`, await page.content());
  }
  await browser.close();
})();
```

### Option B — Storybook at a pre-refactor commit

```bash
git checkout <PRE_REFACTOR_SHA>
npm run storybook -- --port 6006 --no-open &
sleep 5
npx tsx scripts/snapshot-dom.ts http://localhost:6006 .drift-recovery/old
git checkout -
```

### Option C — Staging on the old version

```bash
npx tsx scripts/snapshot-dom.ts https://staging-old.example.com .drift-recovery/old
```

Pick **one** option, document which, move on.

**Aria-snapshot diff** (the drift signal): `diff .drift-recovery/old/_checkout.aria.yml .drift-recovery/new/_checkout.aria.yml`. A role-tree diff highlights *which roles/names moved* and ignores class renames and wrapper divs that a raw-HTML diff drowns in.

---

## 2. Snapshot the new DOM

Run the same routes in the new build (a Vercel/Netlify preview is ideal):

```bash
PREVIEW_URL=$(gh pr view <REFACTOR_PR> --json deployments -q '.deployments[0].url')
npx tsx scripts/snapshot-dom.ts "$PREVIEW_URL" .drift-recovery/new
```

For every old snapshot there should be a matching new one. A route that 404s in the new build is a deleted flow — mark its tests for deletion in Phase 6.

---

## 3. Identify broken selectors (and capture intent + route)

```bash
PLAYWRIGHT_TEST_BASE_URL=$PREVIEW_URL \
  npx playwright test --reporter=json > .drift-recovery/results.json
```

The parser captures file / line / old-locator / **errorType** and — the two fields the reporter does NOT give you — the **inferred intent** and **page route**, read from the test source. Both are required by Phase 4; without them the generator runs on `undefined`.

```typescript
// scripts/identify-drift.ts
import fs from 'fs';
import path from 'path';

interface Failure {
  file: string;
  line: number;
  oldLocator: string;
  errorType: 'timeout' | 'assertion' | 'other';
  intent: string;     // inferred from source — NOT in the reporter
  pageRoute: string;  // which new/*.aria.yml to load — NOT in the reporter
}

const results = JSON.parse(fs.readFileSync('.drift-recovery/results.json', 'utf8'));

// Map a source line to a short intent + the route under test, by reading the spec.
function inferContext(file: string, line: number): { intent: string; pageRoute: string } {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  // intent: nearest comment, test title, or the action/assertion on this line
  const around = src.slice(Math.max(0, line - 4), line + 2).join(' ');
  const titleMatch = around.match(/test\(['"`](.+?)['"`]/);
  const intent = (titleMatch?.[1] || around.replace(/\s+/g, ' ').trim()).slice(0, 60);
  // route: nearest page.goto('...') above this line
  let pageRoute = '/';
  for (let i = line; i >= 0; i--) {
    const m = src[i]?.match(/goto\(['"`]([^'"`]+)['"`]/);
    if (m) { pageRoute = new URL(m[1], 'http://x').pathname; break; }
  }
  return { intent, pageRoute };
}

const failures: Failure[] = [];
for (const suite of results.suites || []) {
  for (const spec of collectSpecs(suite)) {
    for (const test of spec.tests || []) {
      for (const r of test.results || []) {
        if (r.status !== 'failed') continue;
        const msg = r.error?.message || '';
        // A DRIFT failure is a locator timeout; an assertion failure is a value mismatch.
        const isTimeout = /TimeoutError/.test(msg) && /locator\./.test(msg);
        const locatorMatch = msg.match(/(locator\([^\n]*?\)|getBy\w+\([^\n]*?\))/);
        const file = r.error?.location?.file;
        const line = r.error?.location?.line;
        if (!file || !line || !locatorMatch) continue;
        failures.push({
          file, line,
          oldLocator: locatorMatch[1],
          errorType: isTimeout ? 'timeout' : /expect/.test(msg) ? 'assertion' : 'other',
          ...inferContext(file, line),
        });
      }
    }
  }
}

// Group by file for the PR; persist a flat list keyed for Phase 4.
fs.writeFileSync('.drift-recovery/failures.json', JSON.stringify(failures, null, 2));
console.log(`Identified ${failures.length} broken locators across ` +
  `${new Set(failures.map(f => f.file)).size} files`);

function collectSpecs(suite: any): any[] {        // suites nest; flatten
  return [...(suite.specs || []), ...(suite.suites || []).flatMap(collectSpecs)];
}
```

> **POM caveat:** `r.error.location` points at the *failing line*. For inline locators that is the locator. For a locator wrapped in a Page Object, it is the POM helper, not the test — `file`/`line` will be the helper file. Re-read the locator from the trace action, or grep the POM source, before applying. The script above silently assumes inline locators.

Assertion-type rows (`errorType: 'assertion'`) are not drift — drop them from the candidate run; the locator resolved fine and failed a value check.

---

## 4. Generate replacement candidates

Loads the new-DOM HTML for each failure's `pageRoute`, generates candidates by the role-first ladder, and only awards **score 3 after region scoping makes the match unique**.

```typescript
// scripts/generate-candidates.ts
import { chromium, Page } from '@playwright/test';
import fs from 'fs';

interface Candidate { selector: string; score: number; rationale: string; }

async function generate(page: Page, intent: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const rx = new RegExp(intent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  // 5 — data-testid added by the refactor
  for (const el of await page.locator('[data-testid]').all()) {
    const id = await el.getAttribute('data-testid');
    const text = (await el.textContent())?.trim().slice(0, 50) || '';
    if (id && rx.test(text)) out.push({ selector: `getByTestId('${id}')`, score: 5, rationale: `testid matches "${intent}"` });
  }

  // 4 — getByLabel for form fields, then getByRole + name (unique)
  const label = page.getByLabel(rx);
  if (await label.count() === 1) out.push({ selector: `getByLabel(/${intent}/i)`, score: 4, rationale: 'unique labelled field' });

  for (const role of ['button', 'link', 'heading', 'textbox', 'checkbox'] as const) {
    const loc = page.getByRole(role, { name: rx });
    const n = await loc.count();
    if (n === 1) {
      out.push({ selector: `getByRole('${role}', { name: /${intent}/i })`, score: 4, rationale: 'unique role+name' });
    } else if (n > 1) {
      // 3 — ONLY if region scoping resolves it to exactly one. An un-scoped multi-match is NOT a 3.
      for (const region of await page.getByRole('region').all()) {
        const regionName = await region.getAttribute('aria-label') || (await region.getByRole('heading').first().textContent())?.trim();
        if (!regionName) continue;
        const scoped = region.getByRole(role, { name: rx });
        if (await scoped.count() === 1) {
          out.push({
            selector: `getByRole('region', { name: /${escapeName(regionName)}/i }).getByRole('${role}', { name: /${intent}/i })`,
            score: 3, rationale: `region-scoped to one match in "${regionName}"`,
          });
          break;
        }
      }
    }
  }

  // 2 — text only
  if (await page.getByText(rx).count() === 1) out.push({ selector: `getByText(/${intent}/i)`, score: 2, rationale: 'text-only, fragile' });

  return out.sort((a, b) => b.score - a.score);
}

const escapeName = (s: string) => s.slice(0, 40).replace(/[/\\]/g, '');

(async () => {
  const failures = JSON.parse(fs.readFileSync('.drift-recovery/failures.json', 'utf8'))
    .filter((f: any) => f.errorType === 'timeout');     // drift only
  const browser = await chromium.launch();
  const page = await browser.newPage();
  fs.mkdirSync('.drift-recovery/screenshots', { recursive: true });

  const result: any[] = [];
  for (const f of failures) {
    const route = f.pageRoute.replace(/\//g, '_') || 'root';
    const html = fs.readFileSync(`.drift-recovery/new/${route}.html`, 'utf8');
    await page.setContent(html);
    const best = (await generate(page, f.intent))[0];
    if (best && best.score >= 3) {
      const shot = `.drift-recovery/screenshots/${route}-${f.line}.png`;
      try { await page.locator(best.selector).first().screenshot({ path: shot }); } catch {}
      result.push({ ...f, ...best, screenshotPath: shot, applied: false });
    } else {
      result.push({ ...f, selector: null, score: 0, rationale: 'no safe candidate', applied: false });
    }
  }
  await browser.close();
  fs.writeFileSync('.drift-recovery/candidates.json', JSON.stringify(result, null, 2));
})();
```

A `count > 1` selector that no region scoped to one match falls through with **no score-3 candidate** — exactly right. It surfaces as score 0 (flag for human), not as a false 3.

---

## 5. Apply (line-anchored), validate, iterate

Replace the specific `(file, line)` — never a content-wide `String.replace`. The reporter's `oldLocator` is a *rendered* string (`locator('.summary > h2')`) that usually does not match the source expression verbatim, `String.replace` hits only the first occurrence, and identical locators on different lines collide.

```typescript
// scripts/apply-recovery.ts
import fs from 'fs';

const candidates = JSON.parse(fs.readFileSync('.drift-recovery/candidates.json', 'utf8'));
const byFile: Record<string, any[]> = {};
for (const c of candidates) {
  if (c.score < 3 || !c.selector) continue;     // never auto-apply below 3
  (byFile[c.file] ||= []).push(c);
}

for (const [file, changes] of Object.entries(byFile)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  // bottom-up so edits above don't shift the lines below
  for (const c of changes.sort((a, b) => b.line - a.line)) {
    const i = c.line - 1;
    const before = lines[i];
    // swap the call expression on that line; .first() etc. preserved by anchoring on the call head
    lines[i] = lines[i].replace(/(?:page\.|this\.page\.)?(?:locator|getBy\w+)\([^)]*\)/, `page.${c.selector}`);
    c.applied = lines[i] !== before;             // record only what actually changed
    if (!c.applied) console.warn(`No change at ${file}:${c.line} — locator wrapped or moved; review manually`);
  }
  fs.writeFileSync(file, lines.join('\n'));
}
fs.writeFileSync('.drift-recovery/candidates.json', JSON.stringify(candidates, null, 2));  // persist applied flags
```

Then validate the **full affected suite** (not just the previously-failing tests):

```bash
npx playwright test --reporter=json > .drift-recovery/post-recovery.json
jq '.stats.unexpected' .drift-recovery/post-recovery.json   # 0 = all recovered tests green
```

For any test still failing, revert that one line (`git checkout -p`) and flag it for the PR's manual-review list.

---

## 6. Open the PR

```bash
git checkout -b chore/test-selector-recovery-$(date +%Y%m%d)
git add tests/ .drift-recovery/candidates.json
git commit -m "chore(tests): bulk selector recovery after <refactor>"
git push -u origin HEAD
gh pr create --title "chore(tests): selector recovery after <refactor>" \
  --body "$(cat .drift-recovery/pr-body.md)"
```

Body generated from `candidates.json`, filtering on `applied` (set by `apply-recovery.ts`):

```typescript
// scripts/build-pr-body.ts
import fs from 'fs';
const c = JSON.parse(fs.readFileSync('.drift-recovery/candidates.json', 'utf8'));
const recovered = c.filter((x: any) => x.applied);                 // applied === true
const flagged   = c.filter((x: any) => !x.applied && x.score < 3);

const perFile = Object.entries(
  recovered.reduce((m: any, r: any) => ((m[r.file] ||= []).push(r), m), {})
).map(([file, rows]: any) =>
  `### ${file}\n| Line | Old | New | Score | Shot |\n|---|---|---|---|---|\n` +
  rows.map((r: any) => `| ${r.line} | \`${r.oldLocator}\` | \`${r.selector}\` | ${r.score} | ![](${r.screenshotPath}) |`).join('\n')
).join('\n\n');

fs.writeFileSync('.drift-recovery/pr-body.md', `## Trigger
<Link to refactor PR>

## Summary
- ${recovered.length} selectors recovered
- ${new Set(recovered.map((r: any) => r.file)).size} test files updated
- ${flagged.length} flagged for manual review

## Per-file changes
${perFile}

## Flagged for review
${flagged.map((f: any) => `- ${f.file}:${f.line} — ${f.oldLocator} (${f.rationale})`).join('\n')}

## How to review
- Check each screenshot: does \`new\` point at the same element as \`old\`?
- For score-3 candidates, verify the region scope is meaningful in the new design.
- For flagged tests, decide: rewrite, delete, or accept a manual update.
`);
```

---

## Cleanup

```bash
rm -rf .drift-recovery/
grep -qxF '.drift-recovery/' .gitignore || echo '.drift-recovery/' >> .gitignore
```

---

## When this workflow is not enough

- **Semantics changed, not just structure.** A "Submit" button that became a multi-step confirmation flow cannot be rescued by a selector swap — the scenario itself must change. Send those to a human.
- **Deeply encapsulated Page Objects.** If the locator lives three levels into a `CheckoutPage` POM, the line in the reporter is the helper, not the test. Walk the POM source (or read the trace action) to find and apply the real locator.
- **SSR with hydration mismatch.** Snapshot AFTER hydration (`await page.waitForLoadState('networkidle')`) or the new-DOM snapshot is the pre-hydration tree and candidates miss client-rendered elements.

## Cypress adaptation

The *shape* of the workflow ports to Cypress, but the mechanics do not: Cypress has no trace-zip artifact, a different reporter JSON (`mochawesome`/`mocha`), and no `getByRole`/`ariaSnapshot` equivalent (use `@testing-library/cypress` `findByRole`, and `cy.document().then(d => d.body.outerHTML)` for raw DOM). Reuse Phases 1, 2, 5, 6 conceptually; rewrite the parsing and candidate-generation scripts for the Cypress reporter and `findBy*` queries.
