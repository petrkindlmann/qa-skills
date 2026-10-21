// Experiment 4: CPU exhaustion on the host (SKILL.md "Infrastructure failures"
// / "Service slowdown: CPU stress"), generated in-process with bounded worker
// threads instead of stress-ng. The first test trips the automated abort on
// purpose (SKILL.md Verification step 2) before the live experiment trusts it.
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../support/fixtures.mjs';
import {
  cpuLoad, createOrder, deliverPayment, expectHealthy, experiment, getOrder, login, monitorHealth,
  paymentEvent, probeHealth, summarize, HEALTH_BUDGET_MS,
} from './helpers.mjs';

const THREADS = os.availableParallelism() * 2; // oversubscribe every core
const LOAD_MS = 6000;
const ABORT_MS = 5000; // a health probe slower than this halts the load

test.describe('Experiment 4: CPU load', () => {
  test('safety check: the automated abort halts the load and the rollback clears it', async ({ app, request }, testInfo) => {
    const exp = experiment(testInfo, {
      name: 'cpu-load-abort-gate',
      hypothesis: 'We believe that if the abort threshold is forced to 0 ms, the first health probe trips the abort, every load thread is terminated within 5 s (skill rule: rollback under 30 s; observed 0.8-1.3 s) and the Shop is healthy immediately afterwards.',
      blastRadius: `${THREADS} busy threads in the test process for at most ${LOAD_MS} ms (self-clearing), this Shop process only.`,
      abortCondition: 'Forced: health probe > 0 ms.',
      rollback: 'Terminate the worker threads (load.abort()), timed.',
    });
    await expectHealthy(request, app.baseURL, 'baseline health');
    const load = cpuLoad({ threads: THREADS, durationMs: LOAD_MS });
    let abortMs = null;
    try {
      const { probes, abort } = await monitorHealth(request, app.baseURL, {
        until: () => load.done, abortThresholdMs: 0,
        onAbort: async () => { abortMs = await load.abort(); },
      });
      expect(abort, 'the abort must fire').not.toBeNull();
      expect(probes).toHaveLength(1);
      expect(load.aborted).toBe(true);
      expect(abortMs, 'rollback (terminate) completed').toBeLessThan(5000);
      const elapsed = Math.round(performance.now() - load.startedAt);
      expect(elapsed, 'the load ended long before its own deadline').toBeLessThan(LOAD_MS);
      exp.record.observed = { abortReason: abort.reason, abortMs, elapsedMs: elapsed };
      exp.record.rollbackMs = abortMs;
    } finally {
      if (!load.done) await load.abort();
    }
    const final = await expectHealthy(request, app.baseURL, 'Shop healthy again at the end of the experiment');
    exp.record.recoveryMs = final.ms;
    await exp.finish('confirmed');
  });

  test('health stays within its 500 ms budget under CPU load, or the miss is recorded; the order flow completes correctly', async ({ app, request }, testInfo) => {
    const exp = experiment(testInfo, {
      name: 'cpu-load-health-and-orders',
      hypothesis: `We believe that if every core is oversubscribed (${THREADS} busy threads) for ${LOAD_MS} ms, /health keeps answering 200 within ${HEALTH_BUDGET_MS} ms, `
        + 'a sign-in, order and signed payment complete with correct results, and health is back within budget within 5 s of the load ending. '
        + 'A budget miss is recorded as a disproved hypothesis with the measured gap; a non-200 or failed probe is a failure.',
      blastRadius: `${THREADS} busy worker threads inside the Playwright worker process for ${LOAD_MS} ms, each with its own deadline; this Shop process; no other process is touched.`,
      abortCondition: `A health probe not 200 or slower than ${ABORT_MS} ms terminates the load immediately (machine-checked by monitorHealth).`,
      rollback: 'load.abort() in finally (no-op once the threads have exited on their own); then poll health until it is back within budget.',
    });

    // Step 1: steady state. Ten samples; the budget must hold before injection
    // (no chaos on a system that is not in steady state).
    const baselineProbes = [];
    for (let i = 0; i < 10; i += 1) baselineProbes.push(await probeHealth(request, app.baseURL));
    const baseline = summarize(baselineProbes);
    expect(baseline.non200, 'baseline probes all 200').toBe(0);
    expect(baseline.maxMs, `baseline inside budget (max ${baseline.maxMs} ms)`).toBeLessThanOrEqual(HEALTH_BUDGET_MS);
    await login(request, app.baseURL, app.users.alice);
    exp.record.baseline = baseline;

    // Step 2: introduce the variable; Step 3: observe health and one real order flow concurrently.
    const load = cpuLoad({ threads: THREADS, durationMs: LOAD_MS });
    let monitored;
    let flow;
    try {
      [monitored, flow] = await Promise.all([
        monitorHealth(request, app.baseURL, { until: () => load.done, abortThresholdMs: ABORT_MS, onAbort: () => load.abort() }),
        (async () => {
          const started = performance.now();
          const created = await createOrder(request, app.baseURL, `chaos-load-${randomUUID()}`);
          const order = created.json?.order;
          const paid = order ? await deliverPayment(request, app, paymentEvent(app, { id: `evt-chaos-load-${randomUUID()}`, orderId: order.id })) : null;
          const fetched = order ? await getOrder(request, app.baseURL, order.id) : null;
          return { createStatus: created.status, paidStatus: paid?.status, paidBody: paid?.json, finalOrder: fetched?.json?.order, ms: Math.round(performance.now() - started) };
        })(),
      ]);
      const exits = await load.finished;
      const selfCleared = !load.aborted;
      const clearedAfterMs = Math.round(Math.max(...exits.map(e => e.at)) - load.startedAt);
      const runtimes = exits.map(e => e.ranMs);
      exp.record.observed.selfCleared = selfCleared;
      exp.record.observed.loadClearedAfterMs = clearedAfterMs; // seen from the contended main thread: startup stagger + exit latency included
      exp.record.observed.threadRuntimesMs = { min: Math.min(...runtimes), max: Math.max(...runtimes) };
      if (selfCleared) {
        expect(runtimes.every(ms => ms !== null), 'every thread reported its own start and end').toBe(true);
        expect(Math.max(...runtimes), 'each thread stops at its own deadline').toBeLessThan(LOAD_MS + 500);
        expect(clearedAfterMs, 'runaway guard: the whole load is gone well inside the test timeout').toBeLessThan(LOAD_MS + 6000);
      }
    } finally {
      const started = performance.now();
      if (!load.done) await load.abort();
      exp.record.rollbackMs = Math.round(performance.now() - started);
    }

    // Step 4: analyze. Recovery: health back within budget after the load.
    const recoveryStart = performance.now();
    let recovered = null;
    await expect.poll(async () => { recovered = await probeHealth(request, app.baseURL); return recovered.status === 200 && recovered.ms <= HEALTH_BUDGET_MS; },
      { timeout: 5000, message: 'health back within budget after the load' }).toBe(true);
    exp.record.recoveryMs = Math.round(performance.now() - recoveryStart);

    const underLoad = summarize(monitored.probes);
    exp.record.observed = { ...exp.record.observed, underLoad, abort: monitored.abort, orderFlow: flow,
      measurementCaveat: 'latency measured by the test process, which shares the saturated CPU; it bounds server latency from above' };
    exp.record.abort = monitored.abort;

    // Hard assertions: every probe answered 200, the order flow was correct.
    expect(underLoad.samples, 'the monitor actually sampled during the load').toBeGreaterThan(0);
    expect(underLoad.non200, 'every health probe under load was 200').toBe(0);
    expect(flow.createStatus).toBe(201);
    expect(flow.paidStatus).toBe(200);
    expect(flow.paidBody).toMatchObject({ received: true, duplicate: false });
    expect(flow.finalOrder).toMatchObject({ status: 'paid', fulfillment_count: 1, amount: 4200 });
    exp.record.dataIntegrity = 'lost no, duplicated no (one order, paid once, under load)';

    // The budget hypothesis: confirmed or recorded as disproved with the gap.
    const final = await expectHealthy(request, app.baseURL, 'Shop healthy again at the end of the experiment');
    exp.record.observed.finalHealthMs = final.ms;
    if (underLoad.maxMs <= HEALTH_BUDGET_MS) {
      await exp.finish('confirmed');
    } else {
      testInfo.annotations.push({ type: 'finding', description: `health missed its ${HEALTH_BUDGET_MS} ms budget under CPU load: max ${underLoad.maxMs} ms (miss ${underLoad.worstMissMs} ms), p95 ${underLoad.p95Ms} ms, ${underLoad.overBudget}/${underLoad.samples} probes over budget${monitored.abort ? `; abort fired: ${monitored.abort.reason}` : ''}` });
      await exp.finish(`disproved: budget missed by ${underLoad.worstMissMs} ms (max ${underLoad.maxMs} ms, p95 ${underLoad.p95Ms} ms, ${underLoad.overBudget}/${underLoad.samples} over budget)`);
    }
  });
});
