import { test, expect, EXAMPLE_ITEMS, EXAMPLE_AMOUNT, sameItems } from './helpers.mjs';

test('orders are priced by the server and invalid carts create nothing', async ({ app, shop }) => {
  const anonymous = await shop.client();
  for (const response of [
    await shop.placeOrder(anonymous, 'anon-1'),
    await anonymous.get('/api/orders'),
    await anonymous.get('/api/orders/anything'),
  ]) {
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
  }

  const api = await shop.signIn(app.users.alice);
  const invalid = {
    'unknown sku': { currency: 'EUR', items: [{ sku: 'NOPE-00', quantity: 1 }] },
    'duplicate sku': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }] },
    'fractional quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1.5 }] },
    'zero quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 0 }] },
    'quantity above 10': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 11 }] },
    'empty items': { currency: 'EUR', items: [] },
    'non-EUR currency': { currency: 'USD', items: EXAMPLE_ITEMS },
  };
  for (const [name, body] of Object.entries(invalid)) {
    const response = await shop.placeOrder(api, `invalid-${name.replaceAll(' ', '-')}`, body);
    expect(response.status(), name).toBe(400);
    expect(await response.json(), name).toEqual({ error: 'invalid_order' });
  }
  for (const key of [null, '', 'has space', 'x'.repeat(129)]) {
    const headers = key === null ? {} : { 'Idempotency-Key': key };
    const response = await api.post('/api/orders', { headers, data: { currency: 'EUR', items: EXAMPLE_ITEMS } });
    expect(response.status(), `idempotency key ${JSON.stringify(key)}`).toBe(400);
  }
  expect((await (await api.get('/api/orders')).json()).orders).toEqual([]);
  expect((await shop.state()).orders).toEqual([]);

  const tampered = await shop.placeOrder(api, 'k.1:A_b-' + 'x'.repeat(120), { currency: 'EUR', amount: 1, items: EXAMPLE_ITEMS });
  expect(tampered.status()).toBe(201);
  const { order, replayed } = await tampered.json();
  expect(replayed).toBe(false);
  expect(order).toMatchObject({ user_id: 'alice', currency: 'EUR', amount: EXAMPLE_AMOUNT, status: 'pending', fulfillment_count: 0 });
  sameItems(order.items, EXAMPLE_ITEMS);

  const maxQuantity = await shop.createOrder(api, 'max-qty', [{ sku: 'CUP-01', quantity: 10 }]);
  expect(maxQuantity.amount).toBe(18000);

  const listed = (await (await api.get('/api/orders')).json()).orders;
  expect(listed.map((o) => o.id).sort()).toEqual([order.id, maxQuantity.id].sort());
  const stored = (await shop.state()).orders.find((o) => o.id === order.id);
  expect(stored).toMatchObject({ amount: EXAMPLE_AMOUNT, status: 'pending', fulfillment_count: 0 });
});

test('idempotency keys replay, conflict and stay single under parallel submission', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const bob = await shop.signIn(app.users.bob);

  const burst = await Promise.all(Array.from({ length: 10 }, () => shop.placeOrder(alice, 'burst-key')));
  const bodies = await Promise.all(burst.map((r) => r.json()));
  const statuses = burst.map((r) => r.status());
  expect(statuses.filter((s) => s === 201), `statuses ${statuses}`).toHaveLength(1);
  expect(statuses.filter((s) => s === 200)).toHaveLength(9);
  const orderId = bodies[statuses.indexOf(201)].order.id;
  for (const [i, body] of bodies.entries()) {
    expect(body.order.id).toBe(orderId);
    expect(body.replayed).toBe(statuses[i] === 200);
  }

  const reordered = await shop.placeOrder(alice, 'burst-key', { currency: 'EUR', items: [...EXAMPLE_ITEMS].reverse() });
  expect(reordered.status()).toBe(200);
  expect(await reordered.json()).toMatchObject({ replayed: true, order: { id: orderId, amount: EXAMPLE_AMOUNT } });

  const conflicts = {
    quantity: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] },
    sku: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }] },
    // Must be reported as a conflict even though USD alone would be invalid_order.
    currency: { currency: 'USD', items: EXAMPLE_ITEMS },
  };
  for (const [name, body] of Object.entries(conflicts)) {
    const response = await shop.placeOrder(alice, 'burst-key', body);
    expect(response.status(), name).toBe(409);
    expect(await response.json(), name).toEqual({ error: 'idempotency_conflict' });
  }

  const bobOrder = await shop.placeOrder(bob, 'burst-key');
  expect(bobOrder.status()).toBe(201);
  const { order: bobsOrder } = await bobOrder.json();
  expect(bobsOrder.id).not.toBe(orderId);
  expect(bobsOrder.user_id).toBe('bob');

  expect((await (await alice.get('/api/orders')).json()).orders.map((o) => o.id)).toEqual([orderId]);
  const state = await shop.state();
  expect(state.orders.filter((o) => o.user_id === 'alice')).toHaveLength(1);
  expect(state.orders.filter((o) => o.user_id === 'bob')).toHaveLength(1);
});

test("a user cannot see another user's orders", async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const bob = await shop.signIn(app.users.bob);
  const order = await shop.createOrder(alice, 'private-order');

  const own = await alice.get(`/api/orders/${order.id}`);
  expect(own.status()).toBe(200);
  expect((await own.json()).order).toEqual(order);

  const foreign = await bob.get(`/api/orders/${order.id}`);
  const unknown = await bob.get('/api/orders/00000000-0000-0000-0000-000000000000');
  expect(foreign.status()).toBe(404);
  expect(unknown.status()).toBe(404);
  expect(await foreign.text()).toBe(await unknown.text());
  expect(await foreign.json()).toEqual({ error: 'not_found' });
  expect((await (await bob.get('/api/orders')).json()).orders).toEqual([]);
});
