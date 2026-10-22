import {
  test, expect, signedInClient, createOrder, deliverPayment, paymentEvent, sign, expectError,
  fixtureState, receiptsFor,
} from './helpers.mjs';

async function orderState(api, app, orderId) {
  const state = await fixtureState(api, app);
  return { order: state.orders.find(o => o.id === orderId), receipts: receiptsFor(state, orderId) };
}

test('signed payment events: rejections change nothing, a valid event fulfils once', async ({ app, clients }) => {
  const api = await signedInClient(clients, app.users.alice);
  const order = await createOrder(api, 'pay-signed-1');
  const valid = paymentEvent('evt-signed-1', order.id, 4200);

  await test.step('bad signatures are 401', async () => {
    await expectError(await deliverPayment(api, app, valid, { signature: null }), 401, 'invalid_signature');
    await expectError(await deliverPayment(api, app, valid, { signature: sign('wrong-secret', valid) }),
      401, 'invalid_signature');
    const tampered = valid.replace('"amount":4200', '"amount":4201');
    await expectError(await deliverPayment(api, app, tampered, { signature: sign(app.paymentSecret, valid) }),
      401, 'invalid_signature');
  });

  await test.step('signed but unacceptable events are 400, 404 and 422', async () => {
    expect((await deliverPayment(api, app, '{"id":"evt-broken","type":')).status()).toBe(400);
    expect((await deliverPayment(api, app, JSON.stringify({ id: 'evt-no-data', type: 'payment.succeeded' }))).status())
      .toBe(400);
    expect((await deliverPayment(api, app, paymentEvent('evt-unknown', 'no-such-order', 4200))).status()).toBe(404);
    await expectError(await deliverPayment(api, app, paymentEvent('evt-amount', order.id, 4199)), 422, 'payment_mismatch');
    await expectError(await deliverPayment(api, app, paymentEvent('evt-currency', order.id, 4200, 'USD')),
      422, 'payment_mismatch');
  });

  await test.step('none of the rejected events left a receipt or fulfilled the order', async () => {
    const state = await orderState(api, app, order.id);
    expect(state.order).toMatchObject({ status: 'pending', fulfillment_count: 0 });
    expect(state.receipts).toEqual([]);
    expect((await fixtureState(api, app)).receipts).toEqual([]);
  });

  // Noncanonical bytes: reordered keys and extra whitespace; the signature covers these exact bytes.
  const spaced = `{ "type": "payment.succeeded",\n  "id": "evt-signed-1",\n  "data": { "amount": 4200, "currency": "EUR", "order_id": "${order.id}" } }`;

  await test.step('a valid event over noncanonical JSON is accepted and fulfils once', async () => {
    const accepted = await deliverPayment(api, app, spaced);
    expect(accepted.status()).toBe(200);
    expect(await accepted.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
    const own = await (await api.get(`/api/orders/${order.id}`)).json();
    expect(own.order).toMatchObject({ status: 'paid', fulfillment_count: 1, amount: 4200 });
  });

  await test.step('redelivery is a duplicate; a changed body under the same ID conflicts', async () => {
    const again = await deliverPayment(api, app, spaced);
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true, order_id: order.id });
    await expectError(await deliverPayment(api, app, paymentEvent('evt-signed-1', order.id, 1200)), 409, 'event_conflict');
  });

  await test.step('a distinct event for the paid order does not fulfil it again', async () => {
    const second = await deliverPayment(api, app, paymentEvent('evt-signed-2', order.id, 4200));
    expect(second.status(), await second.text()).toBeLessThan(500);
    const state = await orderState(api, app, order.id);
    expect(state.order).toMatchObject({ status: 'paid', fulfillment_count: 1 });
    expect(state.receipts.map(r => r.id)).toContain('evt-signed-1');
  });
});

test('concurrent deliveries fulfil each order exactly once', async ({ app, clients }) => {
  const api = await signedInClient(clients, app.users.alice);
  const first = await createOrder(api, 'pay-burst-1');
  const second = await createOrder(api, 'pay-burst-2', { currency: 'EUR', items: [{ sku: 'CUP-01', quantity: 3 }] });
  expect(second.amount).toBe(5400);

  const sameEvent = paymentEvent('evt-burst-same', first.id, 4200);
  const distinctEvents = Array.from({ length: 6 }, (_, i) => paymentEvent(`evt-burst-distinct-${i}`, second.id, 5400));
  const [sameResponses, distinctResponses] = await Promise.all([
    Promise.all(Array.from({ length: 8 }, () => deliverPayment(api, app, sameEvent))),
    Promise.all(distinctEvents.map(body => deliverPayment(api, app, body))),
  ]);

  await test.step('identical events: one first delivery, the rest duplicates', async () => {
    const bodies = await Promise.all(sameResponses.map(async r => ({ status: r.status(), body: await r.json() })));
    expect(bodies.map(b => b.status)).toEqual(Array(8).fill(200));
    expect(bodies.filter(b => b.body.duplicate === false)).toHaveLength(1);
    expect(bodies.filter(b => b.body.duplicate === true)).toHaveLength(7);
  });

  await test.step('distinct events for one order: no server error, at least one accepted', async () => {
    const statuses = distinctResponses.map(r => r.status());
    expect(statuses.every(s => s < 500), `statuses ${statuses}`).toBe(true);
    expect(statuses).toContain(200);
  });

  const state = await fixtureState(api, app);
  expect(state.orders.find(o => o.id === first.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(state.orders.find(o => o.id === second.id)).toMatchObject({ status: 'paid', fulfillment_count: 1 });
  expect(receiptsFor(state, first.id).map(r => r.id)).toEqual(['evt-burst-same']);
});

test('a transient fulfilment failure commits nothing and the retry succeeds after restart', async ({ app, clients }) => {
  const api = await signedInClient(clients, app.users.alice);
  const order = await createOrder(api, 'pay-transient-1');
  const event = paymentEvent('evt-transient-1', order.id, 4200);

  await app.restart({ failFulfillmentOnce: true });
  const failing = await clients();

  await test.step('the injected failure returns 503 and rolls back', async () => {
    await expectError(await deliverPayment(failing, app, event), 503, 'fulfillment_unavailable');
    const state = await orderState(failing, app, order.id);
    expect(state.order).toMatchObject({ status: 'pending', fulfillment_count: 0 });
    expect(state.receipts).toEqual([]);
  });

  await app.restart();
  const recovered = await signedInClient(clients, app.users.alice);

  await test.step('after restart the order is still pending with no receipt', async () => {
    const own = await (await recovered.get(`/api/orders/${order.id}`)).json();
    expect(own.order).toMatchObject({ status: 'pending', fulfillment_count: 0 });
    expect((await orderState(recovered, app, order.id)).receipts).toEqual([]);
  });

  await test.step('retrying the same event is a first delivery and fulfils once', async () => {
    const retry = await deliverPayment(recovered, app, event);
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
  });

  await app.restart();
  const later = await signedInClient(clients, app.users.alice);

  await test.step('payment and receipt survive another restart and redelivery stays a duplicate', async () => {
    const own = await (await later.get(`/api/orders/${order.id}`)).json();
    expect(own.order).toMatchObject({ status: 'paid', fulfillment_count: 1 });
    const again = await deliverPayment(later, app, event);
    expect(await again.json()).toEqual({ received: true, duplicate: true, order_id: order.id });
    const state = await orderState(later, app, order.id);
    expect(state.order.fulfillment_count).toBe(1);
    expect(state.receipts.map(r => r.id)).toEqual(['evt-transient-1']);
  });
});
