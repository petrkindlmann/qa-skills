import test from 'node:test';
import assert from 'node:assert/strict';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { loadFunctions } from './snippets.mjs';

const source = 'skills/service-virtualization/references/msw.md';
const paymentsUrl = 'https://api.stripe.com/v1/payment_intents';

function fixture(t) {
  // Freeze only the documented factory's clock. MSW and fetch remain real.
  const exports = loadFunctions(source, '// test/mocks/handlers.ts',
    ['handlers', 'createPaymentHandlers', 'errorHandlers'], {
      http, HttpResponse, delay, Date: { now: () => 1_700_000_000_000 },
    });
  const lifecycle = {};
  const { server } = loadFunctions(source, '// vitest.setup.ts', ['server'], {
    setupServer, ...exports, process: { env: { CI: '1' } },
    beforeAll: fn => { lifecycle.start = fn; },
    afterEach: fn => { lifecycle.reset = fn; },
    afterAll: fn => { lifecycle.stop = fn; },
  });
  let bypassed = 0;
  server.events.on('response:bypass', () => { bypassed++; });
  t.after(() => {
    lifecycle.stop();
    assert.equal(bypassed, 0, 'all responses must come from MSW, not a provider');
  });
  lifecycle.start();
  const create = (headers = {}) => fetch(paymentsUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ amount: '5000', currency: 'usd' }),
  });
  return { server, lifecycle, create };
}

test('documented payment handlers support create, retrieve, confirm, and missing IDs', async t => {
  const { create } = fixture(t);
  const response = await create();
  assert.equal(response.status, 201);
  const payment = await response.json();
  assert.equal(payment.amount, 5000);
  assert.equal(payment.status, 'requires_confirmation');
  const url = paymentsUrl + '/' + payment.id;
  assert.deepEqual(await (await fetch(url)).json(), payment);
  const confirmation = await fetch(url + '/confirm', { method: 'POST' });
  assert.equal(confirmation.status, 200);
  assert.equal((await confirmation.json()).status, 'succeeded');
  assert.equal((await (await fetch(url)).json()).status, 'succeeded');
  assert.equal((await fetch(paymentsUrl + '/missing')).status, 404);
});

test('rate-limit scenario wins over the matching payment success handler', async t => {
  const { create } = fixture(t);
  const response = await create({ 'x-test-scenario': 'rate-limit' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '1');
  assert.equal((await response.json()).error.type, 'rate_limit_error');
  assert.equal((await create()).status, 201, 'ordinary requests still fall through to success');
});

test('documented lifecycle clears payment state between tests', async t => {
  const { create, lifecycle } = fixture(t);
  const payment = await (await create()).json();
  const url = paymentsUrl + '/' + payment.id;
  assert.equal((await fetch(url)).status, 200, 'the fixture existed before reset');
  lifecycle.reset();
  assert.equal((await fetch(url)).status, 404, 'handler reset must also replace its closure state');
});

test('payments created at the same clock tick receive distinct fixture IDs', async t => {
  const { create } = fixture(t);
  const first = await (await create()).json();
  const second = await (await create()).json();
  assert.notEqual(first.id, second.id);
});

test('the documented CI setup rejects an unhandled request before network fallback', async t => {
  fixture(t);
  const errors = [];
  t.mock.method(console, 'error', message => errors.push(String(message)));
  await assert.rejects(fetch('https://unhandled.example.invalid/request'),
    /Cannot bypass a request.*error.*onUnhandledRequest/s);
  assert.ok(errors.some(message => message.includes('without a matching request handler')));
});

function sampleClient(options) {
  const { createPaymentClient } = loadFunctions(source, '// test/mocks/payment-client.ts',
    ['createPaymentClient']);
  return createPaymentClient(options);
}

// Adapt only Vitest's assertions/registration to node:test. The handlers, setup,
// sample client, and timeout/retry scenarios themselves come from the code fences.
const exampleExpect = actual => ({
  toBe: expected => assert.equal(actual, expected),
  toEqual: expected => assert.deepEqual(actual, expected),
  rejects: {
    toThrow: message => assert.rejects(actual, error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(message), 'expected error: ' + message);
      return true;
    }),
  },
});

for (const title of ['should handle payment API timeout', 'should retry on 503']) {
  test('documented scenario: ' + title, async t => {
    const { server } = fixture(t);
    const { createPaymentClient } = loadFunctions(source, '// test/mocks/payment-client.ts',
      ['createPaymentClient']);
    const cases = [];
    loadFunctions(source, '// test/payment-errors.test.ts', [], {
      http, HttpResponse, delay, server, createPaymentClient,
      it: (name, run) => cases.push({ name, run }),
      expect: exampleExpect,
    });
    const selected = cases.filter(candidate => candidate.name === title);
    assert.equal(selected.length, 1, 'the intended example must actually be executed');
    await selected[0].run();
  });
}

test('sample client exposes rate limiting without retrying it as a 503', async t => {
  const { server } = fixture(t);
  let attempts = 0;
  server.events.on('request:start', ({ request }) => {
    if (request.url === paymentsUrl) attempts++;
  });
  await assert.rejects(sampleClient().createPayment(5000, {
    idempotencyKey: 'rate-limit-operation', scenario: 'rate-limit',
  }), error => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, '1');
    return true;
  });
  assert.equal(attempts, 1, 'the controlled rate-limit request must be observed exactly once');
});

test('sample client caps persistent 503 retries and keeps the request identity', async t => {
  const { server } = fixture(t);
  const calls = [];
  const waits = [];
  server.use(http.post(paymentsUrl, async ({ request }) => {
    calls.push({
      key: request.headers.get('Idempotency-Key'),
      body: await request.text(),
    });
    return HttpResponse.json({ error: { type: 'api_error' } }, { status: 503 });
  }));
  const client = sampleClient({
    maxAttempts: 3,
    wait: async ms => { waits.push(ms); },
  });
  await assert.rejects(client.createPayment(5000, { idempotencyKey: 'bounded-operation' }),
    error => error.status === 503);
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ({
    key: 'bounded-operation', body: 'amount=5000&currency=usd',
  })));
  assert.deepEqual(waits, [100, 200]);
});

test('documented reset removes a runtime failure override', async t => {
  const { server, lifecycle, create } = fixture(t);
  server.use(http.post(paymentsUrl, () => new HttpResponse(null, { status: 503 })));
  assert.equal((await create()).status, 503, 'the fault override must first be observed');
  lifecycle.reset();
  assert.equal((await create()).status, 201);
});
