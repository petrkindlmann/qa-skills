import { oracle } from '../../support/oracle.mjs';
import { test, expect } from '../../support/fixtures.mjs';
import { json, login, createOrder, signedRawEvent, state } from './helpers.mjs';

// Review finding 1: keep the credential independent of logout's cookie updates.
test('logout revokes a previously valid copied session on the server', async ({ app, playwright }) => {
  const contexts = [];
  try {
    const original = await playwright.request.newContext({ baseURL: app.baseURL });
    contexts.push(original);
    const replay = await playwright.request.newContext({ baseURL: app.baseURL });
    contexts.push(replay);
    await login(app, original);

    const cookies = (await original.storageState()).cookies.filter(c => c.name === 'shop_session');
    expect(cookies.length).toBe(1);
    expect(Boolean(cookies[0].value)).toBe(true);
    // Keep the copied credential in memory only; do not log or attach storage state.
    const headers = { Cookie: `shop_session=${cookies[0].value}` };
    const expectedUser = { user: { id: app.users.alice.id, email: app.users.alice.email } };
    expect(await json(await replay.get('/api/me', { headers }), 200)).toEqual(expectedUser);

    expect((await original.post('/api/logout')).status()).toBe(204);
    expect(await json(await original.get('/api/me'), 401)).toEqual({ error: 'unauthenticated' });
    expect(await oracle('shop-logout', 'toBe', async () => json(await replay.get('/api/me', { headers }), 401))).toEqual({ error: 'unauthenticated' });
    expect(await json(await replay.get('/api/orders', { headers }), 401)).toEqual({ error: 'unauthenticated' });
  } finally {
    await Promise.all(contexts.map(context => context.dispose()));
  }
});

// Review finding 3: independent unit values distinguish compensating price errors.
test('each SKU has its contracted unit price and quantity ten is accepted', async ({ app, request }) => {
  await login(app, request);
  const cases = [
    { sku: 'TEA-50', quantity: 1, amount: 1200, key: 'tea-unit' },
    { sku: 'CUP-01', quantity: 1, amount: 1800, key: 'cup-unit' },
    { sku: 'TEA-50', quantity: 10, amount: 12000, key: 'tea-max' },
  ];
  const orderIDs = [];
  for (const example of cases) {
    await test.step(`${example.sku} x ${example.quantity} costs ${example.amount}`, async () => {
      const { order, replayed } = await createOrder(app, request, example.key, example.sku, example.quantity);
      expect(replayed).toBe(false);
      await oracle('shop-unit-prices', 'toMatchObject', () => expect(order).toMatchObject({
        id: expect.any(String), user_id: app.users.alice.id, currency: 'EUR',
        amount: example.amount, status: 'pending', fulfillment_count: 0,
      }));
      expect(order.items.map(({ sku, quantity }) => ({ sku, quantity }))).toEqual([
        { sku: example.sku, quantity: example.quantity },
      ]);
      const persisted = await json(await request.get(`${app.baseURL}/api/orders/${order.id}`), 200);
      expect(persisted.order).toEqual(order);
      orderIDs.push(order.id);
    });
  }
  expect(new Set(orderIDs).size).toBe(3);
  const listed = await json(await request.get(`${app.baseURL}/api/orders`), 200);
  expect(listed.orders.map(o => o.id).sort()).toEqual([...orderIDs].sort());
});

// Review finding 4: whitespace is signed and sent intact, never reserialized.
test('correctly signed noncanonical JSON is accepted and identical bytes replay once', async ({ app, request }) => {
  await login(app, request);
  const { order } = await createOrder(app, request, 'raw-payment', 'CUP-01', 1);
  expect(order.amount).toBe(1800);
  const event = {
    type: 'payment.succeeded',
    data: { currency: 'EUR', amount: 1800, order_id: order.id },
    id: 'evt-review-pretty-json',
  };
  const raw = ` \n${JSON.stringify(event, null, 2)}\n\t `;
  expect(JSON.parse(raw)).toEqual(event);
  expect(raw).not.toBe(JSON.stringify(event));

  // Broken input control: one extra transmitted byte invalidates the old signature.
  expect(await json(await signedRawEvent(app, request, `${raw}\n`, raw), 401))
    .toEqual({ error: 'invalid_signature' });
  const untouched = await state(app, request);
  expect(untouched.receipts).toHaveLength(0);
  expect(untouched.orders).toHaveLength(1);
  expect(untouched.orders[0]).toMatchObject({ id: order.id, status: 'pending', fulfillment_count: 0 });

  expect(await oracle('shop-signed-whitespace', 'toBe', async () => json(await signedRawEvent(app, request, raw), 200)))
    .toEqual({ received: true, duplicate: false, order_id: order.id });
  expect(await json(await signedRawEvent(app, request, raw), 200))
    .toEqual({ received: true, duplicate: true, order_id: order.id });
  const paid = await json(await request.get(`${app.baseURL}/api/orders/${order.id}`), 200);
  expect(paid.order).toMatchObject({ id: order.id, amount: 1800, status: 'paid', fulfillment_count: 1 });
  const durable = await state(app, request);
  expect(durable.receipts).toHaveLength(1);
  expect(durable.orders).toHaveLength(1);
  expect(durable.orders[0]).toMatchObject({ id: order.id, status: 'paid', fulfillment_count: 1 });
});
