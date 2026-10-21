# TodoMVC browser workflow contract

## Application and access

This is the official vanilla JavaScript TodoMVC application, pinned to upstream
commit `25a9e31eb32db752d959df18e4d214295a2875e8`. The application is already available
at the base URL supplied with your task. It requires no account and uses browser-local
storage. A fresh browser context starts with no todos; a reload in the same context
retains saved todos. Browsers and separate origins do not share this data.

Use the visible application and its HTTP resources to establish the current behavior.
The task workspace contains the requirements, installed Playwright and the skill text.
It does not require access to any external account or paid service.

## Required behavior

1. **Create and list.** Enter a nonblank title in “What needs to be done?” and press
   Enter. The new item appears in order, the entry field clears and the remaining
   active count increases. Leading/trailing spaces are trimmed. Whitespace alone
   creates no item. Several items can be added in one session.
2. **Independent records.** Two todos may have the same title. Editing, completing or
   deleting one must not change the other. Actions target an individual row, not
   every item sharing its text.
3. **Complete and restore.** An individual checkbox changes only that item's completion
   state. The remaining count counts all active items, independent of the displayed
   filter. “Mark all as complete” applies to all todos, including items outside the
   current filter; toggling it back restores all items to active.
4. **Filter.** All shows every item, Active only incomplete items, and Completed only
   completed items. The selected filter is visibly marked. Switching filters does
   not delete or duplicate data. An empty filtered view is allowed while other todos
   still exist.
5. **Edit.** Double-click an item's visible title to edit it. Enter or moving focus away
   saves a nonblank edited title. Escape cancels and restores the previous saved title.
   Saving an empty or whitespace-only title deletes that individual item. Other rows
   retain their titles, order and completion state.
6. **Delete and clear.** A row's delete control removes that row. “Clear completed”
   removes completed items while preserving active items. The main list controls and
   footer are hidden when no todos remain; they reappear when a new item is added.
7. **Persistence.** Titles, order, completion state, edits and removals survive an ordinary
   browser reload in the same context and origin. A canceled edit must not replace
   the saved title on reload.
8. **Keyboard interactions.** Creating with Enter and saving/canceling an edit with
   Enter/Escape must work through real keyboard input, including after other list
   operations. No screen-reader or complete WCAG conformance is promised by this contract.

## Boundaries

This contract covers the pinned revision's todo behavior. It does not assert that the
current upstream revision implements the same storage behavior. It does not require
the online framework-information sidebar, links to authors, analytics, synchronization
between tabs or devices, or behavior under a full browser storage quota.

The local server sends original upstream application and dependency bytes. Optional
online-learning metadata receives HTTP 204, and an offline content policy prevents
outbound connections. Tests should use the supplied origin and avoid following external
informational links. There is no API to seed or mutate the application's saved todos;
use ordinary user actions for the required workflows.
