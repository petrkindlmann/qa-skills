// The request script that produced the recordings. The recorder (record.mjs) runs it against a
// healthy Shop and writes one cassette per step; the fidelity check (stub-fidelity.spec.mjs) runs
// the same steps again and compares each live response's shape with the cassette. One list, so
// the two can never drift apart.

export const ORDER_BODY = { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }] };

export const steps = [
  { name: 'health', method: 'GET', path: '/health' },
  { name: 'catalog', method: 'GET', path: '/api/catalog' },
  { name: 'me-unauthenticated', method: 'GET', path: '/api/me' },
  { name: 'login-invalid', method: 'POST', path: '/api/login',
    body: ({ users }) => ({ email: users.alice.email, password: 'not-the-password' }) },
  { name: 'login-ok', method: 'POST', path: '/api/login',
    body: ({ users }) => ({ email: users.alice.email, password: users.alice.password }) },
  { name: 'me-authenticated', method: 'GET', path: '/api/me' },
  { name: 'orders-create', method: 'POST', path: '/api/orders',
    headers: { 'Idempotency-Key': 'rec-key-1' }, body: () => ORDER_BODY,
    remember: (ctx, response) => { ctx.orderId = response.body?.order?.id; } },
  { name: 'orders-create-replayed', method: 'POST', path: '/api/orders',
    headers: { 'Idempotency-Key': 'rec-key-1' }, body: () => ORDER_BODY },
  { name: 'orders-create-conflict', method: 'POST', path: '/api/orders',
    headers: { 'Idempotency-Key': 'rec-key-1' },
    body: () => ({ currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }] }) },
  { name: 'orders-create-invalid', method: 'POST', path: '/api/orders',
    headers: { 'Idempotency-Key': 'rec-key-2' },
    body: () => ({ currency: 'EUR', items: [{ sku: 'NO-SUCH-SKU', quantity: 1 }] }) },
  { name: 'orders-list', method: 'GET', path: '/api/orders' },
  { name: 'orders-get', method: 'GET', path: ctx => `/api/orders/${ctx.orderId}` },
  { name: 'orders-get-unknown', method: 'GET', path: '/api/orders/does-not-exist' },
  { name: 'logout', method: 'POST', path: '/api/logout' },
  { name: 'login-throttled', method: 'POST', path: '/api/login',
    // Five failures for bob inside the 60 s window; the sixth attempt, with the right
    // password, is the one recorded (contract: 429 too_many_attempts, Retry-After: 60).
    prepare: async ({ send, users }) => {
      for (let i = 0; i < 5; i++) {
        const r = await send({ method: 'POST', path: '/api/login', headers: { 'content-type': 'application/json' },
          body: { email: users.bob.email, password: 'wrong-' + i } });
        if (r.status !== 401) throw new Error(`throttle warm-up attempt ${i + 1} returned ${r.status}, expected 401`);
      }
    },
    body: ({ users }) => ({ email: users.bob.email, password: users.bob.password }) },
];

const KEPT_HEADERS = ['content-type', 'retry-after', 'set-cookie'];

// Reduce a raw response to what a stub needs and what the fidelity check compares.
export function normalizeResponse({ status, headers, text }) {
  const kept = {};
  for (const name of KEPT_HEADERS) {
    if (headers[name] === undefined) continue;
    kept[name] = name === 'set-cookie' ? headers[name].replace(/^(\w+)=[^;]*/, '$1=<redacted>') : headers[name];
  }
  let body = null, unparsable;
  if (text.length) {
    try { body = JSON.parse(text); } catch { unparsable = text; }
  }
  return { status, headers: kept, body, ...(unparsable !== undefined ? { unparsable } : {}) };
}

// `send({ method, path, headers, body })` must keep cookies between calls and resolve to
// { status, headers (lower-cased), text }.
export async function runScenario({ send, users, onStep }) {
  const ctx = { users };
  for (const step of steps) {
    if (step.prepare) await step.prepare({ send, users, ctx });
    const path = typeof step.path === 'function' ? step.path(ctx) : step.path;
    const body = step.body ? step.body(ctx) : undefined;
    const headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(step.headers ?? {}) };
    const response = normalizeResponse(await send({ method: step.method, path, headers, body }));
    if (step.remember) step.remember(ctx, response);
    await onStep(step, { method: step.method, path, headers, body: body ?? null }, response);
  }
  return ctx;
}

// Adapter for a Playwright APIRequestContext (cookie jar included).
export function playwrightSender(requestContext, baseURL) {
  return async ({ method, path, headers, body }) => {
    const response = await requestContext.fetch(baseURL + path, {
      method, headers, data: body === undefined ? undefined : JSON.stringify(body), maxRedirects: 0,
    });
    return { status: response.status(), headers: response.headers(), text: await response.text() };
  };
}
