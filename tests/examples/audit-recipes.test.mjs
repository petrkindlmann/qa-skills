import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { before, after, test } from 'node:test';
import { loadFunctions } from './snippets.mjs';

let server, origin, mode;
const calls = [];
before(async () => {
  server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    calls.push({ path: request.url, method: request.method, authorization: request.headers.authorization, body: JSON.parse(text) });
    if (mode === 'stalled-headers') return;
    response.writeHead(mode === 'http-error' ? 401 : 200, { 'Content-Type': 'application/json' });
    if (mode === 'stalled-body') { response.write('{"message":'); return; }
    if (mode === 'bad-json') return response.end('{not-json');
    response.end(JSON.stringify(request.url.endsWith('/wait') ? { message: { subject: 'Verify your account' } }
      : { id: 'fixture-inbox', email: 'test@example.test' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
});

// Only transport destination is remapped. The documented fetch, body handling and abort signal run unchanged.
const { shazaMailPost } = loadFunctions('skills/email-testing/references/hosted-inboxes.md',
  'function shazaMailPost', ['shazaMailPost'], {
    fetch: (url, options) => fetch(new URL(new URL(url).pathname, origin), options),
    process: { env: { SHAZAMAIL_API_KEY: 'synthetic-local-test-key' } },
  });

test('actual ShazaMail helper creates an inbox and waits using real local HTTP', async () => {
  mode = 'healthy'; calls.length = 0;
  const inbox = await shazaMailPost('/api/v1/test-inboxes', { ttl_seconds: 1800 }, { timeoutMs: 1000 });
  const delivery = await shazaMailPost(`/api/v1/test-inboxes/${inbox.id}/wait`, { timeout_ms: 20, match: { subject: 'Verify your account' } }, { timeoutMs: 1000 });
  assert.equal(inbox.email, 'test@example.test');
  assert.equal(delivery.message.subject, 'Verify your account');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.method === 'POST' && call.authorization === 'Bearer synthetic-local-test-key'));
  assert.deepEqual(calls[1].body, { timeout_ms: 20, match: { subject: 'Verify your account' } });
});

for (const endpoint of ['/api/v1/test-inboxes', '/api/v1/test-inboxes/fixture-inbox/wait']) {
  for (const fault of ['stalled-headers', 'stalled-body']) {
    test(`actual ShazaMail helper bounds ${fault} on ${endpoint.endsWith('/wait') ? 'wait' : 'create'}`, async () => {
      mode = fault;
      const start = performance.now();
      await assert.rejects(shazaMailPost(endpoint, { timeout_ms: 10 }, { timeoutMs: 80 }), /client deadline exceeded \(80 ms\)/);
      assert.ok(performance.now() - start < 2000, 'client deadline must settle the request, including body parsing');
      assert.equal(calls.at(-1).path, endpoint);
    });
  }
}

test('ShazaMail HTTP and malformed JSON failures remain distinct from client timeouts', async () => {
  mode = 'http-error';
  await assert.rejects(shazaMailPost('/api/v1/test-inboxes', {}, { timeoutMs: 1000 }), /returned HTTP 401/);
  mode = 'bad-json';
  await assert.rejects(shazaMailPost('/api/v1/test-inboxes', {}, { timeoutMs: 1000 }), /transport or JSON response failure/);
});

test('ShazaMail rejects absent credentials, invalid budgets and unsupported paths without requests', async () => {
  mode = 'healthy';
  const initial = calls.length;
  await assert.rejects(shazaMailPost('/api/v1/test-inboxes', {}, { apiKey: '' }), /SHAZAMAIL_API_KEY is required/);
  await assert.rejects(shazaMailPost('/api/v1/test-inboxes', {}, { timeoutMs: 0 }), /positive integer/);
  await assert.rejects(shazaMailPost('https://other.example/api/v1/test-inboxes', {}), /Unsupported/);
  assert.equal(calls.length, initial);
});
