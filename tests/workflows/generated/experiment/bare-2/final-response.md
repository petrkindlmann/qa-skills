# Shop acceptance suite (bare-2)

The suite has 12 tests in five spec files plus one helper module. All of them pass with the exact command from the task.

## Files

| File | Tests | What it covers |
|---|---|---|
| `shop-helpers.mjs` | — | Adds three fixtures. `client(user?)` gives each actor its own cookie jar. `admin` reads `/test-support/state` and moves the fixture clock. `inbox` reads Mailpit and, in teardown, deletes only messages sent to this test's addresses. Also has signed-event, order and reset-link helpers. |
| `auth.spec.mjs` | 2 | **Session lifecycle:** 401s when signed out; the test-support routes return 403 without the admin key or with a wrong one; the cookie is `HttpOnly`/`SameSite=Lax`/`Path=/` and not `Secure`; after logout, replaying the old cookie gets 401, so the server really revoked it. **Throttling:** after 5 failures, even the correct password gets 429 with `Retry-After: 60` and no session; the lock is per address; unknown addresses are locked the same way; the lock lifts after advancing the clock 61 s; a successful sign-in resets the counter. |
| `orders.spec.mjs` | 3 | **Pricing:** the server sets the price and ignores a client `amount: 1`; 8 kinds of invalid basket get 400 `invalid_order` and no order is stored; bad `Idempotency-Key` values are rejected; a 128-char key and quantity 10 are accepted. **Idempotency:** a replay with items reordered returns 200 and the original order; quantity, SKU or currency changes get 409 (a USD change gets 409, not 400); bob can reuse alice's key; 8 parallel identical submits create exactly 1 order. **Ownership:** someone else's order returns the same 404 as an unknown ID; each user's list holds only their own orders. |
| `payments.spec.mjs` | 3 | **Rejections:** missing signature, wrong secret, and a re-serialised body (exact-bytes check) all get 401; malformed events get 400, unknown orders 404, wrong amount or currency 422. The order stays pending with no receipt, and the same event ID then succeeds once signed correctly. **Concurrency:** 6 parallel copies of one event produce one `duplicate:false` and one fulfilment; reusing an event ID with a different body gets 409; extra distinct events for a paid order don't fulfil it again; 4 different events racing on an unpaid order fulfil it once. **Transient failure + restart:** the first delivery gets 503 and commits nothing; the retry gets 200; after a second restart the order is still paid with count 1, an idempotent replay still works, and 5 parallel redeliveries all come back `duplicate:true` with exactly one receipt. |
| `password-reset.spec.mjs` | 2 | **Reset via Mailpit:** the response is the same 202 for known and unknown accounts, and the unknown one gets no mail; the message has the right subject and recipient, is `multipart/alternative`, and the text and HTML links match and point at this app. Confirming revokes both of alice's sessions; the old password fails and the new one works; reusing the token or sending a garbage token gets 400 `invalid_or_expired_token`. **Expiry:** an 11-char password is refused and the token is not consumed; after advancing the clock 301 s the token is expired and the old password still works; a new token accepts a password of exactly 12 characters. |
| `browser.spec.mjs` | 2 | **Checkout in Chromium:** a failed sign-in pushes no analytics event; a successful one pushes exactly one `login`; the cart total is right; the order ID and amount appear; there is exactly one `purchase` event, and a MutationObserver confirms it was pushed before the orders list re-rendered. The order shows as paid after the signed webhook. Reloading restores the session without pushing analytics again; sign-out removes access, and the session stays gone after another reload. **Reset in the browser:** request the link in the UI, open the emailed link, set a new password, see the success message; resubmitting shows the server error; the old password then fails and the new one signs in. |

## Results

| Run | Command | Result |
|---|---|---|
| Diagnostic | `--reporter list` | 12 passed (7.1 s) |
| Flakiness | `--repeat-each 3 --reporter dot` | 36 passed (17 s) |
| Official (in `execution.log`) | exact task command | `WORKFLOW RESULT: passed; attempts=12; {"passed":12}`, exit 0, 7 s |

Total test execution was about 1 minute, well under the 12-minute budget. No infrastructure failures.

## Where the contract is silent

- **Bad `Idempotency-Key` and passwords under 12 characters:** the contract gives no status code, so any 4xx is accepted. The app actually returns 400 `invalid_idempotency_key` and 400 `invalid_password`. These are not pinned so the tests don't go beyond the contract.
- **Distinct events for an already-paid order, and racing events:** the response code is also unspecified. The tests require "not 5xx", and the real check is that `fulfillment_count` stays at 1.
- **Sessions across `app.restart()`:** the contract doesn't say whether they survive. The restart test signs in again rather than assuming either way.

## How the UI was found

Before writing tests I ran two throwaway probe specs (since deleted). They read the page served at `/` and `/reset-password` to get accessible labels, recorded API response shapes, and fetched one Mailpit message. A third throwaway probe confirmed that `inbox` teardown really deletes the test's own messages. No files under `fixture-app/`, `runtime.mjs` or other generated folders were read.

**Final: 12 passed, 0 failed** (official run).
