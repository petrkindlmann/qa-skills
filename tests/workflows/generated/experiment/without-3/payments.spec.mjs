import { test, expect, BASKET, BASKET_AMOUNT, paymentEvent, sign } from './helpers.mjs';

async function placeOrder(shop, client, key, body = BASKET) {
  const response = await shop.createOrder(client, key, body);
  expect(response.status()).toBe(201);
  return (await response.json()).order;
}

const receiptsFor = (state, orderId) => state.receipts.filter(receipt => receipt.order_id === orderId);
const stored = (state, orderId) => state.orders.find(order => order.id === orderId);

test('rejected payment events record nothing; a valid event fulfils once and redeliveries stay safe', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const order = await placeOrder(shop, alice, 'pay-1');
  const other = await placeOrder(shop, alice, 'pay-2');
  const event = paymentEvent(`evt-${app.namespace}-1`, order.id);
  const body = JSON.stringify(event);

  await test.step('bad signatures, malformed, unknown and mismatched events are refused', async () => {
    const refused = [
      ['missing signature', () => shop.pay(event, { signature: null }), 401, { error: 'invalid_signature' }],
      ['wrong secret', () => shop.pay(event, { signature: sign('not-the-secret', body) }), 401, { error: 'invalid_signature' }],
      ['signature over different bytes', () => shop.pay(event, { body: JSON.stringify(event, null, 1), signature: sign(app.paymentSecret, body) }), 401, { error: 'invalid_signature' }],
      ['truncated JSON', () => shop.pay(null, { body: body.slice(0, -1) }), 400],
      ['missing data', () => shop.pay({ id: `evt-${app.namespace}-bad`, type: 'payment.succeeded' }), 400],
      ['unknown order', () => shop.pay(paymentEvent(`evt-${app.namespace}-404`, '00000000-0000-4000-8000-000000000000')), 404],
      ['amount mismatch', () => shop.pay(paymentEvent(`evt-${app.namespace}-amt`, order.id, { amount: BASKET_AMOUNT - 100 })), 422, { error: 'payment_mismatch' }],
      ['currency mismatch', () => shop.pay(paymentEvent(`evt-${app.namespace}-cur`, order.id, { currency: 'USD' })), 422, { error: 'payment_mismatch' }],
    ];
    for (const [name, send, status, error] of refused) {
      const response = await send();
      expect(response.status(), name).toBe(status);
      if (error) expect(await response.json(), name).toEqual(error);
    }
    const state = await shop.state();
    expect(state.receipts).toEqual([]);
    expect(stored(state, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
    expect(await shop.orderAs(alice, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
  });

  await test.step('a correctly signed event pays and fulfils the order once', async () => {
    const response = await shop.pay(event);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
    expect(await shop.orderAs(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  });

  await test.step('redelivery is a duplicate; reusing the event ID for another order is a conflict', async () => {
    const again = await shop.pay(event);
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true, order_id: order.id });

    const conflicting = await shop.pay(paymentEvent(event.id, other.id));
    expect(conflicting.status()).toBe(409);
    expect(await conflicting.json()).toEqual({ error: 'event_conflict' });
  });

  await test.step('a distinct successful event for the paid order does not fulfil it again', async () => {
    const second = await shop.pay(paymentEvent(`evt-${app.namespace}-2`, order.id));
    test.info().annotations.push({ type: 'distinct-event-on-paid-order', description: `HTTP ${second.status()} ${await second.text()}` });
    expect(second.status(), 'not a server error').toBeLessThan(500);
  });

  const state = await shop.state();
  expect(stored(state, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(stored(state, other.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
  expect(receiptsFor(state, other.id)).toEqual([]);
  expect(state.receipts.filter(receipt => receipt.id === event.id)).toHaveLength(1);
});

test('concurrent duplicate and competing payment deliveries fulfil each order exactly once', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const duplicated = await placeOrder(shop, alice, 'race-dup');
  const competing = await placeOrder(shop, alice, 'race-distinct');
  const event = paymentEvent(`evt-${app.namespace}-race`, duplicated.id);

  const [sameEvent, distinctEvents] = await Promise.all([
    Promise.all(Array.from({ length: 10 }, () => shop.pay(event))),
    Promise.all(Array.from({ length: 6 }, (_, i) => shop.pay(paymentEvent(`evt-${app.namespace}-c${i}`, competing.id)))),
  ]);

  expect(sameEvent.map(r => r.status())).toEqual(Array(10).fill(200));
  const bodies = await Promise.all(sameEvent.map(r => r.json()));
  expect(bodies.filter(b => b.duplicate === false), 'one first delivery').toHaveLength(1);
  expect(bodies.every(b => b.received === true && b.order_id === duplicated.id)).toBe(true);

  const distinctStatuses = distinctEvents.map(r => r.status());
  test.info().annotations.push({ type: 'competing-event-statuses', description: distinctStatuses.join(',') });
  expect(distinctStatuses.every(status => status < 500), `no server errors: ${distinctStatuses}`).toBe(true);
  expect(distinctStatuses.filter(status => status === 200).length, 'at least one accepted').toBeGreaterThan(0);

  const state = await shop.state();
  expect(stored(state, duplicated.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, duplicated.id)).toHaveLength(1);
  expect(stored(state, competing.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(await shop.orderAs(alice, competing.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
});

test('a transient fulfilment failure commits nothing, the retry succeeds, and state survives restart', async ({ app, shop }) => {
  const key = `restart:${app.namespace}`;
  const order = await placeOrder(shop, await shop.signIn(app.users.alice), key);
  const event = paymentEvent(`evt-${app.namespace}-retry`, order.id);

  await app.restart({ failFulfillmentOnce: true });
  const health = await shop.webhook.get('/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', build: 'shop-lab-v1' });

  await test.step('first delivery hits the injected failure and leaves no receipt', async () => {
    const failed = await shop.pay(event);
    expect(failed.status()).toBe(503);
    expect(await failed.json()).toEqual({ error: 'fulfillment_unavailable' });
    const state = await shop.state();
    expect(receiptsFor(state, order.id)).toEqual([]);
    expect(stored(state, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
    expect(await shop.orderAs(await shop.signIn(app.users.alice), order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
  });

  await test.step('retrying the same event succeeds once', async () => {
    const retried = await shop.pay(event);
    expect(retried.status()).toBe(200);
    expect(await retried.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
  });

  await app.restart({ failFulfillmentOnce: false });

  await test.step('after a clean restart the order, receipt and idempotency key are intact', async () => {
    const alice = await shop.signIn(app.users.alice);
    expect(await shop.orderAs(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1, amount: BASKET_AMOUNT });
    const replay = await shop.createOrder(alice, key);
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, order: { id: order.id } });

    const redeliveries = await Promise.all(Array.from({ length: 5 }, () => shop.pay(event)));
    expect(redeliveries.map(r => r.status())).toEqual(Array(5).fill(200));
    for (const response of redeliveries) expect(await response.json()).toEqual({ received: true, duplicate: true, order_id: order.id });

    const state = await shop.state();
    expect(stored(state, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
    expect(receiptsFor(state, order.id)).toHaveLength(1);
  });
});
