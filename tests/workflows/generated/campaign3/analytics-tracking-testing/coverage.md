# Tracking-plan coverage

Plan source: `tests/workflows/fixture-app-contract.md`, section "Service health and analytics events",
encoded in `tracking-plan.json`. Observable: `window.dataLayer.push` inputs, recorded by the passive
observer in `helpers/datalayer.mjs` (no beacon exists in this application).

Test ids: L1-L3 in `login-events.spec.mjs`, P1-P5 in `purchase-events.spec.mjs`.

| L1 | login is pushed exactly once after a successful sign-in, and not on load or reload |
| L2 | a rejected sign-in pushes nothing; the following successful one pushes login once |
| L3 | sign-out and a password-reset request push nothing after the login event |
| P1 | purchase carries the created order: transaction_id, major-unit value, currency and items match the API |
| P2 | two orders push two purchase inputs, one per created order, with distinct transaction ids |
| P3 | a double-click on Place order creates one order and pushes purchase once |
| P4 | a rejected order pushes no purchase; the next accepted order pushes exactly one |
| P5 | ordering: login after the account UI shows and before orders load; purchase after the order response and before the list refreshes |

| Event | Field / clause | Oracle | Test |
|---|---|---|---|
| login | `event: "login"`, no other keys | contract literal (`toEqual`) | L1, L2, L3, P5 |
| login | `method: "password"` (nonempty string per plan) | `validateEvent` + literal | L1, L2 |
| login | once per successful sign-in | count of new entries after checkpoint = 1; `/api/me` 200 | L1, L2 |
| login | nothing on page load; nothing on reload that restores the session | entries `[]` after `html[data-ready]` | L1 |
| login | nothing after a rejected sign-in (401) | entries `[]`, `/api/me` 401, then in-page control push | L2 |
| login | pushed after the account section shows and before the orders list loads | UI probe at push time: `accountVisible`, `loginVisible`, `orderRows` | P5 |
| purchase | `event: "purchase"`, `ecommerce` with exactly `transaction_id`, `value`, `currency`, `items` | key-set assertion | P1 |
| purchase | `transaction_id` = id of the order the API created | `GET /api/orders/ID` (P1), `GET /api/orders` (P2, P3, P4), POST response (all) | P1, P2, P3, P4, P5 |
| purchase | `value` = `amount / 100` in major units | literal 42 for 4200 (P1), 12 for 1200 (P4); `major(amount)` for every API order (P2, P3) | P1, P2, P3, P4 |
| purchase | `currency` = the order's currency = `EUR` | API order field + plan literal | P1, P2, P3, P4 |
| purchase | `items[] = { item_id: sku, quantity }`, one per line, no price or extra keys | API order items + key-set assertion | P1, P2, P3, P4 |
| purchase | exactly once per created order | 2 orders -> 2 entries with distinct ids (P2); double-click -> 1 order, 1 entry (P3); 1 after a rejection (P4) | P2, P3, P4 |
| purchase | nothing for a rejected order (400 `invalid_order`) | entries unchanged, `GET /api/orders` `[]`, then in-page control | P4 |
| purchase | after the order response arrives, before the orders list refreshes | push carries the server id; UI probe at push time: order id not listed, list still in pre-order state, checkout button still disabled | P5 |
| (none) | sign-out pushes nothing; raw layer keeps the login entry (never cleared) | entries unchanged, `/api/me` 401, `window.dataLayer.length` 1 | L3 |
| (none) | password-reset request pushes nothing | entries unchanged, request 202 | L3 |
| dataLayer | created on load as an array, never replaced, never cleared | `Array.isArray`, `trace.replacements` 0, raw layer agrees with the observer | L1, L3, P2, P3 |
| page | the orders list shows the same order id and amount the push carried | `#orders li[data-order-id]` text | P1, P5 |

Plan-level checks: every purchase payload in P1 and P2 passes `validateEvent(plan, 'purchase', ...)`
(missing/type violations), every login in L1 passes `validateEvent(plan, 'login', ...)`. The validator's
own detection was exercised with broken payloads in `selfcheck-validator.mjs`.

Not covered (and why): no network beacon exists, so beacon interception, pixel dedup, consent mode,
news-media events and the CI baseline diff from the skill do not apply; a deliberately broken Shop
could not be used to prove the gate fails (fixture edits are out of scope), so the broken case was
run against a scratch page through the same observer and assertions (see execution.log).
