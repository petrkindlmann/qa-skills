# Assertion metrics per test (direct = test body; expanded = body + inlined helpers)

| test | direct expects | expanded expects | soft | poll | status-only | weak matchers | strong matchers | warns | ifs | oracles | inlined helpers |
|---|---|---|---|---|---|---|---|---|---|---|---|
| addons/accessibility.spec.mjs:6 Shop sign-in, account and reset pages have no WCAG 2.2 AA violations | 11 | 14 | 0 | 0 | 0 | 0 | 14 | 0 | 0 | shop-unlabeled-controls | 3 |
| addons/accessibility.spec.mjs:42 Shop sign-in completes through the keyboard alone in document order | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 1 |  | 1 |
| addons/accessibility.spec.mjs:77 TodoMVC empty state is clean and populated rows expose only the documented upstream gaps | 8 | 11 | 0 | 0 | 0 | 0 | 11 | 0 | 0 |  | 6 |
| addons/database.spec.mjs:12 session credentials are stored hashed at rest and removed on logout | 10 | 12 | 0 | 0 | 1 | 0 | 12 | 0 | 0 | shop-plaintext-sessions | 3 |
| addons/database.spec.mjs:37 schema enforces idempotency uniqueness, foreign keys and durable journaling | 5 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | shop-missing-idempotency-index | 2 |
| addons/database.spec.mjs:66 orders, receipts and sessions stay referentially consistent after payment and logout | 8 | 10 | 0 | 0 | 1 | 0 | 10 | 0 | 0 |  | 6 |
| addons/performance.spec.mjs:28 TodoMVC paints its largest content within the lab budget | 4 | 4 | 0 | 0 | 0 | 1 | 3 | 0 | 0 | todo-delayed-render | 2 |
| addons/performance.spec.mjs:38 TodoMVC layout stays stable after load and while listing items | 5 | 5 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | todo-layout-shift | 6 |
| addons/security.spec.mjs:13 repeated sign-in failures are throttled per account and recover after the window | 11 | 14 | 0 | 0 | 4 | 0 | 14 | 0 | 0 | shop-no-login-throttle | 5 |
| addons/security.spec.mjs:39 test-support routes stay locked without the admin key | 5 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | shop-open-test-support | 4 |
| addons/security.spec.mjs:51 password reset stays uniform and accepted when the mail service is down | 7 | 9 | 0 | 0 | 0 | 0 | 11 | 0 | 0 | shop-smtp-failure | 6 |
| baseline-shop/shop.spec.mjs:4 API auth, cookie contract and logout revoke access | 14 | 16 | 0 | 0 | 1 | 0 | 16 | 0 | 0 |  | 1 |
| baseline-shop/shop.spec.mjs:20 catalog controls money and malformed orders never create state | 7 | 18 | 0 | 0 | 0 | 0 | 18 | 0 | 0 | shop-pricing | 4 |
| baseline-shop/shop.spec.mjs:28 order ownership is private and idempotency keys belong to users | 5 | 16 | 0 | 0 | 0 | 0 | 16 | 0 | 0 | shop-ownership | 3 |
| baseline-shop/shop.spec.mjs:34 concurrent equivalent checkout replays once and persists across restart | 8 | 19 | 0 | 0 | 0 | 0 | 19 | 0 | 0 | shop-key-conflict | 4 |
| baseline-shop/shop.spec.mjs:42 payment signatures, exact raw bytes and mismatched values reject without side effects | 8 | 19 | 0 | 0 | 2 | 0 | 19 | 0 | 0 |  | 6 |
| baseline-shop/shop.spec.mjs:53 concurrent payment redelivery, conflict and distinct event IDs fulfill once durably | 8 | 19 | 0 | 0 | 0 | 0 | 19 | 0 | 0 | shop-deduplication | 7 |
| baseline-shop/shop.spec.mjs:63 transient fulfillment rolls back receipt then same event succeeds after restart | 7 | 18 | 0 | 0 | 0 | 0 | 18 | 0 | 0 | shop-transaction | 7 |
| baseline-shop/shop.spec.mjs:71 browser checkout restores order on reload and reflects server payment | 10 | 12 | 0 | 0 | 1 | 0 | 12 | 0 | 0 |  | 5 |
| baseline-shop/shop.spec.mjs:82 actual reset email completes browser flow and revokes all sessions | 8 | 19 | 0 | 1 | 2 | 0 | 22 | 0 | 0 | shop-reset-reuse | 7 |
| baseline-shop/shop.spec.mjs:93 reset requests resist account enumeration and tokens expire on the server clock | 5 | 16 | 0 | 1 | 1 | 0 | 19 | 0 | 0 |  | 4 |
| baseline-todo/todomvc.spec.mjs:6 creates trimmed nonblank titles in order and clears the entry field | 13 | 13 | 0 | 0 | 0 | 0 | 13 | 0 | 0 |  | 4 |
| baseline-todo/todomvc.spec.mjs:29 duplicate titles remain independent through complete edit and delete | 10 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | todo-duplicates | 5 |
| baseline-todo/todomvc.spec.mjs:50 individual completion and restoration keep the active count global under filters | 14 | 14 | 0 | 0 | 0 | 0 | 14 | 0 | 0 |  | 4 |
| baseline-todo/todomvc.spec.mjs:78 bulk toggle affects hidden records and works from an empty filtered view | 13 | 13 | 0 | 0 | 0 | 0 | 13 | 0 | 0 |  | 4 |
| baseline-todo/todomvc.spec.mjs:107 filters visibly select the correct subset without losing or duplicating records | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | todo-filter | 5 |
| baseline-todo/todomvc.spec.mjs:134 Enter and blur save edits while Escape preserves the saved title on reload | 8 | 8 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | todo-cancel | 5 |
| baseline-todo/todomvc.spec.mjs:155 whitespace Enter and empty blur edits remove only their targeted records | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | todo-removal-persistence | 5 |
| baseline-todo/todomvc.spec.mjs:173 delete and clear completed preserve active rows and empty controls recover | 16 | 16 | 0 | 0 | 0 | 0 | 16 | 0 | 0 |  | 4 |
| baseline-todo/todomvc.spec.mjs:205 saved edits completion order and removals persist through reload and further keyboard input | 9 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | todo-persistence | 5 |
| campaign3/analytics-tracking-testing/login-events.spec.mjs:11 login is pushed exactly once after a successful sign-in, and not on load or reload | 15 | 17 | 0 | 0 | 1 | 0 | 19 | 0 | 0 |  | 15 |
| campaign3/analytics-tracking-testing/login-events.spec.mjs:41 a rejected sign-in pushes nothing; the following successful one pushes login once | 8 | 9 | 0 | 0 | 1 | 0 | 11 | 0 | 0 |  | 10 |
| campaign3/analytics-tracking-testing/login-events.spec.mjs:62 sign-out and a password-reset request push nothing after the login event | 10 | 12 | 0 | 0 | 2 | 0 | 14 | 0 | 1 |  | 11 |
| campaign3/analytics-tracking-testing/purchase-events.spec.mjs:13 purchase carries the created order: transaction_id, major-unit value, currency and items match the API | 21 | 24 | 0 | 0 | 2 | 0 | 27 | 0 | 0 | c3-analytics-currency | 22 |
| campaign3/analytics-tracking-testing/purchase-events.spec.mjs:62 two orders push two purchase inputs, one per created order, with distinct transaction ids | 13 | 17 | 0 | 0 | 1 | 0 | 19 | 0 | 0 |  | 21 |
| campaign3/analytics-tracking-testing/purchase-events.spec.mjs:98 a double-click on Place order creates one order and pushes purchase once | 8 | 11 | 0 | 0 | 1 | 0 | 13 | 0 | 0 |  | 15 |
| campaign3/analytics-tracking-testing/purchase-events.spec.mjs:120 a rejected order pushes no purchase; the next accepted order pushes exactly one | 13 | 17 | 0 | 0 | 2 | 0 | 19 | 0 | 0 |  | 17 |
| campaign3/analytics-tracking-testing/purchase-events.spec.mjs:152 ordering: login after the account UI shows and before orders load; purchase after the order response and before the list refreshes | 17 | 20 | 0 | 0 | 1 | 0 | 22 | 0 | 0 |  | 14 |
| campaign3/bug-reproduction/report-1-session-revocation.spec.mjs:9 browser Sign out revokes a session cookie copied by someone else | 17 | 22 | 0 | 0 | 2 | 1 | 21 | 0 | 0 | c3-bugrepro-logout | 6 |
| campaign3/bug-reproduction/report-1-session-revocation.spec.mjs:60 POST /api/logout invalidates the session for every holder of the cookie | 6 | 15 | 0 | 0 | 4 | 0 | 16 | 0 | 0 | c3-bugrepro-logout | 10 |
| campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs:15 reusing an Idempotency-Key with a different quantity returns 409 and creates no order | 6 | 13 | 0 | 0 | 1 | 0 | 14 | 0 | 0 | c3-bugrepro-idempotency | 9 |
| campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs:41 a changed SKU set or currency under a used key also conflicts | 1 | 8 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | c3-bugrepro-idempotency | 9 |
| campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs:58 keys are scoped to the signed-in user, so a conflict is not a global lock on the key | 8 | 15 | 0 | 0 | 2 | 0 | 16 | 0 | 0 | c3-bugrepro-idempotency | 9 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:6 creates trimmed nonblank titles in order and clears the entry field | 13 | 13 | 0 | 0 | 0 | 0 | 13 | 0 | 0 |  | 4 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:29 duplicate titles remain independent through complete edit and delete | 10 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | todo-duplicates | 5 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:50 individual completion and restoration keep the active count global under filters | 14 | 14 | 0 | 0 | 0 | 0 | 14 | 0 | 0 |  | 4 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:78 bulk toggle affects hidden records and works from an empty filtered view | 13 | 13 | 0 | 0 | 0 | 0 | 13 | 0 | 0 |  | 4 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:107 filters visibly select the correct subset without losing or duplicating records | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | todo-filter | 5 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:134 Enter and blur save edits while Escape preserves the saved title on reload | 8 | 8 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | todo-cancel | 5 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:155 whitespace Enter and empty blur edits remove only their targeted records | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | todo-removal-persistence | 5 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:173 delete and clear completed preserve active rows and empty controls recover | 16 | 16 | 0 | 0 | 0 | 0 | 16 | 0 | 0 |  | 4 |
| campaign3/selector-drift-recovery/todomvc.spec.mjs:205 saved edits completion order and removals persist through reload and further keyboard input | 9 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | todo-persistence | 5 |
| campaign3/service-virtualization/stub-fidelity.spec.mjs:11 every recorded request still draws a response of the recorded shape from the live Shop | 5 | 5 | 1 | 0 | 0 | 0 | 6 | 0 | 2 | c3-virt-catalog-drift | 10 |
| campaign3/service-virtualization/stub-fidelity.spec.mjs:34 the comparator flags a dropped field, a changed type, a changed status, an emptied array and a non-JSON body | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |  | 6 |
| campaign3/service-virtualization/stub-fidelity.spec.mjs:59 the freshness gate accepts every current recording and rejects a 31-day-old stamp | 5 | 5 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |  | 3 |
| campaign3/service-virtualization/virtualized-ui.spec.mjs:35 500 on order creation: error shown, no purchase event, retry reuses the key and creates exactly one order | 16 | 18 | 0 | 0 | 0 | 0 | 19 | 0 | 1 |  | 11 |
| campaign3/service-virtualization/virtualized-ui.spec.mjs:69 429 on login: too_many_attempts shown, sign-in form kept, no login event; the real sign-in works once the stub steps aside | 13 | 14 | 0 | 0 | 1 | 0 | 15 | 0 | 0 |  | 9 |
| campaign3/service-virtualization/virtualized-ui.spec.mjs:92 slow /api/orders: sign-in does not claim completion before the list arrives; overlapping refreshes never duplicate rows | 10 | 11 | 0 | 3 | 0 | 0 | 15 | 0 | 0 |  | 9 |
| campaign3/service-virtualization/virtualized-ui.spec.mjs:124 malformed JSON on a 200 login response is reported as an error, never as a sign-in | 8 | 9 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |  | 9 |
| campaign3/service-virtualization/virtualized-ui.spec.mjs:142 empty catalogue: no products, zero total, and an order attempt is a visible error, never a silent success | 11 | 13 | 0 | 0 | 0 | 0 | 14 | 0 | 1 |  | 10 |
| campaign3/service-virtualization/virtualized-ui.spec.mjs:172 500 on the orders list right after sign-in is shown; Refresh orders recovers | 8 | 9 | 0 | 0 | 1 | 0 | 10 | 0 | 0 |  | 8 |
| campaign3/service-virtualization/virtualized-ui.spec.mjs:190 fully virtualized load from recordings; an unstubbed call is rejected and logged, not sent to the Shop | 9 | 10 | 0 | 0 | 0 | 0 | 11 | 0 | 0 |  | 9 |
| campaign3/synthetic-monitoring/health.probe.spec.mjs:9 GET /health answers ok for the released build within 500 ms | 0 | 5 | 2 | 0 | 0 | 0 | 7 | 3 | 0 |  | 9 |
| campaign3/synthetic-monitoring/order-journey.probe.spec.mjs:10 synthetic account signs in, places a 1 x TEA-50 order and sees it listed as pending | 0 | 16 | 2 | 0 | 0 | 0 | 19 | 4 | 0 |  | 11 |
| campaign3/synthetic-monitoring/password-reset-email.probe.spec.mjs:11 reset request delivers one correctly addressed email with a reset link within 10 s | 0 | 23 | 2 | 1 | 0 | 0 | 27 | 2 | 0 | c3-synth-reset-email | 14 |
| campaign3/synthetic-monitoring/sign-in.probe.spec.mjs:10 synthetic account signs in through the page, sees its account view, signs out | 0 | 10 | 2 | 0 | 0 | 0 | 12 | 3 | 0 |  | 11 |
| campaign3/synthetic-monitoring/storefront.probe.spec.mjs:9 GET / renders the catalogue at contract prices with sign-in and reset controls | 0 | 10 | 2 | 0 | 0 | 0 | 12 | 2 | 0 |  | 9 |
| campaign3/test-migration/todomvc.spec.mjs:16 creates trimmed non-blank titles in order and clears the entry field | 3 | 3 | 0 | 1 | 0 | 0 | 4 | 0 | 0 |  | 3 |
| campaign3/test-migration/todomvc.spec.mjs:25 duplicate titles remain independent through complete, edit and delete | 4 | 5 | 0 | 1 | 0 | 0 | 6 | 0 | 0 | c3-mig-duplicates | 8 |
| campaign3/test-migration/todomvc.spec.mjs:37 filters visibly select the correct subset | 3 | 3 | 0 | 1 | 0 | 0 | 4 | 0 | 0 | c3-mig-filter | 7 |
| campaign3/test-migration/todomvc.spec.mjs:50 Enter saves an edit and Escape preserves the saved title | 2 | 4 | 0 | 1 | 0 | 0 | 5 | 0 | 0 | c3-mig-cancel | 6 |
| campaign3/test-migration/todomvc.spec.mjs:60 items and their completion persist through reload | 4 | 5 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | c3-mig-persistence | 6 |
| campaign3/test-migration/todomvc.spec.mjs:70 a deleted item stays deleted after reload | 1 | 2 | 0 | 1 | 0 | 0 | 3 | 0 | 0 |  | 5 |
| campaign3/test-migration/todomvc.spec.mjs:78 mark-all completes and restores every item | 7 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |  | 2 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:26 empty state shows only the header and the info footer | 3 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 |  | 2 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:34 several active items | 2 | 5 | 0 | 0 | 0 | 0 | 5 | 0 | 0 |  | 4 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:51 filter view: all | 4 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |  | 5 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:51 filter view: active | 4 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |  | 5 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:51 filter view: completed | 4 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |  | 5 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:62 all items completed through mark-all | 4 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | c3-visual-style | 5 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:74 editing in progress | 3 | 8 | 0 | 0 | 0 | 0 | 8 | 0 | 0 |  | 5 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:87 hovering a row reveals its delete control | 2 | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |  | 5 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:100 mixed list at phone width | 1 | 6 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |  | 4 |
| campaign3/visual-testing/todomvc-visual.spec.mjs:112 a different state is rejected against an existing baseline | 4 | 7 | 0 | 0 | 0 | 1 | 6 | 0 | 0 |  | 4 |
| review-followup/shop-review.spec.mjs:6 logout revokes a previously valid copied session on the server | 7 | 10 | 0 | 0 | 1 | 0 | 10 | 0 | 0 | shop-logout | 3 |
| review-followup/shop-review.spec.mjs:33 each SKU has its contracted unit price and quantity ten is accepted | 6 | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | shop-unit-prices | 4 |
| review-followup/shop-review.spec.mjs:63 correctly signed noncanonical JSON is accepted and identical bytes replay once | 13 | 16 | 0 | 0 | 0 | 0 | 16 | 0 | 0 | shop-signed-whitespace | 6 |
| review-followup/todo-review.spec.mjs:6 single delete persists immediately with survivor order and completion intact | 8 | 8 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | todo-removal-persistence | 5 |
| review-followup/todo-review.spec.mjs:25 clear completed persists immediately and preserves active titles and order | 11 | 11 | 0 | 0 | 0 | 0 | 11 | 0 | 0 |  | 4 |
| review-followup/todo-review.spec.mjs:48 clearing the final completed item persists the empty state immediately | 10 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |  | 4 |