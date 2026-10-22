import { request as playwrightRequest } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { expect } from '../../../support/fixtures.mjs';

export const ORDER_KEYS = ['amount', 'currency', 'fulfillment_count', 'id', 'items', 'status', 'user_id'];

// Independent API client with its own cookie jar. Callers dispose it.
export async function apiClient(app, extraHTTPHeaders = {}) {
  return playwrightRequest.newContext({ baseURL: app.baseURL, extraHTTPHeaders });
}

export async function signIn(app, user, password = user.password) {
  const client = await apiClient(app);
  const response = await client.post('/api/login', { data: { email: user.email, password } });
  expect(response.status(), `sign-in for ${user.id}`).toBe(200);
  return client;
}

export async function sessionCookie(client) {
  const { cookies } = await client.storageState();
  const cookie = cookies.find(c => c.name === 'shop_session');
  expect(cookie, 'shop_session cookie in the client jar').toBeTruthy();
  return cookie.value;
}

// Replays a captured session from a client that shares nothing with the original.
export async function replaySession(app, cookieValue) {
  const client = await apiClient(app, { Cookie: `shop_session=${cookieValue}` });
  try {
    return (await client.get('/api/me')).status();
  } finally {
    await client.dispose();
  }
}

export function orderBody(items, currency = 'EUR', extra = {}) {
  return { currency, items, ...extra };
}

export async function postOrder(client, key, body) {
  const headers = key === undefined ? {} : { 'Idempotency-Key': key };
  return client.post('/api/orders', { headers, data: body });
}

export function sortItems(items) {
  return [...items].sort((a, b) => a.sku.localeCompare(b.sku));
}

// Exact-key shape check: a missing or extra field fails, not only a wrong value.
export function expectOrder(order, expected) {
  expect(Object.keys(order).sort()).toEqual(ORDER_KEYS);
  expect(order.id).toEqual(expect.any(String));
  expect(order.id.length).toBeGreaterThan(0);
  expect(Number.isInteger(order.amount)).toBe(true);
  expect(Number.isInteger(order.fulfillment_count)).toBe(true);
  const { items, ...rest } = expected;
  expect(order).toMatchObject(rest);
  if (items) expect(sortItems(order.items)).toEqual(sortItems(items));
}

export async function supportState(app) {
  const client = await apiClient(app, { 'X-Test-Admin-Key': app.testAdminKey });
  try {
    const response = await client.get('/test-support/state');
    expect(response.status(), 'test-support state').toBe(200);
    return await response.json();
  } finally {
    await client.dispose();
  }
}

export async function advanceClock(app, seconds) {
  const client = await apiClient(app, { 'X-Test-Admin-Key': app.testAdminKey });
  try {
    const response = await client.post('/test-support/clock', { data: { advance_seconds: seconds } });
    expect(response.status(), 'test-support clock').toBe(200);
  } finally {
    await client.dispose();
  }
}

export function paymentEvent(id, orderId, amount, currency = 'EUR') {
  return JSON.stringify({ id, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } });
}

export function sign(secret, bodyText) {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(bodyText, 'utf8')).digest('hex')}`;
}

// Sends the exact bytes given; `signature` null omits the header entirely.
export async function deliverPayment(client, bodyText, signature) {
  const headers = { 'content-type': 'application/json' };
  if (signature !== null) headers['X-Test-Payment-Signature'] = signature;
  return client.post('/api/webhooks/payment', { headers, data: Buffer.from(bodyText, 'utf8') });
}

// --- Mailpit -------------------------------------------------------------

async function searchRecipient(api, mailpit, recipient) {
  const query = new URLSearchParams({ query: `to:${recipient}` });
  const response = await api.get(`${mailpit.baseURL}/api/v1/search?${query}`, { timeout: 5000 });
  if (!response.ok()) throw new Error(`Mailpit search returned HTTP ${response.status()}`);
  const { messages } = await response.json();
  if (!Array.isArray(messages)) throw new Error('Mailpit search has no messages array');
  const wanted = recipient.toLowerCase();
  return messages.filter(m => m.To?.some(t => t.Address.toLowerCase() === wanted));
}

export async function messageIdsFor(api, mailpit, recipient) {
  return (await searchRecipient(api, mailpit, recipient)).map(m => m.ID);
}

export async function waitForEmail(api, mailpit, recipient, { excludeIds = [], timeout = 15000 } = {}) {
  let id = null;
  await expect.poll(async () => {
    const match = (await searchRecipient(api, mailpit, recipient)).find(m => !excludeIds.includes(m.ID));
    id = match?.ID ?? null;
    return id;
  }, { message: `no new email for ${recipient}`, timeout, intervals: [200, 500, 1000] }).not.toBeNull();
  const response = await api.get(`${mailpit.baseURL}/api/v1/message/${encodeURIComponent(id)}`, { timeout: 5000 });
  if (!response.ok()) throw new Error(`Mailpit message returned HTTP ${response.status()}`);
  const message = await response.json();
  if (message.ID !== id || !message.To?.some(t => t.Address.toLowerCase() === recipient.toLowerCase())) {
    throw new Error('Mailpit returned a different message or recipient');
  }
  return message;
}

// Deletes only the listed messages. An empty ID list would purge the whole inbox.
export async function deleteMessages(api, mailpit, ids) {
  if (ids.length === 0) return;
  const response = await api.delete(`${mailpit.baseURL}/api/v1/messages`, { data: { IDs: ids }, timeout: 5000 });
  if (!response.ok()) throw new Error(`Mailpit delete returned HTTP ${response.status()}`);
}

// One reset link at the app's exact origin, parsed from HTML anchors with a DOM parser,
// and the plaintext alternative must carry the same link.
export async function extractResetLink(page, message, appOrigin) {
  const hrefs = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  }, message.HTML ?? '');
  const accepted = new Set();
  for (const href of hrefs) {
    let url;
    try { url = new URL(href); } catch { continue; }
    if (url.origin !== appOrigin || url.username || url.password) continue;
    if (url.pathname === '/reset-password' && url.searchParams.get('token')) accepted.add(url.href);
  }
  if (accepted.size !== 1) throw new Error(`expected one reset link at ${appOrigin}, found ${accepted.size}`);
  const link = [...accepted][0];
  const textLinks = new Set((message.Text ?? '').match(/https?:\/\/[^\s<>"']+/g) ?? []);
  if (textLinks.size !== 1 || !textLinks.has(link)) throw new Error('plaintext alternative does not carry the same single reset link');
  return link;
}
