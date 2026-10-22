# Shop acceptance suite: final response

## What was built

There are 11 Playwright tests in 5 spec files plus `helpers.mjs`. They run against the real Shop process, a fresh SQLite database per test and the real Mailpit. No HTTP is routed or mocked.

- **account-auth.spec.mjs (api-testing).**
  - Sign-in returns the user and a `shop_session` cookie with HttpOnly, SameSite=Lax and Path=/.
  - Logout revokes the session on the server. The captured cookie is replayed from an independent client: it works before logout (healthy control) and gets 401 after.
  - Throttling: after 5 failures the correct password gets 429 with `Retry-After: 60` and no session. Unknown addresses throttle the same way. Bob's 4-failures-then-success control shows the limit is per address and that success clears the counter. Advancing the fixture clock 61 s restores sign-in.
- **orders.spec.mjs (api-testing).**
  - `/health` and the catalog respond as documented.
  - Server-side totals are checked for three compositions, including quantity boundaries 1 and 10, and a client-sent `amount` is ignored.
  - Eight invalid order shapes return `invalid_order`. Keys at the 128-character boundary and malformed keys are checked.
  - Idempotency: an 8-way parallel burst with one key, conflicts on quantity/SKU/currency (409 before currency validation), Bob reusing the same key, and replay plus conflicts after `app.restart()`.
  - Ownership: a foreign order ID and an unknown ID give the same 404, and requests without a session get 401.
- **payments.spec.mjs (payment-testing).**
  - Rejected with 401 and no side effects: missing signature, wrong secret, missing `sha256=` prefix, whitespace added after signing, order changed after signing.
  - Other rejections: malformed event 400, unknown order 404, amount or currency mismatch 422.
  - A pretty-printed valid body is accepted, then: duplicate 200 `duplicate:true`, same event ID with a different body 409 (the other order's own event still pays it, as a control), and a distinct event on a paid order does not fulfill it again.
  - Parallel bursts of 10 identical and 6 distinct events.
  - Restart with `failFulfillmentOnce`: 503, then pending with no receipt, then an in-process retry succeeds. A restart between the failure and the retry leaves nothing half-committed. After another restart, redelivery is reported as a duplicate and `fulfillment_count` stays 1.
- **password-reset.spec.mjs (email-testing + playwright).**
  - Browser flow: request the reset, read the real Mailpit message (recipient filter; subject, To, text and HTML parts), take the single same-origin `/reset-password?token=` link from the DOM-parsed HTML (the plaintext part must agree), and set the new password in the labelled form. Existing sessions are revoked, the old password fails and the new one works. The consumed link shows `invalid_or_expired_token` in the UI.
  - API flow: known and unknown addresses get the same 202. The unknown address gets no mail, with Bob's mail arriving as the positive control. No raw token appears in test-support state. Invalid tokens and tokens past 301 s are refused, while a fresh token works (control). The 11-character password is refused, the 12-character one is accepted, and a second use is refused.
  - Every test deletes only the Mailpit IDs it saw.
- **checkout-browser.spec.mjs (playwright).** A rejected sign-in shows the error, grants no session and pushes no login event. Then: sign in, set the cart, check the server order ID/amount in the status and orders list, and check `dataLayer` has one login event and one purchase. The page stays pending until a signed event is delivered from the API. Reload restores the user and shows the order as paid. Sign-out removes access in the page and on the server (replayed cookie gets 401).

## What ran (evidence in execution.log)

All runs used the requested command at commit bcaf8a7, with the suite files uncommitted.

| Run | Result | Failure |
|---|---|---|
| 1 | 10 passed, 1 failed | `connect ECONNRESET` in the 8-way order burst |
| 2 | 10 passed, 1 failed | same |
| 3 (final) | **9 passed, 2 failed** | soft transport assertions only (below) |

Between runs I changed only two things: I added the `/health` check, and I made the parallel bursts report connection errors separately (`expect.soft`, still red) instead of aborting the test. Burst sizes stayed the same and no retries were added.

## Finding: the Shop drops connections under parallel bursts

- **Run 3 failures:**
  - In the idempotency test, 1 of 8 parallel `POST /api/orders` failed at TCP connect.
  - In the concurrent-delivery test, 3 of 10 parallel webhook deliveries failed at TCP connect.
  - These were the only failed assertions in both tests. All business assertions and later steps, including the restart and conflict checks, passed.
- **Business outcome held in every failing run.** The service logs show the requests that were answered produced exactly one 201 (or one `duplicate:false`) and only replays or duplicates otherwise. Dropped connections never reached the handler.
- **Reproduction:**
  - It is intermittent. Running the single test with `--grep` passed 3/3.
  - Targeted multi-test runs failed 3 of 6 times: the orders file alone on 1 worker, auth+orders on 1 worker, and browser+idempotency on 2 workers each failed once in two runs.
  - Dedicated probes saw no resets in 52 bursts of 4–10 parallel order POSTs (376 requests) or in 90 bursts of up to 16 `/health` requests.
  - So neither "load from a second worker" nor "earlier tests in the worker" explains it on its own.
- **Cause: unconfirmed.** The pattern looks like listen-queue overflow at the server socket rather than an application logic fault. I can't confirm it without reading the fixture source, which was off limits. As instructed, the tests stay red and report it rather than lowering concurrency or retrying.

## Not covered or not run

- The SMTP-unreachable path (202 plus a `smtp_errors` increment). The fixtures can't point the app at a dead SMTP port.
- The test-support 403 for a missing or wrong admin key.
- Mutation-style app fault controls. The fault names live in files I may not read, so the tests rely on the healthy/broken controls built in above.
- Where the contract names no code, the tests assert only a 4xx status: malformed or missing Idempotency-Key and the 11-character password. For a distinct event on a paid order the response status isn't asserted at all; only the invariant is. The sender address and the UI's reset-success wording aren't pinned either, for the same reason.
- Other browsers and mobile viewports, per the instruction to use Chromium only.

## Skill difficulties

1. **api-testing.**
   - The 429 example in `references/test-patterns.md` ("Error Response Validation") gates its `retry-after` check behind `if (rateLimited)`. That contradicts the skill's own anti-pattern #4.
   - "Done When" requires Zod/AJV schemas. Neither is installed and new dependencies were forbidden, so I used exact `toEqual` shapes.
2. **payment-testing** is Stripe-centric. It says a forged signature returns 400 (this contract says 401). Its "Done When" requires test cards, 3DS, test clocks and `stripe listen`, none of which apply. The parts that transferred well were exact-bytes signing, noncanonical JSON, failure after dedup with retry after restart, concurrent duplicates, and distinct event IDs for one payment.
3. **email-testing.**
   - "Flaky email in CI" recommends clearing the inbox in global setup, which conflicts with "never purge globally". Unique recipients plus a recipient filter and per-ID deletion worked instead.
   - `extractLink` needs a Playwright `page` for DOMParser, so the API-only email test had to request `page`.
   - The suggested check, breaking the template subject to see the test fail, is impossible without editing the app.
4. **playwright-automation** assumes TypeScript, a static `baseURL`, `webServer`, POM folders and eslint-plugin-playwright. Here the config is fixed and `baseURL` changes per test, so the tests use `app.baseURL` URLs and no POM (there is one browser journey). `getByLabel('Password')` collided with a hidden "New password" field and needed `exact: true`.

## Workspace note

`site/index.html` shows as modified: a marketing stats edit made at 01:28:52, which is not from this work. I left it untouched.
