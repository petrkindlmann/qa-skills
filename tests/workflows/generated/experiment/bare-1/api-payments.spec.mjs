import { test, expect, deliverPayment, orderOf, paymentEvent, placeOrder, signature } from './helpers.mjs';

test('payment webhook rejects bad deliveries and fulfills a paid order exactly once', async ({ app, client, admin }) => {
  const alice = await client(app.users.alice);
  const psp = await client();
  const order = (await (await placeOrder(alice, 'pay-1')).json()).order;
  const event = paymentEvent('evt-pay-1', order.id, 4200);

  for (const [name, header] of Object.entries({
    missing: null,
    'wrong secret': signature(event, 'not-the-secret'),
    'other body': signature(paymentEvent('evt-pay-1', order.id, 1), app.paymentSecret),
  })) {
    const response = await deliverPayment(psp, app, event, header);
    expect(response.status(), name).toBe(401);
    expect(await response.json(), name).toEqual({ error: 'invalid_signature' });
  }
  const afterForgeries = await admin.state();
  expect(afterForgeries.receipts, 'unsigned deliveries record no receipt').toEqual([]);
  expect(afterForgeries.orders[0]).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  expect((await deliverPayment(psp, app, '{"id":"evt-broken","type":')).status(), 'malformed').toBe(400);
  expect((await deliverPayment(psp, app, paymentEvent('evt-ghost', 'no-such-order', 4200))).status()).toBe(404);
  for (const mismatch of [paymentEvent('evt-low', order.id, 4199), paymentEvent('evt-usd', order.id, 4200, 'USD')]) {
    const response = await deliverPayment(psp, app, mismatch);
    expect(response.status()).toBe(422);
    expect(await response.json()).toEqual({ error: 'payment_mismatch' });
  }
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const accepted = await deliverPayment(psp, app, event);
  expect(accepted.status()).toBe(200);
  expect(await accepted.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const repeat = await deliverPayment(psp, app, event);
  expect(repeat.status()).toBe(200);
  expect(await repeat.json()).toEqual({ received: true, duplicate: true, order_id: order.id });

  // Valid on its own for another order, so only the reused event id can make it fail.
  const other = (await (await placeOrder(alice, 'pay-2')).json()).order;
  const altered = await deliverPayment(psp, app, paymentEvent('evt-pay-1', other.id, 4200));
  expect(altered.status(), 'same event id with a different body').toBe(409);
  expect(await altered.json()).toEqual({ error: 'event_conflict' });
  expect(await orderOf(alice, other.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const secondPayment = await deliverPayment(psp, app, paymentEvent('evt-pay-1-again', order.id, 4200));
  expect(secondPayment.status()).toBeLessThan(500);
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
});

test('concurrent payment deliveries fulfill each order once', async ({ app, client, admin }) => {
  const alice = await client(app.users.alice);
  const psp = await client();
  const first = (await (await placeOrder(alice, 'race-1')).json()).order;
  const second = (await (await placeOrder(alice, 'race-2', { currency: 'EUR', items: [{ sku: 'CUP-01', quantity: 2 }] })).json()).order;

  const sameEvent = paymentEvent('evt-race-same', first.id, 4200);
  const replays = await Promise.all(Array.from({ length: 8 }, () => deliverPayment(psp, app, sameEvent)));
  expect(replays.map(r => r.status())).toEqual(Array(8).fill(200));
  const bodies = await Promise.all(replays.map(r => r.json()));
  expect(bodies.filter(body => body.duplicate === false), 'exactly one delivery is the original').toHaveLength(1);
  expect(await orderOf(alice, first.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect((await admin.state()).receipts).toHaveLength(1);

  const distinct = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    deliverPayment(psp, app, paymentEvent(`evt-race-distinct-${i}`, second.id, 3600))));
  for (const response of distinct) expect(response.status()).toBeLessThan(500);
  expect(distinct.filter(r => r.status() === 200).length).toBeGreaterThanOrEqual(1);
  expect(await orderOf(alice, second.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
});

test('transient fulfillment failure rolls back, the retry succeeds, and state survives restart', async ({ app, client, admin }) => {
  test.setTimeout(60_000);
  const order = (await (await placeOrder(await client(app.users.alice), 'restart-1')).json()).order;
  const event = paymentEvent('evt-restart-1', order.id, 4200);

  await app.restart({ failFulfillmentOnce: true });
  const psp = await client();
  const failed = await deliverPayment(psp, app, event);
  expect(failed.status()).toBe(503);
  expect(await failed.json()).toEqual({ error: 'fulfillment_unavailable' });
  const afterFailure = await admin.state();
  expect(afterFailure.receipts, 'no committed receipt after the transient failure').toEqual([]);
  expect(afterFailure.orders.find(o => o.id === order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const retried = await deliverPayment(psp, app, event);
  expect(retried.status()).toBe(200);
  expect(await retried.json()).toEqual({ received: true, duplicate: false, order_id: order.id });

  await app.restart({ failFulfillmentOnce: false });
  const health = await psp.get('/health');
  expect(health.status()).toBe(200);

  const alice = await client(app.users.alice);
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const redelivered = await deliverPayment(psp, app, event);
  expect(redelivered.status()).toBe(200);
  expect((await redelivered.json()).duplicate, 'event receipt is durable across restart').toBe(true);

  const replay = await placeOrder(alice, 'restart-1');
  expect(replay.status(), 'idempotency key is durable across restart').toBe(200);
  expect((await replay.json()).order).toMatchObject({ id: order.id, status: 'paid', fulfillment_count: 1 });

  const state = await admin.state();
  expect(state.orders).toHaveLength(1);
  expect(state.receipts).toHaveLength(1);
});
