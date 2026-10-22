import {
  test, expect, BASKET, BASKET_AMOUNT, byItem, createOrder, expectError, placeOrder, supportState,
} from './helpers.mjs';

test('server owns pricing and rejects invalid orders without creating any', async ({ app, clients }) => {
  const alice = await clients(app.users.alice);

  const created = await placeOrder(alice, { key: 'price-1', extra: { amount: 1 } });
  expect(created.status()).toBe(201);
  const { order, replayed } = await created.json();
  expect(replayed).toBe(false);
  expect(order).toMatchObject({ user_id: 'alice', currency: 'EUR', amount: BASKET_AMOUNT, status: 'pending', fulfillment_count: 0 });
  expect(byItem(order.items)).toEqual(byItem(BASKET));

  const invalid = {
    'unknown sku': { items: [{ sku: 'NOPE-1', quantity: 1 }] },
    'duplicate sku': { items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }] },
    'quantity 0': { items: [{ sku: 'TEA-50', quantity: 0 }] },
    'quantity 11': { items: [{ sku: 'TEA-50', quantity: 11 }] },
    'negative quantity': { items: [{ sku: 'TEA-50', quantity: -1 }] },
    'fractional quantity': { items: [{ sku: 'TEA-50', quantity: 1.5 }] },
    'string quantity': { items: [{ sku: 'TEA-50', quantity: '2' }] },
    'empty items': { items: [] },
    'non-EUR currency': { currency: 'USD', items: [{ sku: 'TEA-50', quantity: 1 }] },
  };
  for (const [name, body] of Object.entries(invalid)) {
    await test.step(name, async () => {
      await expectError(await placeOrder(alice, { key: `invalid-${name.replaceAll(' ', '-')}`, ...body }), 400, 'invalid_order');
    });
  }

  const boundary = await placeOrder(alice, { key: 'edge', items: [{ sku: 'TEA-50', quantity: 10 }, { sku: 'CUP-01', quantity: 1 }] });
  expect(boundary.status()).toBe(201);
  expect((await boundary.json()).order.amount).toBe(10 * 1200 + 1800);

  for (const key of [undefined, 'has space', 'semi;colon', 'x'.repeat(129)]) {
    const response = await placeOrder(alice, { key, items: [{ sku: 'CUP-01', quantity: 1 }] });
    expect(response.status(), `key ${JSON.stringify(key)}`).toBe(400);
  }
  const longestKey = 'aZ09._:-'.repeat(16);
  expect((await placeOrder(alice, { key: longestKey, items: [{ sku: 'CUP-01', quantity: 1 }] })).status()).toBe(201);

  const { orders } = await (await alice.get('/api/orders')).json();
  expect(orders).toHaveLength(3);
  expect((await supportState(alice, app)).orders).toHaveLength(3);
});

test('idempotency keys replay, conflict, survive parallel submits and stay per user', async ({ app, clients }) => {
  const alice = await clients(app.users.alice);
  const bob = await clients(app.users.bob);

  const original = await createOrder(alice, 'checkout-1');
  const replay = await placeOrder(alice, { key: 'checkout-1', items: [...BASKET].reverse() });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual({ order: original, replayed: true });

  await expectError(await placeOrder(alice, { key: 'checkout-1', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] }), 409, 'idempotency_conflict');
  await expectError(await placeOrder(alice, { key: 'checkout-1', items: [{ sku: 'TEA-50', quantity: 2 }] }), 409, 'idempotency_conflict');
  // Conflict is detected before the new request's currency would be rejected as invalid.
  await expectError(await placeOrder(alice, { key: 'checkout-1', currency: 'USD' }), 409, 'idempotency_conflict');

  const parallel = await Promise.all(Array.from({ length: 8 }, () => placeOrder(alice, { key: 'double-submit' })));
  const results = await Promise.all(parallel.map(async r => ({ status: r.status(), body: await r.json() })));
  expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
  expect(new Set(results.map(r => r.body.order.id)).size).toBe(1);
  expect(results.filter(r => r.body.replayed === false)).toHaveLength(1);

  const bobsOrder = await createOrder(bob, 'checkout-1', [{ sku: 'CUP-01', quantity: 2 }]);
  expect(bobsOrder).toMatchObject({ user_id: 'bob', amount: 3600 });
  expect(bobsOrder.id).not.toBe(original.id);

  const aliceOrders = (await (await alice.get('/api/orders')).json()).orders;
  expect(aliceOrders.map(o => o.id).sort()).toEqual([original.id, results[0].body.order.id].sort());
  expect((await (await bob.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([bobsOrder.id]);

  expect(await (await alice.get(`/api/orders/${original.id}`)).json()).toEqual({ order: original });
  const foreign = await bob.get(`/api/orders/${original.id}`);
  const unknown = await bob.get('/api/orders/00000000-0000-0000-0000-000000000000');
  await expectError(foreign, 404, 'not_found');
  await expectError(unknown, 404, 'not_found');
  expect(await foreign.text()).toBe(await unknown.text());

  expect((await supportState(alice, app)).orders).toHaveLength(3);
});
