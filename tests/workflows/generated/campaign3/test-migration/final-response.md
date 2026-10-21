# Final response: test-migration skill exercised on the TodoMVC legacy Cypress suite

## What actually ran

Command (from the repo root, HEAD a5d27c1, Playwright 1.62.1, Chromium, 2 workers):

```
QA_WORKFLOW_SUITE=/Users/petr/projects/qa-skills/tests/workflows/generated/campaign3/test-migration \
QA_WORKFLOW_OUTPUT=/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad/campaign3-test-migration \
node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs --workers 2
```

| Run | Time (UTC) | Scheduled | Passed | Failed | Flaky | Skipped | Wall time |
|---|---|---|---|---|---|---|---|
| `--list` | 19:00 | 7 | – | – | – | – | – |
| 1 | 2026-10-21T19:00:15Z | 7 | 7 | 0 | 0 | 0 | 3.6 s |
| 2 | 2026-10-21T19:00:36Z | 7 | 7 | 0 | 0 | 0 | 3.4 s |
| probe (scratchpad, deliberately wrong assertions) | 19:01 | 5 | 1 (control) | 4 (expected) | 0 | 0 | – |

Per-test results, durations and worker indices are in `execution.log` §5–6 (from `verbose.json`,
copies kept as `verbose-run1.json` / `verbose-run2.json` in the output folder). No failure artefacts
were produced in `test-results/`.

Deliverables in this folder: `todomvc.spec.mjs` (7 tests), `todo-page.mjs` (page helper),
`migration-map.md` (inventory, test map, command and assertion tables, 28/28 assertion ledger,
intentional changes, uncovered behaviours), `execution.log`, `task-prompt.txt`, this file.
`legacy/todomvc.cy.js` is untouched (4420 bytes, mtime 20:23).

## What the skill got right

- **"Modernize, don't translate" (Core Principle 4, Anti-pattern "Translating without modernizing").**
  This is what turned `click({ force: true })` on the hidden × into hover-then-click, `beforeEach` +
  helper functions into a `todoPage` fixture, and CSS selectors into role/text locators.
- **"Read the old one and understand what it actually verifies" (Phase 4).** Doing that exposed that the
  legacy Escape assertion (line 57) would pass even if Escape did nothing; the migrated helper now
  asserts the editor closes.
- **Infrastructure before tests (Phase 3).** The page helper came first and every test is short.
- **The parity sheet / "no count leaked" verification.** 7 → 7, checked with `--list` and a grep of the
  legacy file.
- **The explicit warning that `npx playwright migrate` does not exist.** Not tried, as instructed.
- **Assertion mapping table rows** for `have.length`, `have.value`, `have.text`, `contain.text`,
  `be.visible` were correct and sufficient for most of the ledger.
- **Cypress guide's `cy.get().type()` → `fill()`** was right for the title text.

## Recipe difficulties (exact lines, what failed, what I did instead)

1. **SKILL.md line 29 (Quick Route) and lines 102–103 (tooling table); framework-guides.md "Cypress to
   Playwright" intro: "use the official cy2pw web converter … or the community CLI
   `npx @11joselu/cypress-to-playwright <dir>`".** Neither is usable here: the web converter needs an
   interactive browser session and a paste, and the `npx` package is a new dependency downloaded at run
   time (forbidden by the task, and the repo's offline policy). The skill has no fallback sentence for
   "no tooling allowed"; I followed the golden-reference recipe at line 109 and hand-migrated all 7.
   For a 7-test suite that is the right call anyway, but the Quick Route should say so.
2. **SKILL.md line 39 / AGENTS.md Skill Discovery step 1: "Check `.agents/qa-project-context.md` … if it
   exists, use it as context".** It exists but is the unfilled template (every value is a
   `[placeholder]`). The "exists" branch yields nothing and the skill has no instruction for that state.
   I treated it as absent and used the contract and the served app instead.
3. **SKILL.md line 267 "`npx playwright test <migrated-file>`" and line 268 "`npx playwright test --list
   | wc -l` per area".** This repo runs Playwright through `node node_modules/playwright/cli.js test
   --config tests/workflows/playwright.config.mjs` with two env vars, and its minimal reporter prints a
   single "7 scheduled cases" line in list mode, so `wc -l` would have returned 2, not 7. I read the
   reporter's count and cross-checked with `grep -c "^  it('"` on the legacy file.
4. **framework-guides.md, Cypress migration notes: "Replace `cy.get().type()` with `await locator.fill()`
   (fill clears first, which is almost always correct)".** `fill` does not press keys. Every legacy test
   embeds Cypress key tokens (`{enter}`, `{esc}`) in the `.type()` string, and the guide never mentions
   them. Each became a separate `press('Enter')` / `press('Escape')`. A row for key tokens is missing.
5. **SKILL.md line 146, assertion table: `cy.get('.msg').should('have.text', 'Done')` →
   `toHaveText('Done')`, annotated only "Auto-retrying".** Not equivalent for whitespace: `toHaveText`
   normalises it. The probe proved `toHaveText(['  Buy café beans  '])` passes against the trimmed
   title, which would have made T1's trimming assertion vacuous. I used
   `expect.poll(() => rows.allTextContents()).toEqual([...])` for ordered title lists. The table also
   has no row for a Cypress callback assertion (`should($els => deep.equal …)`) or for `.each()`.
6. **SKILL.md lines 117–125, locator table.** No row for `cy.contains(selector, text)` (line 124 covers
   only the single-argument form) and no guidance for identical roles without names: this page has two
   unnamed `role=list` elements, so one CSS anchor (`.todo-list`) was kept and everything inside it is
   role-based. The table's "testid as fallback" (line 122) does not apply; the build has no test ids.
7. **No mention anywhere of Cypress's `{ force: true }`.** Three legacy actions use it. The correct
   Playwright move (hover to reveal the ×; rely on actionability for the opacity-0 toggle-all) had to be
   worked out from the CSS and verified by running. A row in the wait-strategy or locator table would
   save the next migrator the same detour.
8. **No row for `Cypress.env(...)`.** Mapped to the runtime `todo` fixture's `baseURL`; obvious, but the
   config table (lines 151–160) covers only `cypress.config` keys.
9. **Phases 5–6, Verification bullets 3–4 (lines 269–270), Done When (lines 276–280).** Parallel CI,
   two sprints green, and removing the old framework cannot be exercised in this task (Cypress not
   installed, CI out of scope). The skill offers no reduced "done" definition for a one-shot migration
   of a suite whose source framework is already gone; I substituted "passed twice on the same commit +
   assertion ledger + negative probe" and say so in migration-map.md §7.
10. **Runtime description vs. code (not a skill defect, recorded for the campaign):** the task prompt
    describes the `todo` fixture as "a fresh TodoMVC server per test"; `tests/workflows/support/fixtures.mjs`
    declares it `{ scope: 'worker' }`. Isolation still holds because storage is browser-side and each
    test gets a new context; `TodoPage.open` asserts the empty list to prove it.

## What I could not verify

- The legacy suite's own pass/fail status, flakiness or skip rate (Cypress absent, no CI history).
- Parallel running of both suites in CI and the two-sprint stability criterion.
- Behaviour in any browser other than bundled Chromium.
- Whether `fill` versus per-character typing changes any outcome; contract §8 is satisfied for Enter and
  Escape, which are real key presses, but the title characters are set, not typed.
- The contract behaviours the legacy suite never covered (migration-map.md §6) remain untested by
  design; this task migrated, it did not extend.

## Final counts

Migrated suite: run 1 → 7 passed, 0 failed; run 2 → 7 passed, 0 failed (0 flaky, 0 skipped both runs).
Negative probe: 1 control passed, 4 deliberately wrong assertions failed, as intended.
Legacy assertions: 28 explicit, 28 mapped, 0 dropped.

## Post-authoring edit for the fault matrix

The orchestrator wrapped four existing assertions in `todomvc.spec.mjs` in `oracle()` from the
lab's `support/oracle.mjs`, so the controls matrix can confirm which assertion fails under each
TodoMVC fault: the post-delete title list in the duplicates test (`c3-mig-duplicates`,
`toEqual`), the Active-filter title list (`c3-mig-filter`, `toEqual`), the row text after
Escape (`c3-mig-cancel`, `toHaveText`) and the row count after reload (`c3-mig-persistence`,
`toHaveCount`). The wrapper rethrows the same error and changes nothing on a passing run.
The legacy suite renames the duplicate before deleting it, so the `delete-wrong-duplicate`
fault is expected to pass undetected; that case is in the matrix to record the limit rather
than to claim coverage. No assertion, locator, helper or expectation changed.
