import { createHmac, randomUUID } from 'node:crypto';
import { test as base, expect } from '../../../support/fixtures.mjs';

export { expect };

// Contract prices in minor units; tests compute expected totals from these, not from the API.
export const PRICE = { 'TEA-50': 1200, 'CUP-01': 1800 };
export const RESET_ACCEPTED = 'If this account exists, a reset email has been sent.';

export const test = base.extend({
  // Independent API clients (one cookie jar each) bound to this test's Shop instance.
  clients: async ({ playwright, app }, use) => {
    const opened = [];
    const open = async (options = {}) => {
      const context = await playwright.request.newContext({ baseURL: app.baseURL, ...options });
      opened.push(context);
      return context;
    };
    const signedIn = async (user, password = user.password) => {
      const client = await open();
      const response = await signIn(client, user, password);
      expect(response.status(), `sign-in for ${user.id}`).toBe(200);
      return client;
    };
    // A fresh context per read, so an app restart never leaves a stale keep-alive socket.
    const state = async () => {
      const admin = await playwright.request.newContext({
        baseURL: app.baseURL, extraHTTPHeaders: { 'X-Test-Admin-Key': app.testAdminKey },
      });
      try {
        const response = await admin.get('/test-support/state');
        expect(response.status(), 'test-support state').toBe(200);
        return await response.json();
      } finally {
        await admin.dispose();
      }
    };
    const advanceClock = async seconds => {
      const admin = await open({ extraHTTPHeaders: { 'X-Test-Admin-Key': app.testAdminKey } });
      const response = await admin.post('/test-support/clock', { data: { advance_seconds: seconds } });
      expect(response.ok(), `advance clock by ${seconds}s`).toBe(true);
    };
    await use({ open, signedIn, state, advanceClock });
    await Promise.all(opened.map(context => context.dispose()));
  },

  // Mailpit reader that records every message it sees for this test's recipients and
  // deletes exactly those IDs afterwards. It never purges the shared worker inbox.
  inbox: async ({ playwright, mailpit }, use) => {
    const api = await playwright.request.newContext({ baseURL: mailpit.baseURL, timeout: 5000 });
    const inbox = new Inbox(api);
    try {
      await use(inbox);
    } finally {
      await inbox.cleanup();
      await api.dispose();
    }
  },
});

class Inbox {
  constructor(api) {
    this.api = api;
    this.owned = new Set();
  }

  async messagesTo(recipient) {
    const response = await this.api.get(`/api/v1/search?${new URLSearchParams({ query: `to:${recipient}` })}`);
    expect(response.ok(), `Mailpit search HTTP ${response.status()}`).toBe(true);
    const { messages } = await response.json();
    expect(Array.isArray(messages), 'Mailpit search returns a messages array').toBe(true);
    const matches = messages.filter(message =>
      message.To?.some(to => to.Address.toLowerCase() === recipient.toLowerCase()));
    for (const message of matches) this.owned.add(message.ID);
    return matches;
  }

  async waitFor(recipient, { exclude = [] } = {}) {
    let summary;
    await expect.poll(async () => {
      summary = (await this.messagesTo(recipient)).find(message => !exclude.includes(message.ID));
      return summary?.ID ?? null;
    }, { message: `email to ${recipient}`, timeout: 15000, intervals: [100, 250, 500, 1000] }).not.toBeNull();
    const response = await this.api.get(`/api/v1/message/${encodeURIComponent(summary.ID)}`);
    expect(response.ok(), `Mailpit message HTTP ${response.status()}`).toBe(true);
    const message = await response.json();
    expect(message.ID).toBe(summary.ID);
    return message;
  }

  async cleanup() {
    if (this.owned.size === 0) return;
    const response = await this.api.delete('/api/v1/messages', { data: { IDs: [...this.owned] } });
    if (!response.ok()) throw new Error(`Mailpit cleanup HTTP ${response.status()}`);
  }
}

// Fires requests together. Connection-level errors are returned, never swallowed:
// callers assert on them separately from the business outcome of answered requests.
export async function burst(count, send) {
  const settled = await Promise.allSettled(Array.from({ length: count }, (_, index) => send(index)));
  return {
    responses: settled.filter(result => result.status === 'fulfilled').map(result => result.value),
    transportErrors: settled.filter(result => result.status === 'rejected')
      .map(result => result.reason.message.split('\n')[0]),
  };
}

export function signIn(client, user, password = user.password) {
  return client.post('/api/login', { data: { email: user.email, password } });
}

export function sessionCookie(response) {
  const header = response.headersArray()
    .filter(({ name }) => name.toLowerCase() === 'set-cookie')
    .map(({ value }) => value)
    .find(value => value.startsWith('shop_session='));
  return header ?? null;
}

export function placeOrder(client, items, { key = `order-${randomUUID()}`, currency = 'EUR', extra = {} } = {}) {
  const headers = key === null ? {} : { 'Idempotency-Key': key };
  return client.post('/api/orders', { headers, data: { currency, items, ...extra } });
}

export async function createOrder(client, items, options) {
  const response = await placeOrder(client, items, options);
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).order;
}

export const TEA2_CUP1 = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];

export function itemsOf(order) {
  return order.items
    .map(({ sku, quantity }) => ({ sku, quantity }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

export function paymentSignature(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function paymentEvent(orderId, amount, { id = `evt-${randomUUID()}`, currency = 'EUR', indent } = {}) {
  return JSON.stringify({ id, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } }, null, indent);
}

// Sends the exact bytes given. Pass signature: null to omit the header entirely.
export function deliverPayment(client, app, body, { signature = paymentSignature(body, app.paymentSecret) } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (signature !== null) headers['X-Test-Payment-Signature'] = signature;
  return client.post('/api/webhooks/payment', { headers, data: Buffer.from(body) });
}

export function receiptsFor(state, orderId) {
  for (const receipt of state.receipts) expect(receipt).toHaveProperty('order_id');
  return state.receipts.filter(receipt => receipt.order_id === orderId);
}

export function orderIn(state, orderId) {
  return state.orders.find(order => order.id === orderId);
}

// Parses the HTML alternative with a real DOM parser and requires exactly one reset link
// at the app's exact origin; the plaintext alternative must carry the same link.
export async function extractResetLink(page, message, baseURL) {
  const origin = new URL(baseURL).origin;
  const accept = candidate => {
    let url;
    try { url = new URL(candidate); } catch { return null; }
    if (url.origin !== origin || url.username || url.password) return null;
    return url.pathname === '/reset-password' && url.searchParams.get('token') ? url.href : null;
  };
  const hrefs = await page.evaluate(html =>
    [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href]')]
      .map(anchor => anchor.getAttribute('href')), message.HTML);
  const fromHtml = [...new Set(hrefs.map(accept).filter(Boolean))];
  const fromText = [...new Set((message.Text.match(/https?:\/\/[^\s<>"']+/g) ?? []).map(accept).filter(Boolean))];
  expect(fromHtml, 'HTML alternative has exactly one reset link at the app origin').toHaveLength(1);
  expect(fromText, 'plaintext alternative carries the same reset link').toEqual(fromHtml);
  return fromHtml[0];
}

export function tokenOf(link) {
  return new URL(link).searchParams.get('token');
}
