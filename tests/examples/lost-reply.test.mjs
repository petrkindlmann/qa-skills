import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { loadFunctions } from './snippets.mjs';

const { startReplyDroppingProxy, retryAfterLostReply } = loadFunctions(
  'skills/api-testing/references/lost-reply-retry.md', 'function retryAfterLostReply(',
  ['startReplyDroppingProxy', 'retryAfterLostReply'], { http, https });

// An order service with its orders in a file, so they survive a restart.
//   dedup 'durable': the idempotency key is stored with the order
//   dedup 'memory':  the key lives in the process and is gone after a restart
//   dedup 'none':    every request makes an order
//   replay 'conflict': a repeated key is refused instead of answered with the first order
async function orderService(t, { dedup = 'durable', replay = 'same', reject = false } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-orders-')), 'orders.json');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(file, '[]');
  const orders = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  let server, port = 0;
  const start = async () => {
    const inMemory = new Map();
    server = http.createServer((request, response) => {
      const json = (status, body) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (request.method === 'GET') return json(200, orders());
      let raw = '';
      request.on('data', chunk => { raw += chunk; });
      request.on('end', () => {
        if (reject) return json(422, { error: 'sku is required' });
        const key = request.headers['idempotency-key'];
        const stored = orders();
        const earlier = dedup === 'durable' ? stored.find(order => order.key === key) : dedup === 'memory' ? inMemory.get(key) : null;
        if (earlier) return replay === 'conflict' ? json(409, { error: 'duplicate request' }) : json(201, { id: earlier.id });
        const order = { id: `ord_${stored.length + 1}`, key, ...JSON.parse(raw) };
        fs.writeFileSync(file, JSON.stringify([...stored, order]));
        inMemory.set(key, order);
        json(201, { id: order.id });
      });
    });
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    port = server.address().port;
  };
  const stop = () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  await start();
  t.after(stop);
  return { url: `http://127.0.0.1:${port}`, orders, restart: async () => { await stop(); await start(); } };
}

// The application's client: one attempt, or its own retry on a network error.
const client = ({ key = () => 'order-7f3a', retries = 0 } = {}) => async baseUrl => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const reply = await fetch(`${baseUrl}/orders`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key() },
        body: JSON.stringify({ sku: 'SKU-1' }),
      });
      if (!reply.ok) throw Object.assign(new Error(`HTTP ${reply.status}`), { status: reply.status });
      return await reply.json();
    } catch (error) {
      if (error.status || attempt >= retries) throw error;
    }
  }
};
const count = service => async () => service.orders().length;

test('a durable key: the reply is lost, the retry returns the first order, one order exists', async t => {
  const service = await orderService(t);
  const outcome = await retryAfterLostReply({ target: service.url, send: client(), countEffects: count(service) });
  assert.equal(outcome.verdict, 'one_effect', outcome.reason);
  assert.equal(outcome.effects, 1);
  assert.equal(outcome.clientRetried, false);
  assert.equal(outcome.restarted, false);
  assert.equal(outcome.retryError, null);
  // The service did commit and answer before the caller lost the connection.
  assert.equal(outcome.lost.status, 201);
  assert.deepEqual(outcome.result, JSON.parse(outcome.lost.body));
  assert.equal(service.orders().length, 1);
});

test('the same service after a restart between the attempts', async t => {
  const service = await orderService(t);
  const outcome = await retryAfterLostReply({ target: service.url, send: client(), countEffects: count(service), restart: service.restart });
  assert.equal(outcome.verdict, 'one_effect', outcome.reason);
  assert.equal(outcome.restarted, true);
  assert.deepEqual(outcome.result, { id: 'ord_1' });
});

test('no deduplication: the retry places a second order', async t => {
  const service = await orderService(t, { dedup: 'none' });
  const outcome = await retryAfterLostReply({ target: service.url, send: client(), countEffects: count(service) });
  assert.equal(outcome.verdict, 'duplicated');
  assert.equal(outcome.effects, 2);
  assert.match(outcome.reason, /produced 2 effects/);
  assert.notDeepEqual(outcome.result, JSON.parse(outcome.lost.body));
});

test('keys kept in memory pass until the service restarts', async t => {
  const warm = await orderService(t, { dedup: 'memory' });
  assert.equal((await retryAfterLostReply({ target: warm.url, send: client(), countEffects: count(warm) })).verdict, 'one_effect');

  const restarted = await orderService(t, { dedup: 'memory' });
  const outcome = await retryAfterLostReply({ target: restarted.url, send: client(), countEffects: count(restarted), restart: restarted.restart });
  assert.equal(outcome.verdict, 'duplicated');
  assert.equal(outcome.restarted, true);
});

test('a client that makes a new key for each attempt defeats a correct server', async t => {
  const service = await orderService(t);
  let attempt = 0;
  const outcome = await retryAfterLostReply({ target: service.url, send: client({ key: () => `order-${attempt += 1}` }), countEffects: count(service) });
  assert.equal(outcome.verdict, 'duplicated');
});

test('a client that retries by itself is observed through the proxy', async t => {
  const service = await orderService(t);
  const outcome = await retryAfterLostReply({ target: service.url, send: client({ retries: 1 }), countEffects: count(service) });
  assert.equal(outcome.verdict, 'one_effect', outcome.reason);
  assert.equal(outcome.clientRetried, true);
  assert.deepEqual(outcome.result, { id: 'ord_1' });

  const broken = await orderService(t, { dedup: 'none' });
  const duplicated = await retryAfterLostReply({ target: broken.url, send: client({ retries: 1 }), countEffects: count(broken) });
  assert.equal(duplicated.verdict, 'duplicated');
  assert.equal(duplicated.clientRetried, true);

  const cannotRestart = await retryAfterLostReply({ target: service.url, send: client({ key: () => 'order-2', retries: 1 }), countEffects: count(service), restart: service.restart });
  assert.equal(cannotRestart.verdict, 'inconclusive');
  assert.match(cannotRestart.reason, /retried on its own/);
});

test('one effect with a retry the caller cannot use is visible in the outcome', async t => {
  const service = await orderService(t, { replay: 'conflict' });
  const outcome = await retryAfterLostReply({ target: service.url, send: client(), countEffects: count(service) });
  assert.equal(outcome.verdict, 'one_effect');
  assert.equal(outcome.retryError.status, 409);
  assert.equal(outcome.result, undefined);
});

test('nothing lost is inconclusive, not a pass', async t => {
  const refusing = await orderService(t, { reject: true });
  const refused = await retryAfterLostReply({ target: refusing.url, send: client(), countEffects: count(refusing) });
  assert.equal(refused.verdict, 'inconclusive');
  assert.match(refused.reason, /answered 422, so no committed write was lost/);

  const service = await orderService(t);
  const bypassed = await retryAfterLostReply({ target: service.url, send: () => client()(service.url), countEffects: count(service) });
  assert.equal(bypassed.verdict, 'inconclusive');
  assert.match(bypassed.reason, /0 replies were dropped/);

  const blind = await retryAfterLostReply({ target: service.url, send: client({ key: () => 'order-3' }), countEffects: async () => 0 });
  assert.equal(blind.verdict, 'inconclusive');
  assert.match(blind.reason, /does not see one new effect/);

  const everyReply = await retryAfterLostReply({ target: service.url, send: client({ key: () => 'order-4', retries: 2 }), countEffects: count(service), drop: () => true });
  assert.equal(everyReply.verdict, 'inconclusive');
  assert.match(everyReply.reason, /3 replies were dropped/);
});

test('an acknowledged write that is gone after the retry is reported as missing', async t => {
  const service = await orderService(t);
  // The counter sees the order after the first attempt; by the last read it is gone, as
  // after a transaction that was acknowledged and then rolled back.
  let reads = 0;
  const countEffects = async () => ((reads += 1) === 3 ? 0 : service.orders().length);
  const outcome = await retryAfterLostReply({ target: service.url, send: client(), countEffects });
  assert.equal(outcome.verdict, 'missing');
});

test('the proxy forwards what it does not drop, and says when the service is down', async t => {
  const service = await orderService(t);
  const proxy = await startReplyDroppingProxy(service.url, { drop: exchange => exchange.method === 'POST' && exchange.path === '/orders' && proxy.dropped.length === 0 });
  t.after(proxy.close);
  assert.deepEqual(await (await fetch(`${proxy.url}/orders`)).json(), []);
  await assert.rejects(client()(proxy.url), /fetch failed/);
  assert.deepEqual(await client()(proxy.url), { id: 'ord_1' });
  assert.equal(proxy.dropped.length, 1);
  assert.deepEqual(proxy.dropped[0], { method: 'POST', path: '/orders', requestBody: '{"sku":"SKU-1"}', status: 201, body: '{"id":"ord_1"}' });
  assert.deepEqual(proxy.forwarded.map(exchange => [exchange.method, exchange.status]), [['GET', 200], ['POST', 201]]);

  const nowhere = await startReplyDroppingProxy('http://127.0.0.1:9');
  t.after(nowhere.close);
  const reply = await fetch(`${nowhere.url}/orders`, { method: 'POST', body: '{}' });
  assert.equal(reply.status, 502);
  assert.equal(nowhere.dropped.length, 0);
});
