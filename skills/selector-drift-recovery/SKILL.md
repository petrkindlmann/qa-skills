---
name: selector-drift-recovery
description: >-
  Bulk-regenerate broken test selectors after a UI refactor or redesign. Detects
  drift between old and new DOM, maps old locators to new equivalents using
  role-first + neighbor context, validates against the new build, and produces a
  single PR with grouped per-file selector updates and per-change evidence. Use
  when: "UI refactor broke tests," "redesign broke tests," "bulk update
  selectors," "regenerate selectors after refactor," "selector drift," "fix N
  broken tests after redesign." Not for: healing one flaky test at runtime — use
  `test-reliability`. Not for: writing a new test suite from scratch — use
  `playwright-automation`.
  Related: test-reliability, playwright-automation, ci-cd-integration, ai-bug-triage, visual-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Close the maintenance loop between a UI refactor and the test suite that depended on the old DOM. The trigger is an event (a redesign shipped, a component library migrated, a Tailwind upgrade), not a flaky test. The output is a single PR that updates many selectors at once with per-change evidence — not a runtime auto-heal.

This skill is the bulk, offline, batch counterpart to `test-reliability`. They share the multi-attribute locator + confidence scoring primitives but apply them in opposite directions:

- `test-reliability` reacts to a single test flake at runtime, heals one selector with a guarded confidence threshold, runs the test, and decides whether to keep the repair.
- `selector-drift-recovery` reacts to a refactor event, regenerates N selectors offline against the new DOM, validates the whole suite, and ships the diff as a reviewable PR.

If you find yourself doing the second workflow inside `test-reliability`, switch to this skill.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It identifies your E2E framework, selector strategy, and known fragile areas.
</objective>

---

## Discovery Questions

1. **What triggered the drift?** A planned refactor (Storybook can show the new DOM before merge), a shipped redesign (the new DOM is in main), a dependency upgrade (component library bumped), or a Tailwind/CSS framework migration? The trigger determines whether you run pre-emptively or react to CI failures.

2. **What is the blast radius?** A single component, a page, or the whole app? If a single component: scope the recovery to test files that touch it. If global: budget for a half-day to a day, and consider whether some tests should be rewritten rather than re-selected.

3. **What is your current selector strategy?** If selectors are mostly `data-testid` and the refactor preserved testids, the recovery is trivial. If selectors are CSS class-based or XPath, expect 30-60% of selectors to need new strategies, not just new locators.

4. **Is there a passing baseline?** You need *somewhere* the old DOM still exists: a previous CI artifact, a deployed staging build, a Storybook story, or the git history of the components. Without an old DOM reference, this skill degrades to "rewrite tests."

5. **Who reviews the resulting PR?** Confidence-scored automated updates need a human signoff. Decide before you start whether the PR goes to the test author, the engineer who did the refactor, or the QA lead.

---

## Core Principles

1. **Recovery is event-driven, not failure-driven.** Run this when a refactor is planned or just shipped, not when one test goes flaky. If you have one broken test, use `test-reliability`. If you have ten, this is the right tool.

2. **Old DOM, new DOM, mapped pair.** The whole skill rests on having a snapshot of the DOM before the refactor and a snapshot after. Everything else is bookkeeping around that pair. If you cannot produce both snapshots, fix that first.

3. **Role-first replacement, every time.** Even if the old test used CSS selectors, the regenerated selector should prefer `getByRole` + accessible name, with neighbor context as the disambiguator. The recovery PR is a chance to ratchet up the average selector stability score (see `test-reliability` for the 0-5 rubric).

4. **One PR, grouped by file, with per-change evidence.** Reviewers cannot eyeball 47 selector changes spread across 30 commits. Bundle the update into one PR, group hunks by test file, and attach a confidence score + DOM screenshot per change.

5. **The suite must pass before merge.** A confidence-scored auto-regenerated selector that doesn't run, or runs and fails, is not a recovery — it's a worse version of the original problem. The skill ends with a green CI run, not a generated diff.

6. **Tests that no longer make sense should be deleted, not patched.** If a refactor removed a feature, the tests for that feature are dead. Treat the recovery as an opportunity to prune, not just to translate.

---

## Workflow

The workflow has six phases. Each phase has a check that gates progression to the next.

### Phase 1 — Snapshot the old DOM

You need a snapshot of every page or component the affected tests touch, in its pre-refactor state.

**Sources, in preference order:**

1. **Last green CI artifact.** Most teams configure Playwright to save traces on failure. If you have a green-run artifact with traces from before the refactor, you have the old DOM for every test that ran. Extract `*.zip` traces, open them with `npx playwright show-trace`, and snapshot the relevant frames.
2. **Storybook stories at a pre-refactor commit.** Check out the commit immediately before the refactor and start Storybook. Use `page.content()` to dump HTML per story.
3. **A staged-on-staging build.** If staging still runs the old version, navigate the same flows and snapshot.
4. **Git history of the components.** Reconstructable, but the most expensive option — render components in isolation.

Output of this phase: a directory `/.drift-recovery/old/<page-or-component>.html` for each affected unit.

**Gate:** You can answer "what did the page look like when these tests last passed?" with HTML, not from memory.

### Phase 2 — Snapshot the new DOM

Run the same surfaces in the post-refactor build. Use the deployed preview (Vercel preview deploys are ideal), a local dev server, or the PR branch in CI.

Output: `/.drift-recovery/new/<page-or-component>.html` matching the old set.

**Gate:** For every old snapshot, there is a matching new snapshot. If the page was deleted, mark its test files for the deletion pile in Phase 6.

### Phase 3 — Identify broken selectors

For each test file:

1. Run the test against the new build. Capture every locator that throws `TimeoutError: locator.* exceeded`.
2. For each broken locator, extract its source line and the locator string.
3. Map the locator's intended target by reading the surrounding code — what assertion follows, what action is being taken.

A short script that consumes a Playwright JSON report and groups failures by file is the right form factor. The output is a table:

| Test file | Line | Old locator | Inferred intent |
|---|---|---|---|
| `tests/checkout.spec.ts` | 42 | `getByTestId('submit-btn')` | Submit the order |
| `tests/checkout.spec.ts` | 87 | `locator('.summary > h2')` | Read the summary heading |

**Gate:** Every broken locator has an inferred intent. If you cannot infer the intent, ask the test author or read the original PR — do not guess.

### Phase 4 — Generate replacement candidates

For each row in the table, generate replacement selectors against the new DOM:

1. **Role-first.** Find an element in the new DOM matching the inferred intent that has a role + accessible name. Score 4-5 on the stability rubric.
2. **Neighbor context.** If role alone is ambiguous (multiple buttons named "Submit"), add a nearby-text disambiguator (e.g. `near=` or scoped within a region role).
3. **Test ID, if added during refactor.** If the new DOM has a `data-testid` that wasn't in the old DOM, prefer it — that's the most stable choice the refactor team made.
4. **Fall back to neighbor + tag** only when no role exists.

For each candidate, compute a confidence score (reuses the rubric from `test-reliability`):

| Score | Replacement strategy |
|---|---|
| 5 | New `data-testid` exists |
| 4 | `getByRole` + accessible name, unique on page |
| 3 | `getByRole` + name + region-scoped |
| 2 | Visible-text-only |
| 1 | CSS class on changed structure |
| 0 | No safe replacement found — flag for human |

Output: a CSV or JSON with `file, line, old, new, score, screenshot_path` for every change.

**Gate:** Every row has a candidate with score ≥ 3, or is flagged for human review. Score-0 and score-1 candidates do not get auto-applied.

### Phase 5 — Validate

1. Apply the replacements to a feature branch.
2. Run the full affected test suite (not just the previously-failing tests — replacements can break passing tests if the new selector matches unintended elements).
3. For each test:
   - **Passed:** keep the replacement.
   - **Failed:** revert that one replacement, mark the test for human review.
4. Generate a summary: N tests recovered automatically, M flagged for review.

**Gate:** Recovered tests pass the suite. Flagged tests are clearly marked, not silently included.

### Phase 6 — Ship the PR

The PR is the actual deliverable. Structure:

**Title:** `chore(tests): selector recovery after <refactor description>`

**Body:**

```markdown
## Trigger
<Link to the refactor PR or describe the redesign>

## Summary
- N test files updated
- M selectors changed
- K tests deleted (no longer applicable)
- L tests flagged for manual review

## Per-file changes
<For each file, a table of: line, old, new, score, screenshot URL>

## Flagged for review
<List of tests where no candidate scored ≥ 3, with the inferred intent>

## How to review
- Check the screenshots: does each `new` selector point at the element the `old` selector pointed at?
- For tests with score 3 candidates, verify the neighbor-context disambiguator is meaningful in the new design.
- For flagged tests, decide: rewrite, delete, or accept a manual selector update.
```

Attach the screenshots inline using the CI artifact URL pattern your team uses.

**Gate:** PR is reviewable in one sitting. If the diff is too large to review, split by area (one PR per page / per component / per test directory).

---

## When to NOT use this skill

- **One broken test.** Use `test-reliability`. The overhead of snapshotting old and new DOM is not worth it for a single locator.
- **No DOM snapshot available.** If you cannot produce a "before" reference, this becomes "rewrite tests." Either capture a snapshot first or scope down the recovery.
- **The refactor was a rewrite, not a refactor.** If the UI is entirely different — new flows, new components, new mental model — the tests should be rewritten from the new specs, not regenerated against the new DOM.
- **The team practices visual regression testing on every PR.** If you have `visual-testing` running on every PR, you should never have reached the "47 broken tests" state — the visual diffs would have caught the refactor at PR time. If this skill keeps getting used, the upstream problem is missing visual coverage.

---

## Anti-patterns

1. **Skipping the screenshots.** Confidence scores are necessary but not sufficient. A score-4 candidate can point at the wrong element if the page has two regions with the same role + name. The screenshot per change is the only check that catches semantic drift.

2. **Auto-applying score-1 and score-2 candidates.** A score-1 candidate is "we found something that might be the right element." That is not recovery — that is gambling.

3. **Running this skill in CI without a human reviewer.** The PR is the artifact. Auto-merging a recovery PR defeats the purpose; the whole point is that a reviewer eyeballs the per-change evidence.

4. **Treating the PR as urgent.** A failed test suite feels urgent. A *correctly* recovered test suite is what matters. Time-pressure on this workflow produces score-2 replacements that erode trust in the suite.

5. **Recovering tests for deleted features.** The refactor may have removed flows. Map deleted flows during Phase 2 and prune the tests, do not regenerate selectors for elements that no longer exist.

6. **Not updating the average selector stability score after.** The recovery is an opportunity to ratchet the suite-wide average up. If you regenerated 47 selectors and the new average isn't higher, you spent the budget poorly.

---

## Done When

- All tests in scope either pass on the new build, are flagged for human review with a clear reason, or are deleted because the feature they covered is gone.
- The PR is open with per-change evidence (screenshots + confidence scores).
- The average selector stability score for the recovered files is ≥ 3.5.
- A short note is added to `.agents/qa-project-context.md` describing the refactor and any new test patterns introduced.

---

## Related Skills

- **`test-reliability`** — runtime per-test healing. Use for one flaky test, not a refactor-driven mass update.
- **`playwright-automation`** — writing new tests from scratch. Use when the refactor removed enough features that the tests should be rewritten, not patched.
- **`visual-testing`** — if you had this running on every PR, the refactor would have flagged the visual diff before merge. Recovery is the workflow you fall back on when this is missing.
- **`ci-cd-integration`** — to wire the recovery PR's validation step into your CI.
- **`ai-bug-triage`** — to classify the original failure stream that triggered the recovery, separating selector drift from real product regressions.

---

## References

- See `references/refactor-recovery-workflow.md` for the full step-by-step playbook with example scripts.
