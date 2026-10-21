// Shared pieces for the chaos experiments: steady-state probes, the Shop's
// public flows, the three permitted fault injectors and the experiment record.
import { createHmac } from 'node:crypto';
import net from 'node:net';
import { Worker } from 'node:worker_threads';
import { setTimeout as pause } from 'node:timers/promises';
import { expect } from '../../../support/fixtures.mjs';

// Contract: GET /health on a healthy service answers 200 within 500 ms.
export const HEALTH_BUDGET_MS = 500;
export const HEALTH_BODY = { status: 'ok', build: 'shop-lab-v1' };
export const ORDER_ITEMS = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];
export const ORDER_AMOUNT = 4200;
export const RESET_MESSAGE = 'If this account exists, a reset email has been sent.';
export const RESET_SUBJECT = 'Reset your Shop password';

function elapsed(since) { return Math.round((performance.now() - since) * 10) / 10; }

// One steady-state sample. Never throws: a hung or refused probe is an observation.
export async function probeHealth(request, baseURL, { timeout = 5000 } = {}) {
  const started = performance.now();
  try {
    const response = await request.get(baseURL + '/health', { timeout });
    const body = await response.json().catch(() => null);
    return { status: response.status(), body, ms: elapsed(started), error: null };
  } catch (error) {
    return { status: 0, body: null, ms: elapsed(started), error: error.message };
  }
}

// The "Shop is healthy again" assertion every experiment ends with.
export async function expectHealthy(request, baseURL, label = 'health') {
  const probe = await probeHealth(request, baseURL);
  expect(probe, `${label}: ${JSON.stringify(probe)}`).toMatchObject({ status: 200, body: HEALTH_BODY });
  expect(probe.ms, `${label}: answered in ${probe.ms} ms, budget ${HEALTH_BUDGET_MS} ms`).toBeLessThanOrEqual(HEALTH_BUDGET_MS);
  return probe;
}

// Repeated probes until `until()` is true. Trips the abort when a probe exceeds
// abortThresholdMs or is not 200, and calls onAbort once. Returns every sample.
export async function monitorHealth(request, baseURL, { until, intervalMs = 150, abortThresholdMs, onAbort }) {
  const probes = [];
  let abort = null;
  while (!until()) {
    const probe = await probeHealth(request, baseURL);
    probes.push(probe);
    const breached = probe.status !== 200 ? `status ${probe.status} ${probe.error ?? ''}`.trim()
      : probe.ms > abortThresholdMs ? `health took ${probe.ms} ms > abort threshold ${abortThresholdMs} ms` : null;
    if (breached) {
      abort = { reason: breached, atProbe: probes.length, firedAt: performance.now() };
      await onAbort?.(abort);
      break;
    }
    await pause(intervalMs);
  }
  return { probes, abort };
}

export function summarize(probes) {
  const sorted = probes.map(p => p.ms).sort((a, b) => a - b);
  const pick = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
  return {
    samples: sorted.length,
    non200: probes.filter(p => p.status !== 200).length,
    minMs: sorted[0] ?? null, p50Ms: pick(0.5), p95Ms: pick(0.95), maxMs: sorted.at(-1) ?? null,
    overBudget: sorted.filter(ms => ms > HEALTH_BUDGET_MS).length,
    worstMissMs: sorted.length ? Math.max(0, Math.round((sorted.at(-1) - HEALTH_BUDGET_MS) * 10) / 10) : null,
  };
}

// --- Public Shop flows -----------------------------------------------------

export async function login(request, baseURL, user) {
  const response = await request.post(baseURL + '/api/login', { data: { email: user.email, password: user.password } });
  expect(response.status(), `login ${user.id}`).toBe(200);
  return (await response.json()).user;
}

export async function createOrder(request, baseURL, key, items = ORDER_ITEMS) {
  const response = await request.post(baseURL + '/api/orders', {
    headers: { 'Idempotency-Key': key }, data: { currency: 'EUR', items },
  });
  return { status: response.status(), json: await response.json().catch(() => null) };
}

export async function getOrder(request, baseURL, id) {
  const response = await request.get(baseURL + `/api/orders/${id}`);
  return { status: response.status(), json: await response.json().catch(() => null) };
}

export function paymentEvent(app, { id, orderId, amount = ORDER_AMOUNT, currency = 'EUR' }) {
  const body = JSON.stringify({ id, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } });
  const signature = 'sha256=' + createHmac('sha256', app.paymentSecret).update(body).digest('hex');
  return { body, signature };
}

export async function deliverPayment(request, app, event) {
  const started = performance.now();
  const response = await request.post(app.baseURL + '/api/webhooks/payment', {
    headers: { 'content-type': 'application/json', 'X-Test-Payment-Signature': event.signature }, data: event.body,
  });
  return { status: response.status(), json: await response.json().catch(() => null), ms: elapsed(started) };
}

// Durable state through the explicit test-support route (an independent observation).
export async function readState(request, app) {
  const response = await request.get(app.baseURL + '/test-support/state', { headers: { 'X-Test-Admin-Key': app.testAdminKey } });
  expect(response.status(), 'test-support state').toBe(200);
  return response.json();
}

export async function mailpitMessages(request, mailpit, email) {
  const response = await request.get(mailpit.baseURL + '/api/v1/search', { params: { query: `to:"${email}"` } });
  expect(response.status(), 'mailpit search').toBe(200);
  const { messages = [] } = await response.json();
  return messages.filter(m => (m.To ?? []).some(to => to.Address === email));
}

// --- Fault injectors ---------------------------------------------------------

// A loopback port nothing listens on, proven closed before it is handed out.
export async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  const outcome = await new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('error', error => resolve(error.code));
    socket.once('connect', () => { socket.destroy(); resolve('connected'); });
  });
  expect(outcome, `port ${port} must refuse connections before it is used as the SMTP fault`).toBe('ECONNREFUSED');
  return port;
}

// Bounded in-process CPU load: `threads` busy worker threads, each with its own
// deadline so the fault self-clears even if nobody aborts. abort() is the rollback.
export function cpuLoad({ threads, durationMs }) {
  // Each thread reports when its loop started and ended by its own clock, so
  // the self-clearing check is about the thread's deadline, not about how late
  // the contended main thread notices the exit.
  const code = `
    const { workerData, parentPort } = require('node:worker_threads');
    const started = Date.now();
    const end = started + workerData.durationMs;
    let x = 1;
    while (Date.now() < end) { x = (x * 48271) % 2147483647; }
    parentPort.postMessage({ started, ended: Date.now() });
  `;
  const startedAt = performance.now();
  const workers = Array.from({ length: threads }, () => new Worker(code, { eval: true, workerData: { durationMs } }));
  const reports = new Map();
  for (const worker of workers) worker.once('message', report => reports.set(worker, report));
  const exits = workers.map(worker => new Promise(resolve => worker.once('exit', code => {
    const report = reports.get(worker);
    resolve({ code, at: performance.now(), ranMs: report ? report.ended - report.started : null });
  })));
  let done = false;
  const finished = Promise.all(exits).then(results => { done = true; return results; });
  let aborted = false;
  return {
    startedAt, threads, durationMs, finished,
    get done() { return done; },
    get aborted() { return aborted; },
    async abort() {
      aborted = true;
      const started = performance.now();
      await Promise.all(workers.map(worker => worker.terminate()));
      await finished;
      return elapsed(started);
    },
  };
}

// --- Experiment record ---------------------------------------------------------

// Records hypothesis, blast radius, abort condition and rollback as annotations
// before any fault is injected; attaches the full record (baseline vs observed)
// to the test result at the end.
export function experiment(testInfo, { name, hypothesis, blastRadius, abortCondition, rollback }) {
  const record = { name, hypothesis, blastRadius, abortCondition, rollback,
    baseline: null, observed: {}, abort: null, rollbackMs: null, recoveryMs: null, dataIntegrity: null, verdict: null };
  for (const [type, description] of Object.entries({ hypothesis, 'blast-radius': blastRadius, 'abort-condition': abortCondition, rollback })) {
    testInfo.annotations.push({ type, description });
  }
  return {
    record,
    async finish(verdict) {
      record.verdict = verdict;
      testInfo.annotations.push({ type: 'verdict', description: verdict });
      await testInfo.attach('experiment-record', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });
      console.log(`[chaos] ${name}: ${verdict}\n${JSON.stringify({ baseline: record.baseline, observed: record.observed, abort: record.abort, rollbackMs: record.rollbackMs, recoveryMs: record.recoveryMs, dataIntegrity: record.dataIntegrity })}`);
    },
  };
}
