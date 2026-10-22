import { test as base, expect } from '../../../support/fixtures.mjs';
import { BASKET, BASKET_AMOUNT, bySku, shopFixtures } from './helpers.mjs';

const test = base.extend(shopFixtures);

test('the server prices orders and rejects invalid ones without creating anything', async ({ app, shop }) => {
  const anonymous = await shop.session(null);
  expect((await shop.placeOrder(anonymous, 'anon-1')).status).toBe(401);
  expect((await anonymous.get('/api/orders')).status()).toBe(401);
  expect((await anonymous.get('/api/orders/any-id')).status()).toBe(401);

  const alice = await shop.session(app.users.alice);

  const missingKey = await alice.post('/api/orders', { data: BASKET });
  expect(missingKey.status(), 'Idempotency-Key is required').toBeGreaterThanOrEqual(400);
  expect(missingKey.status()).toBeLessThan(500);
  for (const badKey of ['has space', 'x'.repeat(129)]) {
    const res = await alice.post('/api/orders', { headers: { 'Idempotency-Key': badKey }, data: BASKET });
    expect(res.status(), `key ${badKey.slice(0, 12)} is rejected`).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  }

  const invalid = {
    'unknown sku': { currency: 'EUR', items: [{ sku: 'NOPE-1', quantity: 1 }] },
    'duplicate sku': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }] },
    'quantity 0': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 0 }] },
    'quantity 11': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 11 }] },
    'fractional quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1.5 }] },
    'string quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: '2' }] },
    'empty items': { currency: 'EUR', items: [] },
    'non-EUR currency': { currency: 'USD', items: [{ sku: 'TEA-50', quantity: 1 }] },
  };
  for (const [name, body] of Object.entries(invalid)) {
    const res = await shop.placeOrder(alice, `invalid-${name.replaceAll(' ', '-')}`, body);
    expect({ name, ...res }).toEqual({ name, status: 400, body: { error: 'invalid_order' } });
  }
  expect((await (await alice.get('/api/orders')).json()).orders).toEqual([]);
  expect((await shop.state()).orders).toEqual([]);

  // A client-supplied amount is ignored; the server recalculates from its own catalog.
  const priced = await shop.placeOrder(alice, 'priced-1', { ...BASKET, amount: 1 });
  expect(priced.status).toBe(201);
  expect(priced.body.replayed).toBe(false);
  const order = priced.body.order;
  expect(order).toMatchObject({
    user_id: 'alice', currency: 'EUR', amount: BASKET_AMOUNT, status: 'pending', fulfillment_count: 0,
  });
  expect(bySku(order.items)).toEqual(bySku(BASKET.items));

  const boundary = await shop.placeOrder(alice, 'priced-2', { currency: 'EUR', items: [{ sku: 'CUP-01', quantity: 10 }] });
  expect(boundary.status).toBe(201);
  expect(boundary.body.order.amount).toBe(18000);

  const listed = (await (await alice.get('/api/orders')).json()).orders.map((o) => o.id).sort();
  expect(listed).toEqual([order.id, boundary.body.order.id].sort());
  const fetched = await alice.get(`/api/orders/${order.id}`);
  expect(fetched.status()).toBe(200);
  expect((await fetched.json()).order).toEqual(order);
});

test('idempotency keys replay equivalent intent, reject conflicting reuse and belong to one user', async ({ app, shop }) => {
  const alice = await shop.session(app.users.alice);
  const bob = await shop.session(app.users.bob);

  const first = await shop.placeOrder(alice, 'checkout:1');
  expect(first.status).toBe(201);
  const order = first.body.order;

  const reordered = { currency: 'EUR', items: [...BASKET.items].reverse() };
  const replay = await shop.placeOrder(alice, 'checkout:1', reordered);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual({ order, replayed: true });

  const conflicts = {
    'different quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] },
    'different sku': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }] },
    // Checked against the existing key before currency validation, so this is a conflict rather than invalid_order.
    'different currency': { currency: 'USD', items: BASKET.items },
  };
  for (const [name, body] of Object.entries(conflicts)) {
    const res = await shop.placeOrder(alice, 'checkout:1', body);
    expect({ name, ...res }).toEqual({ name, status: 409, body: { error: 'idempotency_conflict' } });
  }

  // Bob may use the same key independently and gets his own order.
  const bobs = await shop.placeOrder(bob, 'checkout:1');
  expect(bobs.status).toBe(201);
  expect(bobs.body.replayed).toBe(false);
  expect(bobs.body.order.user_id).toBe('bob');
  expect(bobs.body.order.id).not.toBe(order.id);

  // Orders are visible only to their owner; someone else's ID looks exactly like an unknown one.
  const foreign = await bob.get(`/api/orders/${order.id}`);
  const unknown = await bob.get('/api/orders/00000000-0000-0000-0000-000000000000');
  expect(foreign.status()).toBe(404);
  expect(await foreign.json()).toEqual({ error: 'not_found' });
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({ error: 'not_found' });
  expect((await (await bob.get('/api/orders')).json()).orders.map((o) => o.id)).toEqual([bobs.body.order.id]);
  expect((await (await alice.get('/api/orders')).json()).orders.map((o) => o.id)).toEqual([order.id]);
  expect((await shop.state()).orders).toHaveLength(2);
});

test('parallel equivalent submissions with one key create exactly one order', async ({ app, shop }) => {
  const alice = await shop.session(app.users.alice);
  const attempts = 8;
  const results = await Promise.all(
    Array.from({ length: attempts }, () => shop.placeOrder(alice, 'double-click-1')),
  );

  const statuses = results.map((r) => r.status).sort();
  expect(statuses).toEqual([...Array(attempts - 1).fill(200), 201]);
  const ids = new Set(results.map((r) => r.body.order.id));
  expect(ids.size).toBe(1);
  expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);

  const [id] = ids;
  expect((await (await alice.get('/api/orders')).json()).orders.map((o) => o.id)).toEqual([id]);
  const stored = (await shop.state()).orders;
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id, amount: BASKET_AMOUNT, status: 'pending', fulfillment_count: 0 });
});
