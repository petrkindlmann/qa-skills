---
name: selector-drift-recovery
description: >-
  Bulk-regenerate broken test selectors after a UI refactor or redesign. Detects
  drift between old and new DOM with an aria-snapshot diff, maps old locators to
  new equivalents using role-first + region scoping, validates against the new
  build, and produces a single PR with grouped per-file selector updates and
  per-change evidence. Assumes Playwright >= 1.50 (trace viewer DOM-snapshot
  panel, getByRole filtering, ariaSnapshot). Use when: "UI refactor broke tests,"
  "redesign broke tests," "bulk update selectors," "regenerate selectors after
  refactor," "selector drift," "fix N broken tests after redesign." Not for:
  healing one flaky test at runtime — use test-reliability. Not for: writing a new
  test suite from scratch — use playwright-automation. Not for: re-recording tests
  after a framework switch (Selenium to Playwright) — use test-migration.
  Related: test-reliability, playwright-automation, test-migration, ci-cd-integration, visual-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
A redesign shipped and 23 tests now fail with `TimeoutError: locator.* exceeded` — the DOM moved, not the product. This skill closes that maintenance loop: it diffs the old DOM against the new one, regenerates the broken selectors role-first against the new build, validates the whole suite, and ships the diff as one reviewable PR with a confidence score and screenshot per change. The trigger is an event (a refactor merged), not a flake. The output is a PR a human signs off on — not a silent runtime auto-heal.

This is the bulk, offline, batch counterpart to `test-reliability`. They share the multi-attribute locator + confidence scoring primitives but run in opposite directions: `test-reliability` heals one selector at runtime behind a guarded threshold; `selector-drift-recovery` regenerates N selectors offline against the new DOM and bundles them into a PR. If you are doing the second workflow inside `test-reliability`, switch here.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| One broken test, not a refactor | Stop — use `test-reliability` instead |
| 200+ broken selectors across many files | Split by area first (one PR per page/dir), then Phase 1 |
| Refactor changed flows/semantics, not just structure | Stop — rewrite from specs with `playwright-automation` |
| Framework switch (Selenium → Playwright) | Stop — use `test-migration`, not drift recovery |
| No old-DOM reference exists anywhere | Capture one (Phase 1) or scope down — without it this is "rewrite tests" |
| Have old + new DOM, ready to map | Phase 1 → 6 below |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything answered there. It identifies your E2E framework, selector strategy, and known fragile areas. Then:

1. **What triggered the drift?** A planned refactor (Storybook can show the new DOM before merge), a shipped redesign (new DOM is in main), a dependency upgrade, or a Tailwind/CSS migration? The trigger decides whether you run pre-emptively or react to CI failures.
2. **What is the blast radius?** A single component, a page, or the whole app? Single component: scope recovery to the test files that touch it. Global: budget half a day to a day, and decide which tests should be rewritten rather than re-selected.
3. **What is your current selector strategy?** If selectors are mostly `data-testid` and the refactor preserved testids, recovery is trivial. If they are CSS-class or XPath based, expect 30–60% to need a new *strategy*, not just a new locator.
4. **Is there a passing baseline?** You need the old DOM *somewhere*: a previous CI trace artifact, a deployed staging build, a Storybook story, or git history of the components. No old-DOM reference means this degrades to "rewrite tests."
5. **Are the broken locators inline or wrapped in a Page Object?** The JSON reporter's `error.location` points at the *failing line*. For inline locators that is the locator itself; for POM-wrapped locators it points at the POM helper, not the test. Know this before you trust the auto-extracted line numbers (see Failure Modes).
6. **Who reviews the resulting PR?** Confidence-scored updates need a human signoff. Decide upfront whether the PR goes to the test author, the engineer who did the refactor, or the QA lead.

---

## Core Principles

1. **Recovery is event-driven, not failure-driven.** Run this when a refactor is planned or just shipped, not when one test goes flaky. One broken test → `test-reliability`. Ten or more from the same event → this skill.

2. **Old DOM, new DOM, mapped pair.** The whole skill rests on a snapshot before the refactor and one after. Everything else is bookkeeping around that pair. Capture both as **aria snapshots** (`await page.locator('body').ariaSnapshot()`), not raw HTML — a role-tree diff is exactly the signal role-first recovery needs and ignores the cosmetic churn (class renames, wrapper divs) that a raw-HTML diff drowns in. If you cannot produce both snapshots, fix that first.

3. **Role-first replacement, every time.** Even when the old test used CSS, the regenerated selector should prefer `getByRole` + accessible name, then `getByLabel` for form fields, then `getByTestId` when the refactor added one. The recovery PR is your chance to ratchet the average selector stability score up (0–5 rubric below, shared with `test-reliability`).

4. **Disambiguate by region scoping, not layout selectors.** When role+name is ambiguous (two "Submit" buttons), narrow with `getByRole('region', { name }).getByRole('button', …)` or `getByRole(...).filter({ hasText })`. Do **not** reach for `:near()` / `:right-of()` — see the Avoid note. A score-3 candidate is one where region scoping has been *applied* and the locator now matches exactly one element.

5. **One PR, grouped by file, with per-change evidence.** Reviewers cannot eyeball 47 selector changes spread across 30 commits. Bundle into one PR, group hunks by test file, attach a confidence score + DOM screenshot per change.

6. **The suite must pass before merge, and dead tests get deleted.** A regenerated selector that doesn't run is a worse version of the original problem; the skill ends with green CI, not a generated diff. And if the refactor removed a feature, prune its tests — do not regenerate selectors for elements that no longer exist.

> **Avoid:** Playwright layout selectors `:near()`, `:right-of()`, `:left-of()`, `:above()`, `:below()` as disambiguators — officially deprecated and "may be removed," because a 1px layout shift changes the match (Playwright docs, 2026). They also contradict the role-first thesis. Use region scoping / `getByRole().filter()` instead.

---

## Workflow

Six phases, each gated by a check before the next.

### Phase 1 — Snapshot the old DOM

You need a snapshot of every page or component the affected tests touch, in its pre-refactor state. **Sources, in preference order:**

1. **Last green CI trace artifact.** Most teams save Playwright traces on failure (`trace: 'on-first-retry'`). Download the green-run artifact, open a trace with `npx playwright show-trace traces/checkout.zip`, select an action, and read the per-action **DOM snapshot panel** for each surface. (The viewer no longer has a "Copy HTML at this step" menu item; you read the snapshot panel or, for a programmatic dump, replay with `page.content()` / `ariaSnapshot()`.)
2. **Storybook at a pre-refactor commit.** `git checkout <PRE_REFACTOR_SHA>`, start Storybook, and dump each story with a tiny `page.content()` / `ariaSnapshot()` script.
3. **A staging build still on the old version.** Navigate the same flows and snapshot.
4. **Git history of the components.** Reconstructable but the most expensive — render in isolation.

Output: `.drift-recovery/old/<page-or-component>.aria.yml` (and `.html` if you also need raw markup) per affected unit.

**Gate:** You can answer "what did this page look like when the tests last passed?" from a snapshot file, not from memory.

### Phase 2 — Snapshot the new DOM

Run the same surfaces in the post-refactor build — a Vercel/Netlify preview deploy is ideal, or a local dev server / the PR branch in CI. Wait for hydration (`await page.waitForLoadState('networkidle')`) before snapshotting, or SSR pages give you the pre-hydration tree and you miss client-rendered elements.

Output: `.drift-recovery/new/<page-or-component>.aria.yml` matching the old set.

**Gate:** Every old snapshot has a matching new one. If a route 404s in the new build, that flow was deleted — mark its tests for the deletion pile in Phase 6.

### Phase 3 — Identify broken selectors and infer intent

For each test file, run against the new build with the JSON reporter, then parse it. Capture, per failure: **file, line, old locator string, error type (timeout vs assertion), and inferred intent**. Group the results by test file.

- **Error classification:** a drift failure is `TimeoutError: locator.* exceeded`. Distinguish it from an assertion failure (`expect(...).toBe`) so you don't try to re-select a locator that resolved fine but failed a value check.
- **Inferred intent is mandatory and not in the reporter.** Read the surrounding test code — what action is taken on the locator, what assertion follows — and store a short intent string ("submit the order", "read the order total"). The candidate generator keys off intent, so this step is load-bearing, not commentary.
- **Page route is also not in the reporter.** Map each locator to the snapshot it should resolve against (which `.drift-recovery/new/*.aria.yml`) so Phase 4 can load the right new DOM.

The result is a per-file table:

| Test file | Line | Old locator | Error type | Page route | Inferred intent |
|---|---|---|---|---|---|
| `tests/checkout.spec.ts` | 42 | `getByTestId('submit-btn')` | timeout | `/checkout` | Submit the order |
| `tests/checkout.spec.ts` | 87 | `locator('.summary > h2')` | timeout | `/checkout` | Read the order total |

See `references/recovery-scripts.md` for `identify-drift.ts`, which produces exactly these rows (with the intent/route fields populated, not stubbed).

**Gate:** Every broken locator has an inferred intent and a page route. If you cannot infer intent, ask the test author or read the original PR — do not guess.

### Phase 4 — Generate replacement candidates

For each row, generate candidates against the **new** DOM snapshot and score each on the 0–5 rubric (shared with `test-reliability`). Strategy ladder, best first:

1. **New `data-testid`** added by the refactor team — the most stable choice they made. Score 5.
2. **`getByRole` + accessible name, unique on the page.** Score 4.
3. **`getByLabel` for a form field**, when the intent is an input and a label exists. Score 4 (use over a bare role when the field has no name otherwise).
4. **Role + name, region-scoped to a single match.** If role+name alone returns >1 element, wrap it — `getByRole('region', { name }).getByRole(role, { name })` or `.filter({ hasText })` — and confirm the scoped locator now matches exactly one. Only score 3 **after** scoping makes it unambiguous.
5. **Visible text only** (`getByText`). Score 2 — fragile to copy changes.
6. **CSS class on the changed structure.** Score 1 — usually still broken.
7. **No safe replacement.** Score 0 — flag for human.

| Score | Replacement strategy | Auto-apply? |
|---|---|---|
| 5 | New `data-testid` exists | yes |
| 4 | `getByRole` + accessible name (or `getByLabel`), unique on page | yes |
| 3 | `getByRole` + name, region-scoped to exactly one match | yes |
| 2 | Visible-text-only | no |
| 1 | CSS class on changed structure | no |
| 0 | No safe replacement found | no — flag for human |

A candidate is **score 3 only if scoping already resolved it to a single element**. A still-ambiguous multi-match (`count > 1`, "needs scoping") is not a 3 — it is unfinished, and must not be auto-applied.

Output: `.drift-recovery/candidates.json` with `{ file, line, oldLocator, selector, score, rationale, screenshotPath }` per change. See `references/recovery-scripts.md` for `generate-candidates.ts`.

**Gate:** Every row has a candidate scored ≥ 3 (and confirmed unique), or is flagged for human review. Score-0/1/2 are never auto-applied.

### Phase 5 — Apply, validate, iterate

1. Apply the score-≥3 replacements to a feature branch. Replace by `(file, line)`, not a content-wide string replace — the reporter's locator string is a *rendered* form (`locator('.summary > h2')`) that rarely matches the source expression verbatim, and a naive `String.replace` hits only the first occurrence and collides on identical locators. Edit the specific line; set `applied: true` on each candidate you actually wrote.
2. Run the **full affected suite**, not just the previously-failing tests — a new selector can match an unintended element and break a previously-passing test.
3. Per test: **passed** → keep the replacement. **failed** → revert that one line, mark the test for human review.
4. Emit a summary: N recovered automatically, M flagged.

**Gate:** Recovered tests pass the suite. Flagged tests are clearly marked, not silently included.

### Phase 6 — Ship the PR

The PR is the deliverable. **Title:** `chore(tests): selector recovery after <refactor description>`. **Body** (generated from `candidates.json`, filtering on `applied`):

```markdown
## Trigger
<Link to the refactor PR / describe the redesign>

## Summary
- N test files updated   - M selectors changed
- K tests deleted (feature removed)   - L tests flagged for manual review

## Per-file changes
<For each file: a table of line, old, new, score, screenshot URL>

## Flagged for review
<Tests where no candidate scored >= 3, with the inferred intent>

## How to review
- Check each screenshot: does `new` point at the element `old` pointed at?
- For score-3 candidates, verify the region scope is meaningful in the new design.
- For flagged tests, decide: rewrite, delete, or accept a manual selector update.
```

Attach screenshots inline via your team's CI artifact URL pattern. See `references/recovery-scripts.md` for `apply-recovery.ts` (line-anchored) and `build-pr-body.ts`.

**Gate:** PR is reviewable in one sitting. Too large → split by area (one PR per page / component / test directory).

---

## Anti-Patterns

1. **Auto-applying score-0, -1, or -2 candidates.** A score-2 is "we found *some* element." That is gambling, not recovery — and it is the usual cause of a suite-wide stability score *dropping* after a recovery. Auto-apply only score ≥ 3.

2. **Calling an ambiguous multi-match "score 3."** If `getByRole(...)` returns >1 element it is not a 3 until region scoping narrows it to exactly one. Scoring it 3 and auto-applying ships a locator that resolves to the wrong element.

3. **Skipping the screenshots.** A score-4 candidate can still point at the wrong element when the page has two regions with the same role + name. The per-change screenshot is the only check that catches semantic drift; confidence scores alone do not.

4. **Content-wide string replace instead of line-anchored edits.** `content.replace(oldLocator, …)` hits the first occurrence only, collides on duplicate locators, and silently no-ops when the reporter's rendered string differs from the source expression. Edit the specific `(file, line)`.

5. **Trusting auto-extracted line numbers for POM-wrapped locators.** The JSON reporter's `error.location` points at the failing line, which for a Page Object is the helper, not the test. Re-read the locator from the trace action or grep the POM source before applying.

6. **Recovering tests for deleted features.** The refactor may have removed flows. Map deleted routes in Phase 2 and prune those tests — do not regenerate selectors for elements that no longer exist.

7. **Auto-merging the recovery PR in CI.** The PR *is* the artifact; the whole point is a human eyeballing the per-change evidence. Auto-merge once tests pass defeats the purpose — a green suite with a selector pointing at the wrong-but-present element passes and erodes trust. Require a reviewer.

8. **Treating the PR as urgent.** A failed suite feels urgent; a *correctly* recovered one is what matters. Time pressure produces score-2 replacements that quietly degrade the suite.

---

## Failure Modes

| Symptom | Likely cause | Fix or check |
|---|---|---|
| `identify-drift.ts` finds 0 failures despite red CI | Suite errored before producing the JSON report, or you parsed the wrong file | `jq '.stats' .drift-recovery/results.json`; confirm `--reporter=json` redirected to the file |
| Extracted line points at a POM file, not the test | Locator is wrapped in a Page Object | Read the locator from the trace action, or grep the POM source for the rendered string |
| `generate-candidates.ts` reads `undefined` for intent/route | Phase 3 output missing the inferred-intent / page-route fields | Populate them in Phase 3 — they are not in the reporter; the generator cannot infer them |
| New-DOM snapshot is missing client-rendered elements | Snapshotted before hydration | Add `await page.waitForLoadState('networkidle')` before `ariaSnapshot()` |
| Average stability score dropped after recovery | Score-2/CSS candidates auto-applied | Revert candidates with score < 3 in `candidates.json`; only role/label/testid should land (see scorer below) |

---

## Verification

Run these on the recovery branch before opening the PR, smallest first:

```bash
# 1. No applied candidate is below the stability floor (machine-checkable proxy for "ratcheted up")
node references/score-candidates.mjs .drift-recovery/candidates.json
# prints average score + count of applied rows with score < 3 — that count MUST be 0

# 2. The recovered suite is green against the new build
PLAYWRIGHT_TEST_BASE_URL=$PREVIEW_URL npx playwright test --reporter=json \
  | jq '.stats.unexpected'        # must be 0 (flagged tests excluded via grep/skip)

# 3. The PR exists with the evidence body
gh pr view --json title,body -q '.title'   # contains "selector recovery"
```

`references/score-candidates.mjs` reads `candidates.json`, prints the average applied score and the count of `applied && score < 3` rows; a non-zero count means a low-confidence selector leaked in. Step 1 passing + step 2 returning `0` is the proof the recovery worked.

---

## Done When

- Every in-scope test passes on the new build, is flagged for human review with a clear reason, or is deleted because its feature is gone.
- `references/score-candidates.mjs candidates.json` reports **0** applied candidates with score < 3.
- The PR is open (`gh pr view` succeeds) with per-change evidence: confidence score and screenshot per change, grouped by file.
- `npx playwright test --reporter=json | jq '.stats.unexpected'` returns `0` on the recovery branch.
- A short note is added to `.agents/qa-project-context.md` describing the refactor and any new test patterns introduced.

## Reference Files (in `references/`)

- **recovery-scripts.md** — the full playbook with corrected, runnable scripts: aria-snapshot capture, `identify-drift.ts` (populates intent + route), `generate-candidates.ts` (region-scoping ladder, true score-3), line-anchored `apply-recovery.ts`, and `build-pr-body.ts`. Includes the Cypress-adaptation note.
- **score-candidates.mjs** — tiny stability scorer; prints the average applied score and the count of applied rows below score 3. Used by Verification and Done When.

## Related Skills

- **test-reliability** — runtime per-test healing. Use for one flaky test, not a refactor-driven mass update. Shares the 0–5 stability rubric.
- **playwright-automation** — writing new tests from scratch. Use when the refactor removed enough features that tests should be rewritten, not patched.
- **test-migration** — switching frameworks (Selenium → Playwright). A migration re-records tests; it is not selector drift, even though both touch many tests at once.
- **visual-testing** — had this run on every PR, the refactor's visual diff would have flagged before merge. Recovery is the fallback when that coverage is missing.
- **ci-cd-integration** — wires the recovery PR's validation step into CI.
