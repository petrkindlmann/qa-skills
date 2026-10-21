# final-response.md — selector-drift-recovery on the TodoMVC redesign

## What actually ran (candidate commit 736b88e, macOS, Node 26.0.0, Playwright 1.62.1 Chromium, 2 workers, retries 0)

| Step | Command (abridged; full text in execution.log) | Observed |
|---|---|---|
| Phase 1 old DOM | `node .drift-recovery/scripts/snapshot-dom.mjs .drift-recovery/old` | 6 states x (aria.yml, html, outline.txt, png) |
| Phase 2 new DOM | `QA_TODO_FAULT=redesign-classes node .../snapshot-dom.mjs .drift-recovery/new` | 6 states; aria diff identical for all 6; outline diff = 10 class/id renames, no testids |
| Phase 3 inventory | project Playwright command on the new build with the original helper | 0 passed / 9 failed, exit 1, 77.3 s |
| | `node .drift-recovery/scripts/identify-drift.mjs` | 9 attempts retained, 0 run-level errors |
| | `node .../verify-locators.mjs` on new and old builds; `node .../triage.mjs` | 4 confirmed drifted locators (todo-ui.mjs:4, 10, 11, 12); gate accepted 4, rejected 3 negative controls |
| Phase 4 candidates | `QA_TODO_FAULT=redesign-classes node .../generate-candidates.mjs` | recipe generator: 0 candidates for all 4 targets; inspected adapter: 14 rows, 9 screenshots, 1 target at the floor |
| Phase 5 apply | `node .../apply-candidates.mjs`; `node references/score-candidates.mjs` | 4 applied (3, 2, 1, 1); scorer avg 1.75, 3 below floor, exit 1 |
| Phase 5 validate | project command, new build, twice | 9 passed / 0 failed, exit 0 (15.5 s); 9 passed / 0 failed, exit 0 (12.2 s); jq gate true both |
| Control | project command, old build (QA_TODO_FAULT unset) | 9 passed / 0 failed, exit 0 (13.4 s) — expected to fail, did not; see below |
| Phase 6 | `node .../build-pr-body.mjs`; drift-report.md | pr-body.md: "4 recovered, 0 flagged"; no git branch / gh pr (not permitted) |

Deliverables in this folder: `todomvc.spec.mjs` (9 tests, assertions untouched; only the two support import paths changed because the folder is one level deeper), `todo-ui.mjs` (lines 4/10/11/12 of the original changed + a refreshed 3-line header comment), `before/*.orig`, `.drift-recovery/{old,new}/` snapshots, `.drift-recovery/{results,failure-inventory,reviewed-targets,candidates}.json`, `post-recovery-*.json`, `screenshots/`, `scripts/` (every recipe port and driver), `pr-body.md`, `drift-report.md`, `execution.log`, `task-prompt.txt`.

## Why the old-build control did not fail

All four replacements are a role locator, a text locator and two unchanged-class CSS locators. `verify-locators.mjs` on the default build shows them resolving to `ul.todo-list`, `span.todo-count`, `section.main`, `footer.footer` (count=1 each), the same elements the old selectors pointed at. The regenerated suite is build-agnostic; that is the point of role-first recovery, not a defect of the run. The two builds are genuinely different (class/id diff of the raw HTML snapshots, exit 1).

## What the skill got right

- The phase structure (old snapshot, new snapshot, inventory, candidates, apply, validate, PR) fit the problem and every gate was checkable with a file.
- `collectFailureInventory` / `requireVerifiedDrift` ported without logic changes and did their job: the inventory kept reporter facts and nothing else; the gate rejected unreviewed, intent-less and line-0 rows.
- The Failure Modes row "Extracted line points at a POM file, not the test" and Anti-pattern 5 were exactly right: the reporter located 8 spec lines and `todo-ui.mjs:26`, never the definition `todo-ui.mjs:4`.
- The rubric's refusal to call a multi-match a 3 (bare `getByRole('list')` = 2 elements) pushed me to the filter-scoped locator, which was verified unique in six states on both builds.
- The line-anchored apply rule (exact old expression, once on the line) worked and would have caught a stale target.
- The scorer did what it promises: it refused to bless the sub-floor rows, and the Verification text says to report that rather than hide it.
- `score-candidates.mjs` and the jq stats gate ran unmodified.

## Recipe difficulties, with the exact lines

1. **SKILL.md line 59 (Principle 2) and recovery-scripts.md §1 "Aria-snapshot diff (the drift signal)"**: `diff old/*.aria.yml new/*.aria.yml` was identical for all six states. This redesign renamed classes and ids only, which the aria snapshot hides by design, so the recommended signal reported zero drift while 9/9 tests failed. What I did: added a tag/id/class/data-*/aria-* outline dump to the snapshot script and diffed that; the whole mapping came from it. The skill should say that the aria diff shows role/name drift only and that a class-only redesign needs the raw markup diff it tells you to avoid.
2. **recovery-scripts.md §1 `scripts/snapshot-dom.ts` (the `routes = ['/checkout','/cart','/account']` loop and `getByTestId('app-ready')` wait) and §1 Option B `npx tsx`**: no `tsx`/`ts-node` in the repo and no new dependencies allowed; the app has one route with many UI states and no `app-ready` element. What I did: ported to `.mjs`, keyed the loop by UI state (empty, items, hover, editing, two filters), used "entry textbox visible" as the readiness contract, and started the build through `startTodo` instead of a `baseUrl` argument.
3. **recovery-scripts.md §3 shell block (`PLAYWRIGHT_TEST_BASE_URL=... npx --no-install playwright test --reporter=json > results.json`) and §5 (`npx playwright test --reporter=json > post-recovery.json`)**: the project config ignores `PLAYWRIGHT_TEST_BASE_URL` (the `todo` fixture starts its own server) and already configures a JSON reporter to `verbose.json`; passing `--reporter=json` on the CLI would replace the project's minimal/json/html reporters. What I did: ran the project's own command and copied `verbose.json` to `.drift-recovery/results.json` / `post-recovery-*.json`, keeping the exit status in `test-exit-code.txt`. (My first attempt failed for an unrelated reason: zsh refuses `status=...`, a read-only variable; the recipe's `qa_selector_status` name is fine, the slip was mine.)
4. **recovery-scripts.md §3 `failure-inventory.ts` / `identify-drift.ts`, §4 `recovery-candidates.ts`, §6 `recovery-summary.ts` / `build-pr-body.ts`**: all TypeScript with `import ... from './x'` extensionless specifiers; nothing in this repo runs TS. Ported each to `.mjs` with explicit `.mjs` imports and absolute paths; logic unchanged.
5. **Phase 3 under-reports drift (SKILL.md lines 98-122)**: only 1 of the 4 drifted locators appears in any error. Every test aborted at its first list-dependent step, and `expect(ui.main).toBeHidden()` / `expect(ui.footer).toBeHidden()` passed vacuously on 0 elements. The phase has no step "grep the helper/POM for every locator and resolve each on the new build"; Phase 5's "iterate" would find them in a second or third cycle. What I did: `grep -nE "locator\(|getBy..."` on the helper + `verify-locators.mjs` live counts, and triaged all four up front (the reviewed-targets record marks three as "latent, not in report").
6. **recovery-scripts.md §4 `generate()`**: produced 0 candidates for all 4 targets. Causes: the role loop tries only `button, link, heading, textbox, checkbox` (no `list`); the intent is matched as literal regex text against names and visible text, so a descriptive intent such as "the todo list container" can never match; region scoping needs `getByRole('region')` with `aria-label`, and this page has none. The recipe's own comment ("Other accessible-name sources need their own inspected adapter") is the escape hatch I used: typed candidates, live `count()`, rubric scores, `captureCandidate` for screenshots.
7. **SKILL.md rubric (lines 126-145) has no rung for unnamed, role-less containers** (`<span>` counter, `<section>`, `<footer>` inside `<section>`). Best honest scores: text 2, CSS 1. Lines 151 and 194 say never auto-apply those and flag them; the PR template (line 183) lets the reviewer "accept a manual selector update". I did that explicitly, so the Verification step 1 scorer (line 231) exits 1 and Done When (line 258) is not met. The skill's gate and the task's "suite must pass" cannot both be satisfied without the front-end team adding testids or landmark names (rung 1), which is outside this folder. Reported, not loosened.
8. **SKILL.md line 63 / rubric item 4 (line 131)** name only `getByRole('region', { name })` and `.filter({ hasText })` as scoping. The unique list locator needed `.filter({ hasNot: page.getByRole('link') })`, a structural filter. I scored it 3 on the rubric's stated criterion (role, scoped, exactly one match, verified) and flag the interpretation for the reviewer.
9. **recovery-scripts.md §6 `summarizeRecovery` + `build-pr-body.ts`**: reports "4 recovered, 0 flagged" because any `applied: true` row counts as recovered regardless of score. The scorer and the PR body therefore disagree about the three sub-floor rows; only the scorer catches them. drift-report.md lists them under "Flagged for review" by hand.
10. **SKILL.md Phase 1 Option A (`npx playwright show-trace`, line 81)**: interactive; not used. The old DOM came from the lab's default build (equivalent of §1 Option C). The `trace.zip` attachments from the Phase 3 run exist but were not opened; the `error-context.md` aria snapshot served as the failure-state evidence.
11. **SKILL.md Done When line 261** ("add a note to `.agents/qa-project-context.md`"): that file is outside my folder and is also still the unfilled template. Not done; the note is in drift-report.md instead.
12. **recovery-scripts.md §6 `git checkout -b` / `gh pr create` and SKILL.md Verification step 3 (`gh pr view`)**: not permitted for this task; drift-report.md is the PR body.

## What I could not verify

- Semantic equivalence beyond the suite's own assertions and the four element screenshots. The skill itself says a screenshot or score alone cannot establish it; the 9 unchanged assertions passing twice are the evidence.
- Robustness of `.filter({ hasNot: getByRole('link') })` against a future redesign that puts a link inside a todo row, and of `getByText(/^\d+ items? left$/)` against a copy change; both are documented as score 3 / 2 for that reason.
- Whether the rubric's scorer gate can ever exit 0 on this suite without upstream markup changes; the ask (testids / landmark names) is recorded in drift-report.md.
- The trace viewer path and the `gh` PR path of the skill (not run).
- Repository state outside my folder: during the session, files I did not touch changed (`campaign3/visual-testing/*`, `run-matrix.mjs`, `faults/mutations.mjs`, new `run-experiment.mjs`); concurrent work in the same checkout, not inspected.

## Final counts

- Original suite on the new build: 0 passed / 9 failed (exit 1).
- Regenerated suite on the new build: 9 passed / 0 failed / 0 skipped / 0 flaky, twice (exit 0 both).
- Regenerated suite on the old build: 9 passed / 0 failed (exit 0); the predicted failure did not occur, explained above.
- Selectors changed: 4 (1 at score 3 auto-applied, 3 reviewer-accepted at 2/1/1). Scorer exit 1 (3 below floor). Unrecovered locations: 0.
