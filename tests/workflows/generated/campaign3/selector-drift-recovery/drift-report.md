# chore(tests): selector recovery after the TodoMVC redesign (`redesign-classes` build)

PR-style evidence for the `selector-drift-recovery` run. Everything referenced lives under
`tests/workflows/generated/campaign3/selector-drift-recovery/` (paths below are relative to it).
No branch, commit or `gh pr` was created (not permitted for this task); this file is the PR body.

## Trigger

Front-end redesign of the pinned TodoMVC build. Behaviour unchanged (`tests/workflows/todomvc-contract.md`
holds), markup hooks renamed. Lab serves the new build with `QA_TODO_FAULT=redesign-classes`, the old build by default.

## Summary

- 1 test file updated (`todo-ui.mjs`), 0 spec assertions changed, 9/9 tests retained
- 4 selectors changed: 1 auto-applied (score 3), 3 applied as explicit reviewer decisions (scores 2, 1, 1)
- 0 tests deleted, 0 tests flagged as unrecoverable
- Skill scorer (`references/score-candidates.mjs`): applied 4, average 1.75, 3 below the floor, **exit 1** (reported, not loosened)
- Regenerated suite: new build 9 passed / 0 failed, twice (exit 0, 15.5 s and 12.2 s); old build 9 passed / 0 failed (exit 0, 13.4 s)
- `todomvc.spec.mjs` differs from `before/todomvc.spec.mjs.orig` only in the two support import paths (`../../support/` -> `../../../support/`), because this folder is one level deeper

## Per-change evidence (`todo-ui.mjs`)

Line numbers are those of the file at apply time (`before/todo-ui.mjs.orig` numbering). The applied file has a 3-line header comment instead of 2, so the live lines are 5, 11, 12, 13.

| Line | Old locator | New locator | Score | Rubric rung | Intent (verified from source + contract) | Intent check | What proved it |
|---|---|---|---|---|---|---|---|
| 4 | `page.locator('.todo-list')` | `page.getByRole('list').filter({ hasNot: page.getByRole('link') })` | 3 | role, scoped to exactly one match (bare `getByRole('list')` = 2: todo list + filter list) | the `<ul>` whose list items are todo rows; `rows` and `titles` derive from it | same element: screenshot `.drift-recovery/screenshots/target-4-1.png` shows Alpha / Beta(done) / Gamma rows; resolves to `ul.task-list` (new) and `ul.todo-list` (old) | `verify-locators.mjs`: count=1 in items state and in the empty filtered view, both builds; every `toHaveText([...titles])`, `toHaveCount`, `rows.nth(i).getByRole('checkbox')` assertion in all 9 tests passed twice on the new build |
| 10 | `page.locator('.todo-count')` | `page.getByText(/^\d+ items? left$/)` | 2 | visible text only | the counter element whose text is "N item(s) left" | same element: `target-10-0.png` reads "2 items left"; resolves to `span.task-count` (new) / `span.todo-count` (old) | count=1 in all states, both builds; `toHaveText('0 items left' / '1 item left' / '2 items left' / '3 items left')` assertions in SC-001..SC-009 passed twice |
| 11 | `page.locator('.todoapp .main')` | `page.locator('section.main')` | 1 | CSS (no role: unnamed `<section>` is `generic`) | the main section (toggle-all + list) hidden when no todos, visible otherwise | same element: `target-11-0.png` shows the list block; resolves to `section.main` on both builds | count=1 hidden in empty state, visible with items; SC-001 l.10 `toBeHidden` + l.24 `toBeVisible`, SC-008 l.189/l.193/l.200 (hidden -> visible -> hidden) passed twice |
| 12 | `page.locator('.todoapp .footer')` | `page.locator('footer.footer')` | 1 | CSS (no role: `<footer>` inside `<section>` is not `contentinfo`) | the app footer (count, filters, Clear completed) hidden when no todos | same element: `target-12-0.png` shows "2 items left / All Active Completed / Clear completed"; `footer.footer` on both builds | count=1 in all states; SC-001 l.11/l.25, SC-003 l.63, SC-005 l.128, SC-008 l.190/l.194/l.201 passed twice |

Rejected alternatives (all in `.drift-recovery/candidates.json`, `applied: false`):
`getByRole('list')` bare (count 2 -> score 0), `getByRole('list').filter({ has: getByRole('checkbox') })` (score 3 but count 0 in the empty filtered view),
`.task-list`, `.task-count`, `.taskapp .main`, `.taskapp .footer` (renamed-class CSS, score 1, would re-break on the next rename).

Locators verified NOT drifted (kept as-is): `getByPlaceholder('What needs to be done?')`, `getByRole('checkbox', { name: /Mark all as complete/ })`,
`getByText('Mark all as complete', { exact: true })`, `getByRole('link', { name, exact: true })`, `getByRole('button', { name: /Clear completed/ })`,
`row.locator('label')`, `row.getByRole('textbox')`, `row.getByRole('button')`, spec `toHaveClass(/selected/)` (class unchanged in the redesign).

## Flagged for review

No source location is unrecovered. Three applied rows sit below the rubric's auto-apply floor and were applied as reviewer decisions
(`appliedMode` in `candidates.json`):

- `todo-ui.mjs:10` score 2 (text). The element has no role, label or testid in either build; its text is exactly the asserted property.
- `todo-ui.mjs:11` score 1 (CSS). `<section class="main">` has no accessible role or name; the class survived the redesign, the renamed root (`.todoapp`) was dropped.
- `todo-ui.mjs:12` score 1 (CSS). Same for `<footer class="footer">`.

Ask for the front-end team (rubric rung 1 / 4, the only way these three reach the floor): add `data-testid` or landmark names,
e.g. `<section class="main" aria-label="Todo list">`, `<footer class="footer" aria-label="Todo summary">`, `data-testid="todo-count"`.

## How to review

- Open each screenshot above and the old/new outline pair (`.drift-recovery/old/items.outline.txt`, `.drift-recovery/new/items.outline.txt`).
- For the score-3 row: the scope is "the list that contains no links"; the filter list is the only other list on the page. Verified unique in six UI states on both builds.
- For the three sub-floor rows: accept the manual update (they are the same element on both builds and nothing better exists) or require the testids above first.

## Phase log

| Phase | What ran | Gate | Result |
|---|---|---|---|
| 1 Old DOM | `.drift-recovery/scripts/snapshot-dom.mjs` (recipe `snapshot-dom.ts` ported) on the default build; six states: empty, items, hover, editing, filter-active, filter-completed; each as `.aria.yml`, `.html`, `.outline.txt`, `.png` under `.drift-recovery/old/` | a snapshot file answers "what did the page look like when tests passed" | passed |
| 2 New DOM | same script with `QA_TODO_FAULT=redesign-classes` -> `.drift-recovery/new/` | every old snapshot has a new one; no 404 | passed. **Aria diff identical for all six states**; the outline/HTML diff carries the whole drift (10 class/id renames, no new testids) |
| 3 Inventory | old suite on the new build (project command, JSON report kept as `.drift-recovery/results.json`, exit status 1 in `test-exit-code.txt`); `identify-drift.mjs` -> `failure-inventory.json` (9 attempts, 0 run errors); `verify-locators.mjs` live counts on both builds; `triage.mjs` -> `reviewed-targets.json` with `requireVerifiedDrift` on 4 targets + 3 negative controls | only `confirmed-selector-drift` with verified file/line/locator/intent/route/evidence enters Phase 4 | passed. Reporter located the failing spec lines (8x) and `todo-ui.mjs:26` (1x), never the definition at `todo-ui.mjs:4`; 3 of 4 drifted locators were latent (not in any error) and came from source inspection |
| 4 Candidates | `generate-candidates.mjs`: recipe `proposeRecovery()` as written (0 candidates for all 4 targets) + inspected adapter (10 rows, 9 screenshots) -> `candidates.json` (14 rows) | every row has a candidate >= 3 or is flagged | 1 of 4 targets reached the floor; 3 flagged, then reviewer-accepted |
| 5 Apply + validate | `apply-candidates.mjs` (line-anchored, exact old expression required once on the line) -> 4 applied; suite on new build twice (9/9, 9/9), jq gate true twice; old-build control 9/9 | recovered tests pass the full suite | passed; scorer exit 1 (3 sub-floor rows) reported as-is |
| 6 Ship | `build-pr-body.mjs` (recipe port) -> `.drift-recovery/pr-body.md`; this file | PR reviewable in one sitting | PR body produced, no git/gh (not permitted) |

## Runs (candidate commit 736b88e, macOS, Node 26.0.0, Playwright 1.62.1, Chromium, 2 workers, retries 0)

| Run | Build | Suite | Result | Exit | Duration | Report |
|---|---|---|---|---|---|---|
| Phase 3 | new | original helper | 0 passed / 9 failed / 0 skipped / 0 flaky | 1 | 77.3 s | `.drift-recovery/results.json` |
| Validation 1 | new | regenerated | 9 passed / 0 failed / 0 skipped / 0 flaky | 0 | 15.5 s | `.drift-recovery/post-recovery-new-run1.json` |
| Validation 2 | new | regenerated | 9 passed / 0 failed / 0 skipped / 0 flaky | 0 | 12.2 s | `.drift-recovery/post-recovery-new-run2.json` |
| Control | old | regenerated | 9 passed / 0 failed / 0 skipped / 0 flaky | 0 | 13.4 s | `.drift-recovery/post-recovery-old-build.json` |

The control run was expected to fail on the old build; it did not. All four replacements are role, text or unchanged-class locators
that resolve to the same elements on both builds (`verify-locators.mjs` on the default build: `ul.todo-list`, `span.todo-count`,
`section.main`, `footer.footer`, count=1 each). The regenerated suite is build-agnostic, which is the stated goal of role-first recovery.
