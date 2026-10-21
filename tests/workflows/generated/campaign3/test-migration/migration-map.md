# Migration map: legacy Cypress suite → Playwright

Source: `legacy/todomvc.cy.js` (Cypress 12, 7 tests, not executable here).
Target: `todomvc.spec.mjs` (7 tests) + `todo-page.mjs` (page helper). Playwright 1.62.1, Chromium.
Executed twice against the live pinned TodoMVC build at HEAD a5d27c1: 7/7 passed both times, 0 flaky
(see `execution.log` §5–6). A negative probe (§7) shows the migrated assertions fail when they should.

## 1. Inventory and priority (skill Phase 1)

| # | Legacy test (line) | What it actually verifies | Contract § | Priority |
|---|---|---|---|---|
| T1 | `creates trimmed non-blank titles in order and clears the entry field` (15) | blank title rejected; trim; order; entry clears; count text | 1 | High |
| T2 | `duplicate titles remain independent through complete, edit and delete` (24) | complete/edit/delete hit one row of a duplicate pair, not both | 2 | High |
| T3 | `filters visibly select the correct subset` (37) | Active/Completed/All subsets; selected marker; count after All | 4 | High |
| T4 | `Enter saves an edit and Escape preserves the saved title` (50) | Enter commits, Escape cancels, both survive reload | 5, 7, 8 | High |
| T5 | `items and their completion persist through reload` (62) | completion flags and count survive reload | 7 | Critical (data safety) |
| T6 | `a deleted item stays deleted after reload` (72) | deletion survives reload | 6, 7 | Critical (data safety) |
| T7 | `mark-all completes and restores every item` (80) | toggle-all both directions; count; Clear completed shown | 3 | High |

Skipped/flaky/obsolete: none. Baseline flakiness and skip rate could not be measured (Cypress is not
installed and no CI history was supplied). All 7 were migrated; none intentionally dropped.

## 2. Test-to-test map

Names are kept verbatim so the parity sheet is 1:1.

| Legacy test | New test | Status |
|---|---|---|
| T1 | `todomvc.spec.mjs` › same name | migrated, passed ×2 |
| T2 | same name | migrated, passed ×2 |
| T3 | same name | migrated, passed ×2 |
| T4 | same name | migrated, passed ×2 |
| T5 | same name | migrated, passed ×2 |
| T6 | same name | migrated, passed ×2 |
| T7 | same name | migrated, passed ×2 |

Parity: 7 old / 7 new (`--list` reported "7 scheduled cases"; `grep -c "^  it('"` on the legacy file = 7).

## 3. Command mapping

Role names come from the served build's accessibility tree (captured in `execution.log` §2), not from
the skill's illustrative table.

| Cypress (legacy) | Playwright (new) | Note |
|---|---|---|
| `describe` / `it` | `test.describe` / `test` | |
| `beforeEach(cy.visit; localStorage.clear(); cy.reload())` | `todoPage` fixture → `TodoPage.open(todo.baseURL)` | custom helpers become a fixture (skill: "custom commands become fixtures"); storage clear not needed, see §5.1 |
| `Cypress.env('TODO_URL')` | `todo.baseURL` from the runtime fixture | |
| `cy.get('.new-todo')` | `page.getByRole('textbox', { name: 'What needs to be done?' })` | name = placeholder |
| `.type(`${title}{enter}`)` | `entry.fill(title)` then `entry.press('Enter')` | `{enter}` token has no `fill` equivalent; Enter stays a real key press (contract §8) |
| `cy.get('.todo-list li')` | `page.locator('.todo-list').getByRole('listitem')` | `.todo-list` kept as the one CSS anchor: the page has two unnamed `role=list` elements (todos, filters) |
| `.eq(n)` | `.nth(n)` | |
| `.find('.toggle')` | `row.getByRole('checkbox')` | row checkbox has no accessible name (label not associated) |
| `.check()` / `.uncheck()` | `.check()` / `.uncheck()` | Playwright also verifies the resulting state |
| `cy.get('.toggle-all').check({ force: true })` | `page.getByRole('checkbox', { name: 'Mark all as complete' }).check()` | accessible name is "❯ Mark all as complete" (substring match); no `force` needed, the opacity-0 input is actionable |
| `.find('label').dblclick()` | `row.getByText(currentTitle, { exact: true }).dblclick()` | `<label>` has no role; user-visible text instead of CSS; also checks the row shows the expected title before editing |
| `.find('.edit').clear().type('X{enter}')` | `row.getByRole('textbox').fill('X')` then `.press('Enter')` | editor is the only textbox inside the row |
| `.type('X{esc}')` | `.fill('X')` then `.press('Escape')` | |
| `.find('.destroy').click({ force: true })` | `row.hover()` then `row.getByRole('button', { name: '×' }).click()` | × is `display:none` until hover; hovering is what a user does, so no `force` |
| `cy.contains('.filters a', 'Active').click()` | `page.getByRole('link', { name: 'Active', exact: true }).click()` | `exact` because "All" is also a link name |
| `cy.get('.clear-completed')` | `page.getByRole('button', { name: 'Clear completed' })` | |
| `cy.get('.todo-count')` | `page.getByText('<n> items left', { exact: true })` | count element has no role; see §5.4 |
| `cy.reload()` | `page.reload()` then wait for the entry field | |
| `cy.get('.todo-list li .toggle').each($box => …)` | `expect(boxes).toHaveCount(3)` + `for (const box of await boxes.all()) …` | no `.each`; see §5.6 |
| `cy.window().then(win => win.localStorage.clear())` | removed | see §5.1 |

## 4. Assertion mapping and ledger

### Matcher table

| Cypress | Playwright | Semantics |
|---|---|---|
| `.should('have.length', n)` | `await expect(rows).toHaveCount(n)` | same |
| `.should('have.value', '')` | `await expect(entry).toHaveValue('')` | same |
| `titles([...])` — custom `should($labels => deep.equal(textContent[]))` | `expectTitles([...])` = `expect.poll(() => rows.allTextContents()).toEqual([...])` | same: raw `textContent`, exact order, exact length, retried. `toHaveText([...])` was rejected because it normalises whitespace (probe: an untrimmed expectation matched a trimmed title) |
| `.find('label').should('have.text', 'X')` | `await expect(row).toHaveText('X')` | row `textContent` equals label `textContent` (verified in markup); whitespace-normalised, irrelevant for these values |
| `.should('contain.text', '2 items left')` | `await expect(page.getByText('2 items left', { exact: true })).toBeVisible()` | stricter: exact text instead of substring, and requires visibility |
| `.should('be.checked')` / `('not.be.checked')` | `.toBeChecked()` / `.not.toBeChecked()` | same |
| `.should('have.class', 'selected')` | `.toContainClass('selected')` | same (class token membership) |
| `.should('be.visible')` | `.toBeVisible()` | same |
| `expect($box).to.be.checked` inside `.each` | `await expect(box).toBeChecked()` per element | same, plus explicit count |

### Ledger: every legacy assertion, by legacy line

| Legacy line | Legacy assertion | New assertion (todomvc.spec.mjs) |
|---|---|---|
| 17 | `.todo-list li` length 0 | `expect(app.rows).toHaveCount(0)` |
| 19 | `.new-todo` value '' | `expect(app.entry).toHaveValue('')` |
| 20 | titles = [Buy café beans, Call Mei & book <tickets>] | `app.expectTitles([...])` |
| 21 | count contains "2 items left" | `expect(app.remaining('2 items left')).toBeVisible()` |
| 27 | row 0 toggle not checked | `expect(app.checkbox(0)).not.toBeChecked()` |
| 28 | "2 items left" | `remaining('2 items left')` |
| 31 | row 1 label = "Buy oat milk" | `expect(app.row(1)).toHaveText('Buy oat milk')` |
| 33 | titles = [Buy milk, Keep receipt] | `app.expectTitles([...])` |
| 34 | "2 items left" | `remaining('2 items left')` |
| 41 | titles = [Read chapter, Reserve sequel] | `app.expectTitles([...])` |
| 42 | Active link has class selected | `expect(app.filter('Active')).toContainClass('selected')` |
| 44 | titles = [Return book] | `app.expectTitles([...])` |
| 46 | length 3 | `expect(app.rows).toHaveCount(3)` |
| 47 | "2 items left" | `remaining('2 items left')` |
| 54 | row 0 label = "Book evening train" | `expect(app.row(0)).toHaveText('Book evening train')` |
| 57 | row 1 label = "Pack bag" | `expect(app.row(1)).toHaveText('Pack bag')` |
| 59 | titles after reload = [Book evening train, Pack bag] | `app.reload(); app.expectTitles([...])` |
| 66 | length 2 after reload | `expect(app.rows).toHaveCount(2)` |
| 67 | row 0 checked | `expect(app.checkbox(0)).toBeChecked()` |
| 68 | row 1 not checked | `expect(app.checkbox(1)).not.toBeChecked()` |
| 69 | "1 item left" | `remaining('1 item left')` |
| 75 | length 1 | `expect(app.rows).toHaveCount(1)` |
| 77 | titles after reload = [Keep me] | `app.expectTitles(['Keep me'])` |
| 83 | every toggle checked | `toHaveCount(3)` + loop `toBeChecked()` |
| 84 | "0 items left" | `remaining('0 items left')` |
| 85 | `.clear-completed` visible | `expect(app.clearCompleted).toBeVisible()` |
| 87 | every toggle not checked | `toHaveCount(3)` + loop `.not.toBeChecked()` |
| 88 | "3 items left" | `remaining('3 items left')` |

28 explicit legacy assertions, 28 mapped, 0 dropped. Implicit Cypress checks (`cy.get` existence,
`.check()` acting only on an unchecked box) are covered by Playwright's auto-wait and `check()` state
verification.

## 5. Intentional changes (and additions) with reasons

1. **Storage clear + reload in `beforeEach` removed.** Each Playwright test gets a fresh browser context,
   so `localStorage` starts empty. Added instead: `open()` asserts the entry field is visible and the
   row count is 0, so the precondition the legacy clear established is now proven, not assumed.
2. **`type()` → `fill()` + `press()`.** Per the skill's Cypress guide. Title characters are set with
   `fill`; Enter and Escape are still real key presses, which is the part contract §8 cares about. If a
   reviewer wants per-character keystrokes, swap `fill` for `pressSequentially` in `TodoPage.add`/`edit`.
3. **`{ force: true }` dropped on × and toggle-all.** The × button is hidden until hover, so the helper
   hovers the row first; the toggle-all input (opacity 0, 1×1 px) is actionable without force in
   Playwright. Both runs confirm it. Forcing would have hidden a regression where the control is not
   reachable by a user.
4. **Count assertion strengthened** from substring (`contain.text`) to exact visible text
   (`getByText(..., { exact: true })` + `toBeVisible()`). `"0 items left"` no longer matches
   `"10 items left"`. The probe confirms a wrong count fails.
5. **Editor-closed assertion added** after every Enter/Escape (`expect(editor).toBeHidden()` in
   `TodoPage.edit`). The legacy Escape assertion (line 57) would also have passed if Escape did nothing
   at all: the hidden `<label>` still read "Pack bag" while the editor stayed open, and `cy.reload()`
   discarded the editor. Now a stuck editor fails.
6. **`.each` → explicit `toHaveCount(3)` plus per-element checks.** Playwright has no `.each`; the count
   makes the "every item" claim concrete (AGENTS.md: assert the collection was observed before accepting
   a loop over it).
7. **Single-row `have.text` targets the `listitem`, not the `<label>`.** The row's `textContent` is the
   label text (checkbox and × carry no text, no whitespace between elements). The label itself has no
   role; keeping `locator('label')` would have been a second CSS selector for no gain.
8. **`.todo-list` kept as a CSS anchor.** Two `role=list` elements exist and neither has a name;
   `getByRole('list').first()` would depend on DOM order. Everything inside the anchor is role-based.
9. **`expectTitles` uses `expect.poll` + `allTextContents()`** instead of `toHaveText([...])` so the
   trimming assertion in T1 keeps its teeth (probe §7: `toHaveText(['  Buy café beans  '])` passes
   against the trimmed title; `expectTitles` rejects it).
10. **Test names unchanged**; `describe` title changed to say "migrated from the legacy Cypress suite".

## 6. Behaviours the legacy suite does not cover (reviewer notes)

Measured against `tests/workflows/todomvc-contract.md`:

- **Clear completed is never clicked** (§6). Only its visibility is asserted (T7). Removal of completed
  items while active ones survive is untested.
- **Saving an empty or whitespace-only edit deletes the item** (§5): untested.
- **Blur saves an edit** (§5 "moving focus away"): only Enter is exercised.
- **Individual uncheck / restore** (§3): no test unchecks a single row; restore is only via mark-all.
- **Mark-all across a filter** (§3 "including items outside the current filter"): toggle-all is only
  used under the All view. Likewise the count is never asserted while a filter other than All is active
  (T3 checks "2 items left" only after returning to All), so "count independent of the displayed filter"
  is unproven.
- **Empty filtered view while todos exist** (§4): untested (e.g. Completed with nothing completed).
- **Main list and footer hidden when no todos remain, reappearing on add** (§6): T1 asserts 0 rows, not
  that the controls are hidden; nothing deletes the last item and checks the footer disappears.
- **Only one filter marked selected**: T3 asserts Active has `selected`, never that All/Completed lack it.
- **Toggle-all's own checked state** after every item is complete (and after one is unchecked): never
  asserted.
- **Clear completed hidden when nothing is completed**: untested.
- **Filter state after reload** (URL hash `#/active` etc.): untested; the contract does not require it,
  so this is informational.
- **Order preserved after reload with more than two items**, and persistence of a title edit made while
  a filter is active: untested.

## 7. Parallel run and decommission (skill Phases 5–6)

Not performed. Cypress is not installed, so the legacy suite cannot run alongside the new one, and CI
changes were out of scope. The skill's "2 consecutive sprints green in CI", "legacy job
`continue-on-error: true`" and "old framework fully removed" criteria are therefore not met and not
claimed. What is claimed: 7/7 migrated tests passed twice in a row on the same commit, every legacy
assertion is mapped, and the migrated assertions demonstrably fail on wrong expectations.
