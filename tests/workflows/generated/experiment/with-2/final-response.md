# Shop acceptance suite: final response

All 12 tests pass. The final run used the specified command with 2 workers on commit 8d342e4: 12 passed, 0 failed, 0 flaky, 9.7 s. A follow-up run with `--repeat-each 3` passed 36 of 36 with no flakes. The first run had one failure, which was a bug in my test code (I disposed an API context before reading the response). I fixed that one line and changed no assertions. Commands and outputs are in `execution.log`.

The workspace was not clean at the start. `site/index.html`, `experiment/with-1` and `experiment/without-1` already had changes, and I left them alone. `.agents/qa-project-context.md` is still the unfilled template, so I treated it as absent and used the contract as context.

## Suite (tests/workflows/generated/experiment/with-2/)

| File | Tests | What it proves |
|---|---|---|
| `account-auth.spec.mjs` | 2 | **Sessions:** unauthenticated requests get 401. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/` and has no `Secure` flag. Logout ends the session on the server: a copied cookie works before logout and gets 401 afterwards. **Throttling:** after 5 failed sign-ins, even the correct password gets 429 with `Retry-After: 60` and no session. Unknown addresses lock out the same way, other users are unaffected, a successful sign-in clears the failure count, and advancing the fixture clock 61 s unlocks the address. |
| `orders.spec.mjs` | 4 | **Pricing:** the server computes the total for 4 different item mixes, at quantities 1 and 10, and ignores any amount the client sends. **Rejected orders:** 8 kinds of invalid order get 400 `invalid_order`, and bad or missing Idempotency-Keys get a 4xx. None of them creates an order; a 128-character key is accepted as the control. **Idempotency keys:** a replay with items reordered returns the same order; a different quantity, SKU or currency gets 409. Keys belong to each user, and another user's order gets the same 404 as an unknown ID. **Concurrency:** 8 parallel identical submissions create exactly 1 order, and both the replay and the conflict still hold after a restart. |
| `payments.spec.mjs` | 3 | **Bad events:** a missing signature, the wrong secret, a missing `sha256=` prefix, whitespace-tampered bytes and a tampered event ID all get 401. Malformed events get 400, unknown orders 404, and wrong amount or currency 422. None of them records a receipt. As a control, the same event pretty-printed and signed over its exact bytes is accepted. **Duplicates:** 6 concurrent copies of one event give one fulfilment and five duplicates. Reusing an event ID with a different body gets 409 and does not pay the other order. Extra event IDs for an order that is already paid, or several racing for one unpaid order, still produce exactly one fulfilment. **Transient failure:** the one-time failure returns 503 and leaves the order pending with no receipt. Retrying succeeds, and after a restart the order is still paid and the same event is reported as a duplicate. |
| `checkout-browser.spec.mjs` | 1 | **Browser checkout:** a wrong-password sign-in shows the error and sends no login analytics event. A real sign-in follows, then the cart shows EUR 42.00 and the order is placed. The page shows the server's order ID, amount and pending state, and the purchase analytics event fires once. After a signed payment event and a page reload, the user is still signed in and the order shows as paid. Signing out removes access in the page, and the copied cookie then gets 401. |
| `password-reset.spec.mjs` | 2 | **Reset journey:** a reset is requested in the UI, and an unknown address gets the same 202 but no email. The test reads the real email from Mailpit, filtered to this test's recipient, and checks the subject, the single recipient, and that the HTML and plain-text versions carry the same link back to the app. It opens the link, sets a new password, then reuses the link and gets `invalid_or_expired_token` shown on the page. The session from before the reset gets 401, the old password fails, and the new password signs in through the UI. **Expiry and length:** at 299 s an 11-character password is refused without using up the token, and a 12-character one is accepted. At 301 s a fresh token is expired and changes nothing, and a made-up token gets 400. |

The suite has no sleeps, no routed or mocked HTTP, and no global inbox purge. Each test deletes only the Mailpit messages sent to its own unique addresses.

## Where the contract is silent

In these cases I only asserted a status range and the lack of side effects:

- missing or invalid Idempotency-Key: a 4xx and no order;
- a reset password shorter than 12 characters: a 4xx and the token stays usable;
- another event ID for an already-paid order: not a 5xx, and still only one fulfilment;
- the sender address: not asserted, because the contract does not name one.

## Problems with the skills

1. **api-testing** wants response schemas checked with Zod 4 or AJV. Neither library is installed, and new dependencies were not allowed. Instead, `expectOrder` checks that the order has exactly the expected fields and their types.
2. **api-testing**'s `references/test-patterns.md` contradicts itself. Its 429 example only checks `retry-after` inside `if (rateLimited)`, which is the conditional assertion its own anti-pattern #4 warns against. I asserted it unconditionally.
3. **payment-testing** assumes Stripe. It says a forged signature gets 400, but this contract says 401 `invalid_signature` (400 is for malformed events), and I followed the contract. Test cards, 3DS, Stripe test clocks and `stripe listen` don't apply. Its list of webhook failure cases did map well onto this protocol: concurrent duplicates, a failure after the dedupe marker, restart, distinct event IDs, and exact-byte signing.
4. **email-testing**: deleting messages in Mailpit with an empty `IDs` list wipes the whole inbox, and the skill doesn't warn about this. The helper refuses to send an empty list. The skill also suggests purging in global setup and asserting the sender, both of which conflict with this task or contract. Its Done-When step of recording the capture tool in `qa-project-context.md` was not possible because I could only write inside my own folder.
5. **playwright-automation** assumes TypeScript, page objects, a project config and `tsc`. None of that fits a fixed-config `.mjs` suite, so there are no page objects and no type check. Using the exact label for `Password` was required, because the hidden `New password` input also matches a plain `getByLabel('Password')`.

## Not tested

- Real app defects: the runtime's fault switch (`QA_SHOP_FAULT`) needs fault names that only exist in fixture-app, which was off-limits. Paired good and bad checks inside the tests stand in for it.
- SMTP being unreachable (202 plus the `smtp_errors` counter).
- The `/health` latency budget.
- The 403 checks on the test-support routes.
- Firefox and WebKit.

**Final: 12 passed, 0 failed** (stability run: 36 passed, 0 failed).
