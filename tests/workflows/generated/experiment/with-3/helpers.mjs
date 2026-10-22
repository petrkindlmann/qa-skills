import { createHmac } from 'node:crypto';
import { test as base, expect } from '../../../support/fixtures.mjs';

export { expect };

export const EXAMPLE_ITEMS = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];
const MAIL_TIMEOUT = 5_000;

// `clients()` returns a fresh cookie jar bound to this test's app. Each one is an
// independent API consumer, so two users (or a replayed cookie) never share state.
// `inbox` scopes Mailpit reads and cleanup to the addresses this test registers.
export const test = base.extend({
  clients: async ({ playwright, app }, use) => {
    const made = [];
    await use(async (options = {}) => {
      const context = await playwright.request.newContext({ baseURL: app.baseURL, ...options });
      made.push(context);
      return context;
    });
    await Promise.all(made.map(context => context.dispose()));
  },
  inbox: async ({ request, mailpit }, use) => {
    const inbox = new Inbox(request, mailpit.baseURL);
    await use(inbox);
    await inbox.cleanup();
  },
});

export async function signIn(api, user, password = user.password) {
  const response = await api.post('/api/login', { data: { email: user.email, password } });
  expect(response.status(), `sign-in for ${user.id}`).toBe(200);
  return response;
}

export async function signedInClient(clients, user) {
  const api = await clients();
  await signIn(api, user);
  return api;
}

export async function postOrder(api, key, body = { currency: 'EUR', items: EXAMPLE_ITEMS }) {
  return api.post('/api/orders', { headers: { 'Idempotency-Key': key }, data: body });
}

export async function createOrder(api, key, body) {
  const response = await postOrder(api, key, body);
  expect(response.status(), await response.text()).toBe(201);
  const payload = await response.json();
  expect(payload.replayed).toBe(false);
  expectOrderShape(payload.order);
  return payload.order;
}

// No Zod/AJV in this repository and no new dependencies allowed, so the ORDER
// contract is checked as an exact key set plus value types.
export function expectOrderShape(order) {
  expect(Object.keys(order).sort()).toEqual(
    ['amount', 'currency', 'fulfillment_count', 'id', 'items', 'status', 'user_id']);
  expect(order).toEqual({
    id: expect.any(String),
    user_id: expect.any(String),
    currency: 'EUR',
    amount: expect.any(Number),
    items: expect.any(Array),
    status: expect.stringMatching(/^(pending|paid)$/),
    fulfillment_count: expect.any(Number),
  });
  expect(Number.isInteger(order.amount)).toBe(true);
  expect(order.id.length).toBeGreaterThan(0);
  for (const item of order.items) {
    expect(Object.keys(item).sort()).toEqual(['quantity', 'sku']);
  }
}

export function sortItems(items) {
  return [...items].sort((a, b) => a.sku.localeCompare(b.sku));
}

export function sign(secret, bytes) {
  return `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;
}

export function paymentEvent(id, orderId, amount, currency = 'EUR') {
  return JSON.stringify({ id, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } });
}

// Sends exactly `body` (a string or Buffer); `signature` defaults to a valid HMAC
// over those bytes, `null` omits the header.
export async function deliverPayment(api, app, body, { signature } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const headers = { 'Content-Type': 'application/json' };
  const value = signature === undefined ? sign(app.paymentSecret, bytes) : signature;
  if (value !== null) headers['X-Test-Payment-Signature'] = value;
  return api.post('/api/webhooks/payment', { headers, data: bytes });
}

export async function expectError(response, status, error) {
  expect(response.status(), await response.text()).toBe(status);
  expect(await response.json()).toEqual({ error });
}

export async function fixtureState(api, app) {
  const response = await api.get('/test-support/state', { headers: { 'X-Test-Admin-Key': app.testAdminKey } });
  expect(response.status()).toBe(200);
  return response.json();
}

export async function advanceClock(api, app, seconds) {
  const response = await api.post('/test-support/clock', {
    headers: { 'X-Test-Admin-Key': app.testAdminKey }, data: { advance_seconds: seconds },
  });
  expect(response.status(), await response.text()).toBe(200);
}

export function receiptsFor(state, orderId) {
  return state.receipts.filter(receipt => receipt.order_id === orderId);
}

class Inbox {
  constructor(request, baseURL) {
    this.request = request;
    this.baseURL = baseURL;
    this.addresses = new Set();
  }

  watch(address) {
    this.addresses.add(address.toLowerCase());
    return address;
  }

  async search(address) {
    const query = new URLSearchParams({ query: `to:${address}`, limit: '50' });
    const response = await this.request.get(`${this.baseURL}/api/v1/search?${query}`, { timeout: MAIL_TIMEOUT });
    if (!response.ok()) throw new Error(`Mailpit search returned HTTP ${response.status()}`);
    const { messages } = await response.json();
    if (!Array.isArray(messages)) throw new Error('Mailpit search has no messages array');
    return messages.filter(message =>
      message.To?.some(to => to.Address.toLowerCase() === address.toLowerCase()));
  }

  // Polls for the first message to `address` whose ID is not in `excludeIds`.
  async waitFor(address, { excludeIds = [], timeout = 15_000 } = {}) {
    this.watch(address);
    let found;
    await expect.poll(async () => {
      found = (await this.search(address)).find(message => !excludeIds.includes(message.ID));
      return found?.ID ?? null;
    }, { message: `no new email for ${address}`, timeout, intervals: [200, 500, 1_000] }).not.toBeNull();
    const response = await this.request.get(
      `${this.baseURL}/api/v1/message/${encodeURIComponent(found.ID)}`, { timeout: MAIL_TIMEOUT });
    if (!response.ok()) throw new Error(`Mailpit message returned HTTP ${response.status()}`);
    const message = await response.json();
    if (message.ID !== found.ID) throw new Error('Mailpit returned a different message');
    return message;
  }

  async cleanup() {
    const ids = [];
    for (const address of this.addresses) ids.push(...(await this.search(address)).map(m => m.ID));
    if (!ids.length) return;
    const response = await this.request.delete(`${this.baseURL}/api/v1/messages`, {
      data: { IDs: ids }, timeout: MAIL_TIMEOUT,
    });
    if (!response.ok()) throw new Error(`Mailpit delete returned HTTP ${response.status()}`);
  }
}

// Parses the HTML part with the browser's DOMParser and requires exactly one reset
// link at the application's own origin carrying a token.
export async function extractResetLink(page, message, appOrigin) {
  const hrefs = await page.evaluate(html => [...new DOMParser().parseFromString(html, 'text/html')
    .querySelectorAll('a[href]')].map(anchor => anchor.getAttribute('href')), message.HTML ?? '');
  const links = new Set();
  for (const href of hrefs) {
    let url;
    try { url = new URL(href); } catch { continue; }
    if (url.origin === new URL(appOrigin).origin && url.pathname === '/reset-password'
      && url.searchParams.get('token')) links.add(url.href);
  }
  if (links.size !== 1) throw new Error(`expected one reset link at ${appOrigin}, found ${links.size}`);
  return [...links][0];
}
