import { test, expect, placeOrder, TEA_AND_CUP } from './helpers.mjs';

test('orders are priced by the server and invalid carts create nothing', async ({ app, client, admin }) => {
  const alice = await client(app.users.alice);

  const priced = await placeOrder(alice, 'priced-1', { currency: 'EUR', amount: 1, items: TEA_AND_CUP });
  expect(priced.status()).toBe(201);
  const { order, replayed } = await priced.json();
  expect(replayed).toBe(false);
  expect(order).toMatchObject({ user_id: 'alice', currency: 'EUR', amount: 4200, status: 'pending', fulfillment_count: 0 });

  const maxQuantity = await placeOrder(alice, 'priced-2', { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 10 }] });
  expect(maxQuantity.status()).toBe(201);
  expect((await maxQuantity.json()).order.amount).toBe(12000);

  const invalidCarts = {
    'unknown sku': { currency: 'EUR', items: [{ sku: 'NOPE-99', quantity: 1 }] },
    'duplicate sku': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }] },
    'zero quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 0 }] },
    'quantity 11': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 11 }] },
    'fractional quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1.5 }] },
    'string quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: '2' }] },
    'empty items': { currency: 'EUR', items: [] },
    'non-EUR currency': { currency: 'USD', items: TEA_AND_CUP },
  };
  for (const [name, body] of Object.entries(invalidCarts)) {
    const response = await placeOrder(alice, `invalid-${name.replaceAll(' ', '-')}`, body);
    expect(response.status(), name).toBe(400);
    expect(await response.json(), name).toEqual({ error: 'invalid_order' });
  }

  for (const [name, headers] of Object.entries({
    'missing key': {},
    'key with spaces': { 'Idempotency-Key': 'has spaces' },
    'key over 128 chars': { 'Idempotency-Key': 'k'.repeat(129) },
  })) {
    const response = await alice.post('/api/orders', { headers, data: { currency: 'EUR', items: TEA_AND_CUP } });
    expect(response.status(), name).toBeGreaterThanOrEqual(400);
    expect(response.status(), name).toBeLessThan(500);
  }

  const listed = (await (await alice.get('/api/orders')).json()).orders;
  expect(listed.map(o => o.amount).sort((a, b) => a - b)).toEqual([4200, 12000]);
  expect((await admin.state()).orders).toHaveLength(2);
});

test('idempotency keys replay, conflict, stay per user and collapse parallel submissions', async ({ app, client, admin }) => {
  const alice = await client(app.users.alice);
  const bob = await client(app.users.bob);

  const first = await placeOrder(alice, 'checkout-1');
  expect(first.status()).toBe(201);
  const original = (await first.json()).order;

  const replay = await placeOrder(alice, 'checkout-1', { currency: 'EUR', items: [...TEA_AND_CUP].reverse() });
  expect(replay.status(), 'item order does not change intent').toBe(200);
  expect(await replay.json()).toEqual({ order: original, replayed: true });

  const conflicts = {
    'different quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] },
    'different sku': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }] },
    'different currency': { currency: 'USD', items: TEA_AND_CUP },
  };
  for (const [name, body] of Object.entries(conflicts)) {
    const response = await placeOrder(alice, 'checkout-1', body);
    expect(response.status(), name).toBe(409);
    expect(await response.json(), name).toEqual({ error: 'idempotency_conflict' });
  }

  const bobs = await placeOrder(bob, 'checkout-1');
  expect(bobs.status(), 'another user may reuse the key').toBe(201);
  const bobOrder = (await bobs.json()).order;
  expect(bobOrder.user_id).toBe('bob');
  expect(bobOrder.id).not.toBe(original.id);

  const burst = await Promise.all(Array.from({ length: 10 }, () => placeOrder(alice, 'double-click')));
  const bodies = await Promise.all(burst.map(response => response.json()));
  expect(burst.map(r => r.status()).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
  expect(new Set(bodies.map(body => body.order.id)).size, 'parallel equivalent submissions share one order').toBe(1);
  expect(bodies.filter(body => body.replayed === false)).toHaveLength(1);

  const orders = (await admin.state()).orders;
  expect(orders.filter(o => o.user_id === 'alice')).toHaveLength(2);
  expect(orders.filter(o => o.user_id === 'bob')).toHaveLength(1);
});

test('orders are visible only to their owner', async ({ app, client }) => {
  const alice = await client(app.users.alice);
  const bob = await client(app.users.bob);
  const aliceOrder = (await (await placeOrder(alice, 'private-1')).json()).order;
  const bobOrder = (await (await placeOrder(bob, 'private-1', { currency: 'EUR', items: [{ sku: 'CUP-01', quantity: 1 }] })).json()).order;

  const own = await alice.get(`/api/orders/${aliceOrder.id}`);
  expect(own.status()).toBe(200);
  expect(await own.json()).toEqual({ order: aliceOrder });

  const foreign = await bob.get(`/api/orders/${aliceOrder.id}`);
  const unknown = await bob.get('/api/orders/00000000-0000-0000-0000-000000000000');
  expect(foreign.status()).toBe(404);
  expect(unknown.status()).toBe(404);
  expect(await foreign.json()).toEqual({ error: 'not_found' });
  expect(await foreign.text(), 'foreign and unknown IDs are indistinguishable').toBe(await unknown.text());

  expect((await (await alice.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([aliceOrder.id]);
  expect((await (await bob.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([bobOrder.id]);
});
