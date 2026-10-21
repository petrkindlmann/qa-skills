// Support report 2: "Posting the same order twice with the same Idempotency-Key but a
// different basket gave me 200 and a second order instead of a conflict."
// Contract clauses: "Reusing a key for a different quantity, SKU or currency returns 409
// { "error": "idempotency_conflict" }", "Reusing a key with equivalent items and currency
// returns 200, the original order and replayed: true", "Keys belong to the signed-in user".
// These pass on a healthy Shop and go red if a changed basket is accepted under a used key.
import { test, expect } from '../../../support/fixtures.mjs';
import {
  BASKET, BASKET_AMOUNT, BASKET_CURRENCY_CHANGED, BASKET_QTY_CHANGED, BASKET_REORDERED, BASKET_SKU_CHANGED,
  createOrder, disposeAll, expectIdempotencyConflict, listOrders, postOrder, signIn,
} from './helpers.mjs';

const KEY = 'report-2-key-7f3a';

test('reusing an Idempotency-Key with a different quantity returns 409 and creates no order', async ({ app }) => {
  let alice;
  try {
    alice = (await signIn(app.baseURL, app.users.alice)).ctx;
    const original = await createOrder(alice, KEY, BASKET);
    expect(original).toMatchObject({ user_id: 'alice', currency: 'EUR', amount: BASKET_AMOUNT, status: 'pending', fulfillment_count: 0 });

    // The reporter's exact move: same key, one quantity bumped. Reported: 200 + a second order.
    await expectIdempotencyConflict(alice, KEY, BASKET_QTY_CHANGED, 'quantity changed');

    // No second order exists and the original is untouched.
    const orders = await listOrders(alice);
    expect(orders.map(o => o.id)).toEqual([original.id]);
    expect(orders[0]).toMatchObject({ amount: BASKET_AMOUNT, items: original.items });

    // Control: the conflict did not poison the key. An equivalent basket, even reordered,
    // still replays the original order, and the list still holds exactly one order.
    const replay = await postOrder(alice, KEY, BASKET_REORDERED);
    expect(replay.status(), 'equivalent reuse replays').toBe(200);
    expect(await replay.json()).toEqual({ order: original, replayed: true });
    expect(await listOrders(alice)).toHaveLength(1);
  } finally {
    await disposeAll(alice);
  }
});

test('a changed SKU set or currency under a used key also conflicts', async ({ app }) => {
  let alice;
  try {
    alice = (await signIn(app.baseURL, app.users.alice)).ctx;
    const original = await createOrder(alice, KEY, BASKET);

    await expectIdempotencyConflict(alice, KEY, BASKET_SKU_CHANGED, 'SKU dropped');
    // The contract checks the currency conflict before the new body's currency validation,
    // so USD on a used key is 409, not 400 invalid_order.
    await expectIdempotencyConflict(alice, KEY, BASKET_CURRENCY_CHANGED, 'currency changed');

    expect((await listOrders(alice)).map(o => o.id)).toEqual([original.id]);
  } finally {
    await disposeAll(alice);
  }
});

test('keys are scoped to the signed-in user, so a conflict is not a global lock on the key', async ({ app }) => {
  let alice, bob;
  try {
    alice = (await signIn(app.baseURL, app.users.alice)).ctx;
    bob = (await signIn(app.baseURL, app.users.bob)).ctx;

    const alicesOrder = await createOrder(alice, KEY, BASKET);
    await expectIdempotencyConflict(alice, KEY, BASKET_QTY_CHANGED, 'alice, quantity changed');

    // Bob may use the same key with a different basket: a fresh order for bob, not a conflict.
    const bobsOrder = await createOrder(bob, KEY, BASKET_QTY_CHANGED);
    expect(bobsOrder.user_id).toBe('bob');
    expect(bobsOrder.id).not.toBe(alicesOrder.id);
    expect(bobsOrder.amount).toBe(3 * 1200 + 1800);

    // Each user sees only their own single order; alice's key still replays alice's order.
    expect((await listOrders(alice)).map(o => o.id)).toEqual([alicesOrder.id]);
    expect((await listOrders(bob)).map(o => o.id)).toEqual([bobsOrder.id]);
    const replay = await postOrder(alice, KEY, BASKET);
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual({ order: alicesOrder, replayed: true });
    // Neither user can read the other's order through the key or the id.
    expect((await bob.get(`/api/orders/${alicesOrder.id}`)).status()).toBe(404);
  } finally {
    await disposeAll(alice, bob);
  }
});
