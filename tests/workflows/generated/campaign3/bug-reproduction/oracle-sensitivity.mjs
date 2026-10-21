// Sensitivity check for the two oracles in helpers.mjs (the skill's "watch it go red" step).
// The real Shop is healthy, so the specs can only be seen green against it. This script stands
// up a throwaway HTTP stub that behaves exactly as the two reports describe, runs the same
// oracle functions the specs use against it, and requires each oracle to FAIL. It is a check
// of the tests, not of the application, and it is not part of the Playwright suite.
//   node tests/workflows/generated/campaign3/bug-reproduction/oracle-sensitivity.mjs
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { request } from '@playwright/test';
import { BASKET, BASKET_QTY_CHANGED, copiedSession, createOrder, expectIdempotencyConflict, expectSessionRevoked, signIn } from './helpers.mjs';

function defectiveShop() {
  const sessions = new Set();           // never shrinks: logout only tells the browser to drop the cookie
  const orders = [];                    // idempotency keys are ignored: every POST creates an order
  const user = { id: 'alice', email: 'alice+stub@example.test' };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const cookie = (req.headers.cookie ?? '').match(/shop_session=([^;]+)/)?.[1];
      const authed = cookie && sessions.has(cookie);
      const json = (status, payload, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(payload)); };
      if (req.method === 'POST' && req.url === '/api/login') {
        const token = randomUUID(); sessions.add(token);
        return json(200, { user }, { 'set-cookie': `shop_session=${token}; HttpOnly; SameSite=Lax; Path=/` });
      }
      if (req.method === 'POST' && req.url === '/api/logout') {
        // Defect 1: clears the cookie in the caller's browser but keeps the token valid server side.
        res.writeHead(204, { 'set-cookie': 'shop_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }); return res.end();
      }
      if (!authed) return json(401, { error: 'unauthenticated' });
      if (req.url === '/api/me') return json(200, { user });
      if (req.method === 'POST' && req.url === '/api/orders') {
        // Defect 2: a reused key with a different basket yields 200 and a brand-new order.
        const { currency, items } = JSON.parse(body);
        const key = req.headers['idempotency-key'];
        const existing = orders.find(o => o.key === key);
        const amount = items.reduce((sum, i) => sum + i.quantity * (i.sku === 'TEA-50' ? 1200 : 1800), 0);
        const order = { id: randomUUID(), user_id: user.id, currency, amount, items, status: 'pending', fulfillment_count: 0 };
        orders.push({ key, order });
        return json(existing ? 200 : 201, { order, replayed: false });
      }
      if (req.method === 'GET' && req.url === '/api/orders') return json(200, { orders: orders.map(o => o.order) });
      if (req.method === 'GET' && req.url.startsWith('/api/orders/')) {
        const hit = orders.find(o => o.order.id === req.url.slice('/api/orders/'.length));
        return hit ? json(200, { order: hit.order }) : json(404, { error: 'not_found' });
      }
      json(404, { error: 'not_found' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ baseURL: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) })));
}

async function mustFail(label, run) {
  try { await run(); console.log(`NOT SENSITIVE  ${label}: oracle passed against the defective stub`); return false; }
  catch (error) { console.log(`SENSITIVE      ${label}: ${String(error.message).split('\n')[0]}`); return true; }
}

const stub = await defectiveShop();
const user = { id: 'alice', email: 'alice+stub@example.test', password: 'irrelevant-for-stub' };
let ok = true;
try {
  const { ctx: owner, cookie } = await signIn(stub.baseURL, user);
  const colleague = await copiedSession(stub.baseURL, cookie);
  const order = await createOrder(colleague, 'sens-1', BASKET);
  await owner.post('/api/logout');
  ok &= await mustFail('report 1 (session not revoked server side)', () => expectSessionRevoked(colleague, order.id));
  // The stub's logout clears the owner's jar (Max-Age=0), so report 2 needs its own session.
  const { ctx: buyer } = await signIn(stub.baseURL, user);
  await createOrder(buyer, 'sens-2', BASKET);
  ok &= await mustFail('report 2 (changed basket accepted under used key)', () => expectIdempotencyConflict(buyer, 'sens-2', BASKET_QTY_CHANGED, 'stub'));
  await owner.dispose(); await colleague.dispose(); await buyer.dispose();
} finally {
  await stub.close();
}
console.log(ok ? 'RESULT: both oracles fail against the defective stub' : 'RESULT: at least one oracle is blind');
process.exit(ok ? 0 : 1);
