# Shop acceptance suite: bare-1

## Result

The final run used the exact command from the task (2 workers) and all **11 of 11 tests passed** in about 5 s. Before that, a stability run with `--repeat-each 3` passed 33 of 33. Full output is in `execution.log`.

## What the tests cover

| File | Test | What it checks |
|---|---|---|
| `browser.spec.mjs` | Checkout journey | A wrong password shows `invalid_credentials` and pushes no analytics. A real sign-in pushes one `login` event. Setting quantities shows a cart total of EUR 42.00. Placing the order returns 201 with amount 4200, and the notice and order row show the server's ID and amount. Exactly one `purchase` event is pushed with the right id, value, currency and items. After a signed payment, Refresh shows `paid · Fulfillments: 1`. Reloading keeps the user signed in and pushes no new purchase. Sign-out makes `/api/me` return 401 and leaves 0 sessions. |
| `browser.spec.mjs` | Password reset through Mailpit | The same generic message appears for an unknown address and for alice. Mailpit has exactly one message: the right subject and recipient, a plaintext link to this app's `/reset-password?token=`, and the same link in the HTML. The unknown address gets no mail. The reset form succeeds. A session opened before the reset gets 401, the old password fails and the new one works. Reusing the link shows `invalid_or_expired_token`. No analytics events are pushed. |
| `api-account.spec.mjs` | Health, session and logout | `/health` returns its exact body in under 500 ms. All order and me endpoints return 401 without a session. Test-support returns 403 with no admin key or a wrong one. The cookie has `HttpOnly`, `SameSite=Lax` and `Path=/` and is not `Secure`. Logout returns 204 and the session is revoked. |
| `api-account.spec.mjs` | Sign-in throttling | After 5 failures, a 6th attempt gets 429 even with the correct password, with `Retry-After: 60`, no cookie and no session. An unknown address throttles the same way. Throttling is per address, and a successful sign-in clears the counter. Advancing the clock 61 s lets alice sign in again. |
| `api-account.spec.mjs` | Reset token rules | A short password gets 400 and the token stays unconsumed. After advancing the clock 301 s the token is expired. A bogus token gets 400 `invalid_or_expired_token`. The old password still works. |
| `api-orders.spec.mjs` | Pricing and validation | A client-sent `amount` is ignored (the server returns 4200). Quantity 10 is accepted. Eight kinds of invalid cart each get 400 `invalid_order`. A missing or malformed Idempotency-Key gets a 4xx. Only the 2 valid orders exist afterwards. |
| `api-orders.spec.mjs` | Idempotency | Replaying with the items reordered returns 200 with `replayed: true` and the same order. A different quantity, SKU or currency gets 409; the currency conflict wins over the EUR check. Bob can use the same key and gets his own order. 10 parallel identical submissions create one order (one 201, nine 200 replays). |
| `api-orders.spec.mjs` | Ownership | Another user's order ID and an unknown ID give byte-identical 404 `not_found` responses. Each user's list contains only their own orders. |
| `api-payments.spec.mjs` | Webhook rules | A missing signature, a wrong secret, or a signature over a different body each get 401 and record no receipt. A malformed event gets 400 and an unknown order 404. A wrong amount or currency gets 422. A valid event marks the order paid with one fulfillment. Repeating it gets `duplicate: true`. Reusing the event ID for a different (otherwise valid) order gets 409 `event_conflict`. A second distinct event does not fulfill the order again. |
| `api-payments.spec.mjs` | Concurrent deliveries | 8 parallel copies of the same event: all get 200, exactly one is not a duplicate, there is one fulfillment and one receipt. 6 parallel distinct events for a pending order still produce exactly one fulfillment. |
| `api-payments.spec.mjs` | Transient failure and restart | After `restart({failFulfillmentOnce:true})` the first delivery gets 503 `fulfillment_unavailable`, the order stays pending, and there is no receipt. The retry succeeds. After a clean restart: the order is still paid with 1 fulfillment, redelivery is a duplicate, the idempotency key still replays, and there is 1 order and 1 receipt. |

`helpers.mjs` adds three fixtures on top of the shared ones:
- `client`: API contexts, optionally signed in, disposed after the test.
- `admin`: reads test-support state and advances the clock.
- `inbox`: reads Mailpit through its API, then deletes only messages sent to addresses this test used, and fails if that delete fails.

It also has helpers for exact-bytes HMAC signing and placing orders. Nothing is routed or mocked.

## Judgement calls

- **Things the contract doesn't specify, which the tests don't pin:**
  - The status for a distinct payment event on an order that's already paid. The tests only require it not to be a 5xx and not to fulfill again.
  - The status code for a bad Idempotency-Key. The tests require a 4xx and no order created.
  - Whether sessions survive a restart. The tests sign in again after restarting.
  - The error code for a short reset password. The tests require only a 400.
- **Inferred from the contract:**
  - A rejected short password does not consume the reset token. The contract says only a valid reset consumes it.
  - Parallel equivalent submissions answer with 201 or 200 replays rather than some other conflict status.
- **Not covered:**
  - The rule that the purchase event is pushed before the orders list refreshes. Checking that ordering would need request interception.
  - The `smtp_errors` path when SMTP is unreachable. Mailpit is worker-scoped and shared, so one test can't take it down.
  - The mobile viewport.

## How I learned the UI, and process notes

- To get the UI labels, I ran a throwaway spec that saved the page's accessibility snapshot and the HTML served at `GET /`, plus the shapes of the fixture objects, test-support state and Mailpit messages. Then I deleted it. The served HTML includes the page's inline script, which is what any browser receives. I did not open anything under `fixture-app/`, `runtime.mjs` or any other generated folder.
- One slip: I captured the first run's console output in a temp file under `/tmp/claude-501/`, which is outside the workspace. I deleted it right away, and later runs write only to `execution.log`.
- I added no dependencies, changed no package or runtime files, and made no git commits.
