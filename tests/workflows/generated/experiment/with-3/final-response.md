# Shop acceptance suite: with-3

All 11 tests passed in each of two final runs with `--workers 2`. Each run took 5 to 7 seconds, and no test was retried, skipped or flaky. The full command, timestamps and per-test durations are in `execution.log`.

## What the suite covers

Each test gets its own Shop process, its own SQLite database and its own Mailpit addresses. There is no routing or mocking.

| File | Test | What it shows |
|---|---|---|
| account-auth.spec.mjs | Sign-in session and logout revocation | - Anonymous requests to `/api/me` and the order routes return 401.<br>- A wrong password returns 401 and creates no session.<br>- The cookie attributes are exactly HttpOnly, SameSite=Lax and Path=/, and `Secure` is absent.<br>- After logout, a copy of the old cookie in an independent client gets 401, and the server shows a session count of 0. |
| account-auth.spec.mjs | Sign-in throttling | - A successful sign-in clears the failure counter.<br>- Failures 1 to 5 return 401. The 6th attempt returns 429 with `Retry-After: 60` and no cookie, even with the correct password.<br>- The lock applies to one address only. An unknown address is throttled the same way.<br>- Advancing the fixture clock by 61 s lifts the lock. |
| orders.spec.mjs | Pricing and validation | - Health check and catalogue.<br>- The server computes the amount and ignores any amount the client sends. Three different orders give 4200, 12000 (quantity 10) and 1800.<br>- Eight kinds of invalid order return 400 `invalid_order`.<br>- A missing or malformed Idempotency-Key gets a 4xx.<br>- Only the 3 valid orders exist afterwards. |
| orders.spec.mjs | Idempotency and ownership | - Repeating a request, including with items reordered, returns the original order with `replayed: true`.<br>- Changing the quantity, SKU or currency under the same key returns 409.<br>- Bob can use the same key independently.<br>- Another user's order and an unknown ID both return 404 `not_found`.<br>- Each order list contains only its owner's orders. |
| orders.spec.mjs | Concurrent submissions and restart | - 8 identical submissions in parallel give exactly one 201 and seven 200 replays, with one order ID and one stored order.<br>- After a restart, repeating the key still returns that order. |
| payments.spec.mjs | Signed payment events | - A missing signature, a wrong secret or a changed body returns 401.<br>- A malformed event returns 400 and an unknown order returns 404. A wrong amount or currency returns 422.<br>- None of these leave a receipt or change the order.<br>- A valid event with reordered keys and extra whitespace, signed over those exact bytes, returns 200, and the order becomes paid with one fulfilment.<br>- Sending it again returns `duplicate: true`. The same event ID with a different body returns 409.<br>- A second, different event for the paid order does not fulfil it again. |
| payments.spec.mjs | Concurrent deliveries | - 8 identical events in parallel: one first delivery and seven duplicates.<br>- 6 different event IDs in parallel for one order: no 5xx, and the order is fulfilled once.<br>- Exactly one receipt. |
| payments.spec.mjs | Transient failure and restart | - The injected failure returns 503, and the order stays pending with no receipt.<br>- After a restart it is still pending.<br>- Retrying the same event counts as a first delivery and pays the order.<br>- After another restart the order is still paid, and sending the event again is a duplicate. |
| checkout-browser.spec.mjs | Browser checkout journey | - A rejected sign-in shows `invalid_credentials` and adds no login event to `dataLayer`.<br>- Sign-in adds exactly one login event.<br>- Cart total is EUR 42.00, and the order status shows the server's ID and amount. The API confirms 4200 pending.<br>- Exactly one purchase event, with the correct order ID, amount and items.<br>- A signed event followed by "Refresh orders" shows paid with one fulfilment, and a reload keeps the user and the paid order.<br>- Sign-out adds no analytics event and survives a reload. A copy of the old cookie gets 401. |
| password-reset.spec.mjs | Reset by email in the browser | - Requests for an unknown and a known address both get the same 202 response and page message.<br>- The real Mailpit email has the exact subject, the right recipient, and one reset link at the app's own address in both the HTML and the plain text.<br>- The unknown address gets no mail. A positive search for the known address confirms the search works.<br>- The reset form succeeds. The old session and old password then fail, and the new password works.<br>- Opening the used link again shows `invalid_or_expired_token`. |
| password-reset.spec.mjs | Token expiry, single use and length | - An 11-character password returns 400 and does not use up the token.<br>- After 301 s on the fixture clock the token has expired, and the old password still works.<br>- A second email, distinguished from the first by message ID, has a new token. At 299 s it accepts a 12-character password exactly once.<br>- Reusing that token, or sending a made-up one, returns 400.<br>- Only the new password works. |

Each test deletes only the Mailpit messages sent to the addresses it registered.

## Evidence that the tests can fail

I broke copies of the tests in five ways. Each copy failed at the intended assertion:

1. Signing re-serialised JSON instead of the exact bytes gave 401 where 200 was expected.
2. Using different keys for the parallel orders failed the one-order check.
3. Never requesting the known-account email made the inbox wait time out.
4. Making only 4 failed sign-ins gave 200 where 429 was expected.
5. Skipping logout let the copied cookie get 200 where 401 was expected.

These breaks were all on the test side. I did not inject faults into the server, because the fault names are in files this task excluded.

## Not covered, or only partly asserted

- **SMTP down:** the 202 response and the `smtp_errors` count when SMTP is unreachable are not tested. Mailpit is shared by the worker, so one test cannot stop it.
- **Purchase event timing:** the contract says the event fires before the order list refreshes. Only "exactly once, with the correct payload" is checked.
- **Behaviour the contract leaves open:** for these, the tests assert only what is documented:
  - a missing or malformed Idempotency-Key: any 4xx;
  - the response body for a webhook with an unknown order: status 404 only;
  - the error code for a short password: 400 only;
  - the response to a second event for an already-paid order: under 500, and still one fulfilment;
  - the sender address of the email: it must be present.
- **The injected failure with parallel deliveries:** only tested one delivery at a time.
- **Other platforms:** Chromium at desktop size only.

## Problems with the skills

1. **api-testing (missing schema library):** its done criteria require Zod 4 or AJV schema validation. Neither is installed and no new dependencies were allowed, so `expectOrderShape` in `helpers.mjs` checks the exact field names and their types by hand.
2. **api-testing (contradictory 429 example):** `references/test-patterns.md` ("Error Response Validation") still guards its 429 assertion with `if (rateLimited)`. `SKILL.md` anti-pattern #4 and a later section of the same file forbid that pattern.
3. **playwright-automation:**
   - It assumes TypeScript, `tsc`, an `e2e/pages` layout and a project config. This harness uses `.spec.mjs` files and a fixed config, so most of its done criteria do not apply.
   - The support fixtures set no `baseURL` for the built-in `page` and `request`, so relative paths like `page.goto('/login')` in the skill's examples don't work. A `clients()` fixture creates request contexts with the base URL set.
4. **payment-testing:**
   - It is written for Stripe. It says a forged signature returns 400, but this contract says 401.
   - Its done criteria (test cards, 3DS, test clocks) do not apply here.
   - The useful parts were the idempotency and restart guidance, and the guidance on distinct event IDs for one payment.
5. **email-testing:** it shows only the global Mailpit purge. Cleaning up only one test's messages needs `DELETE /api/v1/messages` with `{IDs}`, which I worked out from the Mailpit API myself.

## Context notes

- `.agents/qa-project-context.md` is still the unfilled template, so I treated it as absent and took the context from the contract.
- The workspace was not clean at the start. `site/index.html` was modified and the other experiment folders were untracked before this task. I did not touch them.

**Final result: 11 passed, 0 failed, 0 skipped, 0 flaky, in each of two final runs.**
