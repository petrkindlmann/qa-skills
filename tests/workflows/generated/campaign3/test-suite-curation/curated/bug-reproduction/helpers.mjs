// Shared public-contract helpers for the two support reports.
// Everything here talks to the Shop over plain HTTP; nothing reads application internals.
import { expect, request } from '@playwright/test';
import { oracle } from '../../../../../support/oracle.mjs';

// Contract example basket: TEA-50 x2 (1200 each) + CUP-01 x1 (1800) = 4200 minor units.
export const BASKET = { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }] };
export const BASKET_AMOUNT = 4200;
// Same intent, different wire order. The contract says item order does not change intent.
export const BASKET_REORDERED = { currency: 'EUR', items: [{ sku: 'CUP-01', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }] };
// Three distinct intents under the same key: quantity, SKU set, currency.
export const BASKET_QTY_CHANGED = { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 3 }, { sku: 'CUP-01', quantity: 1 }] };
export const BASKET_SKU_CHANGED = { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }] };
export const BASKET_CURRENCY_CHANGED = { currency: 'USD', items: BASKET.items };

export function sessionCookieFrom(response) {
  const header = response.headersArray().find(h => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('shop_session='));
  if (!header) throw new Error('login response carried no shop_session cookie');
  return header.value.split(';')[0].slice('shop_session='.length);
}

// Signs in through POST /api/login. The returned context keeps the session in its own jar,
// and `cookie` is the raw token so a second party can "copy" it the way the report describes.
export async function signIn(baseURL, user) {
  const ctx = await request.newContext({ baseURL });
  const response = await ctx.post('/api/login', { data: { email: user.email, password: user.password } });
  expect(response.status(), 'sign-in must succeed').toBe(200);
  expect(await response.json()).toEqual({ user: { id: user.id, email: user.email } });
  return { ctx, cookie: sessionCookieFrom(response) };
}

// A separate HTTP client that presents only the copied cookie value, nothing else shared.
export async function copiedSession(baseURL, cookie) {
  return request.newContext({ baseURL, extraHTTPHeaders: { cookie: `shop_session=${cookie}` } });
}

export function postOrder(ctx, key, basket) {
  return ctx.post('/api/orders', { headers: { 'Idempotency-Key': key }, data: basket });
}

export async function createOrder(ctx, key, basket = BASKET) {
  const response = await postOrder(ctx, key, basket);
  expect(response.status(), 'first use of a key creates an order').toBe(201);
  const body = await response.json();
  expect(body.replayed).toBe(false);
  return body.order;
}

export async function listOrders(ctx) {
  const response = await ctx.get('/api/orders');
  expect(response.status()).toBe(200);
  return (await response.json()).orders;
}

// Report 1 oracle. After sign-out, a session copied earlier must be refused by every
// authenticated endpoint, not merely dropped from the browser that signed out.
export async function expectSessionRevoked(copied, orderId) {
  const me = await copied.get('/api/me');
  // Matrix oracle (added after authoring): the designated assertion for the logout fault run.
  await oracle('c3-bugrepro-logout', 'toBe', () => expect(me.status(), 'copied cookie must not load /api/me after sign-out').toBe(401));
  expect(await me.json()).toEqual({ error: 'unauthenticated' });
  const orders = await copied.get('/api/orders');
  expect(orders.status(), 'copied cookie must not list orders after sign-out').toBe(401);
  if (orderId) {
    const one = await copied.get(`/api/orders/${orderId}`);
    expect(one.status(), 'copied cookie must not read a single order after sign-out').toBe(401);
  }
}

// Report 2 oracle. Reusing a key with a different intent must conflict and create nothing.
export async function expectIdempotencyConflict(ctx, key, basket, label) {
  const response = await postOrder(ctx, key, basket);
  // Matrix oracle (added after authoring): the designated assertion for the idempotency fault run.
  await oracle('c3-bugrepro-idempotency', 'toBe', () => expect(response.status(), `${label}: reuse with a different basket must be refused`).toBe(409));
  expect(await response.json()).toEqual({ error: 'idempotency_conflict' });
}

export async function disposeAll(...contexts) {
  for (const ctx of contexts) if (ctx) await ctx.dispose().catch(() => {});
}
