# Shop acceptance suite: final response

The suite has 12 Playwright tests in five spec files. Each test gets its own Shop process and
SQLite database, uses real HTTP, Chromium and the worker's real Mailpit, and mocks or routes
nothing. The final run with the prescribed command and `--workers 2` passed 12 of 12 in 7.3 s.
A stability run with `--repeat-each 3` passed 36 of 36. Command, file hashes and per-test
durations are in `execution.log`.

## What the tests cover

| File | Test | Main assertions |
|---|---|---|
| account-auth | session cookie and server-side sign-out | 401 `invalid_credentials` sets no cookie. `shop_session` has HttpOnly, SameSite=Lax and Path=/ and no Secure. `/api/me` works. After a 204 logout, replaying the old cookie value gets 401 and the test-support session count is 0 |
| account-auth | sign-in throttle | After 5 failures the correct password gets 429 `too_many_attempts` with `Retry-After: 60`, no cookie and no session. Unknown addresses lock the same way. Bob is unaffected. After the test clock moves 61 s sign-in works, and the counter is cleared |
| orders | server pricing and validation | 401 without a session. A missing or malformed Idempotency-Key is rejected. Unknown, duplicate, 0, 11, 1.5 and "2" quantities, empty items and USD each get 400 `invalid_order` and create no order. A client `amount` is ignored (4200). Quantity 10 is accepted (18000) |
| orders | idempotency and ownership | A replay with items in another order gets 200 `replayed:true` and the same order. Changing quantity, SKU or currency (USD) gets 409. Bob can reuse the key and gets his own order. Another user's order ID gets the same 404 `not_found` as an unknown ID. Each order list contains only its owner's orders |
| orders | 8 parallel submissions with one key | Exactly one 201 and seven 200 replays, one order ID, one stored order |
| payments | rejection matrix, then exactly-once | A missing signature, the wrong secret, or a signature over other bytes gets 401. Unknown order gets 404, amount or currency mismatch gets 422, malformed JSON or a missing data field gets 400. None of these records a receipt or changes the order. A valid event returns paid with `fulfillment_count` 1. The identical repeat gets `duplicate:true`. The same event ID naming another order gets 409 `event_conflict` and that order stays pending. A distinct second event does not fulfill again |
| payments | concurrency | 10 parallel copies of one event give one non-duplicate and 9 duplicates, one receipt and one fulfillment. 6 different event IDs racing for one order give one fulfillment and no 5xx |
| payments | transient failure and restart | The order survives a restart with `failFulfillmentOnce`. The event gets 503 `fulfillment_unavailable`, the order stays pending and no receipt is stored. A retry of the same bytes pays once. After a second, normal restart: the order is still paid with count 1, the replayed event is a duplicate, the event-ID conflict persists, the idempotency key still replays, and there is one receipt |
| password-reset | API reset through the real inbox | Known and unknown addresses get the same 202 body, and only the known one gets mail. Subject, recipient, and the same link in the text and HTML parts are checked. 11 characters are refused. A valid reset ends both existing sessions, the old password fails and the new one works. The token is single use, and a bogus token gets 400 |
| password-reset | expiry | The stored token has no raw value. After 301 s on the test clock it gets 400 `invalid_or_expired_token` and the password is unchanged |
| browser-journeys | checkout journey | A wrong password shows the error and pushes no login event. Sign-in pushes one `login` event and the cookie is not visible to JS. 11 cups are blocked by the form and no order request is sent. Checkout shows the server's order ID and EUR 42.00, which the API confirms. One correct `purchase` event is pushed. A signed payment shows as paid after Refresh orders. Reload restores the user and orders. Sign-out removes access in the UI and the API, and pushes no events |
| browser-journeys | reset from the emailed link | The UI request leads to a Mailpit message. Its HTML link opens the form and the reset succeeds. The old password is rejected. Reusing the link shows `invalid_or_expired_token`. The new password signs in, and the only event pushed is `login` |

Inbox cleanup is scoped. The fixture deletes only messages addressed to that test's own
addresses, refuses to send an empty ID list (which would purge the shared inbox), and checks
that those addresses are empty afterwards.

## Findings
No application defects were observed. The only failure came from my own wrong assumption.
On the first run, the browser test expected the server's `invalid_order` message after
entering 11 cups. In fact the input has `max=10`, so the browser's form validation stops the
submit and no request is sent. The test now asserts that behaviour. The server-side rejection
is covered by orders.spec.

## Interpretations beyond the contract (asserted, but please confirm)
- The contract gives no status code for a missing or malformed Idempotency-Key, a password
  under 12 characters, or a distinct second payment event for a paid order. The tests require
  4xx, 4xx and "not 5xx and no second fulfillment" respectively.
- A refused short-password confirm does not use up the token: the same token works afterwards.
- A session restored by page reload pushes no `login` event. The test expects `dataLayer` to be
  empty after a reload.
- Sessions are not assumed to survive a restart. The tests sign in again after each restart.

## Not covered
- The SMTP-down path (the `smtp_errors` counter). Mailpit is shared by the worker and must not be stopped.
- The `/health` latency budget.
- The ordering rule "purchase is pushed before the orders list refreshes".
- The mobile viewport and accessibility audits.

Final counts: 12 passed, 0 failed, 0 skipped, 0 flaky (stability run: 36 passed of 36).
