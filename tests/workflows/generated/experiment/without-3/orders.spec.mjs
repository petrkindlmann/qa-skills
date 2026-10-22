import { test, expect, BASKET, BASKET_AMOUNT } from './helpers.mjs';

const sortItems = items => [...items].sort((a, b) => a.sku.localeCompare(b.sku));

test('server prices the basket, replays an equivalent key, and rejects conflicts and invalid baskets', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);

  const catalog = await (await alice.get('/api/catalog')).json();
  expect(catalog.currency).toBe('EUR');
  const price = sku => catalog.products.find(product => product.sku === sku)?.unit_amount;
  expect([price('TEA-50'), price('CUP-01')]).toEqual([1200, 1800]);

  const key = `checkout:${app.namespace}`;
  const created = await shop.createOrder(alice, key, { ...BASKET, amount: 1 });
  expect(created.status()).toBe(201);
  const { order, replayed } = await created.json();
  expect(replayed).toBe(false);
  expect(order).toMatchObject({ user_id: 'alice', currency: 'EUR', amount: BASKET_AMOUNT, status: 'pending', fulfillment_count: 0 });
  expect(sortItems(order.items)).toEqual(sortItems(BASKET.items));

  await test.step('equivalent retry with reordered items replays the original', async () => {
    const replay = await shop.createOrder(alice, key, { currency: 'EUR', items: [...BASKET.items].reverse() });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ order, replayed: true });
  });

  await test.step('changed intent under the same key is a conflict', async () => {
    const variants = {
      quantity: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] },
      sku: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }] },
      currency: { ...BASKET, currency: 'USD' },
    };
    for (const [change, body] of Object.entries(variants)) {
      const response = await shop.createOrder(alice, key, body);
      expect(response.status(), `different ${change}`).toBe(409);
      expect(await response.json()).toEqual({ error: 'idempotency_conflict' });
    }
  });

  await test.step('invalid baskets are rejected without creating an order', async () => {
    const invalid = {
      'unknown SKU': { currency: 'EUR', items: [{ sku: 'NOPE-1', quantity: 1 }] },
      'duplicate SKU': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 1 }] },
      'quantity 0': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 0 }] },
      'quantity 11': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 11 }] },
      'fractional quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1.5 }] },
      'string quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: '2' }] },
      'empty items': { currency: 'EUR', items: [] },
      'non-EUR currency': { currency: 'USD', items: [{ sku: 'TEA-50', quantity: 1 }] },
    };
    for (const [name, body] of Object.entries(invalid)) {
      const response = await shop.createOrder(alice, `invalid:${name.replaceAll(' ', '-')}`, body);
      expect(response.status(), name).toBe(400);
      expect(await response.json(), name).toEqual({ error: 'invalid_order' });
    }
  });

  await test.step('quantity bounds 1 and 10 are accepted', async () => {
    const response = await shop.createOrder(alice, `bounds:${app.namespace}`,
      { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 10 }, { sku: 'CUP-01', quantity: 1 }] });
    expect(response.status()).toBe(201);
    expect((await response.json()).order.amount).toBe(10 * 1200 + 1800);
  });

  const { orders } = await (await alice.get('/api/orders')).json();
  expect(orders.map(o => o.id)).toContain(order.id);
  expect(orders).toHaveLength(2);
  expect((await shop.state()).orders).toHaveLength(2);
});

test('orders are private to their owner, keys are per user, and every order endpoint needs a session', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const bob = await shop.signIn(app.users.bob);
  const sharedKey = 'same-key-for-both';

  const aliceOrder = (await (await shop.createOrder(alice, sharedKey)).json()).order;
  const bobResponse = await shop.createOrder(bob, sharedKey, { currency: 'EUR', items: [{ sku: 'CUP-01', quantity: 1 }] });
  expect(bobResponse.status(), 'another user reusing the key gets an independent order').toBe(201);
  const bobOrder = (await bobResponse.json()).order;
  expect(bobOrder).toMatchObject({ user_id: 'bob', amount: 1800 });
  expect(bobOrder.id).not.toBe(aliceOrder.id);

  const foreign = await bob.get(`/api/orders/${aliceOrder.id}`);
  const missing = await bob.get('/api/orders/00000000-0000-4000-8000-000000000000');
  expect([foreign.status(), missing.status()]).toEqual([404, 404]);
  expect(await foreign.json()).toEqual({ error: 'not_found' });
  expect(await missing.json()).toEqual({ error: 'not_found' });

  expect((await shop.orderAs(alice, aliceOrder.id)).id).toBe(aliceOrder.id);
  expect((await (await alice.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([aliceOrder.id]);
  expect((await (await bob.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([bobOrder.id]);

  const anonymous = await shop.client();
  const me = await anonymous.get('/api/me');
  expect(me.status()).toBe(401);
  expect(await me.json()).toEqual({ error: 'unauthenticated' });
  const unauthenticated = [
    await anonymous.get('/api/orders'),
    await anonymous.get(`/api/orders/${aliceOrder.id}`),
    await shop.createOrder(anonymous, 'anonymous-key'),
  ];
  expect(unauthenticated.map(response => response.status())).toEqual([401, 401, 401]);
  expect((await shop.state()).orders).toHaveLength(2);
});

test('parallel equivalent submissions create one order per user even when users share a key', async ({ app, shop }) => {
  const alice = await shop.signIn(app.users.alice);
  const bob = await shop.signIn(app.users.bob);
  const key = `burst:${app.namespace}`;
  const reordered = { currency: 'EUR', items: [...BASKET.items].reverse() };

  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    shop.createOrder(i % 2 ? alice : bob, key, i % 3 ? BASKET : reordered)
      .then(async response => ({ user: i % 2 ? 'alice' : 'bob', status: response.status(), body: await response.json() }))));

  for (const user of ['alice', 'bob']) {
    const mine = burst.filter(result => result.user === user);
    expect(mine.map(r => r.status).sort(), `${user} statuses`).toEqual([200, 200, 200, 200, 200, 201]);
    expect(mine.filter(r => r.body.replayed === false), `${user} non-replayed`).toHaveLength(1);
    expect(new Set(mine.map(r => r.body.order.id)).size, `${user} distinct order IDs`).toBe(1);
  }

  const { orders } = await shop.state();
  expect(orders.map(o => o.user_id).sort()).toEqual(['alice', 'bob']);
  expect(orders.every(o => o.amount === BASKET_AMOUNT && o.status === 'pending')).toBe(true);
  expect((await (await alice.get('/api/orders')).json()).orders).toHaveLength(1);
});
