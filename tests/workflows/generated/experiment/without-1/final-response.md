# Shop acceptance suite: without-1

Final run: 12 scheduled, 12 passed, 0 failed, 0 skipped, 0 flaky. Chromium, 2 workers, about 10 s wall time.
Command and per-test output are in `execution.log`. Reports are in
`/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad/experiment-without-1`
(`verbose.json`, `html/`).

## Files

- `helpers.mjs` extends the support `test` with two fixtures:
  - `shop`: request contexts with the app's baseURL, plus helpers for signed webhook delivery, test-support state and the fixture clock.
  - `inbox`: Mailpit search scoped to one address. At teardown it deletes only the message IDs this test saw, and it never sends an empty ID list.
- `account-auth.spec.mjs` (2 tests): health and catalog, login cookie attributes, `/api/me`, logout revoking the session on the server (replaying the old cookie returns 401), and throttling:
  - 5 failures, then 429 with `Retry-After: 60`, even for the correct password, and no session is created.
  - Unknown addresses are throttled the same way, and each address has its own counter.
  - A successful sign-in resets the counter.
  - The window is released by advancing the clock 61 s.
- `orders.spec.mjs` (3 tests):
  - Every order endpoint returns 401 without a session.
  - Seven invalid carts each return 400 `invalid_order` and create no order.
  - Bad or missing `Idempotency-Key` returns 400; a 128-character key is accepted.
  - A client-supplied `amount` is ignored (4200); quantity 10 is accepted (18000).
  - 10 parallel requests with the same key give exactly one 201 and nine 200 `replayed:true` responses, all for one order.
  - Replay with items in a different order works. Conflicts on quantity, SKU and currency return 409; USD is reported as a conflict, not as `invalid_order`.
  - Bob can reuse the same key independently.
  - A foreign order ID and an unknown ID return byte-identical 404 bodies.
- `payments.spec.mjs` (3 tests):
  - Rejections leave no receipt and the order stays pending: missing, wrong and bytes-mismatched signatures (401), malformed events (400), unknown order (404), amount or currency mismatch (422).
  - Then: accept, duplicate, `event_conflict`, and a second distinct payment does not fulfill again.
  - Concurrency: 8 identical deliveries give exactly one `duplicate:false`, 6 distinct events for one order leave `fulfillment_count` at 1, and a 6-way burst under `failFulfillmentOnce` gives exactly one 503 and one fulfillment after a retry.
  - Restart: a 503 leaves the order pending with no receipt. The retry succeeds. After a restart without fault injection the order is still paid with count 1. Replaying the event returns `duplicate:true`, reusing its ID for another order returns 409, the idempotency replay returns the same order, and there is exactly one receipt.
- `password-reset.spec.mjs` (2 tests):
  - The real Mailpit message reaches the right recipient, its text and HTML parts carry the same link to this app, and the unknown address gets no mail (checked after Alice's mail arrives).
  - A short password returns 400 and keeps sessions. A valid reset returns `{reset:true}`, ends the old session, the old password fails and the new one works. The consumed token and a bogus token both return `invalid_or_expired_token`.
  - Expiry: advancing the clock 301 s rejects the token, and the password is unchanged.
- `checkout-browser.spec.mjs` (2 tests):
  - A rejected sign-in shows the error and pushes no `login` event. A valid sign-in pushes exactly one `login`.
  - Cart total EUR 42.00. The order notice shows the server ID and amount. Exactly one `purchase` event, with the correct transaction ID, value 42, EUR and items.
  - A signed webhook is sent, and after a reload the user and a paid order with 1 fulfillment are restored. Sign-out pushes no event and revokes API access (401).
  - Reset through the UI: a forged token shows the server error, the inbox link resets the password, reusing the link shows the error, the new password signs in through the form and the old one fails.

## What happened during the work

The first full run had 11 passes and 1 failure: a correctly signed truncated-JSON webhook got 401 instead of 400. The bug was in the helper, not the app. The body was passed to Playwright as a string, and Playwright re-encodes a string that does not parse as JSON when `Content-Type` is JSON. The bytes sent therefore no longer matched the HMAC, and the app was right to reject them. The helper now sends a `Buffer`, so the bytes it signs are the bytes it sends. After that, payments.spec passed 3/3 and the full suite 12/12. No expectation was weakened.

## Where the contract is silent, so assertions are deliberately loose

- A second distinct payment for an already-paid order: only `< 500` is asserted, plus no second fulfillment.
- Missing or invalid `Idempotency-Key` and passwords under 12 characters: only status 400 is asserted. The observed error code for the key was `invalid_idempotency_key`.
- Sessions are not assumed to survive a restart. Tests sign in again afterwards.

## Not covered

- The SMTP-unreachable path (`smtp_errors` incrementing). Mailpit is worker-scoped and shared, so stopping it would disturb other tests.
- An analytics event for a rejected order through the UI. The quantity inputs have `min`/`max`, so the browser's own validation blocks the submit.
- The ordering "purchase event before the orders list refresh".
- The exact 60 s throttle and 300 s expiry boundaries. Only the after-the-window side is tested.
- Mobile viewport.
