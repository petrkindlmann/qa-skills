import { test, expect, createOrder, getOrder, paymentEvent, sign, deliver } from './shop-helpers.mjs';

test('unsigned, malformed or mismatched payment events leave the order unpaid and unreceipted', async ({ app, client, admin }) => {
  const alice = await client(app.users.alice);
  const order = (await (await createOrder(alice, 'pay-reject')).json()).order;
  const hook = await client();
  const body = paymentEvent('evt-sig', order.id);

  const forged = {
    'missing signature': await deliver(hook, app, body, { signature: null }),
    'wrong secret': await deliver(hook, app, body, { signature: sign('not-the-secret', body) }),
    're-serialised bytes': await deliver(hook, app, body, { bytes: JSON.stringify(JSON.parse(body), null, 2) }),
  };
  for (const [name, response] of Object.entries(forged)) {
    expect(response.status(), name).toBe(401);
    expect(await response.json(), name).toEqual({ error: 'invalid_signature' });
  }

  expect((await deliver(hook, app, '{"id":"evt-broken",')).status(), 'truncated JSON').toBe(400);
  expect((await deliver(hook, app, '{"id":"evt-nodata","type":"payment.succeeded"}')).status(), 'missing data').toBe(400);
  expect((await deliver(hook, app, paymentEvent('evt-unknown', 'no-such-order'))).status(), 'unknown order').toBe(404);
  for (const [name, overrides] of Object.entries({ amount: { amount: 4199 }, currency: { currency: 'USD' } })) {
    const response = await deliver(hook, app, paymentEvent(`evt-${name}`, order.id, overrides));
    expect(response.status(), `${name} mismatch`).toBe(422);
    expect(await response.json(), `${name} mismatch`).toEqual({ error: 'payment_mismatch' });
  }

  expect(await getOrder(alice, order.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
  expect((await admin.state()).receipts).toEqual([]);

  // The forged attempts recorded nothing, so the genuine event with the same ID is processed as new.
  const genuine = await deliver(hook, app, body);
  expect(genuine.status()).toBe(200);
  expect(await genuine.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
  expect(await getOrder(alice, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
});

test('concurrent and repeated payment deliveries fulfil each order exactly once', async ({ app, client, admin }) => {
  const alice = await client(app.users.alice);
  const first = (await (await createOrder(alice, 'pay-a')).json()).order;
  const second = (await (await createOrder(alice, 'pay-b', [{ sku: 'TEA-50', quantity: 1 }])).json()).order;
  const hook = await client();
  const body = paymentEvent('evt-a', first.id);

  const burst = await Promise.all(Array.from({ length: 6 }, () => deliver(hook, app, body)));
  const results = await Promise.all(burst.map(response => response.json()));
  expect(burst.map(response => response.status())).toEqual(Array(6).fill(200));
  expect(results.filter(result => result.duplicate === false)).toHaveLength(1);
  expect(results.every(result => result.received === true && result.order_id === first.id)).toBe(true);
  expect(await getOrder(alice, first.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });

  const repeat = await deliver(hook, app, body);
  expect(repeat.status()).toBe(200);
  expect(await repeat.json()).toEqual({ received: true, duplicate: true, order_id: first.id });

  const reused = await deliver(hook, app, paymentEvent('evt-a', second.id, { amount: second.amount }));
  expect(reused.status()).toBe(409);
  expect(await reused.json()).toEqual({ error: 'event_conflict' });
  expect(await getOrder(alice, second.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });

  // Distinct event IDs for an already-paid order must not fulfil it again. The contract leaves their status open.
  const extra = await Promise.all(['evt-a2', 'evt-a3', 'evt-a4'].map(id => deliver(hook, app, paymentEvent(id, first.id))));
  for (const response of extra) expect(response.status()).toBeLessThan(500);

  // Several distinct events racing for one unpaid order still fulfil it once.
  const race = await Promise.all(['evt-b1', 'evt-b2', 'evt-b3', 'evt-b4']
    .map(id => deliver(hook, app, paymentEvent(id, second.id, { amount: second.amount }))));
  for (const response of race) expect(response.status()).toBeLessThan(500);
  expect(race.filter(response => response.status() === 200).length).toBeGreaterThanOrEqual(1);

  expect(await getOrder(alice, first.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(await getOrder(alice, second.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  const state = await admin.state();
  expect(state.receipts.filter(receipt => receipt.id === 'evt-a')).toHaveLength(1);
  expect(state.orders.map(order => order.fulfillment_count)).toEqual([1, 1]);
});

test('a transient fulfilment failure commits nothing, the retry succeeds, and state survives restarts', async ({ app, client, admin }) => {
  test.setTimeout(60_000);
  const alice = await client(app.users.alice);
  const order = (await (await createOrder(alice, 'restart-1')).json()).order;
  const body = paymentEvent('evt-retry', order.id);

  await app.restart({ failFulfillmentOnce: true });
  const hook = await client();
  const failed = await deliver(hook, app, body);
  expect(failed.status()).toBe(503);
  expect(await failed.json()).toEqual({ error: 'fulfillment_unavailable' });

  const afterFailure = await admin.state();
  expect(afterFailure.receipts).toEqual([]);
  expect(afterFailure.orders).toEqual([expect.objectContaining({ id: order.id, status: 'pending', fulfillment_count: 0 })]);

  const retry = await deliver(hook, app, body);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual({ received: true, duplicate: false, order_id: order.id });

  await app.restart({ failFulfillmentOnce: false });
  const aliceAgain = await client(app.users.alice);
  expect(await getOrder(aliceAgain, order.id)).toMatchObject({ status: 'paid', fulfillment_count: 1, amount: order.amount });
  expect((await (await aliceAgain.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([order.id]);

  const replayedOrder = await createOrder(aliceAgain, 'restart-1');
  expect(replayedOrder.status()).toBe(200);
  expect(await replayedOrder.json()).toMatchObject({ replayed: true, order: { id: order.id } });

  const redeliveries = await Promise.all(Array.from({ length: 5 }, () => deliver(hook, app, body)));
  for (const response of redeliveries) {
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true, order_id: order.id });
  }

  const finalState = await admin.state();
  expect(finalState.receipts.map(receipt => receipt.id)).toEqual(['evt-retry']);
  expect(finalState.orders).toEqual([expect.objectContaining({ id: order.id, status: 'paid', fulfillment_count: 1 })]);
});
