import { test, expect } from '../../../support/fixtures.mjs';
import { expectOrder, orderBody, postOrder, signIn, sortItems, supportState } from './helpers.mjs';

const TEA = 'TEA-50';
const CUP = 'CUP-01';

test('server-owned pricing across compositions and quantity boundaries', async ({ app }) => {
  const alice = await signIn(app, app.users.alice);
  try {
    const catalog = await (await alice.get('/api/catalog')).json();
    expect(catalog.currency).toBe('EUR');
    const prices = Object.fromEntries(catalog.products.map(p => [p.sku, p.unit_amount]));
    expect(prices).toMatchObject({ [TEA]: 1200, [CUP]: 1800 });

    // Unit prices are known independently (1200, 1800); several compositions guard
    // against compensating errors, and quantities 1 and 10 are the accepted bounds.
    const cases = [
      { key: 'price-mixed', items: [{ sku: TEA, quantity: 2 }, { sku: CUP, quantity: 1 }], amount: 4200 },
      { key: 'price-min', items: [{ sku: TEA, quantity: 1 }], amount: 1200 },
      { key: 'price-max', items: [{ sku: CUP, quantity: 10 }], amount: 18000 },
      { key: 'price-both-max', items: [{ sku: CUP, quantity: 10 }, { sku: TEA, quantity: 10 }], amount: 30000 },
    ];
    const created = [];
    for (const c of cases) {
      // A client-supplied amount must be ignored.
      const response = await postOrder(alice, c.key, orderBody(c.items, 'EUR', { amount: 1 }));
      expect(response.status(), c.key).toBe(201);
      const body = await response.json();
      expect(body.replayed).toBe(false);
      expectOrder(body.order, {
        user_id: 'alice', currency: 'EUR', amount: c.amount, items: c.items, status: 'pending', fulfillment_count: 0,
      });
      created.push(body.order);
    }

    for (const order of created) {
      const read = await alice.get(`/api/orders/${order.id}`);
      expect(read.status()).toBe(200);
      expect(await read.json()).toEqual({ order });
    }
    const list = await (await alice.get('/api/orders')).json();
    expect(list.orders.map(o => o.id).sort()).toEqual(created.map(o => o.id).sort());
  } finally {
    await alice.dispose();
  }
});

test('invalid orders are rejected without creating anything', async ({ app }) => {
  const alice = await signIn(app, app.users.alice);
  try {
    const invalid = {
      'quantity zero': orderBody([{ sku: TEA, quantity: 0 }]),
      'quantity eleven': orderBody([{ sku: TEA, quantity: 11 }]),
      'fractional quantity': orderBody([{ sku: TEA, quantity: 2.5 }]),
      'string quantity': orderBody([{ sku: TEA, quantity: '2' }]),
      'unknown sku': orderBody([{ sku: 'NOPE-99', quantity: 1 }]),
      'duplicate sku': orderBody([{ sku: TEA, quantity: 1 }, { sku: TEA, quantity: 2 }]),
      'empty items': orderBody([]),
      'non-EUR currency': orderBody([{ sku: TEA, quantity: 1 }], 'USD'),
    };
    let n = 0;
    for (const [name, body] of Object.entries(invalid)) {
      const response = await postOrder(alice, `invalid-${n++}`, body);
      expect(response.status(), name).toBe(400);
      expect(await response.json(), name).toEqual({ error: 'invalid_order' });
    }

    const valid = orderBody([{ sku: TEA, quantity: 1 }]);
    const missingKey = await postOrder(alice, undefined, valid);
    expect(missingKey.status(), 'missing Idempotency-Key').toBeGreaterThanOrEqual(400);
    expect(missingKey.status(), 'missing Idempotency-Key').toBeLessThan(500);
    for (const badKey of ['has space', 'slash/key', 'k'.repeat(129)]) {
      const response = await postOrder(alice, badKey, valid);
      expect(response.status(), `key ${badKey.slice(0, 20)}`).toBeGreaterThanOrEqual(400);
      expect(response.status(), `key ${badKey.slice(0, 20)}`).toBeLessThan(500);
    }

    expect((await (await alice.get('/api/orders')).json()).orders).toEqual([]);
    expect((await supportState(app)).orders).toEqual([]);

    // Healthy control: the longest key using every allowed character class is accepted.
    const longestKey = `Ab9._:-${'x'.repeat(121)}`;
    expect(longestKey).toHaveLength(128);
    const accepted = await postOrder(alice, longestKey, valid);
    expect(accepted.status()).toBe(201);
    expect((await supportState(app)).orders).toHaveLength(1);
  } finally {
    await alice.dispose();
  }
});

test('idempotency keys replay, conflict and stay scoped to their owner', async ({ app }) => {
  const alice = await signIn(app, app.users.alice);
  const bob = await signIn(app, app.users.bob);
  try {
    const key = 'checkout:2026-10-22.1';
    const items = [{ sku: TEA, quantity: 2 }, { sku: CUP, quantity: 1 }];
    const first = await postOrder(alice, key, orderBody(items));
    expect(first.status()).toBe(201);
    const original = (await first.json()).order;

    await test.step('equivalent replay (items reordered) returns the original order', async () => {
      const replay = await postOrder(alice, key, orderBody([...items].reverse()));
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual({ order: original, replayed: true });
    });

    await test.step('same key with different intent is a conflict', async () => {
      const variants = {
        quantity: orderBody([{ sku: TEA, quantity: 3 }, { sku: CUP, quantity: 1 }]),
        sku: orderBody([{ sku: TEA, quantity: 2 }]),
        currency: orderBody(items, 'USD'),
      };
      for (const [name, body] of Object.entries(variants)) {
        const response = await postOrder(alice, key, body);
        expect(response.status(), name).toBe(409);
        expect(await response.json(), name).toEqual({ error: 'idempotency_conflict' });
      }
    });

    let bobOrder;
    await test.step('another user may use the same key independently', async () => {
      const response = await postOrder(bob, key, orderBody([{ sku: CUP, quantity: 1 }]));
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body.replayed).toBe(false);
      bobOrder = body.order;
      expectOrder(bobOrder, { user_id: 'bob', amount: 1800, status: 'pending', fulfillment_count: 0 });
      expect(bobOrder.id).not.toBe(original.id);
    });

    await test.step('orders are visible only to their owner; foreign and unknown IDs look identical', async () => {
      const foreign = await bob.get(`/api/orders/${original.id}`);
      const unknown = await bob.get('/api/orders/00000000-0000-0000-0000-000000000000');
      expect(foreign.status()).toBe(404);
      expect(unknown.status()).toBe(404);
      expect(await foreign.json()).toEqual({ error: 'not_found' });
      expect(await unknown.json()).toEqual({ error: 'not_found' });
      expect((await alice.get(`/api/orders/${original.id}`)).status()).toBe(200);
      expect((await (await alice.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([original.id]);
      expect((await (await bob.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([bobOrder.id]);
    });

    const state = await supportState(app);
    expect(state.orders).toHaveLength(2);
    const stored = state.orders.find(o => o.id === original.id);
    expect(stored.amount).toBe(4200);
    expect(sortItems(stored.items)).toEqual(sortItems(items));
  } finally {
    await alice.dispose();
    await bob.dispose();
  }
});

test('parallel duplicate submissions create one order that survives a restart', async ({ app }) => {
  const key = 'burst-key-1';
  const items = [{ sku: TEA, quantity: 3 }, { sku: CUP, quantity: 2 }];
  let orderId;
  const alice = await signIn(app, app.users.alice);
  try {
    const bodies = Array.from({ length: 8 }, (_, i) => orderBody(i % 2 ? [...items].reverse() : items));
    const responses = await Promise.all(bodies.map(body => postOrder(alice, key, body)));
    const results = await Promise.all(responses.map(async r => ({ status: r.status(), body: await r.json() })));

    expect(results.filter(r => r.status === 201 && r.body.replayed === false), JSON.stringify(results)).toHaveLength(1);
    expect(results.filter(r => r.status === 200 && r.body.replayed === true)).toHaveLength(7);
    orderId = results[0].body.order.id;
    for (const r of results) expectOrder(r.body.order, { id: orderId, amount: 7200, items });
    expect((await supportState(app)).orders.map(o => o.id)).toEqual([orderId]);
  } finally {
    await alice.dispose();
  }

  await app.restart();

  const afterRestart = await signIn(app, app.users.alice);
  try {
    const replay = await postOrder(afterRestart, key, orderBody(items));
    expect(replay.status()).toBe(200);
    const body = await replay.json();
    expect(body.replayed).toBe(true);
    expectOrder(body.order, { id: orderId, amount: 7200, status: 'pending', fulfillment_count: 0 });
    const conflict = await postOrder(afterRestart, key, orderBody([{ sku: TEA, quantity: 1 }]));
    expect(conflict.status()).toBe(409);
    expect((await (await afterRestart.get('/api/orders')).json()).orders.map(o => o.id)).toEqual([orderId]);
    expect((await supportState(app)).orders).toHaveLength(1);
  } finally {
    await afterRestart.dispose();
  }
});
