import { test, expect } from './support/test.mjs';
import { oracle } from '../../../support/oracle.mjs';
import { createFactories, ITEMS, catalogue, catalogueView } from './factories/index.mjs';
import { orderView, reconcileState } from './support/ledger.mjs';

// Every test opens its own scope(s). No test touches an order it did not
// create, and every expectation is derived from the factory promise or the
// ledger, never from reading the Shop first.

test('a factory-built order is accepted and reads back equal to the factory promise', async ({ app, scopes }) => {
  const alice = await scopes.open({ app, user: app.users.alice, name: 'order-roundtrip' });
  expect((await alice.login()).status).toBe(200);

  // Reference fixture agrees with the server-owned catalogue, otherwise every
  // amount the factory promises is wrong for the wrong reason.
  const served = await alice.catalogue();
  expect(served.status).toBe(200);
  expect(catalogueView(served)).toEqual(catalogueView(catalogue));

  const built = alice.factories.order.build();
  expect(built.expected.rejected).toBeUndefined();
  const created = await alice.createOrder(built);
  expect(created.status).toBe(201);
  expect(created.replayed).toBe(false);
  expect(orderView(created.order)).toEqual({ id: expect.any(String), user_id: 'alice', ...built.expected });

  const read = await alice.readOrder(created.order.id);
  expect(read.status).toBe(200);
  expect(orderView(read.order)).toEqual(orderView(created.order));

  // An explicit override: the contract's own example must come to 4200.
  const example = alice.factories.order.build({ items: ITEMS.contractExample });
  expect(example.expected.amount).toBe(4200);
  const createdExample = await alice.createOrder(example);
  expect(createdExample.status).toBe(201);
  expect(createdExample.order.amount).toBe(4200);

  // The scoped list is exactly the ledger, in content and in count.
  const visible = await alice.visibleOrders();
  expect(visible.map(orderView)).toEqual(expect.arrayContaining(alice.ledger.expectedOrders()));
  expect(visible).toHaveLength(2);
  expect(await alice.foreignOrders()).toEqual([]);
});

test('factories are deterministic by scope and seed, and honour overrides', async () => {
  const first = createFactories({ scope: 'determinism', secret: 'local-payment-secret' });
  const second = createFactories({ scope: 'determinism', secret: 'local-payment-secret' });
  const other = createFactories({ scope: 'determinism-other', secret: 'local-payment-secret' });

  const a = first.order.buildList(3);
  const b = second.order.buildList(3);
  expect(a).toEqual(b);
  expect(a.map(order => order.idempotencyKey)).toEqual(['determinism.order-1', 'determinism.order-2', 'determinism.order-3']);
  expect(a.every(order => order.expected.rejected === undefined)).toBe(true);
  expect(a.every(order => Number.isInteger(order.expected.amount) && order.expected.amount > 0)).toBe(true);

  const c = other.order.buildList(3);
  expect(c.map(order => order.idempotencyKey)).not.toEqual(a.map(order => order.idempotencyKey));
  expect(c.map(order => order.payload)).not.toEqual(a.map(order => order.payload));

  const order = { id: 'order-fixed', currency: 'EUR', amount: 4200 };
  const p1 = first.payment.build({ order });
  const p2 = second.payment.build({ order });
  expect(p1).toEqual(p2);
  expect(p1.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  expect(p1.event.id).toBe('evt-determinism-1');

  const r1 = first.reset.build({ user: { id: 'bob', email: 'bob@example.test', password: 'x' } });
  const r2 = second.reset.build({ user: { id: 'bob', email: 'bob@example.test', password: 'x' } });
  expect(r1).toEqual(r2);
  expect(r1.newPassword.length).toBeGreaterThanOrEqual(12);
  expect(first.reset.tooShort(r1).newPassword.length).toBe(11);

  // Overrides change exactly the field named and whatever derives from it.
  const overridden = first.order.build({ items: ITEMS.maxQuantity, idempotencyKey: 'determinism.pinned' });
  expect(overridden.payload.items).toEqual([{ sku: 'CUP-01', quantity: 10 }]);
  expect(overridden.expected.amount).toBe(18000);
  expect(overridden.idempotencyKey).toBe('determinism.pinned');
  expect(first.order.build({ items: ITEMS.unknownSku }).expected).toEqual({ rejected: 'invalid_order' });
  expect(first.order.build({ items: ITEMS.tooMany }).expected).toEqual({ rejected: 'invalid_order' });
  expect(first.order.build({ currency: 'USD', items: ITEMS.singleTea }).expected).toEqual({ rejected: 'invalid_order' });

  const seeded = createFactories({ scope: 'determinism', seed: 7 });
  expect(seeded.order.build().payload).not.toEqual(a[0].payload);
  expect(createFactories({ scope: 'spaces and/slashes!' }).scope).toBe('spaces-and-slashes-');
});

test('scopes running in parallel on one Shop cannot see each other\'s orders', async ({ app, scopes }) => {
  const a = await scopes.open({ app, user: app.users.alice, name: 'parallel-a' });
  const b = await scopes.open({ app, user: app.users.bob, name: 'parallel-b' });
  const c = await scopes.open({ app, user: app.users.alice, name: 'parallel-c' }); // same user as a

  await Promise.all([a, b, c].map(async scope => {
    expect((await scope.login()).status).toBe(200);
    for (const built of scope.factories.order.buildList(2)) {
      const created = await scope.createOrder(built);
      expect(created.status).toBe(201);
    }
  }));
  for (const scope of [a, b, c]) expect(scope.ledger.orders()).toHaveLength(2);

  // Keys never collided: six distinct keys, six distinct orders.
  const keys = [a, b, c].flatMap(scope => scope.ledger.orders().map(order => order.idempotencyKey));
  expect(new Set(keys).size).toBe(6);
  const ids = [a, b, c].flatMap(scope => [...scope.ledger.orderIds()]);
  expect(new Set(ids).size).toBe(6);

  // Different users: the Shop itself partitions. Bob's list is exactly bob's ledger
  // and bob reading alice's order is indistinguishable from an unknown id.
  const bobList = await b.listOrders();
  expect(bobList.orders.map(order => order.id).sort()).toEqual([...b.ledger.orderIds()].sort());
  expect(await b.foreignOrders()).toEqual([]);
  for (const id of a.ledger.orderIds()) {
    const read = await b.readOrder(id);
    await oracle('c3-tdm-cross-user', 'toEqual', () => expect(read).toEqual({ status: 404, error: 'not_found' }));
  }
  for (const id of b.ledger.orderIds()) expect(await a.readOrder(id)).toEqual({ status: 404, error: 'not_found' });

  // Same user, two scopes: the raw list leaks across scopes, the scoped view does not.
  const aForeign = await a.foreignOrders();
  expect(aForeign.map(order => order.id).sort()).toEqual([...c.ledger.orderIds()].sort());
  expect((await a.visibleOrders()).map(orderView)).toEqual(expect.arrayContaining(a.ledger.expectedOrders()));
  expect(await a.visibleOrders()).toHaveLength(2);
  expect((await c.visibleOrders()).map(orderView)).toEqual(expect.arrayContaining(c.ledger.expectedOrders()));
  expect(await c.visibleOrders()).toHaveLength(2);
  const aIds = a.ledger.orderIds();
  expect([...c.ledger.orderIds()].some(id => aIds.has(id))).toBe(false);
});

test('an idempotent replay through the factory returns the same order; a changed intent conflicts', async ({ app, scopes }) => {
  const alice = await scopes.open({ app, user: app.users.alice, name: 'replay' });
  expect((await alice.login()).status).toBe(200);

  const built = alice.factories.order.build({ items: ITEMS.contractExample });
  const created = await alice.createOrder(built);
  expect(created.status).toBe(201);

  const replay = await alice.createOrder(built);
  expect(replay.status).toBe(200);
  expect(replay.replayed).toBe(true);
  expect(orderView(replay.order)).toEqual(orderView(created.order));

  const permuted = await alice.createOrder(alice.factories.order.permuted(built));
  expect(permuted.status).toBe(200);
  expect(permuted.replayed).toBe(true);
  expect(permuted.order.id).toBe(created.order.id);

  const conflicting = alice.factories.order.conflicting(built);
  expect(conflicting.idempotencyKey).toBe(built.idempotencyKey);
  const conflict = await alice.createOrder(conflicting);
  expect(conflict.status).toBe(409);
  expect(conflict.error).toBe(conflicting.expected.rejected);

  // Parallel equivalent submissions of a second factory order create one order.
  const second = alice.factories.order.build();
  const burst = await Promise.all([1, 2, 3].map(() => alice.createOrder(second)));
  await oracle('c3-tdm-idempotency-index', 'toHaveLength', () =>
    expect(burst.filter(result => result.status === 201)).toHaveLength(1));
  expect(burst.filter(result => result.status === 200 && result.replayed)).toHaveLength(2);
  expect(new Set(burst.map(result => result.order.id)).size).toBe(1);

  expect(alice.ledger.orders()).toHaveLength(2);
  expect(alice.ledger.ofType('replay')).toHaveLength(4);
  expect(alice.ledger.ofType('rejected-order')).toEqual([expect.objectContaining({ status: 409, error: 'idempotency_conflict' })]);
  const visible = await alice.visibleOrders();
  expect(visible).toHaveLength(2);
  expect(await alice.foreignOrders()).toEqual([]);
});

test('a signed payment payload from the factory is accepted; tampered, re-signed, unsigned and mismatched ones are not', async ({ app, scopes }) => {
  const alice = await scopes.open({ app, user: app.users.alice, name: 'payment' });
  expect((await alice.login()).status).toBe(200);
  const created = await alice.createOrder(alice.factories.order.build());
  expect(created.status).toBe(201);
  const order = created.order;

  const signed = alice.factories.payment.build({ order });
  expect(signed.headers['X-Test-Payment-Signature']).toBe(signed.signature);

  // Broken cases first, while the order is still pending, so acceptance of any
  // of them would be visible as a status change or a receipt.
  const tampered = alice.factories.payment.tampered(signed);
  expect(tampered.body).not.toBe(signed.body);
  expect(tampered.signature).toBe(signed.signature);
  expect(await alice.pay(tampered)).toEqual({ status: 401, error: 'invalid_signature' });
  expect(await alice.pay(alice.factories.payment.resigned(signed, 'not-the-fixture-secret'))).toEqual({ status: 401, error: 'invalid_signature' });
  expect(await alice.pay(alice.factories.payment.unsigned(signed))).toEqual({ status: 401, error: 'invalid_signature' });
  const mismatched = alice.factories.payment.build({ order, overrides: { amount: order.amount + 1 } });
  expect(await alice.pay(mismatched)).toEqual({ status: 422, error: 'payment_mismatch' });

  let state = await alice.state();
  expect(state.receipts).toEqual([]);
  expect(orderView(state.orders.find(candidate => candidate.id === order.id))).toEqual(orderView(order));
  expect((await alice.readOrder(order.id)).order.status).toBe('pending');

  const accepted = await alice.pay(signed);
  expect(accepted).toEqual({ status: 200, ...signed.expected });
  const paid = await alice.readOrder(order.id);
  expect(paid.order.status).toBe('paid');
  expect(paid.order.fulfillment_count).toBe(1);
  expect(orderView(paid.order)).toEqual(alice.ledger.expectedOrders()[0]);

  const duplicate = await alice.pay(signed);
  expect(duplicate).toEqual({ status: 200, received: true, duplicate: true, order_id: order.id });
  const afterDuplicate = (await alice.readOrder(order.id)).order.fulfillment_count;
  await oracle('c3-tdm-duplicate-fulfillment', 'toBe', () => expect(afterDuplicate).toBe(1));

  state = await alice.state();
  expect(state.receipts.map(receipt => ({ id: receipt.id, order_id: receipt.order_id }))).toEqual([{ id: signed.event.id, order_id: order.id }]);
  expect(alice.ledger.receipts()).toHaveLength(1);
  expect(alice.ledger.ofType('rejected-payment').map(entry => entry.status)).toEqual([401, 401, 401, 422]);
  expect(alice.ledger.ofType('duplicate-receipt')).toHaveLength(1);
});

test('durable state from the test-support endpoint matches the ledger, before and after a restart', async ({ app, scopes }) => {
  const alice = await scopes.open({ app, user: app.users.alice, name: 'durable-alice' });
  const bob = await scopes.open({ app, user: app.users.bob, name: 'durable-bob' });
  expect((await alice.login()).status).toBe(200);
  expect((await bob.login()).status).toBe(200);

  for (const built of alice.factories.order.buildList(2)) expect((await alice.createOrder(built)).status).toBe(201);
  const bobOrder = await bob.createOrder(bob.factories.order.build());
  expect(bobOrder.status).toBe(201);
  const paid = await bob.pay(bob.factories.payment.build({ order: bobOrder.order }));
  expect(paid.status).toBe(200);
  expect((await bob.requestReset(bob.factories.reset.build({ user: app.users.bob }))).status).toBe(202);

  // Sanity: the reconciliation notices a record the ledger does not explain.
  const before = await alice.state();
  const onlyAlice = reconcileState(before, [alice]);
  expect(onlyAlice.clean).toBe(false);
  expect(onlyAlice.unexpectedOrders).toEqual([bobOrder.order.id]);
  expect(onlyAlice.unexpectedReceipts).toHaveLength(1);

  const full = reconcileState(before, [alice, bob]);
  expect(full).toEqual(expect.objectContaining({ clean: true, missingOrders: [], mismatchedOrders: [], unexpectedOrders: [],
    missingReceipts: [], unexpectedReceipts: [], resetTokens: [], sessions: [] }));
  expect(before.orders).toHaveLength(3);
  expect(before.sessions).toEqual({ alice: 1, bob: 1 });

  await app.restart();
  const after = await alice.state();
  expect(after.orders.map(orderView).sort((x, y) => x.id.localeCompare(y.id)))
    .toEqual(before.orders.map(orderView).sort((x, y) => x.id.localeCompare(y.id)));
  expect(reconcileState(after, [alice, bob]).clean).toBe(true);

  // The public read agrees with the ledger after the restart as well.
  const relogin = await alice.login();
  expect(relogin.status).toBe(200);
  expect((await alice.visibleOrders()).map(orderView)).toEqual(expect.arrayContaining(alice.ledger.expectedOrders()));
  expect(await alice.foreignOrders()).toEqual([]);
});

test('reset-flow data from the factory drives a real inbox round trip', async ({ app, mailpit, scopes }) => {
  const bob = await scopes.open({ app, mailpit, user: app.users.bob, name: 'reset' });
  const built = bob.factories.reset.build({ user: app.users.bob });
  expect(built.email).toBe(app.users.bob.email);
  expect(built.newPassword).not.toBe(built.currentPassword);

  expect((await bob.login()).status).toBe(200);
  expect((await bob.requestReset(built)).status).toBe(built.expected.request);

  const email = await bob.readResetEmail(built);
  expect(email.to).toEqual([built.email]);
  expect(email.subject).toBe(built.subject);
  expect(email.html).toContain(`/reset-password?token=${email.token}`);
  let state = await bob.state();
  expect(state.reset_tokens).toEqual([expect.objectContaining({ user_id: 'bob', consumed: null })]);

  const confirmed = await bob.confirmReset(built, email.token);
  expect(confirmed).toEqual({ status: 200, ...built.expected.confirm });
  expect((await bob.me()).status).toBe(401); // existing sessions invalidated
  expect((await bob.login(built.currentPassword)).status).toBe(401);
  expect((await bob.login(built.newPassword)).status).toBe(200);
  expect(await bob.confirmReset(built, email.token)).toEqual({ status: 400, error: 'invalid_or_expired_token' });

  state = await bob.state();
  expect(state.reset_tokens).toHaveLength(1);
  expect(state.reset_tokens[0].consumed).toBeTruthy();
  expect(reconcileState(state, [bob]).clean).toBe(true);
  expect(bob.ledger.resets()).toEqual([expect.objectContaining({ userId: 'bob', consumed: true })]);
});
