// One row per test in the corpus: the contract clauses it guards, its disposition and the
// evidence. Consumed by check-decisions.mjs (behaviour map + hard constraint) and
// build-curated.mjs (what to copy, what to quarantine with test.skip).
//
// Dispositions follow SKILL.md §5: keep / merge / quarantine-redundant / quarantine-low-value /
// delete-obsolete. Nothing is deleted from the repository; "quarantine" means the test is not
// copied into curated/ (whole-file duplicates) or is copied as test.skip with the row id
// (partially kept files). The untouched original folder is the restore location.

// Shop contract clauses (tests/workflows/fixture-app-contract.md) and TodoMVC requirements
// (tests/workflows/todomvc-contract.md). X* rows are behaviours tests guard that no contract
// clause promises; they are tracked so a deletion cannot silently drop them either.
export const clauses = {
  S01: 'GET /health -> 200 {status:ok, build:shop-lab-v1}',
  S02: '/health answers within 500 ms on a healthy service',
  S03: 'GET /api/catalog -> EUR, TEA-50 1200 and CUP-01 1800 minor units, server-owned prices',
  S04: 'quantity is an integer 1..10 (0, 11, 1.5, "2" rejected; 10 accepted)',
  S05: 'POST /api/login valid -> 200 {user} + shop_session cookie HttpOnly, SameSite=Lax, Path=/',
  S06: 'POST /api/login invalid -> 401 invalid_credentials',
  S07: 'throttle: 5 failures in 60 s -> 429 too_many_attempts, Retry-After 60, no session; correct password also 429; unknown addresses identical; clears after the window',
  S08: 'GET /api/me -> 200 {user} signed in, 401 unauthenticated otherwise',
  S09: 'POST /api/logout -> 204 and invalidates the session server-side (a copied cookie is refused)',
  S10: 'order endpoints -> 401 without a valid session',
  S11: 'POST /api/orders -> 201 {order, replayed:false}; ORDER shape; amount 4200 for the example; pending, fulfillment_count 0; client amount ignored',
  S12: 'unknown SKU, duplicate SKU, bad quantity, empty items, non-EUR -> 400 invalid_order and no order',
  S13: 'same key + equivalent items (any order) -> 200 original order, replayed:true',
  S14: 'same key + different quantity / SKU set / currency -> 409 idempotency_conflict (currency conflict before validation)',
  S15: 'keys belong to the signed-in user; parallel equivalent submissions create one order; different users may reuse a key',
  S16: 'GET /api/orders lists only the current user',
  S17: 'GET /api/orders/ID only to its owner; unknown and foreign ids -> exactly 404 not_found',
  S18: 'payment signature: missing or wrong -> 401 invalid_signature with no receipt or fulfillment; the exact request bytes are signed',
  S19: 'payment event malformed -> 400; unknown order -> 404; amount or currency mismatch -> 422 payment_mismatch',
  S20: 'valid event -> 200 {received:true, duplicate:false, order_id}; order paid, fulfillment_count 1',
  S21: 'same event id + same body -> duplicate:true; different body -> 409 event_conflict; a paid order is never fulfilled twice (repeats, distinct events, concurrency, restart)',
  S22: 'receipt and fulfillment are one transaction: injected 503 fulfillment_unavailable leaves pending with no receipt; the retry succeeds',
  S23: 'password-reset/request -> 202 with the same message for known and unknown addresses; unknown gets no mail; SMTP failure only increments smtp_errors',
  S24: 'known account receives a real SMTP message: subject, text and HTML alternatives, link to /reset-password?token=',
  S25: 'password-reset/confirm valid -> 200 {reset:true}; password changed; token consumed; all sessions invalidated; old credentials fail, new work',
  S26: 'tokens expire after 300 s; invalid, expired and consumed tokens -> 400 invalid_or_expired_token',
  S27: 'GET / serves labelled login, catalog/cart, order and reset controls; checkout shows order id, amount and payment state',
  S28: 'reload while signed in restores the user and their orders',
  S29: 'browser logout removes access',
  S30: 'a reset link opens a labelled new-password form; submission reports success or the server error',
  S31: 'test-support routes require X-Test-Admin-Key (403 forbidden otherwise); state and clock work with it',
  S32: 'dataLayer login {method:password} exactly once after a successful sign-in',
  S33: 'dataLayer purchase exactly once per created order with transaction_id, major-unit value, currency, items; after the response and before the list refresh',
  S34: 'no dataLayer event for a rejected sign-in, a rejected order, sign-out or password reset; the layer is never cleared',
  S35: 'durable state survives a process restart on the same database',
  T1: 'create and list: nonblank title + Enter appends in order, field clears, count increases, whitespace-only creates nothing, several per session',
  T1t: 'leading/trailing spaces are trimmed (asserted on raw text, not whitespace-normalised)',
  T2: 'equal titles are independent records for complete, edit and delete',
  T3: 'individual complete/restore; count is global across filters; mark-all covers hidden items and toggles back',
  T4: 'filters show the right subset, the selected filter is marked, switching neither deletes nor duplicates, empty filtered view allowed',
  T5: 'edit by double-click; Enter or blur saves; Escape cancels; empty/whitespace edit deletes that item only',
  T6: 'row delete; clear completed keeps active; list controls and footer hidden when empty and back when an item is added',
  T7: 'titles, order, completion, edits and removals survive reload; a cancelled edit is not persisted',
  T7i: 'a delete or clear completed persists when the reload is the very next action (no later mutation saves it)',
  T8: 'keyboard create/save/cancel still works after other list operations',
  X01: 'Shop pages are WCAG 2.2 AA clean (axe); TodoMVC empty state clean, populated rows expose only button-name and label',
  X02: 'Shop sign-in works keyboard-only in document order and keeps focus visible',
  X03: 'session tokens and passwords are hashed at rest; logout removes the row',
  X04: 'schema: unique (user_id, idem_key), orders.user_id -> users.id, WAL journaling, the database itself refuses a duplicate key',
  X05: 'integrity_check ok, no FK violations, no orphan receipts/orders/sessions after payment and logout',
  X06: 'storefront resilience under stubbed /api failures: 500 on order, 429 on login, slow list, malformed JSON, empty catalogue, 500 on list, unstubbed call guard',
  X07: 'recorded cassettes still match the live Shop response shapes (15 endpoints)',
  X08: 'tooling self-checks: shape comparator and 30-day freshness gate',
  X09: 'monitoring budgets: storefront ready <= 3 s, sign-in <= 5 s, order click-to-listed <= 5 s, reset email delivered <= 10 s, single recipient',
  X10: 'storefront renders both catalogue prices as text, Place order disabled when signed out, reset button present',
  X11: 'TodoMVC LCP under the lab budget; CLS under 0.1 and the entry field does not move',
  X12: 'TodoMVC visual baselines: empty, several active, each filter, all completed, editing, row hover, phone width',
  X13: 'the screenshot comparator rejects a wrong image (opt-in detector check)',
};

const keep = (file, title, clausesHit, tier, note = '') => ({ file, title, clauses: clausesHit, disposition: 'keep', tier, note });

export const decisions = [
  // ---------------------------------------------------------------- baseline-shop (10)
  keep('baseline-shop/shop.spec.mjs', 'API auth, cookie contract and logout revoke access', ['S01', 'S05', 'S06', 'S08', 'S09', 'S10'], 'smoke', 'only test that sends unauthenticated POST /api/orders and GET /api/orders/:absent (dynamic fingerprint)'),
  keep('baseline-shop/shop.spec.mjs', 'catalog controls money and malformed orders never create state', ['S03', 'S04', 'S11', 'S12'], 'smoke', 'oracle shop-pricing; the only test that sends quantity 0, 11, 1.5 and "2"'),
  keep('baseline-shop/shop.spec.mjs', 'order ownership is private and idempotency keys belong to users', ['S15', 'S16', 'S17'], 'core', 'oracle shop-ownership'),
  keep('baseline-shop/shop.spec.mjs', 'concurrent equivalent checkout replays once and persists across restart', ['S13', 'S14', 'S15', 'S35'], 'smoke', 'oracle shop-key-conflict; the only concurrent-submission test'),
  keep('baseline-shop/shop.spec.mjs', 'payment signatures, exact raw bytes and mismatched values reject without side effects', ['S18', 'S19', 'S20'], 'smoke', 'only test producing webhook 400/404/422'),
  keep('baseline-shop/shop.spec.mjs', 'concurrent payment redelivery, conflict and distinct event IDs fulfill once durably', ['S21', 'S35'], 'smoke', 'oracle shop-deduplication; only test producing webhook 409'),
  keep('baseline-shop/shop.spec.mjs', 'transient fulfillment rolls back receipt then same event succeeds after restart', ['S22', 'S35'], 'core', 'oracle shop-transaction; only test producing webhook 503'),
  keep('baseline-shop/shop.spec.mjs', 'browser checkout restores order on reload and reflects server payment', ['S27', 'S28', 'S29'], 'smoke', 'note: its post-logout 401 uses the same cookie jar, so it does not prove server-side revocation (report-1 does)'),
  keep('baseline-shop/shop.spec.mjs', 'actual reset email completes browser flow and revokes all sessions', ['S24', 'S25', 'S26', 'S30'], 'core', 'oracle shop-reset-reuse; only test with POST /api/password-reset/confirm 200'),
  keep('baseline-shop/shop.spec.mjs', 'reset requests resist account enumeration and tokens expire on the server clock', ['S23', 'S24', 'S26', 'S31'], 'core', ''),

  // ---------------------------------------------------------------- baseline-todo (9): spec kept, helper merged from selector-drift-recovery
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'creates trimmed nonblank titles in order and clears the entry field', clauses: ['T1', 'T6'], disposition: 'merge', tier: 'smoke', note: 'spec unchanged; todo-ui.mjs replaced by the role-first helper from selector-drift-recovery (identical API, passes on both TodoMVC builds). Trimming here is asserted with toHaveText, which normalises whitespace, hence T1t is credited to test-migration:16 only' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'duplicate titles remain independent through complete edit and delete', clauses: ['T2', 'T3', 'T5', 'T6'], disposition: 'merge', tier: 'core', note: 'oracle todo-duplicates' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'individual completion and restoration keep the active count global under filters', clauses: ['T3', 'T4'], disposition: 'merge', tier: 'core', note: '' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'bulk toggle affects hidden records and works from an empty filtered view', clauses: ['T3', 'T4'], disposition: 'merge', tier: 'core', note: '' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'filters visibly select the correct subset without losing or duplicating records', clauses: ['T4'], disposition: 'merge', tier: 'core', note: 'oracle todo-filter' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'Enter and blur save edits while Escape preserves the saved title on reload', clauses: ['T5', 'T7', 'T8'], disposition: 'merge', tier: 'smoke', note: 'oracle todo-cancel' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'whitespace Enter and empty blur edits remove only their targeted records', clauses: ['T2', 'T5', 'T6', 'T7'], disposition: 'merge', tier: 'core', note: 'oracle todo-removal-persistence' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'delete and clear completed preserve active rows and empty controls recover', clauses: ['T6', 'T8'], disposition: 'merge', tier: 'core', note: '' },
  { file: 'baseline-todo/todomvc.spec.mjs', title: 'saved edits completion order and removals persist through reload and further keyboard input', clauses: ['T7', 'T8'], disposition: 'merge', tier: 'core', note: 'oracle todo-persistence' },

  // ---------------------------------------------------------------- review-followup (6)
  { file: 'review-followup/shop-review.spec.mjs', title: 'logout revokes a previously valid copied session on the server', clauses: ['S09', 'S10'], disposition: 'quarantine-redundant', supersededBy: 'campaign3/bug-reproduction/report-1-session-revocation.spec.mjs: POST /api/logout invalidates the session for every holder of the cookie', tier: '-', mutationCheck: 'not run (no mutation tool for the black-box Shop); subsumption established by reading both oracles: survivor asserts the same 401 on /api/me and /api/orders with the copied cookie plus /api/orders/:id and a fresh sign-in control', risk: 'low: identical server path (POST /api/logout then copied-cookie reads). The lab matrix oracle id shop-logout moves to c3-bugrepro-logout, which marks the same assertion', note: '' },
  keep('review-followup/shop-review.spec.mjs', 'each SKU has its contracted unit price and quantity ten is accepted', ['S03', 'S04', 'S11', 'S17'], 'core', 'oracle shop-unit-prices; the only test of 1200 and 1800 as separate orders and of quantity 10'),
  keep('review-followup/shop-review.spec.mjs', 'correctly signed noncanonical JSON is accepted and identical bytes replay once', ['S18', 'S20', 'S21'], 'core', 'oracle shop-signed-whitespace; the only test signing non-canonical bytes'),
  keep('review-followup/todo-review.spec.mjs', 'single delete persists immediately with survivor order and completion intact', ['T6', 'T7', 'T7i'], 'core', 'oracle todo-removal-persistence; reload is the next action after the delete'),
  keep('review-followup/todo-review.spec.mjs', 'clear completed persists immediately and preserves active titles and order', ['T6', 'T7', 'T7i'], 'core', ''),
  keep('review-followup/todo-review.spec.mjs', 'clearing the final completed item persists the empty state immediately', ['T6', 'T7', 'T7i'], 'core', 'only test that reloads into the empty state'),

  // ---------------------------------------------------------------- addons (11 tests in 4 files)
  keep('addons/accessibility.spec.mjs', 'Shop sign-in, account and reset pages have no WCAG 2.2 AA violations', ['X01', 'S27', 'S30'], 'extended', 'oracle shop-unlabeled-controls'),
  keep('addons/accessibility.spec.mjs', 'Shop sign-in completes through the keyboard alone in document order', ['X02'], 'extended', ''),
  keep('addons/accessibility.spec.mjs', 'TodoMVC empty state is clean and populated rows expose only the documented upstream gaps', ['X01'], 'extended', ''),
  keep('addons/database.spec.mjs', 'session credentials are stored hashed at rest and removed on logout', ['X03', 'S09'], 'core', 'oracle shop-plaintext-sessions'),
  keep('addons/database.spec.mjs', 'schema enforces idempotency uniqueness, foreign keys and durable journaling', ['X04'], 'core', 'oracle shop-missing-idempotency-index'),
  keep('addons/database.spec.mjs', 'orders, receipts and sessions stay referentially consistent after payment and logout', ['X05', 'S20'], 'core', ''),
  keep('addons/performance.spec.mjs', 'TodoMVC paints its largest content within the lab budget', ['X11'], 'extended', 'oracle todo-delayed-render; uses toBeNull (counted as a weak matcher) only as a guard before the budget assertion'),
  keep('addons/performance.spec.mjs', 'TodoMVC layout stays stable after load and while listing items', ['X11'], 'extended', 'oracle todo-layout-shift'),
  keep('addons/security.spec.mjs', 'repeated sign-in failures are throttled per account and recover after the window', ['S07', 'S31'], 'smoke', 'oracle shop-no-login-throttle; the only test of the throttle clause (stub-fidelity only compares the 429 shape)'),
  keep('addons/security.spec.mjs', 'test-support routes stay locked without the admin key', ['S31'], 'core', 'oracle shop-open-test-support; the only test producing 403'),
  keep('addons/security.spec.mjs', 'password reset stays uniform and accepted when the mail service is down', ['S23'], 'core', 'oracle shop-smtp-failure; the only test with an unreachable SMTP port'),

  // ---------------------------------------------------------------- campaign3/analytics-tracking-testing (8)
  keep('campaign3/analytics-tracking-testing/login-events.spec.mjs', 'login is pushed exactly once after a successful sign-in, and not on load or reload', ['S32', 'S34', 'S28'], 'core', ''),
  keep('campaign3/analytics-tracking-testing/login-events.spec.mjs', 'a rejected sign-in pushes nothing; the following successful one pushes login once', ['S32', 'S34', 'S06'], 'core', ''),
  keep('campaign3/analytics-tracking-testing/login-events.spec.mjs', 'sign-out and a password-reset request push nothing after the login event', ['S34', 'S23'], 'extended', ''),
  keep('campaign3/analytics-tracking-testing/purchase-events.spec.mjs', 'purchase carries the created order: transaction_id, major-unit value, currency and items match the API', ['S33', 'S11'], 'core', 'oracle c3-analytics-currency; exact key set of the payload'),
  keep('campaign3/analytics-tracking-testing/purchase-events.spec.mjs', 'two orders push two purchase inputs, one per created order, with distinct transaction ids', ['S33', 'S11'], 'extended', 'review pair with the previous test (combined score 0.57): different input (two orders, CUP-01 x3 = 5400) and a per-order one-to-one oracle; kept'),
  keep('campaign3/analytics-tracking-testing/purchase-events.spec.mjs', 'a double-click on Place order creates one order and pushes purchase once', ['S33', 'S13'], 'core', 'the only double-submit test through the page'),
  keep('campaign3/analytics-tracking-testing/purchase-events.spec.mjs', 'a rejected order pushes no purchase; the next accepted order pushes exactly one', ['S34', 'S12', 'S33'], 'core', ''),
  keep('campaign3/analytics-tracking-testing/purchase-events.spec.mjs', 'ordering: login after the account UI shows and before orders load; purchase after the order response and before the list refreshes', ['S33', 'S32'], 'extended', 'the only test of the ordering clause'),

  // ---------------------------------------------------------------- campaign3/bug-reproduction (5)
  keep('campaign3/bug-reproduction/report-1-session-revocation.spec.mjs', 'browser Sign out revokes a session cookie copied by someone else', ['S09', 'S29', 'S05', 'S10'], 'core', 'oracle c3-bugrepro-logout; the only test proving that the UI Sign out revokes the session server-side (baseline-shop:71 checks the same jar after the cookie was cleared)'),
  keep('campaign3/bug-reproduction/report-1-session-revocation.spec.mjs', 'POST /api/logout invalidates the session for every holder of the cookie', ['S09', 'S10', 'S16'], 'core', 'oracle c3-bugrepro-logout; survivor for review-followup/shop-review:6'),
  { file: 'campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs', title: 'reusing an Idempotency-Key with a different quantity returns 409 and creates no order', clauses: ['S13', 'S14', 'S11'], disposition: 'quarantine-redundant', supersededBy: 'baseline-shop/shop.spec.mjs: concurrent equivalent checkout replays once and persists across restart', tier: '-', mutationCheck: 'not run; by reading: the survivor sends the same quantity-changed basket under a used key, requires 409 idempotency_conflict, requires one order in durable state and replays the key afterwards', risk: 'low: same server path. The survivor reaches the conflict after six parallel submissions rather than one; a defect that only appears after a single create would be new', note: 'oracle c3-bugrepro-idempotency stays available in the kept sibling test' },
  keep('campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs', 'a changed SKU set or currency under a used key also conflicts', ['S14'], 'core', 'oracle c3-bugrepro-idempotency; the only test of a SKU-set change under a used key'),
  { file: 'campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs', title: 'keys are scoped to the signed-in user, so a conflict is not a global lock on the key', clauses: ['S15', 'S16', 'S17', 'S13', 'S14'], disposition: 'quarantine-redundant', supersededBy: 'baseline-shop/shop.spec.mjs: order ownership is private and idempotency keys belong to users (+ concurrent equivalent checkout for the 409)', tier: '-', mutationCheck: 'not run; by reading: baseline-shop:28 creates orders for alice and bob under one key and requires distinct ids, user-scoped lists and a 404 for the foreign id; any global-key implementation fails there', risk: 'low-medium: bob using the key with a different basket after alice\'s conflict is not exercised elsewhere; a per-key global intent hash (conflict for bob) would still fail baseline-shop:28 because bob would be replayed alice\'s order', note: '' },

  // ---------------------------------------------------------------- campaign3/selector-drift-recovery (9): byte-identical copy of baseline-todo
  ...['creates trimmed nonblank titles in order and clears the entry field', 'duplicate titles remain independent through complete edit and delete', 'individual completion and restoration keep the active count global under filters', 'bulk toggle affects hidden records and works from an empty filtered view', 'filters visibly select the correct subset without losing or duplicating records', 'Enter and blur save edits while Escape preserves the saved title on reload', 'whitespace Enter and empty blur edits remove only their targeted records', 'delete and clear completed preserve active rows and empty controls recover', 'saved edits completion order and removals persist through reload and further keyboard input'].map(title => ({
    file: 'campaign3/selector-drift-recovery/todomvc.spec.mjs', title, clauses: [], disposition: 'quarantine-redundant', supersededBy: `baseline-todo/todomvc.spec.mjs: ${title}`, tier: '-',
    reason: 'byte-identical copy of baseline-todo/todomvc.spec.mjs (diff: lines 1-2, the import depth); same assertions, same oracle ids',
    mutationCheck: 'not needed: the spec is byte-identical to baseline-todo/todomvc.spec.mjs except the two import depths (diff shows lines 1-2 only); same assertions, same oracle ids', risk: 'none for assertions. The only thing this folder adds is its locator helper, which the curated suite adopts (merge row above)', note: 'byte-identical to the baseline spec; clauses credited to the baseline copy',
  })),

  // ---------------------------------------------------------------- campaign3/service-virtualization (10)
  keep('campaign3/service-virtualization/stub-fidelity.spec.mjs', 'every recorded request still draws a response of the recorded shape from the live Shop', ['X07', 'S01', 'S03', 'S06', 'S07', 'S08', 'S11', 'S12', 'S13', 'S14', 'S16', 'S17', 'S09'], 'core', 'oracle c3-virt-catalog-drift; shape-only comparison of 15 endpoints, values never compared'),
  keep('campaign3/service-virtualization/stub-fidelity.spec.mjs', 'the comparator flags a dropped field, a changed type, a changed status, an emptied array and a non-JSON body', ['X08'], 'extended', 'tooling self-check, no application traffic (6 ms); low-value for the product, required by AGENTS.md for the detector'),
  keep('campaign3/service-virtualization/stub-fidelity.spec.mjs', 'the freshness gate accepts every current recording and rejects a 31-day-old stamp', ['X08'], 'extended', 'tooling self-check; will start failing 30 days after the recordings (re-record with record.mjs)'),
  keep('campaign3/service-virtualization/virtualized-ui.spec.mjs', '500 on order creation: error shown, no purchase event, retry reuses the key and creates exactly one order', ['X06', 'S13', 'S34'], 'core', 'only test producing POST /api/orders 500'),
  keep('campaign3/service-virtualization/virtualized-ui.spec.mjs', '429 on login: too_many_attempts shown, sign-in form kept, no login event; the real sign-in works once the stub steps aside', ['X06', 'S34'], 'extended', 'AST cluster with the 500-on-list test (0.88) is a false positive: different stub, different page state'),
  keep('campaign3/service-virtualization/virtualized-ui.spec.mjs', 'slow /api/orders: sign-in does not claim completion before the list arrives; overlapping refreshes never duplicate rows', ['X06'], 'extended', ''),
  keep('campaign3/service-virtualization/virtualized-ui.spec.mjs', 'malformed JSON on a 200 login response is reported as an error, never as a sign-in', ['X06', 'S34'], 'extended', ''),
  { ...keep('campaign3/service-virtualization/virtualized-ui.spec.mjs', 'empty catalogue: no products, zero total, and an order attempt is a visible error, never a silent success', ['X06', 'S12', 'S34'], 'extended'), disposition: 'rewrite', note: 'kept as-is in curated/; rewrite recommended: the oracle branches on `if (enabled)` so the test accepts two different behaviours (button disabled, or 400 shown). It should assert the one the team decides on. Both branches still assert; it cannot pass silently' },
  keep('campaign3/service-virtualization/virtualized-ui.spec.mjs', '500 on the orders list right after sign-in is shown; Refresh orders recovers', ['X06'], 'extended', 'only test producing GET /api/orders 500'),
  keep('campaign3/service-virtualization/virtualized-ui.spec.mjs', 'fully virtualized load from recordings; an unstubbed call is rejected and logged, not sent to the Shop', ['X06'], 'extended', ''),

  // ---------------------------------------------------------------- campaign3/synthetic-monitoring (5): scheduled probes, kept as the monitoring tier
  keep('campaign3/synthetic-monitoring/health.probe.spec.mjs', 'GET /health answers ok for the released build within 500 ms', ['S01', 'S02'], 'monitoring', 'the only test of the 500 ms clause (three samples)'),
  keep('campaign3/synthetic-monitoring/storefront.probe.spec.mjs', 'GET / renders the catalogue at contract prices with sign-in and reset controls', ['S27', 'X10', 'X09'], 'monitoring', 'the only test that reads the rendered prices as page text'),
  { ...keep('campaign3/synthetic-monitoring/sign-in.probe.spec.mjs', 'synthetic account signs in through the page, sees its account view, signs out', ['S05', 'S08', 'S29', 'X09'], 'monitoring'), note: 'low-value candidate routed to review (SKILL.md §5): every behaviour it asserts is also asserted by baseline-shop:71 and accessibility:6; its unique oracle is the author-chosen 5 s budget and the login-event warning (warn only, cannot fail). Kept because monitoring needs a cheap sign-in probe; not a regression-gate test' },
  { ...keep('campaign3/synthetic-monitoring/order-journey.probe.spec.mjs', 'synthetic account signs in, places a 1 x TEA-50 order and sees it listed as pending', ['S11', 'S27', 'S16', 'S17', 'X09'], 'monitoring'), note: 'low-value candidate routed to review: overlaps baseline-shop:71 and purchase-events:13; unique oracles are the 5 s click-to-listed budget and the "Fulfillments: 0" row text; the purchase-event check is warn only. Kept for the same reason as the sign-in probe' },
  keep('campaign3/synthetic-monitoring/password-reset-email.probe.spec.mjs', 'reset request delivers one correctly addressed email with a reset link within 10 s', ['S23', 'S24', 'X09'], 'monitoring', 'oracle c3-synth-reset-email; the only test asserting exactly one recipient and no Cc/Bcc, and a delivery budget'),

  // ---------------------------------------------------------------- campaign3/test-migration (7)
  keep('campaign3/test-migration/todomvc.spec.mjs', 'creates trimmed non-blank titles in order and clears the entry field', ['T1', 'T1t'], 'core', 'kept for its oracle, not its coverage: expectTitles uses allTextContents + toEqual, so untrimmed titles would fail here; baseline-todo:6 uses toHaveText, which normalises whitespace and cannot see a missing trim (coverage-equality trap, SKILL.md §2)'),
  { file: 'campaign3/test-migration/todomvc.spec.mjs', title: 'duplicate titles remain independent through complete, edit and delete', clauses: ['T2', 'T3', 'T5', 'T6'], disposition: 'quarantine-redundant', supersededBy: 'baseline-todo/todomvc.spec.mjs: duplicate titles remain independent through complete edit and delete', tier: '-', mutationCheck: 'not run (no mutation tool for the pinned upstream build); by reading: every assertion here (second row checked, first unchecked, count, edited title, survivors after delete, count) appears in the survivor, which additionally re-edits the duplicate and checks both survivors\' states', risk: 'low. Oracle id c3-mig-duplicates leaves the suite; todo-duplicates marks the same behaviour in the survivor', note: '' },
  { file: 'campaign3/test-migration/todomvc.spec.mjs', title: 'filters visibly select the correct subset', clauses: ['T4'], disposition: 'quarantine-redundant', supersededBy: 'baseline-todo/todomvc.spec.mjs: filters visibly select the correct subset without losing or duplicating records', tier: '-', mutationCheck: 'not run; by reading: survivor asserts the same three subsets, the selected marker on every filter (and its absence on the others), the count, and the empty Completed view', risk: 'low. toContainClass vs toHaveClass(/selected/) read the same attribute', note: '' },
  { file: 'campaign3/test-migration/todomvc.spec.mjs', title: 'Enter saves an edit and Escape preserves the saved title', clauses: ['T5', 'T7'], disposition: 'quarantine-redundant', supersededBy: 'baseline-todo/todomvc.spec.mjs: Enter and blur save edits while Escape preserves the saved title on reload', tier: '-', mutationCheck: 'not run; by reading: survivor saves with Enter and blur, cancels with Escape (twice, once empty), reloads and checks titles, states and count', risk: 'low', note: '' },
  { file: 'campaign3/test-migration/todomvc.spec.mjs', title: 'items and their completion persist through reload', clauses: ['T7'], disposition: 'quarantine-redundant', supersededBy: 'baseline-todo/todomvc.spec.mjs: Enter and blur save edits while Escape preserves the saved title on reload (+ saved edits ... persist through reload)', tier: '-', mutationCheck: 'not run; by reading: survivor reloads with one completed and one active row and checks both checkbox states and the count', risk: 'low', note: '' },
  { file: 'campaign3/test-migration/todomvc.spec.mjs', title: 'a deleted item stays deleted after reload', clauses: ['T6', 'T7', 'T7i'], disposition: 'quarantine-redundant', supersededBy: 'review-followup/todo-review.spec.mjs: single delete persists immediately with survivor order and completion intact', tier: '-', mutationCheck: 'not run; by reading: survivor deletes a row, reloads as the next action and checks survivors, order, completion and count', risk: 'low', note: '' },
  { file: 'campaign3/test-migration/todomvc.spec.mjs', title: 'mark-all completes and restores every item', clauses: ['T3'], disposition: 'quarantine-redundant', supersededBy: 'baseline-todo/todomvc.spec.mjs: bulk toggle affects hidden records and works from an empty filtered view', tier: '-', mutationCheck: 'not run; by reading: survivor toggles all from two filtered views, checks every row state and the count, and the toggle-all checkbox state', risk: 'low-medium: this test drives the native checkbox directly (toggleAll.check()); the survivor clicks its visible label. Same control, different pointer target; the survivor also never asserts Clear completed is visible after mark-all (baseline-todo:173 does)', note: '' },

  // ---------------------------------------------------------------- campaign3/visual-testing (10)
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'empty state shows only the header and the info footer', ['X12', 'T6'], 'extended', ''),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'several active items', ['X12'], 'extended', ''),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'filter view: all', ['X12', 'T4'], 'extended', 'three parametrised tests share one body (AST score 1.0 between them is the loop, not a copy)'),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'filter view: active', ['X12', 'T4'], 'extended', ''),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'filter view: completed', ['X12', 'T4'], 'extended', ''),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'all items completed through mark-all', ['X12', 'T3'], 'extended', 'oracle c3-visual-style'),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'editing in progress', ['X12'], 'extended', ''),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'hovering a row reveals its delete control', ['X12'], 'extended', ''),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'mixed list at phone width', ['X12'], 'extended', ''),
  keep('campaign3/visual-testing/todomvc-visual.spec.mjs', 'a different state is rejected against an existing baseline', ['X13'], 'extended', 'opt-in (VISUAL_DETECTOR_CHECK=1); skipped in every ordinary run, including the two curated runs'),
];

// Files that are not tests. Disposition per file.
export const nonTestFiles = [
  { file: 'baseline-shop/probe.mjs', disposition: 'delete-obsolete', reason: 'UI discovery probe from the first authoring session; not a .spec.mjs so never collected; imports nothing from the corpus and nothing imports it; the review already asked for its exclusion', copied: false },
  { file: 'campaign3/analytics-tracking-testing/selfcheck-validator.mjs', disposition: 'keep (manual tool)', reason: 'detector self-check for validate.mjs, run by hand with node; needed when the tracking plan changes', copied: true },
  { file: 'campaign3/bug-reproduction/oracle-sensitivity.mjs', disposition: 'keep (manual tool)', reason: 'runs the two report oracles against a defective stub; the only "watch it go red" evidence for those oracles', copied: true },
  { file: 'campaign3/service-virtualization/record.mjs', disposition: 'keep (manual tool)', reason: 're-records recordings/*.json; the freshness gate fails after 30 days without it', copied: true },
  { file: 'campaign3/selector-drift-recovery/.drift-recovery/**', disposition: 'quarantine with its folder', reason: 'one-off scripts and DOM snapshots of the drift-recovery run; evidence, not suite code', copied: false },
  { file: 'campaign3/selector-drift-recovery/before/*.orig', disposition: 'quarantine with its folder', reason: 'frozen copies of the baseline-todo files; evidence', copied: false },
  { file: 'campaign3/test-migration/legacy/todomvc.cy.js', disposition: 'quarantine with its folder', reason: 'the Cypress input of the migration; cannot run (Cypress is not installed); the parity sheet references it', copied: false },
  { file: 'addons/helpers.mjs: closedPort, signature', disposition: 'keep, un-export', reason: 'exported but only used inside the module (closedPort) or never imported from here (signature is re-exported from baseline-shop)', copied: true },
  { file: 'campaign3/analytics-tracking-testing/helpers/shop.mjs: uiProbes', disposition: 'keep, un-export', reason: 'exported, used only inside the module', copied: true },
  { file: 'campaign3/bug-reproduction/helpers.mjs: sessionCookieFrom', disposition: 'keep, un-export', reason: 'exported, used only inside the module', copied: true },
  { file: 'campaign3/service-virtualization/cassette.mjs: recordingsDir; scenario.mjs: ORDER_BODY, normalizeResponse; virtual-api.mjs: fulfillFrom', disposition: 'keep, un-export', reason: 'exported, used only inside their modules', copied: true },
];
