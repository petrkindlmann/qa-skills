# Webhooks, idempotency, test clocks, reconciliation, refunds

Server-side payment correctness. All examples assume Node + the `stripe` SDK and test-mode
keys. Verify commands at https://docs.stripe.com/stripe-cli and
https://docs.stripe.com/billing/testing/test-clocks.

## 1. Local webhook delivery with the Stripe CLI

Do **not** expose your endpoint publicly with ngrok and do **not** poll the API for
payment status. `stripe listen` tunnels live test events to localhost natively; `stripe
trigger` fires test events on demand.

```bash
# Tunnel all test-mode events to your local handler. Keep this running.
stripe listen --forward-to localhost:3000/webhooks

# It prints ONCE, at startup:
#   Ready! Your webhook signing secret is whsec_abc123…  (^C to quit)
# Copy that whsec_… into STRIPE_WEBHOOK_SECRET for THIS session. It is the
# signing secret, NOT your STRIPE_SECRET_KEY (sk_test_…) — they are different values.

# In another shell, fire test events:
stripe trigger payment_intent.succeeded
stripe trigger invoice.payment_failed
stripe trigger charge.refunded
```

```bash
# .env for local webhook testing
STRIPE_SECRET_KEY=sk_test_…        # API calls
STRIPE_WEBHOOK_SECRET=whsec_…      # signature verification — the value listen printed
```

## 2. Signature verification — raw body FIRST

The load-bearing bug: parsing the body as JSON before verifying destroys the raw bytes
`constructEvent` needs, so verification can never succeed. Mount `express.raw` **only** on
the webhook route, before any global `express.json()`, and never hand-roll a `===`
signature comparison.

```ts
import express from 'express';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const app = express();

// Webhook route gets the RAW body. Mount this BEFORE app.use(express.json()).
app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    // req.body is a Buffer here (raw), exactly what constructEvent needs.
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    // Bad/forged/tampered signature → reject with 400. Do NOT process the payload.
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }
  return handleEvent(event, res);
});

app.use(express.json()); // everything else parses JSON normally
```

```ts
// Test that a forged/tampered event is rejected.
import { test, expect } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';

const secret = process.env.STRIPE_WEBHOOK_SECRET!; // whsec_…

test('valid signature is accepted', async () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await request(app).post('/webhooks')
    .set('Stripe-Signature', header)
    .set('content-type', 'application/json')
    .send(payload);
  expect(res.status).toBe(200);
});

test('forged/tampered event is rejected with 400', async () => {
  const payload = JSON.stringify({ id: 'evt_forged', type: 'payment_intent.succeeded' });
  const res = await request(app).post('/webhooks')
    .set('Stripe-Signature', 't=1,v1=deadbeef')   // garbage signature
    .set('content-type', 'application/json')
    .send(payload);
  expect(res.status).toBe(400); // SignatureVerificationError → 400
});
```

`Stripe.webhooks.generateTestHeaderString` signs a payload with your `whsec_` so you can
test the happy path without a live event.

## 3. Idempotency — dedup INBOUND events by event.id

Stripe retries webhook delivery, so the same `event.id` can arrive twice. Request-side
idempotency keys (for *outbound* API calls) do not help here. Store `event.id` with a
**UNIQUE** constraint and short-circuit on conflict. An in-memory `Set` is wrong: lost on
restart, useless across instances.

```sql
CREATE TABLE processed_events (
  id          TEXT PRIMARY KEY,          -- Stripe event.id, UNIQUE by construction
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```ts
async function handleEvent(event: Stripe.Event, res: express.Response) {
  // Persisted dedup keyed on event.id — survives restarts and works across instances.
  const inserted = await db.query(
    `INSERT INTO processed_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [event.id],
  );
  if (inserted.rowCount === 0) {
    return res.status(200).send('duplicate ignored'); // already processed → ack, do nothing
  }
  if (event.type === 'payment_intent.succeeded') {
    await fulfillOrder(event.data.object as Stripe.PaymentIntent);
  }
  return res.status(200).send('ok');
}
```

```ts
// Test: deliver the SAME event twice, assert fulfillment happens exactly once.
test('handler is idempotent across retries', async () => {
  const fulfill = vi.spyOn(orders, 'fulfillOrder');
  const evt = { id: 'evt_dup_1', type: 'payment_intent.succeeded', data: { object: pi } };
  await deliverSignedWebhook(evt);   // first delivery
  await deliverSignedWebhook(evt);   // Stripe retry — same event.id
  expect(fulfill).toHaveBeenCalledTimes(1); // fulfilled once, second is a 200 no-op
});
```

## 4. Test clocks — server-side subscription/billing time travel

Client-side time mocking (`jest.useFakeTimers`, sinon, mocking `Date`) does **nothing** to
Stripe's billing engine — billing runs on Stripe's servers. Use a test clock: a
server-side construct you create at a `frozen_time`, attach the customer to **at creation**
(you cannot attach an existing customer later), and `advance` **forward only**.

```ts
// Simulate an annual renewal 12 months out without waiting a year.
const clock = await stripe.testHelpers.testClocks.create({
  frozen_time: Math.floor(Date.now() / 1000),
  name: 'annual-renewal',
});

// Customer MUST be created with the test_clock attached — cannot be added afterward.
const customer = await stripe.customers.create({ test_clock: clock.id, /* … */ });
await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price: ANNUAL_PRICE_ID }],
  default_payment_method: pmId,
});

// Advance one year. Time only moves forward — you cannot rewind a test clock.
await stripe.testHelpers.testClocks.advance(clock.id, {
  frozen_time: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
});
// Poll clock.status until 'ready', then assert the renewal invoice + webhooks fired.
```

Advance in steps of at most two billing cycles at a time (Stripe limit).

## 5. Failed renewal → past_due → refund (end to end)

Drive the dunning lifecycle with a test clock and the "attaches but fails on charge" card
`4000000000000341`. Do **not** "fix" the failure by deleting the subscription — issue a
refund with `refunds.create`.

```ts
// 1. Subscribe with the card that attaches but declines on later charge.
const customer = await stripe.customers.create({ test_clock: clock.id });
const pm = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: customer.id });
const sub = await stripe.subscriptions.create({
  customer: customer.id, items: [{ price: ANNUAL_PRICE_ID }],
  default_payment_method: pm.id,
});

// 2. Advance the clock past the renewal date so Stripe attempts the renewal charge.
await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: renewalTs });

// 3. The renewal charge fails → Stripe emits invoice.payment_failed and the sub goes past_due.
//    Assert in your webhook handler test:
expect(receivedEvents).toContainEqual(expect.objectContaining({ type: 'invoice.payment_failed' }));
const refreshed = await stripe.subscriptions.retrieve(sub.id);
expect(refreshed.status).toBe('past_due');

// 4. Resolution = refund any captured charge, not deletion of the subscription.
const refund = await stripe.refunds.create({ payment_intent: capturedPiId });
expect(refund.status).toBe('succeeded'); // charge.refunded webhook fires
```

`pm_card_chargeCustomerFail` is the SDK token alias for `4000000000000341`.

## 6. Reconciliation — fulfill only on verified webhook, never on redirect

The dominant production bug: marking the order paid on the `return_url` redirect or a
client-side success flag. The redirect can fire while the payment is still processing, can
be replayed, or can be forged. Fulfill **only** after a signature-verified
`payment_intent.succeeded` webhook, and confirm against the API with `retrieve`.

```ts
// WRONG — do not do this:
app.get('/return', async (req, res) => {
  await markOrderPaid(req.query.orderId); // trusts the redirect / client → forgeable, premature
});

// RIGHT — fulfill from the verified webhook only:
async function handleEvent(event: Stripe.Event) {
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    // Re-confirm against the API; don't trust the event body alone for money.
    const verified = await stripe.paymentIntents.retrieve(pi.id);
    if (verified.status === 'succeeded' && verified.amount_received === expectedAmount(pi)) {
      await markOrderPaid(pi.metadata.orderId); // fulfillment happens HERE, not on redirect
    }
  }
}
```

```ts
test('order is paid only after payment_intent.succeeded webhook, not on redirect', async () => {
  const order = await createOrder();
  await visitReturnUrl(order.id);                 // simulate the browser redirect
  expect(await orderStatus(order.id)).toBe('pending'); // NOT paid yet — redirect alone must not fulfill

  await deliverSignedWebhook({ type: 'payment_intent.succeeded', data: { object: pi } });
  expect(await orderStatus(order.id)).toBe('paid');    // paid only after the verified webhook
});
```
