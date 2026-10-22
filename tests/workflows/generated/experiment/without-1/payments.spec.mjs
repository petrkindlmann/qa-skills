import { test, expect, paymentEvent, signPayload } from './helpers.mjs';

const receiptsFor = (state, orderId) => state.receipts.filter((r) => r.order_id === orderId);
const orderIn = (state, orderId) => state.orders.find((o) => o.id === orderId);

test('only a correctly signed, matching payment fulfills an order, and only once', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const order = await shop.createOrder(alice, 'pay-1');
  const other = await shop.createOrder(alice, 'pay-2', [{ sku: 'CUP-01', quantity: 1 }]);
  const event = paymentEvent('evt-accept-1', order);
  const body = JSON.stringify(event);

  const unsigned = await shop.deliver(event, { signature: null });
  expect(unsigned.status()).toBe(401);
  expect(await unsigned.json()).toEqual({ error: 'invalid_signature' });
  expect((await shop.deliver(event, { signature: signPayload('not-the-secret', body) })).status()).toBe(401);
  // Signature over different bytes than those sent.
  const tamperedBytes = JSON.stringify(paymentEvent('evt-accept-1', order, { amount: 1 }));
  expect((await shop.deliver(tamperedBytes, { signature: signPayload(app.paymentSecret, body) })).status()).toBe(401);

  expect((await shop.deliver('{"id":"evt-bad",')).status()).toBe(400);
  expect((await shop.deliver({ id: 'evt-no-data', type: 'payment.succeeded' })).status()).toBe(400);
  expect((await shop.deliver(paymentEvent('evt-unknown', { ...order, id: 'no-such-order' }))).status()).toBe(404);
  for (const [name, data] of Object.entries({ amount: { amount: 4100 }, currency: { currency: 'USD' } })) {
    const mismatch = await shop.deliver(paymentEvent(`evt-mismatch-${name}`, order, data));
    expect(mismatch.status(), name).toBe(422);
    expect(await mismatch.json(), name).toEqual({ error: 'payment_mismatch' });
  }

  let state = await shop.state();
  expect(state.receipts).toEqual([]);
  expect(orderIn(state, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const accepted = await shop.deliver(event);
  expect(accepted.status()).toBe(200);
  expect(await accepted.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
  const paid = (await (await alice.get(`/api/orders/${order.id}`)).json()).order;
  expect(paid).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const repeat = await shop.deliver(event);
  expect(repeat.status()).toBe(200);
  expect(await repeat.json()).toEqual({ received: true, duplicate: true, order_id: order.id });

  const reusedId = await shop.deliver(paymentEvent('evt-accept-1', other));
  expect(reusedId.status()).toBe(409);
  expect(await reusedId.json()).toEqual({ error: 'event_conflict' });

  const secondPayment = await shop.deliver(paymentEvent('evt-accept-2', order));
  expect(secondPayment.status(), 'a second payment for a paid order is handled, not crashed').toBeLessThan(500);

  state = await shop.state();
  expect(orderIn(state, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, order.id).filter((r) => r.id === 'evt-accept-1')).toHaveLength(1);
  expect(orderIn(state, other.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
  expect(receiptsFor(state, other.id)).toEqual([]);
});

test('concurrent deliveries fulfill once, including across a transient failure', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const sameEvent = await shop.createOrder(alice, 'conc-1');
  const manyEvents = await shop.createOrder(alice, 'conc-2');

  const event = paymentEvent('evt-burst', sameEvent);
  const burst = await Promise.all(Array.from({ length: 8 }, () => shop.deliver(event)));
  expect(burst.map((r) => r.status())).toEqual(Array(8).fill(200));
  const firsts = (await Promise.all(burst.map((r) => r.json()))).filter((b) => b.duplicate === false);
  expect(firsts).toHaveLength(1);

  const distinct = await Promise.all(Array.from({ length: 6 }, (_, i) => shop.deliver(paymentEvent(`evt-distinct-${i}`, manyEvents))));
  for (const response of distinct) expect(response.status()).toBeLessThan(500);

  let state = await shop.state();
  expect(orderIn(state, sameEvent.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, sameEvent.id)).toHaveLength(1);
  expect(orderIn(state, manyEvents.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  await app.restart({ failFulfillmentOnce: true });
  const retried = await shop.createOrder(await shop.signIn(app.users.alice), 'conc-3');
  const flaky = paymentEvent('evt-flaky-burst', retried);
  const results = await Promise.all(Array.from({ length: 6 }, () => shop.deliver(flaky)));
  const statuses = results.map((r) => r.status());
  expect(statuses.filter((s) => s === 503), `statuses ${statuses}`).toHaveLength(1);
  expect(statuses.filter((s) => s === 200)).toHaveLength(5);
  const failed = results[statuses.indexOf(503)];
  expect(await failed.json()).toEqual({ error: 'fulfillment_unavailable' });

  const retry = await shop.deliver(flaky);
  expect(retry.status()).toBe(200);
  const fresh = [...(await Promise.all(results.filter((r) => r.status() === 200).map((r) => r.json()))), await retry.json()]
    .filter((b) => b.duplicate === false);
  expect(fresh).toHaveLength(1);

  state = await shop.state();
  expect(orderIn(state, retried.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, retried.id)).toHaveLength(1);
});

test('a failed fulfillment rolls back, and paid state survives restarts', async ({ app, shop }) => {
  let alice = await shop.signIn(app.users.alice);
  const order = await shop.createOrder(alice, 'durable-key');
  const other = await shop.createOrder(alice, 'durable-other', [{ sku: 'TEA-50', quantity: 1 }]);
  const event = paymentEvent('evt-durable', order);

  await app.restart({ failFulfillmentOnce: true });
  const failed = await shop.deliver(event);
  expect(failed.status()).toBe(503);
  expect(await failed.json()).toEqual({ error: 'fulfillment_unavailable' });

  let state = await shop.state();
  expect(orderIn(state, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
  expect(receiptsFor(state, order.id)).toEqual([]);
  alice = await shop.signIn(app.users.alice);
  expect((await (await alice.get(`/api/orders/${order.id}`)).json()).order.status).toBe('pending');

  const retried = await shop.deliver(event);
  expect(retried.status()).toBe(200);
  expect(await retried.json()).toEqual({ received: true, duplicate: false, order_id: order.id });

  await app.restart({ failFulfillmentOnce: false });
  alice = await shop.signIn(app.users.alice);
  expect((await (await alice.get(`/api/orders/${order.id}`)).json()).order).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const afterRestart = await shop.deliver(event);
  expect(afterRestart.status()).toBe(200);
  expect((await afterRestart.json()).duplicate).toBe(true);
  // The stored receipt body still guards the event ID after a restart.
  expect((await shop.deliver(paymentEvent('evt-durable', other))).status()).toBe(409);

  const replay = await shop.placeOrder(alice, 'durable-key');
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({ replayed: true, order: { id: order.id, status: 'paid' } });
  expect((await (await alice.get('/api/orders')).json()).orders).toHaveLength(2);

  state = await shop.state();
  expect(orderIn(state, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, order.id).map((r) => r.id)).toEqual(['evt-durable']);
  expect(orderIn(state, other.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
});
