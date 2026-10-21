# TodoMVC acceptance design (before code)

## 1. Extracted requirements
The entity is an ordered todo record with title and active/completed state. REQ-1 create trimmed nonblank titles with Enter and clear input; REQ-2 equal titles remain independent; REQ-3 individual and global completion/restoration update the global active count; REQ-4 filters select the correct subset without changing records; REQ-5 Enter/blur saves, Escape cancels, blank edit deletes only its record; REQ-6 row delete and clear completed preserve other records and hide empty controls; REQ-7 same-origin reload preserves saved changes, order, state and cancellation; REQ-8 real keyboard create/save/cancel still works after other operations.

## 2. Risks, invariants, assumptions
High impact: duplicate title actions affect multiple records (REQ-2); filtered bulk actions omit hidden records (REQ-3/4); canceled draft replaces storage (REQ-5/7); removal resurrects after reload (REQ-6/7). Medium impact: stale global count, mistaken whitespace handling, empty filters hide the footer, event handlers stop after re-render (REQ-1/3/4/8). Likelihood is not evidenced; these are risk-based priorities, not incident claims.
Invariants: ordered records survive unrelated actions; count equals all active records; filter changes only visibility; duplicate titles do not identify records; canceled edits do not persist. All are directly checked below.
Assumptions: no additional behavior beyond supplied contract. Exact classes are not product requirements; narrow DOM selectors are permitted where this old markup has no accessible name. No blocking ambiguity. No cross-tab synchronization, quota, complete accessibility, third-party, maximum length, race, mobile or multi-browser requirements are invented.

## 3. Coverage matrix
| ID | Requirements | Focus | Category | Priority | Oracle |
|---|---|---|---|---|---|
| SC-001 | 1,6,8 | Create order, trim, blank rejection, entry reset | happy/boundary/negative | P0 | exact list, field value, count, visibility |
| SC-002 | 2,3,5,6 | Duplicate records independently complete/edit/delete | state/negative | P0 | row checkbox states, exact ordered labels |
| SC-003 | 3,4 | Complete and restore while filtering; global count | state/negative | P0 | visible subset, count, checkbox |
| SC-004 | 3,4 | Bulk complete/restore from filtered and empty views | state/boundary | P0 | all row states after return to All |
| SC-005 | 4 | Selected filters, empty subset, stable order | happy/negative | P1 | selected link, exact subsets and full list |
| SC-006 | 5,7,8 | Enter and blur save, Escape cancel, reload | happy/negative | P0 | titles/order/state persist, draft absent |
| SC-007 | 2,5,6 | Empty/whitespace edits delete one duplicate | boundary/negative | P0 | exact survivors and state |
| SC-008 | 6,8 | Delete, clear completed, empty recovery | happy/negative | P0 | surviving active rows; controls disappear/reappear |
| SC-009 | 7,8 | Mixed edits/completion/removal persist on reload | state/negative | P0 | full exact list and checkbox vector |
Every requirement includes successful behavior plus a negative preservation/rejection assertion. Boundaries include zero/one/several records, duplicates, whitespace and literal Unicode/punctuation. Negative means no unintended record/state change, not a manufactured error UI.

## 4. Scenarios (behavior before assertions)
SC-001 Given empty app, when the user adds padded titles, a Unicode title, and whitespace, then only nonblank trimmed titles appear in insertion order.
SC-002 Given two equal titles and a guard row, when the user completes, edits, then deletes the second duplicate, then the first and guard remain independently unchanged.
SC-003 Given three active todos, when the user completes and restores a record in filtered views, then the visible subsets change and the remaining count stays global.
SC-004 Given mixed states, when the user bulk-completes in Active and bulk-restores in Completed, then every record changes, including the hidden records. Repeat from an empty Completed view.
SC-005 Given one completed and two active records, when the user switches All/Active/Completed, then filter styling and subsets agree, including an empty subset, with order preserved.
SC-006 Given a completed and active record, when the user saves edits using Enter and blur and cancels a draft with Escape, then only saved titles survive reload and completion is unchanged.
SC-007 Given equal titles plus a completed guard, when the user saves whitespace and empty edits, then each targeted record is individually removed.
SC-008 Given mixed records, when the user deletes one row and clears completed rows, then active records remain; removing the last record hides controls and a new keyboard-created record restores them.
SC-009 Given UI-created records, when the user edits, completes, deletes and clears records and reloads, then saved order, state, titles and removals survive and keyboard handlers still work.

## 5. Oracles
Use web-first exact title arrays, exact count text, checkbox checked/unchecked state, cleared input values, and visible/hidden controls. Positive and negative outcomes are combined via exact survivor arrays and individual state assertions. Reload is the only persistence oracle; no localStorage inspection/seeding or API mutation. Selected class is observed DOM's only filter-selection indicator; no aria-current exists. Expect selected class together with correct visible subset. CSS fallback selectors scope the unlabeled todo list, static labels, global count and non-semantic controls. Interactions remain genuine keyboard/mouse actions, without force, mocks or sleeps.

## 6. Implementation / verification plan
Use existing fixture and config, JavaScript ES modules, 9 independent tests and two fully parallel workers. Existing harness manages servers and fresh contexts. Inspect running DOM first; never inspect upstream source. Check syntax/discovery, run all tests, investigate only concrete failures. Retain legitimate discrepancies. Skill versions: playwright-automation 2.0, ai-test-generation 2.0. Model advertised by environment: GPT-6 Astra Pro (no exact backend identifier exposed). Playwright supplied version: 1.62.1.

## 7. Review boundary
Agent self-review is recorded after execution. Human review remains pending; no test will be represented as human-approved or merged. User authorized executable drafts and forbade commits, so the skill's human review gate does not block requested generation/execution.
