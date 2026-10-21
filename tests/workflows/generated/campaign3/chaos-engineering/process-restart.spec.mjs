// Experiments 2 and 3: service crash/restart (SKILL.md "Service failures":
// "Kill process") mid-flow, and a transient fulfillment error right after the
// restart (Starter Experiment 2 shape: dependency returns an error; idempotency
// must hold). Both use app.restart() on the same database.
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../support/fixtures.mjs';
import { oracle } from '../../../support/oracle.mjs';
import {
  createOrder, deliverPayment, expectHealthy, experiment, getOrder, login, paymentEvent,
  probeHealth, readState, ORDER_AMOUNT,
} from './helpers.mjs';

async function timedRestart(app, request, options) {
  const started = performance.now();
  await app.restart(options);
  const restartMs = Math.round(performance.now() - started);
  const first = await probeHealth(request, app.baseURL);
  expect(first, 'abort: Shop did not answer /health after restart').toMatchObject({ status: 200 });
  return { restartMs, firstHealthMs: first.ms };
}

test.describe('Experiment 2: process restart mid-flow', () => {
  test('a session, a pending order and its idempotency key survive a restart; the flow then completes', async ({ app, request }, testInfo) => {
    const exp = experiment(testInfo, {
      name: 'process-restart',
      hypothesis: 'We believe that if the Shop process is killed and restarted on the same database between order creation and payment, '
        + 'the session cookie keeps working, the pending order is returned unchanged, replaying its idempotency key returns the same order with replayed:true, '
        + 'no second order appears, and the payment then fulfills it exactly once. Recovery: /health 200 within the runtime readiness window (15 s).',
      blastRadius: 'This test\'s own Shop process only (one SIGTERM + relaunch, same port, same SQLite file). Duration: the restart itself (sub-second on this machine).',
      abortCondition: 'The restart does not become ready within the runtime\'s 15 s (restart() throws), the first /health after restart is not 200, '
        + 'or durable state differs from the pre-restart snapshot: the assertion stops the experiment before any further injection.',
      rollback: 'The restart is its own recovery; the fixture teardown stops the Shop. Final check: /health 200 within 500 ms and a fresh sign-in works.',
    });

    // Step 1: steady state.
    const baseline = await expectHealthy(request, app.baseURL, 'baseline health');
    const alice = await login(request, app.baseURL, app.users.alice);
    const key = `chaos-restart-${randomUUID()}`;
    const created = await createOrder(request, app.baseURL, key);
    expect(created.status).toBe(201);
    const order = created.json.order;
    expect(order).toMatchObject({ user_id: 'alice', status: 'pending', fulfillment_count: 0, amount: ORDER_AMOUNT, currency: 'EUR' });
    const before = await readState(request, app);
    expect(before.orders).toHaveLength(1);
    expect(Object.values(before.sessions).reduce((sum, n) => sum + n, 0), 'one live session before restart').toBe(1);
    exp.record.baseline = { healthMs: baseline.ms, orders: 1, sessions: before.sessions, orderId: order.id, status: order.status };

    // Step 2: introduce the variable.
    const { restartMs, firstHealthMs } = await timedRestart(app, request);
    exp.record.recoveryMs = restartMs;

    // Step 3: observe through the public API with the pre-restart cookie.
    const me = await request.get(app.baseURL + '/api/me');
    expect(me.status(), 'session survives the restart').toBe(200);
    expect((await me.json()).user).toEqual(alice);

    const fetched = await getOrder(request, app.baseURL, order.id);
    expect(fetched.status).toBe(200);
    expect(fetched.json.order, 'order returned unchanged').toEqual(order);

    const listed = await request.get(app.baseURL + '/api/orders');
    expect((await listed.json()).orders).toEqual([order]);

    const replay = await createOrder(request, app.baseURL, key);
    expect(replay.status, 'idempotency key survives the restart').toBe(200);
    expect(replay.json).toEqual({ order, replayed: true });

    const after = await readState(request, app);
    expect(after.orders, 'no order lost or duplicated').toHaveLength(1);
    expect(after.sessions, 'sessions persisted').toEqual(before.sessions);

    // Step 4: the interrupted flow completes after the restart.
    const event = paymentEvent(app, { id: `evt-chaos-restart-${randomUUID()}`, orderId: order.id });
    const paid = await deliverPayment(request, app, event);
    expect(paid.status).toBe(200);
    expect(paid.json).toEqual({ received: true, duplicate: false, order_id: order.id });
    const completed = await getOrder(request, app.baseURL, order.id);
    expect(completed.json.order).toMatchObject({ status: 'paid', fulfillment_count: 1 });
    const settled = await readState(request, app);
    expect(settled.orders).toHaveLength(1);
    expect(settled.receipts).toHaveLength(1);

    exp.record.observed = { restartMs, firstHealthMs, meStatus: me.status(), orderUnchanged: true, replayed: true, ordersAfter: after.orders.length,
      sessionsAfter: after.sessions, paymentAfterRestart: paid.json, finalStatus: completed.json.order.status, fulfillmentCount: completed.json.order.fulfillment_count };
    exp.record.dataIntegrity = 'lost no, duplicated no, corrupted no (order equal before/after; receipts 1)';

    // Steady state restored.
    await login(request, app.baseURL, app.users.bob);
    const final = await expectHealthy(request, app.baseURL, 'Shop healthy again at the end of the experiment');
    exp.record.observed.finalHealthMs = final.ms;
    await exp.finish('confirmed');
  });
});

test.describe('Experiment 3: fulfillment fails once after a restart', () => {
  test('a transient fulfillment failure after restart loses nothing and duplicates nothing; the retried delivery completes the order', async ({ app, request }, testInfo) => {
    const exp = experiment(testInfo, {
      name: 'fulfillment-failure-after-restart',
      hypothesis: 'We believe that if the Shop restarts with --fail-fulfillment-once and a valid payment event then fails with 503 fulfillment_unavailable, '
        + 'the order stays pending with fulfillment_count 0 and no receipt is committed; redelivering the same event returns 200 and fulfills it exactly once; '
        + 'a further redelivery is reported duplicate:true; and all of this survives one more restart.',
      blastRadius: 'This test\'s own Shop process (two restarts, same port, same SQLite file). The fault is armed for exactly one fulfillment.',
      abortCondition: 'restart() does not become ready, the first delivery is not the expected 503 (fault not observed = invalid experiment, reported as failure, not success), '
        + 'or the order is marked paid / a receipt exists after the 503: the assertion stops the experiment.',
      rollback: 'The fault self-clears after one failure; a plain app.restart() afterwards explicitly clears any residual fault and doubles as the durability check. Fixture teardown is the backstop.',
    });

    // Step 1: steady state.
    const baseline = await expectHealthy(request, app.baseURL, 'baseline health');
    await login(request, app.baseURL, app.users.alice);
    const created = await createOrder(request, app.baseURL, `chaos-fulfillment-${randomUUID()}`);
    expect(created.status).toBe(201);
    const order = created.json.order;
    const before = await readState(request, app);
    expect(before.orders).toHaveLength(1);
    expect(before.receipts).toHaveLength(0);
    exp.record.baseline = { healthMs: baseline.ms, orderId: order.id, status: order.status, receipts: 0 };

    // Step 2: introduce the variable.
    const armed = await timedRestart(app, request, { failFulfillmentOnce: true });
    const me = await request.get(app.baseURL + '/api/me');
    expect(me.status(), 'session survives the restart (prerequisite for the flow)').toBe(200);

    // Step 3: observe.
    const event = paymentEvent(app, { id: `evt-chaos-fulfillment-${randomUUID()}`, orderId: order.id });
    const failed = await deliverPayment(request, app, event);
    expect(failed, 'the injected fault must be observed: first delivery fails with 503').toMatchObject({ status: 503, json: { error: 'fulfillment_unavailable' } });

    const afterFailure = await readState(request, app);
    expect(afterFailure.orders, 'order not lost').toHaveLength(1);
    expect(afterFailure.orders[0]).toMatchObject({ id: order.id, status: 'pending', fulfillment_count: 0 });
    await oracle('c3-chaos-receipt', 'toHaveLength', () =>
      expect(afterFailure.receipts, 'no receipt committed after the failed fulfillment').toHaveLength(0));
    const viaApi = await getOrder(request, app.baseURL, order.id);
    expect(viaApi.json.order).toMatchObject({ status: 'pending', fulfillment_count: 0 });

    const retried = await deliverPayment(request, app, event);
    expect(retried.status, 'retrying the same event succeeds').toBe(200);
    expect(retried.json).toEqual({ received: true, duplicate: false, order_id: order.id });
    const afterRetry = await readState(request, app);
    expect(afterRetry.orders[0]).toMatchObject({ id: order.id, status: 'paid', fulfillment_count: 1 });
    expect(afterRetry.receipts).toHaveLength(1);

    const repeated = await deliverPayment(request, app, event);
    expect(repeated.status).toBe(200);
    expect(repeated.json).toEqual({ received: true, duplicate: true, order_id: order.id });
    expect((await readState(request, app)).orders[0].fulfillment_count, 'no second fulfillment').toBe(1);

    // Step 4: rollback (plain restart clears any residual fault) and durability after it.
    const rollback = await timedRestart(app, request);
    exp.record.rollbackMs = rollback.restartMs;
    const durable = await readState(request, app);
    expect(durable.orders).toHaveLength(1);
    expect(durable.orders[0]).toMatchObject({ id: order.id, status: 'paid', fulfillment_count: 1 });
    expect(durable.receipts).toHaveLength(1);
    const afterRollback = await deliverPayment(request, app, event);
    expect(afterRollback.json, 'redelivery after the rollback restart is still a duplicate').toEqual({ received: true, duplicate: true, order_id: order.id });
    expect((await readState(request, app)).orders[0].fulfillment_count).toBe(1);

    exp.record.recoveryMs = armed.restartMs;
    exp.record.observed = { armedRestartMs: armed.restartMs, firstHealthMs: armed.firstHealthMs, firstDelivery: { status: failed.status, body: failed.json, ms: failed.ms },
      stateAfterFailure: { status: afterFailure.orders[0].status, fulfillmentCount: afterFailure.orders[0].fulfillment_count, receipts: afterFailure.receipts.length },
      retry: retried.json, repeat: repeated.json, afterRollbackRestart: { status: durable.orders[0].status, fulfillmentCount: durable.orders[0].fulfillment_count, receipts: durable.receipts.length } };
    exp.record.dataIntegrity = 'lost no, duplicated no, corrupted no (1 order, 1 receipt, fulfillment_count 1 across 503, retry, repeat and a restart)';

    const final = await expectHealthy(request, app.baseURL, 'Shop healthy again at the end of the experiment');
    exp.record.observed.finalHealthMs = final.ms;
    await exp.finish('confirmed');
  });
});
