import { test, expect, BASKET, BASKET_AMOUNT, createOrder, getOrder } from './shop-helpers.mjs';

test('the server prices orders from its catalogue and rejects invalid baskets without creating orders', async ({ app, client, admin }) => {
  const catalog = await (await client()).get('/api/catalog');
  expect(catalog.status()).toBe(200);
  const { currency, products } = await catalog.json();
  expect(currency).toBe('EUR');
  expect(Object.fromEntries(products.map(p => [p.sku, p.unit_amount]))).toMatchObject({ 'TEA-50': 1200, 'CUP-01': 1800 });

  const alice = await client(app.users.alice);
  const created = await createOrder(alice, 'priced-1', BASKET, { amount: 1 });
  expect(created.status()).toBe(201);
  const { order, replayed } = await created.json();
  expect(replayed).toBe(false);
  expect(order).toMatchObject({ user_id: 'alice', currency: 'EUR', amount: BASKET_AMOUNT, status: 'pending', fulfillment_count: 0 });
  expect(order.items).toHaveLength(2);
  expect(order.items).toEqual(expect.arrayContaining(BASKET));

  const invalidBaskets = {
    'unknown SKU': { currency: 'EUR', items: [{ sku: 'NOPE-99', quantity: 1 }] },
    'duplicate SKU': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 1 }] },
    'zero quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 0 }] },
    'quantity above 10': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 11 }] },
    'fractional quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1.5 }] },
    'string quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: '2' }] },
    'empty items': { currency: 'EUR', items: [] },
    'non-EUR currency': { currency: 'USD', items: [{ sku: 'TEA-50', quantity: 1 }] },
  };
  for (const [name, data] of Object.entries(invalidBaskets)) {
    const response = await alice.post('/api/orders', { headers: { 'Idempotency-Key': `invalid-${name.replaceAll(' ', '-')}` }, data });
    expect(response.status(), name).toBe(400);
    expect(await response.json(), name).toEqual({ error: 'invalid_order' });
  }

  // The contract requires a well-formed key but does not name the status, so any client error is accepted.
  const badKeys = { missing: undefined, empty: '', 'too long': 'k'.repeat(129), 'with space': 'has space', 'with slash': 'a/b' };
  for (const [name, key] of Object.entries(badKeys)) {
    const headers = key === undefined ? {} : { 'Idempotency-Key': key };
    const response = await alice.post('/api/orders', { headers, data: { currency: 'EUR', items: BASKET } });
    expect(response.status(), `idempotency key ${name}`).toBeGreaterThanOrEqual(400);
    expect(response.status(), `idempotency key ${name}`).toBeLessThan(500);
  }

  const longestKey = 'aZ09._:-'.repeat(16);
  const boundary = await createOrder(alice, longestKey, [{ sku: 'TEA-50', quantity: 10 }]);
  expect(boundary.status()).toBe(201);
  expect((await boundary.json()).order.amount).toBe(12000);

  const listed = await (await alice.get('/api/orders')).json();
  expect(listed.orders).toHaveLength(2);
  expect((await admin.state()).orders).toHaveLength(2);
});

test('idempotency keys replay, conflict and stay per user, and parallel submits create one order', async ({ app, client, admin }) => {
  const alice = await client(app.users.alice);
  const bob = await client(app.users.bob);

  const first = await createOrder(alice, 'checkout-1');
  expect(first.status()).toBe(201);
  const original = (await first.json()).order;

  const replay = await createOrder(alice, 'checkout-1', [...BASKET].reverse());
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual({ order: original, replayed: true });

  const conflicts = {
    quantity: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] },
    sku: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }] },
    // Must be a conflict, not invalid_order: the key is checked before currency validation.
    currency: { currency: 'USD', items: BASKET },
  };
  for (const [name, data] of Object.entries(conflicts)) {
    const response = await alice.post('/api/orders', { headers: { 'Idempotency-Key': 'checkout-1' }, data });
    expect(response.status(), `different ${name}`).toBe(409);
    expect(await response.json(), `different ${name}`).toEqual({ error: 'idempotency_conflict' });
  }

  const bobs = await createOrder(bob, 'checkout-1');
  expect(bobs.status()).toBe(201);
  const bobOrder = (await bobs.json()).order;
  expect(bobOrder.user_id).toBe('bob');
  expect(bobOrder.id).not.toBe(original.id);

  const burst = await Promise.all(Array.from({ length: 8 }, () => createOrder(alice, 'checkout-2')));
  const bodies = await Promise.all(burst.map(response => response.json()));
  expect(burst.map(response => response.status()).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
  expect(bodies.filter(body => body.replayed === false)).toHaveLength(1);
  expect(new Set(bodies.map(body => body.order.id)).size).toBe(1);

  const { orders } = await admin.state();
  expect(orders.filter(order => order.user_id === 'alice')).toHaveLength(2);
  expect(orders.filter(order => order.user_id === 'bob')).toHaveLength(1);
});

test("orders are private: another user's order is indistinguishable from an unknown ID", async ({ app, client }) => {
  const alice = await client(app.users.alice);
  const bob = await client(app.users.bob);
  const aliceOrder = (await (await createOrder(alice, 'mine')).json()).order;
  const bobOrder = (await (await createOrder(bob, 'mine', [{ sku: 'CUP-01', quantity: 1 }])).json()).order;

  const foreign = await bob.get(`/api/orders/${aliceOrder.id}`);
  const unknown = await bob.get('/api/orders/00000000-0000-0000-0000-000000000000');
  expect(foreign.status()).toBe(404);
  expect(unknown.status()).toBe(404);
  expect(await foreign.json()).toEqual({ error: 'not_found' });
  expect(await unknown.json()).toEqual({ error: 'not_found' });

  expect((await (await alice.get('/api/orders')).json()).orders.map(order => order.id)).toEqual([aliceOrder.id]);
  expect((await (await bob.get('/api/orders')).json()).orders.map(order => order.id)).toEqual([bobOrder.id]);
  expect(await getOrder(alice, aliceOrder.id)).toEqual(aliceOrder);
});
