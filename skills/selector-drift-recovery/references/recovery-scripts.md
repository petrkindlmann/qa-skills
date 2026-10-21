# Refactor recovery — full playbook and scripts

The executable playbook behind `selector-drift-recovery`. Assumes **Playwright >= 1.50, TypeScript** (trace-viewer DOM-snapshot panel, `ariaSnapshot`, `getByRole().filter()`). Cypress adaptation note at the end — but note the trace-zip, JSON-reporter shape, and `getByRole` ladder are Playwright-specific.

---

## 0. Preconditions

- [ ] You can run the affected suite locally and reproduce the failures.
- [ ] You have the new build deployed (preview) or running locally.
- [ ] You have at least one old-DOM source: a pre-refactor CI trace artifact, a Storybook setup, or a staging env on the old build.
- [ ] You have a feature branch off main for the recovery PR.

Missing any of these → fix it first. The skill cannot generate recovery from no reference point.

The scripts below are TypeScript run through `npx tsx`. In a repository with no TypeScript
runner and no room for a new dependency, save each as `.mjs`, drop the type annotations and
use explicit `./name.mjs` import specifiers; the logic does not change.

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

Programmatic dump (replace the sample routes and `app-ready` signal with the actual application contract; network idle does not establish hydration):

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
    await page.getByTestId('app-ready').waitFor({ state: 'visible' }); // replace with the app-owned readiness contract
    const aria = await page.locator('body').ariaSnapshot();
    const name = route.replace(/\//g, '_') || 'root';
    fs.writeFileSync(`${outDir}/${name}.aria.yml`, aria);
    fs.writeFileSync(`${outDir}/${name}.html`, await page.content());
  }
  await browser.close();
})();
```

The aria snapshot hides class, id and `data-*` renames by design. Dump a markup outline
beside it so a hook-only redesign is still visible in the diff:

```typescript
// add inside the loop, after the aria snapshot
const outline = await page.locator('body *').evaluateAll(nodes => nodes.map(n => {
  const attrs = [...n.attributes]
    .filter(a => a.name === 'id' || a.name === 'class' || a.name.startsWith('data-') || a.name.startsWith('aria-'))
    .map(a => `${a.name}="${a.value}"`).join(' ');
  return `${n.tagName.toLowerCase()} ${attrs}`.trim();
}).join('\n'));
fs.writeFileSync(`${outDir}/${name}.outline.txt`, outline);
```

An empty `diff old/*.aria.yml new/*.aria.yml` next to an outline diff full of renames is the
signature of a class-only redesign; the Phase 4 mapping comes from the outline diff. A
single-route application with many UI states keys the loop by state (empty, items, editing,
each filter) instead of by route.

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

For every old snapshot there should be a matching new one. A 404 is a finding to investigate. Confirm an intentional product removal before proposing test deletion; routing, authentication, deployment, and application regressions can also cause 404s.

---

## 3. Inventory failed attempts, then verify the cause and source

Use the project's real baseURL configuration; the environment variable below works
only if `playwright.config.ts` reads it. Keep the test process status beside its JSON
report. A reporter/parser completing successfully is not a passing test run.

```bash
mkdir -p .drift-recovery
qa_selector_status=0
PLAYWRIGHT_TEST_BASE_URL="$PREVIEW_URL" \
  npx --no-install playwright test --reporter=json > .drift-recovery/results.json \
  || qa_selector_status=$?
printf '%s\n' "$qa_selector_status" > .drift-recovery/test-exit-code.txt
```

If `playwright.config` already declares reporters (a `json` reporter writing a fixed file,
plus `html`), `--reporter=json` on the command line replaces all of them. Run the project's
own test command instead and copy its JSON output to `.drift-recovery/results.json`, keeping
the exit status the same way.

This adapter targets Playwright's JSON reporter shape: nested `suites[].specs[]`,
`spec.tests[]` for projects, and `test.results[]` for attempts. Check a retained report
from the installed Playwright version before adapting it to another reporter. Keep
**every failed or timedOut attempt**, including earlier failures before a green retry
and expected failures. Interrupted or missing-status attempts remain visible too.
Run-level `report.errors` are separate evidence; they are not broken selectors.

The collector never reads test source or extracts a locator from an error regex.
It preserves the reporter result, including `error`, `errors`, `errorLocation`,
steps and attachments, plus test/project/retry identity. Reporter locations are
leads for inspection, not verified edit positions. Source, locator, route, intent,
and triage evidence start as `null`; no fallback `/` or nearby test title is invented.
Each `attemptId` identifies a position within this report; retain the original
report and run identity when combining evidence from different runs or shards.

```typescript
// scripts/failure-inventory.ts
const record = (value: any, field: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
};
const list = (value: any, field: string): any[] => {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
};

export function collectFailureInventory(input: unknown) {
  const report = record(input, 'report');
  const runErrors = list(report.errors, 'report.errors')
    .map((error, index) => record(error, `report.errors[${index}]`));
  const attempts: any[] = [];
  let observedResults = 0;
  const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
  const visit = (rawSuite: any, suitePath: string, parents: any[]) => {
    const suite = record(rawSuite, suitePath);
    const suiteTitles = [...parents, suite.title ?? null];
    list(suite.specs, `${suitePath}.specs`).forEach((rawSpec, specIndex) => {
      const specPath = `${suitePath}.specs[${specIndex}]`;
      const spec = record(rawSpec, specPath);
      list(spec.tests, `${specPath}.tests`).forEach((rawTest, testIndex) => {
        const testPath = `${specPath}.tests[${testIndex}]`;
        const test = record(rawTest, testPath);
        list(test.results, `${testPath}.results`).forEach((rawResult, resultIndex) => {
          const attemptId = `${testPath}.results[${resultIndex}]`;
          const result = record(rawResult, attemptId);
          const status = result.status ?? null;
          if (status !== null && !statuses.has(status)) throw new Error(`${attemptId}: unknown status`);
          observedResults++;
          if (status === 'passed' || status === 'skipped') return;
          const retry = result.retry ?? null;
          if (retry !== null && (!Number.isInteger(retry) || retry < 0)) {
            throw new Error(`${attemptId}: retry must be a nonnegative integer when supplied`);
          }
          attempts.push({
            attemptId, testId: spec.id ?? null, testTitle: spec.title ?? null,
            suiteTitles, projectName: test.projectName ?? null, projectId: test.projectId ?? null,
            expectedStatus: test.expectedStatus ?? null, testOutcome: test.status ?? null,
            status, retry,
            reportedTestLocation: { file: spec.file ?? null, line: spec.line ?? null, column: spec.column ?? null },
            reporterResult: result,
            triage: 'unreviewed', triageEvidence: null,
            file: null, line: null, column: null, oldLocator: null, intent: null, pageRoute: null,
          });
        });
      });
    });
    list(suite.suites === undefined ? [] : suite.suites, `${suitePath}.suites`)
      .forEach((child, index) => visit(child, `${suitePath}.suites[${index}]`, suiteTitles));
  };
  list(report.suites, 'report.suites').forEach((suite, index) => visit(suite, `suites[${index}]`, []));
  if (!observedResults && !runErrors.length) throw new Error('Report contains no test attempts or run-level errors');
  return { observedResults, runErrors, attempts };
}

// This checks the completeness of an inspected record, not the truth of its claims.
// Call it immediately before passing a reviewed target to Phase 4.
export function requireVerifiedDrift(input: unknown) {
  const row = record(input, 'reviewed failure');
  if (row.triage !== 'confirmed-selector-drift') throw new Error('Manual drift triage is required');
  for (const field of ['attemptId', 'file', 'oldLocator', 'intent', 'pageRoute', 'triageEvidence']) {
    if (typeof row[field] !== 'string' || !row[field].trim()) throw new Error(`Verified ${field} is required`);
  }
  if (!Number.isInteger(row.line) || row.line < 1) throw new Error('Verified source line is required');
  if (row.column !== null && row.column !== undefined && (!Number.isInteger(row.column) || row.column < 1)) {
    throw new Error('Source column must be a positive integer when supplied');
  }
  return row;
}
```

Copy the I/O driver separately. It writes the complete inventory, including attempts
with no error message or source location; malformed JSON/report structure fails.
An all-green report can have an empty failure inventory only after actual results
were observed. A report with run-level errors and no attempts retains those errors.

```typescript
// scripts/identify-drift.ts
import fs from 'fs';
import { collectFailureInventory } from './failure-inventory';

const raw = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync('.drift-recovery/results.json'));
const inventory = collectFailureInventory(JSON.parse(raw));
fs.writeFileSync('.drift-recovery/failure-inventory.json', JSON.stringify(inventory, null, 2));
console.log(`Observed ${inventory.observedResults} results; retained ${inventory.attempts.length} failed/incomplete attempts ` +
  `and ${inventory.runErrors.length} run-level errors. Manual triage is still required.`);
```

Inspect each retained attempt's trace, error details, test and Page Object source,
and the correct old/new application state. A locator timeout can come from missing
hydration, authentication, a network failure, or a product regression. An `expect`
failure can be an assertion timeout caused by a missing locator. Neither spelling
establishes or rules out selector drift.

Keep `triage: 'unreviewed'` until that inspection is complete. For confirmed selector
drift, set `triage: 'confirmed-selector-drift'`, the verified source `file`/`line`
(and `column` when known), exact `oldLocator`, `intent`, `pageRoute`, and a
`triageEvidence` reference explaining the decision. For other causes, record that
classification and its evidence without generating replacement locators. Retain
unresolved and other-cause attempts in the inventory and carry open items into the
recovery PR separately from the source-level candidate table.

Retries may refer to the same source occurrence: keep all attempt IDs as evidence,
then choose one reviewed recovery target per source occurrence. Before Phase 4,
call `requireVerifiedDrift(target)`; it rejects untriaged or incomplete records:

```typescript
// After reviewing the retained attempt and recording its verified context:
import { requireVerifiedDrift } from './failure-inventory';
const failure = requireVerifiedDrift(reviewedTarget); // pass this target to Phase 4
```

The check validates recorded fields, while the trace/source comparison establishes
whether the proposed edit preserves the original intent.

---

## 4. Generate replacement candidates

Loads the new-DOM HTML for each failure's `pageRoute`, generates candidates by the role-first ladder, and only awards **score 3 after region scoping makes the match unique**.

Copy the helper block to `scripts/recovery-candidates.ts`. Keep live Locator objects
for inspection; the `selector` string is a proposed source expression for review,
not a CSS selector and never input to `eval` or `new Function`. Names are quoted as
JavaScript string literals and intent is escaped as literal regex text. `intent` is
therefore the accessible name or visible text the old locator pointed at (`'Clear
completed'`, `'items left'`), not a prose description such as "the todo list container";
a description never matches and yields zero candidates. For an unnamed container (a list,
section or footer without a label) skip `generate()`, write typed candidates by hand,
check each with a live `count()` and score them on the rubric.

```typescript
import { Page, Locator } from '@playwright/test';

type Candidate = { selector: string; score: number; rationale: string; locator: Locator };
const quote = (value: string) => JSON.stringify(value);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function generate(page: Page, intent: string): Promise<Candidate[]> {
  if (typeof intent !== 'string' || !intent.trim()) throw new Error('A verified intent is required');
  const pattern = escapeRegex(intent.trim());
  const rx = new RegExp(pattern, 'i');
  const expression = `new RegExp(${quote(pattern)}, 'i')`;
  const out: Candidate[] = [];
  const add = async (locator: Locator, selector: string, score: number, rationale: string) => {
    if (await locator.count() === 1) out.push({ locator, selector, score, rationale });
  };

  for (const el of await page.locator('[data-testid]').all()) {
    const id = await el.getAttribute('data-testid');
    const text = (await el.textContent())?.trim() ?? '';
    if (id && rx.test(text)) {
      await add(page.getByTestId(id), `getByTestId(${quote(id)})`, 5, 'unique test ID with matching text');
    }
  }
  await add(page.getByLabel(rx), `getByLabel(${expression})`, 4, 'unique labelled field');
  for (const role of ['button', 'link', 'heading', 'textbox', 'checkbox', 'list', 'listitem', 'navigation'] as const) {
    const loc = page.getByRole(role, { name: rx });
    const selector = `getByRole(${quote(role)}, { name: ${expression} })`;
    const count = await loc.count();
    if (count === 1) await add(loc, selector, 4, 'unique role and name');
    else if (count > 1) {
      for (const region of await page.getByRole('region').all()) {
        // Other accessible-name sources need their own inspected adapter.
        const regionName = await region.getAttribute('aria-label');
        if (!regionName) continue;
        const scope = page.getByRole('region', { name: regionName, exact: true });
        if (await scope.count() !== 1) continue;
        await add(scope.getByRole(role, { name: rx }),
          `getByRole('region', { name: ${quote(regionName)}, exact: true }).${selector}`,
          3, `unique within named region ${regionName}`);
      }
    }
  }
  await add(page.getByText(rx), `getByText(${expression})`, 2, 'text-only candidate for review');
  return out.sort((a, b) => b.score - a.score);
}

export async function captureCandidate(candidate: Candidate, screenshotPath: string) {
  if (typeof screenshotPath !== 'string' || !screenshotPath) throw new Error('Screenshot path is required');
  if (await candidate.locator.count() !== 1) throw new Error('Candidate is no longer unique');
  await candidate.locator.screenshot({ path: screenshotPath });
  const { locator, ...record } = candidate;
  return { ...record, screenshotPath, applied: false };
}

// The caller supplies a verified source location and creates screenshotDir first.
export async function proposeRecovery(page: Page, failure: any, screenshotDir: string, failureIndex: number) {
  const unresolved = (rationale: string, selector: string | null = null) => ({
    ...failure, selector, score: 0, rationale, screenshotPath: null, applied: false,
  });
  let candidates: Candidate[];
  try { candidates = await generate(page, failure.intent); }
  catch (error) { return [unresolved(`Candidate generation failed: ${String(error)}`)]; }
  const usable = candidates.filter(candidate => candidate.score >= 3);
  if (!usable.length) return [unresolved('No unique candidate meets the score-three floor')];
  const proposed = [];
  for (const [index, candidate] of usable.entries()) {
    const shot = `${screenshotDir}/candidate-${failureIndex}-${index}.png`;
    try { proposed.push({ ...failure, ...await captureCandidate(candidate, shot) }); }
    catch (error) { proposed.push(unresolved(`Evidence capture failed: ${String(error)}`, candidate.selector)); }
  }
  return proposed;
}
```

Drive these helpers against the correct application state. An inert HTML snapshot
can suggest candidates, but does not reproduce hydration, frames, styles, hidden
states, or shadow roots. Verify the chosen locator on the live test build before applying.

```typescript
// Within the existing recovery runner, after loading the appropriate page state:
import { proposeRecovery } from './recovery-candidates';

const proposed = await proposeRecovery(page, failure, '.drift-recovery/screenshots', failureIndex);
// Persist proposed rows for old/new intent review. Multiple candidates are not an
// instruction to pick the first. Create the screenshots directory before calling.
```

A `count > 1` selector that no region scoped to one match falls through with **no score-3 candidate** — exactly right. It surfaces as score 0 (flag for human), not as a false 3.

---

## 5. Apply (line-anchored), validate, iterate

Replace the specific `(file, line)` — never a content-wide `String.replace`. The reporter's `oldLocator` is a *rendered* string (`locator('.summary > h2')`) that usually does not match the source expression verbatim, `String.replace` hits only the first occurrence, and identical locators on different lines collide.

Apply the reviewed candidate at the identified source node using the TypeScript AST
or a narrow inspected edit. Before writing, require that the current file and exact
old expression still match the reviewed source. Preserve the existing receiver
(`page`, `this.page`, or a page-object variable), chained calls, comments, and unrelated
locators on the same line. Reject stale or ambiguous source positions and paths outside
the intended test files. A regex ending at the first `)` cannot safely edit nested
calls, regex literals, quoted parentheses, or multiple locators on one line.

A candidate's displayed expression is data, not a command. Never evaluate source text
from a DOM attribute, log, or candidate file to construct a Locator. Use the live object
from generation for evidence, and inspect the resulting code diff before rerunning.
Set `applied: true` only for the exact candidate actually written; retain unresolved
rows and any evidence failures. Record the old/new source and candidate commit.

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
# One PR, one commit per test file: a reviewer reads each file's selector changes next to
# its evidence instead of one squashed diff across the suite.
for file in $(git diff --name-only -- tests/); do
  git add "$file"
  git commit -m "test: recover selectors in ${file#tests/}"
done
git add .drift-recovery/candidates.json
git commit -m "chore(tests): selector recovery evidence after <refactor>"
git push -u origin HEAD
gh pr create --title "chore(tests): selector recovery after <refactor>" \
  --body-file .drift-recovery/pr-body.md
```

Summarize by verified source location, so alternative proposals for one edit do not
inflate the unresolved count. Every location without an applied candidate remains
flagged, including high-scoring candidates awaiting review. This compact example
requires one identified locator occurrence per line; split multiple occurrences into
separately identified source nodes before applying or reporting them.

```typescript
// scripts/recovery-summary.ts
import path from 'path';

export function summarizeRecovery(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = JSON.stringify([path.normalize(row.file), row.line]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const recovered: any[] = [], accepted: any[] = [], flagged: any[] = [];
  for (const group of groups.values()) {
    const applied = group.filter(row => row.applied === true);
    if (applied.length > 1) throw new Error('Multiple applied candidates for one source location');
    if (applied.length === 1 && applied[0].score >= 3) recovered.push(applied[0]);
    else if (applied.length === 1) accepted.push(applied[0]); // reviewer-accepted edit below the floor; the scorer still exits 1
    else flagged.push({ ...group[0], rationale: group.map(row => row.rationale).join('; ') });
  }
  return { recovered, accepted, flagged };
}
```

Generate the body from the recorded edits and unresolved locations. Run the scorer
first to check candidate row types and source coordinates.

```typescript
// scripts/build-pr-body.ts
import fs from 'fs';
import { summarizeRecovery } from './recovery-summary';
const c = JSON.parse(fs.readFileSync('.drift-recovery/candidates.json', 'utf8'));
const { recovered, accepted, flagged } = summarizeRecovery(c);

const perFile = Object.entries(
  [...recovered, ...accepted].reduce((m: any, r: any) => ((m[r.file] ||= []).push(r), m), {})
).map(([file, rows]: any) =>
  `### ${file}\n| Line | Old | New | Score | Shot |\n|---|---|---|---|---|\n` +
  rows.map((r: any) => `| ${r.line} | \`${r.oldLocator}\` | \`${r.selector}\` | ${r.score} | ![](${r.screenshotPath}) |`).join('\n')
).join('\n\n');

fs.writeFileSync('.drift-recovery/pr-body.md', `## Trigger
<Link to refactor PR>

## Summary
- ${recovered.length} selectors recovered at score 3 or above
- ${accepted.length} manual updates accepted below the floor (scorer exits 1 until the markup gains a hook)
- ${new Set([...recovered, ...accepted].map((r: any) => r.file)).size} test files updated
- ${flagged.length} flagged for manual review

## Per-file changes
${perFile}

## Flagged for review
${[...accepted.map((f: any) => `- ${f.file}:${f.line} — ${f.oldLocator} → \`${f.selector}\` (score ${f.score}, accepted by reviewer: ${f.rationale})`),
   ...flagged.map((f: any) => `- ${f.file}:${f.line} — ${f.oldLocator} (${f.rationale})`)].join('\n')}

## How to review
- Check each screenshot: does \`new\` point at the same element as \`old\`?
- For score-3 candidates, verify the region scope is meaningful in the new design.
- For flagged tests, decide: rewrite, delete, or accept a manual update.
`);
```

---

## Cleanup

Retain the old/new snapshots, result JSON, candidate records, and screenshots until
review is complete and the evidence is accessible from the PR. Publish artifact
links in the body; a local screenshot path will not render on GitHub. Remove only
the temporary files created for this run after their retention period. Do not delete
the evidence directory immediately after opening the PR.

---

## When this workflow is not enough

- **Semantics changed, not just structure.** A "Submit" button that became a multi-step confirmation flow cannot be rescued by a selector swap — the scenario itself must change. Send those to a human.
- **Deeply encapsulated Page Objects.** If the locator lives three levels into a `CheckoutPage` POM, the line in the reporter is the helper, not the test. Walk the POM source (or read the trace action) to find and apply the real locator.
- **SSR with hydration mismatch.** Wait for the application's own readiness signal before taking the snapshot. Network idle does not establish hydration, and a static HTML replay cannot establish live application behavior.

## Cypress adaptation

The *shape* of the workflow ports to Cypress, but the mechanics do not: Cypress has no trace-zip artifact, a different reporter JSON (`mochawesome`/`mocha`), and no `getByRole`/`ariaSnapshot` equivalent (use `@testing-library/cypress` `findByRole`, and `cy.document().then(d => d.body.outerHTML)` for raw DOM). Reuse Phases 1, 2, 5, 6 conceptually; rewrite the parsing and candidate-generation scripts for the Cypress reporter and `findBy*` queries.
