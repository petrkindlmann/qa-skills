import { createHmac } from 'node:crypto';
import { test as base, expect } from '../../../support/fixtures.mjs';

export { expect };

export const EXAMPLE_ITEMS = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];
export const EXAMPLE_AMOUNT = 4200;
export const RESET_SUBJECT = 'Reset your Shop password';
export const RESET_ACK = { message: 'If this account exists, a reset email has been sent.' };

const sortItems = (items) => [...items].sort((a, b) => a.sku.localeCompare(b.sku));
export const sameItems = (actual, expected) => expect(sortItems(actual)).toEqual(sortItems(expected));

export function signPayload(secret, body) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function paymentEvent(id, order, data = {}) {
  return { id, type: 'payment.succeeded', data: { order_id: order.id, currency: order.currency, amount: order.amount, ...data } };
}

class Shop {
  #contexts = [];

  constructor(app, playwright) {
    this.app = app;
    this.playwright = playwright;
  }

  async client() {
    const context = await this.playwright.request.newContext({ baseURL: this.app.baseURL });
    this.#contexts.push(context);
    return context;
  }

  async signIn(user, password = user.password) {
    const api = await this.client();
    const response = await api.post('/api/login', { data: { email: user.email, password } });
    expect(response.status(), `sign-in as ${user.id}`).toBe(200);
    return api;
  }

  placeOrder(api, key, body = { currency: 'EUR', items: EXAMPLE_ITEMS }) {
    return api.post('/api/orders', { headers: { 'Idempotency-Key': key }, data: body });
  }

  async createOrder(api, key, items = EXAMPLE_ITEMS) {
    const response = await this.placeOrder(api, key, { currency: 'EUR', items });
    expect(response.status()).toBe(201);
    return (await response.json()).order;
  }

  // Sends the exact bytes that were signed (a Buffer, because Playwright re-encodes a
  // non-JSON string body). signature: undefined signs correctly, null omits the header,
  // a string is sent as-is.
  async deliver(event, { signature } = {}) {
    const api = await this.webhookClient();
    const body = typeof event === 'string' ? event : JSON.stringify(event);
    const headers = { 'Content-Type': 'application/json' };
    const value = signature === undefined ? signPayload(this.app.paymentSecret, body) : signature;
    if (value !== null) headers['X-Test-Payment-Signature'] = value;
    return api.post('/api/webhooks/payment', { data: Buffer.from(body, 'utf8'), headers });
  }

  async webhookClient() {
    this.psp ??= await this.client();
    return this.psp;
  }

  async state() {
    const api = await this.webhookClient();
    const response = await api.get('/test-support/state', { headers: { 'X-Test-Admin-Key': this.app.testAdminKey } });
    expect(response.status(), 'test-support state').toBe(200);
    return response.json();
  }

  async advanceClock(seconds) {
    const api = await this.webhookClient();
    const response = await api.post('/test-support/clock', {
      headers: { 'X-Test-Admin-Key': this.app.testAdminKey },
      data: { advance_seconds: seconds },
    });
    expect(response.status(), 'advance fixture clock').toBe(200);
  }

  async dispose() {
    for (const context of this.#contexts) await context.dispose();
  }
}

// Mailpit access scoped to this test's addresses. Only IDs this test observed are deleted.
class Inbox {
  #seen = new Set();

  constructor(request, mailpit) {
    this.request = request;
    this.baseURL = mailpit.baseURL;
  }

  async messagesTo(address) {
    const response = await this.request.get(`${this.baseURL}/api/v1/search`, { params: { query: `to:${address}`, limit: 50 } });
    expect(response.status(), 'Mailpit search').toBe(200);
    const { messages } = await response.json();
    const matching = messages.filter((m) => m.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()));
    for (const message of matching) this.#seen.add(message.ID);
    return matching;
  }

  async waitForMessage(address, subject) {
    let found = [];
    await expect.poll(async () => {
      found = (await this.messagesTo(address)).filter((m) => m.Subject === subject);
      return found.length;
    }, { message: `mail "${subject}" to ${address}`, timeout: 10_000 }).toBeGreaterThan(0);
    expect(found, `exactly one "${subject}" message to ${address}`).toHaveLength(1);
    return this.message(found[0].ID);
  }

  async message(id) {
    const response = await this.request.get(`${this.baseURL}/api/v1/message/${id}`);
    expect(response.status(), 'Mailpit message').toBe(200);
    return response.json();
  }

  async cleanup() {
    const ids = [...this.#seen];
    if (ids.length === 0) return; // an empty ID list would delete every message
    const response = await this.request.delete(`${this.baseURL}/api/v1/messages`, { data: { IDs: ids } });
    expect(response.status(), 'Mailpit cleanup').toBe(200);
  }
}

export function resetLinks(message, baseURL) {
  const pattern = new RegExp(`${baseURL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/reset-password\\?token=([A-Za-z0-9_-]+)`, 'g');
  const fromText = [...message.Text.matchAll(pattern)].map((m) => m[0]);
  const fromHtml = [...message.HTML.matchAll(pattern)].map((m) => m[0]);
  return { fromText, fromHtml };
}

export const test = base.extend({
  shop: async ({ app, playwright }, use) => {
    const shop = new Shop(app, playwright);
    try { await use(shop); } finally { await shop.dispose(); }
  },
  inbox: async ({ request, mailpit }, use) => {
    const inbox = new Inbox(request, mailpit);
    try { await use(inbox); } finally { await inbox.cleanup(); }
  },
});
