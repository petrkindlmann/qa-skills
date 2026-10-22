# Shop acceptance suite (experiment/without-3)

I built an 11-test suite and ran it with the exact command you gave (`--workers 2`, retries 0). **All 11 passed** in 7.1 s, exit 0, with nothing skipped or flaky. Before that final run it also passed 33 out of 33 with `--repeat-each 3`. A deliberately broken copy of the helpers failed the 6 tests it should have.

## What the tests cover

All traffic is real HTTP, a real browser, real SQLite and real Mailpit. Nothing is routed or mocked.

**`checkout-browser.spec.mjs`**
- **Main journey:**
  - Sign in through the form, including the session cookie's HttpOnly, SameSite=Lax and Path=/ flags with no `Secure`.
  - Build a 2×TEA-50 + 1×CUP-01 cart and check the EUR 42.00 total.
  - Place the order and check that the notice and the order list show the server's order ID and amount, and that the server's own record matches.
  - Check `dataLayer` holds exactly one login event and one purchase event, with the right transaction ID, value 42, currency and items.
  - Send a signed payment event and refresh: the order shows paid with 1 fulfilment.
  - Reload: the user and orders come back, and no analytics event is sent again.
  - Sign out: the page loses access, and replaying the old cookie gets 401.
- **Failure handling:**
  - A wrong password shows `invalid_credentials`, sets no cookie and sends no login event.
  - An empty cart shows `invalid_order`, sends no purchase event and stores no order.
  - The shopper can then place an order normally.

**`password-reset.spec.mjs`**
- **Reset through the real inbox:**
  - An unknown address gets the same 202 response and receives no mail.
  - Alice gets exactly one email with the right subject and recipient. Its plaintext and HTML links are the same and point to this app's `/reset-password`.
  - Setting a 12-character password in the browser works. Alice's existing session ends, the token is marked consumed, the old password fails and the new one works.
  - Reusing the link shows `invalid_or_expired_token` in the page.
- **Rejected resets:** an 11-character password, an unknown token, and a token after advancing the fixture clock by 301 s are all rejected. The password stays the same.

**`orders.spec.mjs`**
- **Pricing and idempotency:**
  - The catalogue prices are 1200 and 1800, and a client-sent `amount` is ignored (the server charges 4200).
  - Resending the same items in a different order replays the original order.
  - Reusing a key with a different quantity, SKU or currency gives 409. The currency case returns 409 rather than 400.
  - Eight kinds of invalid basket return 400 `invalid_order`.
  - Quantities 1 and 10 are accepted.
- **Ownership:**
  - Two users can use the same key and get separate orders.
  - Another user's order and an unknown ID return the same 404 body.
  - Each user's order list shows only their own orders.
  - Every order endpoint returns 401 without a session.
- **Concurrency:** 12 parallel submissions (Alice and Bob, same key) produce exactly one 201 and one order per user.

**`payments.spec.mjs`**
- **Rejected events:** each of these gets its exact status and records no receipt or fulfilment:
  - missing signature
  - wrong secret
  - a valid signature over different bytes
  - truncated JSON
  - missing `data`
  - unknown order
  - wrong amount
  - wrong currency
- **Valid event:** it pays and fulfils once, and redelivering it returns `duplicate: true`. Reusing its event ID for a second order returns 409, and that order stays unpaid.
- **Concurrent deliveries:** 10 identical deliveries plus 6 different event IDs for one order. Exactly one is a first delivery, and each order ends with 1 fulfilment and one receipt.
- **Transient failure and restart:**
  - After a restart with the one-time failure switched on, the first delivery returns 503. The order stays pending with no receipt.
  - Retrying the same event succeeds.
  - After a clean restart, the order is still paid with 1 fulfilment, the idempotency key still replays, and 5 concurrent redeliveries are all duplicates.

**`account-auth.spec.mjs`**
- **Sign-in throttling:**
  - After 5 failures, a 6th attempt with the correct password gets 429 with `Retry-After: 60` and creates no session.
  - Unknown addresses are throttled the same way, and Bob is not affected.
  - A successful sign-in resets the counter.
  - Advancing the fixture clock 61 s lets the user sign in.
  - Logout returns 204, after which `/api/me` returns 401.

## Evidence and limits
- **Deliberate-break check:** I broke the HMAC key and the Mailpit address match on purpose. The browser checkout, both reset tests and all three payment tests failed; the other 5 passed. I restored the helpers, confirmed they were identical, and also changed inbox cleanup so it always checks that nothing is left for the test's addresses.
- **Two answers the contract leaves open, so the tests only record them:**
  - A different successful event for an already-paid order returned 200 `{duplicate:false}` while the fulfilment count stayed at 1. The test checks that the count stays at 1 and the response isn't a 5xx; the exact status isn't pinned.
  - For the too-short password, the test checks for a 400 and an unchanged password, not the error code.
- **Not tested:**
  - SMTP being unreachable (the `smtp_errors` path), because Mailpit is shared per worker and stopping it would affect other tests.
  - Reset-token expiry at exactly 300 s.
  - Whether a session survives a restart: the restart test signs in again rather than asserting that.
- I used the page's HTML and accessibility tree, plus the test-support endpoints, only to learn control labels and the response shapes. I didn't read the fixture app source or runtime.mjs.

Files are in `tests/workflows/generated/experiment/without-3/`: `helpers.mjs` and five `.spec.mjs` files, plus `task-prompt.txt`, `execution.log` and this file.

**Final: 11 passed, 0 failed (0 skipped, 0 flaky).**
