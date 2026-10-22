import {
  test, expect, EXAMPLE_ITEMS, signIn, signedInClient, postOrder, createOrder, expectOrderShape,
  expectError, fixtureState, sortItems,
} from './helpers.mjs';

test('server owns prices and rejects invalid orders without creating one', async ({ app, clients }) => {
  const api = await clients();

  await test.step('health and catalogue', async () => {
    const health = await api.get('/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', build: 'shop-lab-v1' });
    const catalog = await (await api.get('/api/catalog')).json();
    expect(catalog.currency).toBe('EUR');
    // The contract names the prices but not the field, so look for the value on each product.
    const bySku = Object.fromEntries(catalog.products.map(p => [p.sku, Object.values(p)]));
    expect(bySku['TEA-50']).toContain(1200);
    expect(bySku['CUP-01']).toContain(1800);
  });

  await signIn(api, app.users.alice);

  await test.step('amounts are recalculated from the catalogue', async () => {
    const example = await createOrder(api, 'price-example', { currency: 'EUR', items: EXAMPLE_ITEMS, amount: 1 });
    expect(example).toMatchObject({ user_id: 'alice', amount: 4200, status: 'pending', fulfillment_count: 0 });
    expect(sortItems(example.items)).toEqual(sortItems(EXAMPLE_ITEMS));
    expect((await createOrder(api, 'price-tea-max', { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 10 }] })).amount)
      .toBe(12000);
    expect((await createOrder(api, 'price-cup-min', { currency: 'EUR', items: [{ sku: 'CUP-01', quantity: 1 }], amount: 99999 })).amount)
      .toBe(1800);
  });

  await test.step('invalid bodies are 400 invalid_order', async () => {
    const invalid = {
      'quantity 0': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 0 }] },
      'quantity 11': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 11 }] },
      'fractional quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1.5 }] },
      'string quantity': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: '2' }] },
      'unknown sku': { currency: 'EUR', items: [{ sku: 'NOPE-1', quantity: 1 }] },
      'duplicate sku': { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }] },
      'empty items': { currency: 'EUR', items: [] },
      'non-EUR currency': { currency: 'USD', items: [{ sku: 'TEA-50', quantity: 1 }] },
    };
    for (const [name, body] of Object.entries(invalid)) {
      const response = await postOrder(api, `invalid-${name.replaceAll(' ', '-')}`, body);
      expect(response.status(), name).toBe(400);
      expect(await response.json(), name).toEqual({ error: 'invalid_order' });
    }
  });

  await test.step('a missing or malformed Idempotency-Key is refused', async () => {
    const noKey = await api.post('/api/orders', { data: { currency: 'EUR', items: EXAMPLE_ITEMS } });
    expect(noKey.status()).toBeGreaterThanOrEqual(400);
    expect(noKey.status()).toBeLessThan(500);
    const badKey = await postOrder(api, 'has space!');
    expect(badKey.status()).toBeGreaterThanOrEqual(400);
    expect(badKey.status()).toBeLessThan(500);
    const tooLong = await postOrder(api, 'k'.repeat(129));
    expect(tooLong.status()).toBeGreaterThanOrEqual(400);
    expect(tooLong.status()).toBeLessThan(500);
  });

  await test.step('only the three valid orders exist', async () => {
    const { orders } = await (await api.get('/api/orders')).json();
    expect(orders.map(o => o.amount).sort((a, b) => a - b)).toEqual([1800, 4200, 12000]);
    orders.forEach(expectOrderShape);
    expect((await fixtureState(api, app)).orders).toHaveLength(3);
  });
});

test('idempotency keys replay, conflict and stay private to each user', async ({ app, clients }) => {
  const alice = await signedInClient(clients, app.users.alice);
  const bob = await signedInClient(clients, app.users.bob);
  const key = 'checkout:2026-10-22.a_1';
  const original = await createOrder(alice, key);

  await test.step('equivalent retries replay the original order', async () => {
    for (const items of [EXAMPLE_ITEMS, [...EXAMPLE_ITEMS].reverse()]) {
      const replay = await postOrder(alice, key, { currency: 'EUR', items });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toEqual({ order: original, replayed: true });
    }
  });

  await test.step('a changed quantity, SKU or currency is 409', async () => {
    const changed = [
      { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] },
      { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }] },
      { currency: 'USD', items: EXAMPLE_ITEMS },
    ];
    for (const body of changed) await expectError(await postOrder(alice, key, body), 409, 'idempotency_conflict');
  });

  await test.step('another user may use the same key independently', async () => {
    const bobsOrder = await createOrder(bob, key);
    expect(bobsOrder.id).not.toBe(original.id);
    expect(bobsOrder.user_id).toBe('bob');
  });

  await test.step('orders are visible only to their owner', async () => {
    const own = await alice.get(`/api/orders/${original.id}`);
    expect(own.status()).toBe(200);
    expect(await own.json()).toEqual({ order: original });
    await expectError(await bob.get(`/api/orders/${original.id}`), 404, 'not_found');
    await expectError(await bob.get('/api/orders/00000000-0000-0000-0000-000000000000'), 404, 'not_found');
    const bobsList = (await (await bob.get('/api/orders')).json()).orders;
    expect(bobsList.map(o => o.user_id)).toEqual(['bob']);
    const alicesList = (await (await alice.get('/api/orders')).json()).orders;
    expect(alicesList.map(o => o.id)).toEqual([original.id]);
  });
});

test('concurrent duplicate submissions create one durable order across restart', async ({ app, clients }) => {
  const api = await signedInClient(clients, app.users.alice);
  const key = 'burst-order-1';
  const responses = await Promise.all(Array.from({ length: 8 }, () => postOrder(api, key)));
  const results = await Promise.all(responses.map(async r => ({ status: r.status(), body: await r.json() })));

  expect(results.map(r => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
  const ids = new Set(results.map(r => r.body.order.id));
  expect(ids.size).toBe(1);
  expect(results.filter(r => r.body.replayed === false)).toHaveLength(1);
  const [orderId] = ids;
  expect((await fixtureState(api, app)).orders.map(o => o.id)).toEqual([orderId]);

  await app.restart();

  const afterRestart = await signedInClient(clients, app.users.alice);
  const replay = await postOrder(afterRestart, key);
  expect(replay.status()).toBe(200);
  const body = await replay.json();
  expect(body.replayed).toBe(true);
  expect(body.order).toMatchObject({ id: orderId, amount: 4200, status: 'pending', fulfillment_count: 0 });
  const listed = (await (await afterRestart.get('/api/orders')).json()).orders;
  expect(listed.map(o => o.id)).toEqual([orderId]);
});
