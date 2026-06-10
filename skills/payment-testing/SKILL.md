---
name: payment-testing
description: >-
  Test payment and checkout flows end to end against PSP sandboxes — Stripe first, with
  the general pattern for Adyen/Braintree/PayPal. Covers Stripe test-mode card numbers and
  their decline codes, the 3DS/SCA challenge flow and its nested-iframe handling in
  Playwright, test clocks for subscription/billing-cycle simulation, webhook testing
  (stripe listen/trigger, signature verification, idempotency), failed/retried payments and
  refunds, and never using real cards. Use when: "test Stripe checkout," "payment test,"
  "3DS test," "test webhook signature," "test subscription renewal," "test clock,"
  "refund test," "decline card test," "checkout E2E."
  Not for: General API contract testing of non-payment endpoints — api-testing. PCI-DSS/regulatory
  compliance audit — compliance-testing.
  Related: api-testing, playwright-automation, compliance-testing, test-data-management, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: specialized
---

<objective>
Payment flows fail in ways generic E2E tests miss: a card field in a cross-origin iframe
that `page.locator` silently never reaches, a renewal that won't trigger for a year, a
webhook handler that "works" until Stripe retries and fulfills an order twice, an order
marked paid on a redirect that the browser forged. This skill makes you test payments the
way they actually break — against PSP sandboxes, with the real test cards, the nested 3DS
challenge, server-side test clocks, signature-verified webhooks, and idempotent
fulfillment. Never a real PAN, never a live key.
</objective>

## Quick Route

| You need to test… | Go to | Reference |
|-------------------|-------|-----------|
| Success / decline / insufficient-funds outcomes | [Test cards](#stripe-test-cards-and-outcomes) | `references/stripe-test-cards.md` |
| A 3DS/SCA challenge that pops a modal | [3DS challenge](#3ds--sca-the-nested-iframe-challenge) | `references/playwright-3ds.md` |
| A subscription renewal months/years out | [Test clocks](#test-clocks-server-side-time-travel) | `references/webhooks-and-clocks.md` |
| Webhooks reaching localhost + signatures | [Webhooks](#webhooks-local-delivery-signatures-idempotency) | `references/webhooks-and-clocks.md` |
| A failed renewal then a refund | [Failed payments](#failed-payments-dunning-and-refunds) | `references/webhooks-and-clocks.md` |
| Fulfillment only after real payment | [Reconciliation](#reconciliation-fulfill-on-the-webhook-not-the-redirect) | `references/webhooks-and-clocks.md` |
| Adyen / PayPal / Braintree sandboxes | [Multi-PSP](#multi-psp-adyen-paypal-braintree) | `references/multi-psp.md` |

## Discovery Questions

First, check `.agents/qa-project-context.md` in the project root and skip anything it
already answers (PSP, stack, test framework, existing fixtures). Then clarify:

- **Which PSP, and is it Stripe?** Stripe is the default here. Other PSPs share the pattern
  but have their own sandbox cards/accounts — see [Multi-PSP](#multi-psp-adyen-paypal-braintree).
- **One-time payments, subscriptions, or both?** Subscriptions pull in test clocks, dunning,
  and the `invoice.*` lifecycle; one-time payments don't.
- **Is SCA/3DS in play?** EU/UK card flows almost always challenge. If yes you need the
  nested-iframe pattern, not plain locators.
- **Do you fulfill on a webhook or on the redirect today?** If fulfillment happens on
  `return_url`, that's the bug to test for — fulfillment must wait for the verified webhook.
- **Where does the webhook handler run in tests?** Local (`stripe listen`) vs a deployed
  preview env changes how you deliver events.

## Core Principles

1. **Never touch a real card or a live key — and this is non-negotiable, not a preference.**
   Real PANs in any environment violate Stripe's Services Agreement and drag your repo into
   PCI scope. Test mode (`pk_test_`/`sk_test_`) with Stripe's published test cards is the
   only correct answer. Masking or encrypting a real number does not fix it; removing it
   does.

2. **Money is confirmed server-side, never client-side.** A redirect, an `onApprove`
   callback, or a `?status=success` query param can be premature, replayed, or forged.
   Fulfill an order only after a signature-verified `payment_intent.succeeded` webhook,
   re-confirmed with an API `retrieve`.

3. **Verify the signature before you parse the body.** Parsing JSON first destroys the raw
   bytes `constructEvent` needs. The webhook route gets the raw body; everything else can
   parse JSON.

4. **Time is a server-side construct for billing.** Stripe's billing engine runs on
   Stripe's servers. Faking the clock in your test process changes nothing. Use test clocks.

5. **Assume every webhook is delivered more than once.** Stripe retries. Idempotency keyed
   on `event.id` in durable storage is mandatory; an in-memory set is not idempotency.

## Stripe Test Cards and Outcomes

Drive each outcome with the card that deterministically produces it. The four you need most:

| PAN | Outcome | Code |
|-----|---------|------|
| `4242424242424242` | Succeeds | — |
| `4000000000000002` | Declined | `card_declined` (generic_decline) |
| `4000000000009995` | Declined | `insufficient_funds` |
| `4000000000003220` | 3DS always challenges | — |
| `4000000000000341` | Attaches, then fails on charge | `card_declined` |

Use test keys (`pk_test_…`/`sk_test_…`) in the app under test and assert that in setup.
**Do not use `4111111111111111`** — that is a generic Braintree/PayPal-era Luhn number,
not a Stripe test card, and it does not deterministically decline.

The card field is in a cross-origin Stripe iframe, so fill it through `frameLocator`, never
`page.locator` directly. Assert outcomes on UI copy for a smoke test, or more robustly on
the server-side `last_payment_error.decline_code` from `paymentIntents.retrieve`. Full
Playwright tests for success / `card_declined` / `insufficient_funds`:
`references/stripe-test-cards.md`.

## 3DS / SCA: The Nested-Iframe Challenge

This is the hardest part to get right. The Stripe 3DS challenge is **a frame nested inside
the Stripe modal frame** — a single `frameLocator` cannot reach it. Chain
`frameLocator` outer → inner, then click **Complete authentication**.

What fails, and why:

- `page.locator('#card')` → the input is cross-origin; the locator matches nothing.
- `page.frames()[1]` → frame **index** shifts when Stripe adds/reorders frames. Never select
  frames by index.
- `await page.waitForTimeout(5000)` → guessing the challenge duration. Wait on the element.

The correct shape (full test, including the fail-authentication variant, in
`references/playwright-3ds.md`):

```ts
// 3DS-required card so the challenge always appears.
await card.getByPlaceholder('Card number').fill('4000000000003220');
await page.getByRole('button', { name: /pay/i }).click();

// Nested: outer Stripe challenge frame → inner ACS frame. One frameLocator is not enough.
const inner = page
  .frameLocator('iframe[name^="__privateStripeFrame"]')
  .frameLocator('iframe#challengeFrame, iframe[name="acsFrame"]');
await inner.getByRole('button', { name: /complete authentication|complete|authorize/i }).click();

await expect(page).toHaveURL(/\/success/);              // assert the succeeded state
await expect(page.getByText(/payment succeeded/i)).toBeVisible();
```

`4000002760003184` is the alternative SCA card for setup-intent / first-use flows; the eval
and docs accept it where a one-time-payment 3DS card is wanted.

## Test Clocks: Server-Side Time Travel

To test an annual renewal without waiting a year, use a Stripe **test clock** — a
server-side construct. Client-side fakes (`jest.useFakeTimers`, sinon, mocking `Date`) do
nothing to Stripe's billing engine.

Rules that bite if missed:
- Create the clock at a `frozen_time`, then attach the **customer at creation** with
  `test_clock: clock.id`. You cannot attach an existing customer to a clock afterward.
- `testHelpers.testClocks.advance` moves time **forward only** — you cannot rewind. Advance
  at most two billing cycles per call.
- After advancing, poll the clock to `ready`, then assert the renewal invoice and webhooks.

```ts
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: Math.floor(Date.now() / 1000), name: 'annual-renewal',
});
const customer = await stripe.customers.create({ test_clock: clock.id /* … */ });
// …create subscription, then advance ~12 months forward:
await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: oneYearLater });
```

Full create/advance/assert flow: `references/webhooks-and-clocks.md` (section 4).

## Webhooks: Local Delivery, Signatures, Idempotency

**Local delivery.** Do not expose your endpoint with ngrok and do not poll the API for
status. `stripe listen` tunnels test events to localhost natively; `stripe trigger` fires
them on demand:

```bash
stripe listen --forward-to localhost:3000/webhooks   # prints whsec_… ONCE at startup
stripe trigger payment_intent.succeeded
```

Copy that `whsec_…` into `STRIPE_WEBHOOK_SECRET`. It is the **signing secret**, a different
value from `STRIPE_SECRET_KEY` (`sk_test_…`) — do not conflate them.

**Signature verification.** Mount `express.raw` on the webhook route **before** any global
`express.json()`, so `constructEvent` gets the raw body. A forged or tampered event must be
rejected with **400**; never hand-roll a `=== signature` string comparison.

```ts
app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    return handleEvent(event, res);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`); // SignatureVerificationError
  }
});
app.use(express.json()); // everything else, after the webhook route
```

**Idempotency.** Stripe retries delivery, so the same `event.id` arrives twice. Request-side
idempotency keys (for outbound API calls) do not dedup inbound webhooks. Store `event.id`
with a **UNIQUE** constraint and short-circuit on conflict; an in-memory set is lost on
restart and useless across instances. The handler returns **200** for a duplicate so Stripe
stops retrying, and fulfillment runs exactly **once**.

```ts
const inserted = await db.query(
  `INSERT INTO processed_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id`, [event.id]);
if (inserted.rowCount === 0) return res.status(200).send('duplicate ignored');
```

The signature test (valid accepted, forged → 400) and the "deliver the same event twice,
assert fulfilled once" idempotency test are in `references/webhooks-and-clocks.md`
(sections 2–3).

## Failed Payments: Dunning and Refunds

To test a failed recurring charge end to end, subscribe with `4000000000000341` (SDK token
`pm_card_chargeCustomerFail`) — it **attaches** to the customer but **fails on the later
charge**, which is what the renewal needs. Cards that decline at attach time can't be saved,
so they can't model a renewal failure.

Drive the lifecycle with a test clock:
1. Subscribe the customer (on a test clock) with the attach-then-fail card.
2. `advance` the clock past the renewal date → Stripe attempts the charge.
3. The charge fails → Stripe emits **`invoice.payment_failed`** and the subscription goes
   **`past_due`**. Assert both.
4. Resolve by issuing a refund with **`refunds.create`** (fires `charge.refunded`) — do
   **not** "fix" it by deleting the subscription.

Full driver in `references/webhooks-and-clocks.md` (section 5).

## Reconciliation: Fulfill on the Webhook, Not the Redirect

Mark an order paid **only** after a signature-verified `payment_intent.succeeded` webhook,
re-confirmed against the API — never on the `return_url` redirect or a client-side success
flag, and never by polling with a sleep.

```ts
if (event.type === 'payment_intent.succeeded') {
  const verified = await stripe.paymentIntents.retrieve(event.data.object.id);
  if (verified.status === 'succeeded' && verified.amount_received === expected) {
    await markOrderPaid(verified.metadata.orderId); // fulfillment happens HERE
  }
}
```

The reconciliation test asserts the order is still `pending` after the redirect and only
`paid` after the verified webhook: `references/webhooks-and-clocks.md` (section 6).

## Multi-PSP: Adyen, PayPal, Braintree

Stripe test cards do **not** work on other PSPs. Each has its own sandbox cards and sandbox
buyer accounts. Port the *structure* of your Stripe tests; swap in the PSP's sandbox values.
Never reuse Stripe PANs or live/production keys.

- **Adyen** — own test cards (e.g. `4212345678910014` for 3DS2); many declines are driven by
  the **transaction amount** (`.13` refused, `.51` referral), not the card. Events arrive as
  HMAC-signed notifications.
- **PayPal** — log in with a **sandbox buyer account** (sandbox personal email/password), not
  a card. Confirm server-side via the Orders API / webhooks, not the client `onApprove`.
- **Braintree** — own sandbox **test card** numbers via Drop-in UI / Hosted Fields; amount
  drives transaction outcome, card number drives verification.

What stays the same: separate test/sandbox credentials, no real card, and fulfillment on the
verified server-side event/notification. Details: `references/multi-psp.md`.

## Anti-Patterns

### 1. Reaching for `4111111111111111`
That Luhn-valid number is a Braintree/PayPal-era generic PAN, not a Stripe test card. Use
`4242424242424242` for success and the specific decline cards (`4000000000000002`,
`4000000000009995`).

### 2. Treating the card field as a normal input
`page.locator('#card-number')` silently matches nothing because the field is in a
cross-origin iframe. Use `frameLocator`.

### 3. Selecting iframes by index
`page.frames()[1]` breaks the instant Stripe reorders frames. Match the frame by a stable
name prefix (`iframe[name^="__privateStripeFrame"]`) and chain `frameLocator` for the nested
3DS challenge.

### 4. `waitForTimeout` to "wait for the challenge"
Flaky on slow CI, wasteful on fast CI. Wait on the element (`expect(...).toBeVisible()` /
auto-waiting locator actions), never the clock.

### 5. Client-side time mocking for billing
`jest.useFakeTimers` / sinon / mocking `Date` cannot move Stripe's server-side billing.
Use a test clock.

### 6. ngrok or polling for local webhooks
`stripe listen --forward-to localhost:3000/webhooks` tunnels events natively; `stripe
trigger` fires them. No public tunnel, no status polling.

### 7. Parsing the body before verifying the signature
A global `express.json()` ahead of the webhook route destroys the raw body
`constructEvent` needs, so verification can never pass. Mount `express.raw` on the webhook
route first.

### 8. Confusing the request idempotency key with webhook dedup, or using an in-memory set
Outbound idempotency keys don't dedup inbound webhooks; an in-memory `Set` dies on restart.
Persist `event.id` with a UNIQUE constraint.

### 9. Fulfilling on the redirect / client success flag
The `return_url` can be premature, replayed, or forged. Fulfill only on the verified
`payment_intent.succeeded` webhook.

### 10. "Fixing" a failed renewal by deleting the subscription
The correct resolution is a refund via `refunds.create`, leaving the dunning lifecycle
(`invoice.payment_failed` → `past_due`) intact and testable.

### 11. Rationalizing a real card "just in CI"
A hardcoded real PAN is a PCI/compliance violation regardless of environment. The fix is a
test card in test mode — plus removing the secret from the repo and git history and rotating
any exposed key. Masking or encrypting it does not make it acceptable.

## Verification

- `stripe listen --forward-to localhost:3000/webhooks` prints a `whsec_…` and shows events
  arriving when you run `stripe trigger payment_intent.succeeded`.
- Running the 3DS test with `4000000000003220` reaches and clicks the **Complete
  authentication** button (the test fails loudly, not silently, if the nested frame isn't
  found).
- The signature test: a tampered `Stripe-Signature` returns **400**; a header from
  `generateTestHeaderString` returns **200**.
- The idempotency test: delivering the same `event.id` twice fulfills **once**.
- `grep -rE 'pk_live|sk_live|4111111111111111'` over the test suite returns nothing.

## Done When

- Checkout suite covers success (`4242424242424242`), `card_declined`
  (`4000000000000002`), and `insufficient_funds` (`4000000000009995`), each asserting the
  matching outcome, using `pk_test_`/`sk_test_` keys.
- A 3DS test fills `4000000000003220`, reaches the nested challenge frame via chained
  `frameLocator`, clicks **Complete authentication**, and asserts the succeeded state — no
  `frames()[index]`, no `waitForTimeout`.
- A subscription-renewal test uses a Stripe test clock (`testHelpers.testClocks.create` +
  `advance`, forward-only, customer attached at creation) instead of any client-side time mock.
- Local webhooks are received via `stripe listen --forward-to` / `stripe trigger`, with the
  `whsec_…` wired into `STRIPE_WEBHOOK_SECRET` (distinct from `STRIPE_SECRET_KEY`).
- The webhook handler verifies the signature with `constructEvent` on the **raw** body
  before parsing, returns 400 on a forged event, and a test proves it.
- Idempotency is enforced by persisting `event.id` with a UNIQUE constraint; a duplicate
  delivery returns 200 and fulfills exactly once, proven by a test.
- A failed-renewal test drives `invoice.payment_failed` → `past_due` → `refunds.create` via
  a test clock and the attach-then-fail card `4000000000000341`.
- A reconciliation test confirms the order is `paid` only after the verified
  `payment_intent.succeeded` webhook (re-checked with `paymentIntents.retrieve`), not on the
  redirect.
- `grep -rE 'pk_live|sk_live|4111111111111111'` finds no live key or banned PAN in the test
  suite. (A bare `[0-9]{16}` scan would false-positive on every legitimate test card —
  match live-key prefixes and the banned `4111…` number, not all 16-digit strings.)

## Related Skills

- **api-testing** — General REST/GraphQL endpoint testing, schema validation, and auth
  flows for non-payment endpoints. Go there when the target isn't a PSP checkout/webhook.
- **playwright-automation** — Page Object Model, fixtures, and general browser E2E
  mechanics that the 3DS flow here builds on.
- **compliance-testing** — PCI-DSS, GDPR, and regulatory audit work. This skill keeps you
  *out* of PCI scope by using test cards; go there for a formal compliance audit.
- **test-data-management** — Seeding customers, subscriptions, and fixtures; managing the
  test-clock-bound customers this skill creates.
- **qa-project-context** — The universal first stop: PSP, stack, and fixture conventions
  that every question above should defer to.

## Reference Files (in `references/`)

- **stripe-test-cards.md** — Full test-card catalogue with decline codes and the Playwright
  success/decline/insufficient-funds tests.
- **playwright-3ds.md** — Nested-iframe 3DS challenge handling, complete and fail variants,
  and selector notes.
- **webhooks-and-clocks.md** — `stripe listen`/`trigger`, raw-body signature verification,
  idempotency by `event.id`, test clocks, failed-renewal dunning + refunds, and
  reconciliation.
- **multi-psp.md** — Adyen, PayPal, and Braintree sandbox patterns and what differs from
  Stripe.
