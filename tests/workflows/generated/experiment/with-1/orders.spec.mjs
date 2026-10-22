import { randomUUID } from 'node:crypto';
import { test, expect, PRICE, TEA2_CUP1, burst, placeOrder, createOrder, itemsOf, signIn } from './helpers.mjs';

const orderShape = (overrides) => ({
  id: expect.any(String), user_id: 'alice', currency: 'EUR', amount: expect.any(Number),
  items: expect.any(Array), status: 'pending', fulfillment_count: 0, ...overrides,
});

test('server owns prices and rejects invalid orders without creating one', async ({ app, clients }) => {
  const alice = await clients.signedIn(app.users.alice);

  await test.step('health and catalog publish the build and server prices in EUR', async () => {
    const health = await alice.get('/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', build: 'shop-lab-v1' });

    const response = await alice.get('/api/catalog');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const catalog = await response.json();
    expect(catalog.currency).toBe('EUR');
    const prices = Object.fromEntries(catalog.products.map(product => [product.sku, product.unit_amount]));
    expect(prices).toEqual(expect.objectContaining(PRICE));
  });

  const accepted = [];
  await test.step('totals are recalculated from the catalog for several compositions', async () => {
    const cases = [
      { items: TEA2_CUP1, amount: 2 * PRICE['TEA-50'] + PRICE['CUP-01'] },
      { items: [{ sku: 'TEA-50', quantity: 1 }], amount: PRICE['TEA-50'] },
      { items: [{ sku: 'CUP-01', quantity: 10 }], amount: 10 * PRICE['CUP-01'] },
    ];
    expect(cases[0].amount, 'contract example total').toBe(4200);
    for (const { items, amount } of cases) {
      const response = await placeOrder(alice, items, { extra: { amount: 1 } });
      expect(response.status()).toBe(201);
      const body = await response.json();
      expect(body.replayed).toBe(false);
      expect(body.order).toEqual(orderShape({ amount }));
      expect(itemsOf(body.order)).toEqual([...items].sort((a, b) => a.sku.localeCompare(b.sku)));
      accepted.push(body.order.id);
    }

    const maxKey = `${'k'.repeat(120)}.:_-AZ09`;
    expect(maxKey).toHaveLength(128);
    const boundaryKey = await placeOrder(alice, [{ sku: 'TEA-50', quantity: 1 }], { key: maxKey });
    expect(boundaryKey.status(), '128-character key with every allowed punctuation').toBe(201);
    accepted.push((await boundaryKey.json()).order.id);
  });

  await test.step('invalid orders return invalid_order and create nothing', async () => {
    const invalid = {
      'unknown SKU': { items: [{ sku: 'NOPE-1', quantity: 1 }] },
      'duplicate SKU': { items: [{ sku: 'TEA-50', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }] },
      'quantity 0': { items: [{ sku: 'TEA-50', quantity: 0 }] },
      'quantity 11': { items: [{ sku: 'TEA-50', quantity: 11 }] },
      'fractional quantity': { items: [{ sku: 'TEA-50', quantity: 1.5 }] },
      'string quantity': { items: [{ sku: 'TEA-50', quantity: '2' }] },
      'empty items': { items: [] },
      'USD currency': { items: [{ sku: 'TEA-50', quantity: 1 }], currency: 'USD' },
    };
    for (const [name, { items, currency }] of Object.entries(invalid)) {
      const response = await placeOrder(alice, items, { currency });
      expect(response.status(), name).toBe(400);
      expect(await response.json(), name).toEqual({ error: 'invalid_order' });
    }
  });

  await test.step('missing or malformed idempotency keys are rejected', async () => {
    // The contract requires a valid key but does not name the error body; assert a client error.
    for (const key of [null, '', 'k'.repeat(129), 'has space', 'slash/key']) {
      const response = await placeOrder(alice, [{ sku: 'TEA-50', quantity: 1 }], { key });
      expect(response.status(), `key ${JSON.stringify(key)}`).toBeGreaterThanOrEqual(400);
      expect(response.status(), `key ${JSON.stringify(key)}`).toBeLessThan(500);
    }
  });

  await test.step('only the accepted orders exist', async () => {
    const list = await alice.get('/api/orders');
    expect(list.status()).toBe(200);
    expect((await list.json()).orders.map(order => order.id).sort()).toEqual([...accepted].sort());
    expect((await clients.state()).orders.map(order => order.id).sort()).toEqual([...accepted].sort());
  });
});

test('an idempotency key yields one order across reordering, concurrency and restart', async ({ app, clients }) => {
  const key = `checkout:${randomUUID()}`;
  const alice = await clients.signedIn(app.users.alice);
  const reordered = [...TEA2_CUP1].reverse();
  let orderId;

  await test.step('eight concurrent equivalent submissions create exactly one order', async () => {
    const { responses, transportErrors } = await burst(8, index =>
      placeOrder(alice, index % 2 ? reordered : TEA2_CUP1, { key }));
    // A dropped connection never reached the server, so it fails the test on its own
    // while the idempotency invariant is judged on the submissions that were answered.
    expect.soft(transportErrors, 'every parallel submission received an HTTP response').toEqual([]);
    expect(responses.length, 'enough submissions were answered to race').toBeGreaterThanOrEqual(2);
    const bodies = await Promise.all(responses.map(response => response.json()));
    const statuses = responses.map(response => response.status());
    expect(statuses.filter(status => status === 201), 'exactly one submission creates').toHaveLength(1);
    expect(statuses.filter(status => status === 200), 'the rest replay').toHaveLength(responses.length - 1);
    expect(bodies.filter(body => body.replayed === false)).toHaveLength(1);
    orderId = bodies[0].order.id;
    for (const body of bodies) expect(body.order).toEqual(orderShape({ id: orderId, amount: 4200 }));

    const list = await (await alice.get('/api/orders')).json();
    expect(list.orders.map(order => order.id)).toEqual([orderId]);
  });

  const expectConflicts = async client => {
    const changes = {
      quantity: { items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] },
      sku: { items: [{ sku: 'TEA-50', quantity: 2 }] },
      // Checked against the existing key before currency validation, so not invalid_order.
      currency: { items: TEA2_CUP1, currency: 'USD' },
    };
    for (const [name, { items, currency }] of Object.entries(changes)) {
      const response = await placeOrder(client, items, { key, currency });
      expect(response.status(), `changed ${name}`).toBe(409);
      expect(await response.json(), `changed ${name}`).toEqual({ error: 'idempotency_conflict' });
    }
  };

  await test.step('a changed quantity, SKU or currency under the same key conflicts', async () => {
    await expectConflicts(alice);
  });

  let bobOrderId;
  await test.step('another user may use the same key independently', async () => {
    const bob = await clients.signedIn(app.users.bob);
    const response = await placeOrder(bob, [{ sku: 'CUP-01', quantity: 1 }], { key });
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    expect(order).toEqual(orderShape({ user_id: 'bob', amount: PRICE['CUP-01'] }));
    expect(order.id).not.toBe(orderId);
    bobOrderId = order.id;
  });

  await test.step('after a restart on the same database the key still replays the original order', async () => {
    await app.restart();
    const fresh = await clients.open();
    expect((await signIn(fresh, app.users.alice)).status()).toBe(200);

    const replay = await placeOrder(fresh, reordered, { key });
    expect(replay.status()).toBe(200);
    const body = await replay.json();
    expect(body.replayed).toBe(true);
    expect(body.order).toEqual(orderShape({ id: orderId, amount: 4200 }));
    await expectConflicts(fresh);

    const state = await clients.state();
    expect(state.orders.map(order => order.id).sort()).toEqual([orderId, bobOrderId].sort());
  });
});

test('orders are visible only to their owner and require a session', async ({ app, clients }) => {
  const alice = await clients.signedIn(app.users.alice);
  const bob = await clients.signedIn(app.users.bob);
  const anonymous = await clients.open();
  const order = await createOrder(alice, TEA2_CUP1);

  await test.step('the owner can read the order', async () => {
    const response = await alice.get(`/api/orders/${order.id}`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ order });
  });

  await test.step("another user's order is indistinguishable from an unknown one", async () => {
    const foreign = await bob.get(`/api/orders/${order.id}`);
    const unknown = await bob.get(`/api/orders/${randomUUID()}`);
    expect(foreign.status()).toBe(404);
    expect(unknown.status()).toBe(404);
    expect(await foreign.json()).toEqual({ error: 'not_found' });
    expect(await unknown.json()).toEqual({ error: 'not_found' });
    expect((await (await bob.get('/api/orders')).json()).orders).toEqual([]);
  });

  await test.step('every order endpoint returns 401 without a session and creates nothing', async () => {
    const attempts = [
      await anonymous.get('/api/orders'),
      await anonymous.get(`/api/orders/${order.id}`),
      await placeOrder(anonymous, TEA2_CUP1),
    ];
    // The contract fixes the status for order endpoints, not the error body.
    for (const response of attempts) expect(response.status()).toBe(401);
    expect((await clients.state()).orders.map(stored => stored.id)).toEqual([order.id]);
  });
});
