import {
  test, expect, createOrder, deliverPayment, expectError, paymentEvent, sign, supportState,
} from './helpers.mjs';

const receiptsFor = (state, orderId) => state.receipts.filter(r => r.order_id === orderId);

async function orderOf(client, id) {
  const response = await client.get(`/api/orders/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).order;
}

test('payment events are authenticated, validated and fulfill an order exactly once', async ({ app, clients }) => {
  const alice = await clients(app.users.alice);
  const psp = await clients();
  const order = await createOrder(alice, 'pay-1');
  const event = paymentEvent('evt-validate-1', order);
  const body = JSON.stringify(event);

  await expectError(await deliverPayment(psp, app, event, { signature: null }), 401, 'invalid_signature');
  await expectError(await deliverPayment(psp, app, event, { signature: sign('some-other-secret', body) }), 401, 'invalid_signature');
  await expectError(await deliverPayment(psp, app, event, { signature: sign(app.paymentSecret, body).replace('sha256=', '') }), 401, 'invalid_signature');
  // Signature covers exact bytes: the same JSON re-serialized with whitespace is not the signed message.
  await expectError(await deliverPayment(psp, app, event, { body: JSON.stringify(event, null, 2), signature: sign(app.paymentSecret, body) }), 401, 'invalid_signature');

  let state = await supportState(psp, app);
  expect(receiptsFor(state, order.id)).toEqual([]);
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  expect((await deliverPayment(psp, app, null, { body: '{"id":"evt-broken",' })).status()).toBe(400);
  expect((await deliverPayment(psp, app, { id: 'evt-no-data', type: 'payment.succeeded' })).status()).toBe(400);
  expect((await deliverPayment(psp, app, paymentEvent('evt-unknown', { ...order, id: 'no-such-order' }))).status()).toBe(404);
  await expectError(await deliverPayment(psp, app, paymentEvent('evt-short', order, { amount: order.amount - 100 })), 422, 'payment_mismatch');
  await expectError(await deliverPayment(psp, app, paymentEvent('evt-usd', order, { currency: 'USD' })), 422, 'payment_mismatch');
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const accepted = await deliverPayment(psp, app, event);
  expect(accepted.status()).toBe(200);
  expect(await accepted.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const repeat = await deliverPayment(psp, app, event);
  expect(repeat.status()).toBe(200);
  expect(await repeat.json()).toMatchObject({ received: true, duplicate: true, order_id: order.id });

  await expectError(await deliverPayment(psp, app, paymentEvent('evt-validate-1', order, { amount: order.amount + 1 })), 409, 'event_conflict');

  const second = await deliverPayment(psp, app, paymentEvent('evt-validate-2', order));
  expect(second.status(), await second.text()).toBeLessThan(500);

  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  state = await supportState(psp, app);
  expect(state.orders.find(o => o.id === order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, order.id).filter(r => r.id === 'evt-validate-1')).toHaveLength(1);
});

test('concurrent deliveries never fulfill an order twice', async ({ app, clients }) => {
  const alice = await clients(app.users.alice);
  const psp = await clients();
  const [first, second] = [await createOrder(alice, 'race-1'), await createOrder(alice, 'race-2')];

  const sameEvent = paymentEvent('evt-race-same', first);
  const identical = await Promise.all(Array.from({ length: 10 }, () => deliverPayment(psp, app, sameEvent)));
  const identicalBodies = await Promise.all(identical.map(r => r.json()));
  expect(identical.map(r => r.status())).toEqual(Array(10).fill(200));
  expect(identicalBodies.filter(b => b.duplicate === false)).toHaveLength(1);
  expect(identicalBodies.filter(b => b.duplicate === true)).toHaveLength(9);

  const distinct = await Promise.all(Array.from({ length: 6 }, (_, i) => deliverPayment(psp, app, paymentEvent(`evt-race-distinct-${i}`, second))));
  for (const response of distinct) expect(response.status(), await response.text()).toBeLessThan(500);
  expect(distinct.some(r => r.status() === 200)).toBe(true);

  expect(await orderOf(alice, first.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(await orderOf(alice, second.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  const state = await supportState(psp, app);
  expect(receiptsFor(state, first.id).map(r => r.id)).toEqual(['evt-race-same']);
  expect(state.orders.map(o => o.fulfillment_count)).toEqual([1, 1]);
});

test('a transient fulfillment failure rolls back, the retry succeeds, and state survives restart', async ({ app, clients }) => {
  const psp = await clients();
  let alice = await clients(app.users.alice);
  const order = await createOrder(alice, 'durable-1');
  const event = paymentEvent('evt-durable-1', order);

  await app.restart({ failFulfillmentOnce: true });
  await expectError(await deliverPayment(psp, app, event), 503, 'fulfillment_unavailable');
  let state = await supportState(psp, app);
  expect(receiptsFor(state, order.id)).toEqual([]);
  expect(state.orders.find(o => o.id === order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const retry = await deliverPayment(psp, app, event);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual({ received: true, duplicate: false, order_id: order.id });

  await app.restart({ failFulfillmentOnce: false });
  alice = await clients(app.users.alice);
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const replayedOrder = await alice.post('/api/orders', { headers: { 'Idempotency-Key': 'durable-1' }, data: { currency: 'EUR', items: order.items } });
  expect(replayedOrder.status()).toBe(200);
  expect(await replayedOrder.json()).toMatchObject({ replayed: true, order: { id: order.id, status: 'paid', fulfillment_count: 1 } });

  const redelivered = await deliverPayment(psp, app, event);
  expect(redelivered.status()).toBe(200);
  expect(await redelivered.json()).toMatchObject({ duplicate: true, order_id: order.id });
  expect((await deliverPayment(psp, app, paymentEvent('evt-durable-2', order))).status()).toBeLessThan(500);

  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  state = await supportState(psp, app);
  expect(state.orders).toHaveLength(1);
  expect(receiptsFor(state, order.id).filter(r => r.id === 'evt-durable-1')).toHaveLength(1);
});

test('concurrent deliveries during the transient failure converge to one fulfillment', async ({ app, clients }) => {
  const psp = await clients();
  const alice = await clients(app.users.alice);
  const order = await createOrder(alice, 'flaky-race');
  const event = paymentEvent('evt-flaky-race', order);

  await app.restart({ failFulfillmentOnce: true });
  const responses = await Promise.all(Array.from({ length: 6 }, () => deliverPayment(psp, app, event)));
  const outcomes = await Promise.all(responses.map(async r => ({ status: r.status(), body: await r.json() })));
  expect(outcomes.filter(o => o.status === 503)).toEqual([{ status: 503, body: { error: 'fulfillment_unavailable' } }]);
  const accepted = outcomes.filter(o => o.status === 200);
  expect(accepted).toHaveLength(5);
  expect(accepted.filter(o => o.body.duplicate === false)).toHaveLength(1);

  const retry = await deliverPayment(psp, app, event);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toMatchObject({ duplicate: true });

  await app.restart({ failFulfillmentOnce: false });
  const state = await supportState(psp, app);
  expect(state.orders.find(o => o.id === order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, order.id).map(r => r.id)).toEqual(['evt-flaky-race']);
});
