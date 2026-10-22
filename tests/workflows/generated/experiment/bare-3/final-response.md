# Shop acceptance suite (bare-3)

I wrote 11 tests in `tests/workflows/generated/experiment/bare-3/`. All 11 passed with the official command, and all 44 passed in an extra `--repeat-each 4` run that checked the concurrency tests for flakiness. The tests use the real HTTP service, Chromium, SQLite and Mailpit; nothing is routed or mocked.

## What the tests cover

| File | Test | What it checks |
|---|---|---|
| `browser.spec.mjs` | Checkout journey | - A wrong password shows `invalid_credentials` and pushes no `login` event.<br>- A correct sign-in pushes exactly one `login` event.<br>- The cart total shows EUR 42.00, and a double-click on **Place order** creates exactly one order.<br>- The notice shows the server's order ID and amount.<br>- Exactly one `purchase` event is pushed, with the right ID, value, currency and items, before the order appears in the list.<br>- After a signed payment, **Refresh orders** shows `paid · Fulfillments: 1`.<br>- After a reload the user and orders come back, with no repeated `login` or `purchase` events.<br>- Sign out blocks `/api/me` and `/api/orders`, and a reload stays signed out. |
| `browser.spec.mjs` | Password reset through the real inbox | - The reset form gives the generic message.<br>- The Mailpit message has the right subject and recipient, a text body and an HTML body with the same link to this app's `/reset-password` page.<br>- Setting a new password through the browser form works and ends the old API session.<br>- The old password fails and the new one signs in.<br>- Opening the link a second time shows `invalid_or_expired_token`.<br>- No raw token appears in the test-support state. |
| `auth.spec.mjs` | Public endpoints, sessions and logout | - `/health` answers in under 500 ms with the right body.<br>- Catalog prices are 1200 and 1800.<br>- Every endpoint that needs a session returns 401 without one.<br>- Test-support routes return 403 with a missing or wrong key.<br>- The cookie has `HttpOnly`, `SameSite=Lax` and `Path=/`, and no `Secure`.<br>- After logout, a copy of the old cookie is rejected by the server, not just cleared in the client. |
| `auth.spec.mjs` | Sign-in throttling | - After 5 failures, the next attempt returns 429 with `Retry-After: 60` and creates no session, even with the correct password.<br>- Bob can still sign in, and an unknown address is throttled the same way.<br>- After advancing the clock 61 s, sign-in works again.<br>- A successful sign-in resets the counter: 4 failures, a success, then 4 more failures does not lock the address. |
| `orders.spec.mjs` | Pricing and validation | - A client-sent `amount` is ignored and the server charges 4200.<br>- Nine kinds of invalid order return 400 `invalid_order`.<br>- Quantity 10 is accepted.<br>- Bad idempotency keys are rejected, and a 128-character key is accepted.<br>- Only the 3 valid orders exist afterwards. |
| `orders.spec.mjs` | Idempotency and ownership | - Repeating a key with the items in a different order replays the original order.<br>- Changing quantity, SKU or currency returns 409; the currency conflict wins over `invalid_order`.<br>- 8 parallel submits with one key give one 201 and seven replays of the same order.<br>- Bob can reuse Alice's key and gets his own order.<br>- Bob gets the same 404 body for Alice's order as for a made-up ID. |
| `payments.spec.mjs` | Payment event checks | - A missing signature, wrong secret, missing `sha256=` prefix or changed body bytes each return 401, with no receipt and no fulfillment.<br>- Malformed JSON and an event without `data` return 400.<br>- An unknown order returns 404, and a wrong amount or currency returns 422.<br>- A valid event is accepted, then the same event again is reported as a duplicate.<br>- Reusing the event ID with a different body returns 409.<br>- A second, different event for the paid order does not fulfill it again. |
| `payments.spec.mjs` | Concurrent deliveries | - 10 parallel copies of the same event give exactly one non-duplicate, 9 duplicates and one receipt.<br>- 6 parallel different events for another order still leave `fulfillment_count` at 1. |
| `payments.spec.mjs` | Transient failure and restart | - After `restart({failFulfillmentOnce:true})` the event returns 503, the order stays pending and there is no receipt.<br>- A retry succeeds.<br>- After a normal restart the order is still paid with one fulfillment.<br>- The idempotency key still replays the order.<br>- The event is still treated as a duplicate.<br>- An extra event does not fulfill the order again. |
| `payments.spec.mjs` | Concurrent deliveries during the transient failure | - 6 parallel copies give exactly one 503 and five 200s, with exactly one non-duplicate.<br>- A retry is reported as a duplicate.<br>- After a restart there is one fulfillment and one receipt. |
| `password-reset.spec.mjs` | Reset edge cases | - Unknown, Bob and Alice requests all return the same 202 message.<br>- No mail goes to the unknown address. Bob's and Alice's later messages act as a barrier, so the test doesn't wait on a timer.<br>- An invalid token returns 400, and an 11-character password is rejected.<br>- A 12-character password works at 299 s.<br>- A used token returns 400.<br>- Bob's token fails once the clock passes 301 s, and his password is unchanged.<br>- No raw tokens appear in state, and `smtp_errors` is 0. |

Shared code in `helpers.mjs`:
- **`clients`**: gives each user their own API session, and closes them all after the test.
- **`inbox`**: watches this test's addresses and, at teardown, deletes only those message IDs. It never purges the inbox globally.
- **Payment helpers**: sign the exact body bytes with HMAC.

## Assumptions where the contract is silent

- A missing or badly formatted `Idempotency-Key` is expected to return **400**. The server currently returns `invalid_idempotency_key`; the contract only says the key is required.
- A password shorter than 12 characters is expected to return **400** and leave the token usable.
- For a second, different event on an already-paid order, the test only checks for "not a 5xx" and no second fulfillment. The contract doesn't define the status code.
- The catalog price field name `unit_amount` comes from the page's own script.
- Sessions are not assumed to survive a restart: the tests sign in again after each restart.

## Not covered

- An unreachable SMTP server (the `smtp_errors` counter). Mailpit is shared by every test on a worker, so stopping it would break other tests.
- The mobile viewport.
- An accessibility audit.
- The exact 60-second edge of the throttle window.
- Reset requests with an invalid email format.

## Process notes

- To learn the UI labels and the shapes of the test-support state and Mailpit messages, I ran two temporary probe specs that loaded the served page. Both are deleted.
- No app source, `runtime.mjs` or other generated folders were read.
- The probe and stability runs wrote to their own sibling output folders, which are now removed. So is one temporary log file I wrote under `/tmp/claude-501`. Only the official output folder `scratchpad/experiment-bare-3` is left.

## Final counts

- **Official run:** 11 passed, 0 failed, 0 flaky, 0 skipped.
- **Stability run:** 44 passed, 0 failed.
