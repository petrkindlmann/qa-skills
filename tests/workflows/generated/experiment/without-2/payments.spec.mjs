import { test as base, expect } from '../../../support/fixtures.mjs';
import { BASKET_AMOUNT, paymentBody, shopFixtures, sign } from './helpers.mjs';

const test = base.extend(shopFixtures);

const receiptsFor = (state, orderId) => state.receipts.filter((r) => r.order_id === orderId);

async function orderOf(ctx, id) {
  const res = await ctx.get(`/api/orders/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()).order;
}

test('rejected payment events change nothing; a valid event pays and fulfills exactly once', async ({ app, shop }) => {
  const alice = await shop.session(app.users.alice);
  const order = (await shop.placeOrder(alice, 'pay-1')).body.order;
  const other = (await shop.placeOrder(alice, 'pay-2')).body.order;
  const valid = paymentBody('evt-valid', order.id);

  const rejections = [
    ['missing signature', valid, { signature: null }, 401, { error: 'invalid_signature' }],
    ['wrong secret', valid, { signature: sign(valid, 'not-the-secret') }, 401, { error: 'invalid_signature' }],
    ['signature of other bytes', valid, { signature: sign(paymentBody('evt-valid', order.id, { amount: 1 }), app.paymentSecret) }, 401, { error: 'invalid_signature' }],
    ['unknown order', paymentBody('evt-unknown', 'no-such-order'), {}, 404, undefined],
    ['amount mismatch', paymentBody('evt-amount', order.id, { amount: BASKET_AMOUNT - 1 }), {}, 422, { error: 'payment_mismatch' }],
    ['currency mismatch', paymentBody('evt-currency', order.id, { currency: 'USD' }), {}, 422, { error: 'payment_mismatch' }],
    ['malformed JSON', '{"id":"evt-broken","type":', {}, 400, undefined],
    ['missing data', JSON.stringify({ id: 'evt-nodata', type: 'payment.succeeded' }), {}, 400, undefined],
  ];
  for (const [name, body, options, status, error] of rejections) {
    const res = await shop.deliver(body, options);
    expect(res.status, name).toBe(status);
    if (error) expect(res.body, name).toEqual(error);
  }
  let state = await shop.state();
  expect(state.receipts).toEqual([]);
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const paid = await shop.deliver(valid);
  expect(paid).toEqual({ status: 200, body: { received: true, duplicate: false, order_id: order.id } });
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const repeat = await shop.deliver(valid);
  expect(repeat).toEqual({ status: 200, body: { received: true, duplicate: true, order_id: order.id } });

  // Same event ID, different body (it names the other order): a conflict that must not pay that order.
  const conflict = await shop.deliver(paymentBody('evt-valid', other.id));
  expect(conflict).toEqual({ status: 409, body: { error: 'event_conflict' } });
  expect(await orderOf(alice, other.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  // A distinct, correctly signed event for an order that is already paid must not fulfill it again.
  const second = await shop.deliver(paymentBody('evt-second', order.id));
  expect(second.status, 'second payment event is not a server error').toBeLessThan(500);
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  state = await shop.state();
  expect(state.receipts.filter((r) => r.id === 'evt-valid')).toHaveLength(1);
  expect(receiptsFor(state, other.id)).toEqual([]);
});

test('concurrent deliveries of payment events fulfill an order once', async ({ app, shop }) => {
  const alice = await shop.session(app.users.alice);
  const order = (await shop.placeOrder(alice, 'burst-1')).body.order;
  const body = paymentBody('evt-burst', order.id);

  const sameEvent = await Promise.all(Array.from({ length: 10 }, () => shop.deliver(body)));
  expect(sameEvent.map((r) => r.status)).toEqual(Array(10).fill(200));
  expect(sameEvent.filter((r) => r.body.duplicate === false)).toHaveLength(1);
  expect(sameEvent.filter((r) => r.body.duplicate === true)).toHaveLength(9);
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(await shop.state(), order.id)).toHaveLength(1);

  // Distinct event IDs racing for one pending order still produce a single fulfillment.
  const raced = (await shop.placeOrder(alice, 'burst-2')).body.order;
  const distinct = await Promise.all(
    Array.from({ length: 6 }, (_, i) => shop.deliver(paymentBody(`evt-race-${i}`, raced.id))),
  );
  for (const res of distinct) expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
  expect(distinct.filter((r) => r.status === 200 && r.body.duplicate === false).length).toBeGreaterThanOrEqual(1);
  expect(await orderOf(alice, raced.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect((await shop.state()).orders.find((o) => o.id === raced.id).fulfillment_count).toBe(1);
});

test('a transient fulfillment failure rolls back, the retry succeeds, and state survives restarts', async ({ app, shop }) => {
  test.setTimeout(60000);
  const before = await shop.session(app.users.alice);
  const order = (await shop.placeOrder(before, 'restart-1')).body.order;
  const untouched = (await shop.placeOrder(before, 'restart-2')).body.order;
  const body = paymentBody('evt-restart', order.id);

  await app.restart({ failFulfillmentOnce: true });
  const alice = await shop.session(app.users.alice);
  expect(await orderOf(alice, order.id), 'order persisted across restart').toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const failed = await shop.deliver(body);
  expect(failed).toEqual({ status: 503, body: { error: 'fulfillment_unavailable' } });
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
  expect(receiptsFor(await shop.state(), order.id), 'no receipt committed for the failed attempt').toEqual([]);

  const retried = await shop.deliver(body);
  expect(retried).toEqual({ status: 200, body: { received: true, duplicate: false, order_id: order.id } });
  expect(await orderOf(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  await app.restart({ failFulfillmentOnce: false });
  const afterRestart = await shop.session(app.users.alice);
  expect(await orderOf(afterRestart, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const replayedEvent = await shop.deliver(body);
  expect(replayedEvent).toEqual({ status: 200, body: { received: true, duplicate: true, order_id: order.id } });
  const conflictingEvent = await shop.deliver(paymentBody('evt-restart', untouched.id));
  expect(conflictingEvent).toEqual({ status: 409, body: { error: 'event_conflict' } });
  expect(await orderOf(afterRestart, untouched.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  const replayedOrder = await shop.placeOrder(afterRestart, 'restart-1');
  expect(replayedOrder.status, 'idempotency key survives restart').toBe(200);
  expect(replayedOrder.body.replayed).toBe(true);
  expect(replayedOrder.body.order).toMatchObject({ id: order.id, status: 'paid', fulfillment_count: 1 });

  const state = await shop.state();
  expect(receiptsFor(state, order.id)).toHaveLength(1);
  expect(state.orders).toHaveLength(2);
});
