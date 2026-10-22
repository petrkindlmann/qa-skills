import { createHmac } from 'node:crypto';
import { test as base, expect } from '../../../support/fixtures.mjs';

export { expect };

// TEA-50 x2 (2400) + CUP-01 x1 (1800) per the contract's example order.
export const BASKET = { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }] };
export const BASKET_AMOUNT = 4200;
export const RESET_MESSAGE = 'If this account exists, a reset email has been sent.';

export function sign(secret, body) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

export function paymentEvent(id, orderId, { amount = BASKET_AMOUNT, currency = 'EUR' } = {}) {
  return { id, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } };
}

class Shop {
  #contexts = [];

  constructor(app, playwright) {
    this.app = app;
    this.playwright = playwright;
  }

  async init() {
    this.admin = await this.client();
    this.webhook = await this.client();
  }

  async client() {
    const context = await this.playwright.request.newContext({ baseURL: this.app.baseURL });
    this.#contexts.push(context);
    return context;
  }

  async signIn(user, password = user.password) {
    const context = await this.client();
    const response = await context.post('/api/login', { data: { email: user.email, password } });
    expect(response.status(), `sign-in as ${user.email}`).toBe(200);
    return context;
  }

  createOrder(context, key, body = BASKET) {
    return context.post('/api/orders', { headers: { 'Idempotency-Key': key }, data: body });
  }

  async orderAs(context, id) {
    const response = await context.get(`/api/orders/${id}`);
    expect(response.status()).toBe(200);
    return (await response.json()).order;
  }

  // Sends exact bytes. signature: undefined signs with the fixture secret, null omits the header.
  pay(event, { body = JSON.stringify(event), signature } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const value = signature === undefined ? sign(this.app.paymentSecret, body) : signature;
    if (value !== null) headers['X-Test-Payment-Signature'] = value;
    return this.webhook.post('/api/webhooks/payment', { data: Buffer.from(body), headers });
  }

  async state() {
    const response = await this.admin.get('/test-support/state', { headers: { 'X-Test-Admin-Key': this.app.testAdminKey } });
    expect(response.status(), 'test-support state').toBe(200);
    return response.json();
  }

  async advanceClock(seconds) {
    const response = await this.admin.post('/test-support/clock', {
      headers: { 'X-Test-Admin-Key': this.app.testAdminKey },
      data: { advance_seconds: seconds },
    });
    expect(response.status(), 'advance fixture clock').toBe(200);
  }

  async dispose() {
    await Promise.all(this.#contexts.map(context => context.dispose()));
  }
}

// Reads one test's messages through Mailpit's API and deletes only the IDs it saw.
class Inbox {
  #ids = new Set();

  constructor(context, addresses) {
    this.context = context;
    this.addresses = addresses;
  }

  async messagesTo(address) {
    const response = await this.context.get('/api/v1/search', { params: { query: `to:"${address}"` } });
    expect(response.status(), 'Mailpit search').toBe(200);
    const { messages } = await response.json();
    const exact = messages.filter(message =>
      message.To.some(to => to.Address.toLowerCase() === address.toLowerCase()));
    for (const message of exact) this.#ids.add(message.ID);
    return exact;
  }

  async waitForOnly(address) {
    let found = [];
    await expect.poll(async () => (found = await this.messagesTo(address)).length,
      { message: `email delivered to ${address}`, timeout: 10_000 }).toBeGreaterThan(0);
    expect(found, `exactly one message to ${address}`).toHaveLength(1);
    const response = await this.context.get(`/api/v1/message/${found[0].ID}`);
    expect(response.status()).toBe(200);
    return response.json();
  }

  async cleanup() {
    for (const address of this.addresses) await this.messagesTo(address);
    // An empty IDs list would delete every message in the shared inbox, so never send one.
    if (this.#ids.size > 0) {
      const response = await this.context.delete('/api/v1/messages', { data: { IDs: [...this.#ids] } });
      expect(response.status(), 'delete this test\'s messages').toBe(200);
    }
    for (const address of this.addresses) {
      const left = await this.context.get('/api/v1/search', { params: { query: `to:"${address}"` } });
      expect((await left.json()).messages_count, `messages left for ${address}`).toBe(0);
    }
  }
}

export function resetLinks(message) {
  const text = message.Text.match(/https?:\/\/\S+\/reset-password\?token=[^\s"<]+/)?.[0];
  const html = message.HTML.match(/href="(https?:\/\/[^"]+\/reset-password\?token=[^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  return { text, html };
}

export const test = base.extend({
  shop: async ({ app, playwright }, use) => {
    const shop = new Shop(app, playwright);
    await shop.init();
    try { await use(shop); } finally { await shop.dispose(); }
  },
  inbox: async ({ app, mailpit, playwright }, use) => {
    const context = await playwright.request.newContext({ baseURL: mailpit.baseURL });
    const inbox = new Inbox(context, [app.users.alice.email, app.users.bob.email, `nobody+${app.namespace}@example.test`]);
    try { await use(inbox); } finally {
      try { await inbox.cleanup(); } finally { await context.dispose(); }
    }
  },
});
