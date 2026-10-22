import { createHmac } from 'node:crypto';
import { test as base, expect } from '../../../support/fixtures.mjs';

export { expect };

export const BASKET = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];
export const BASKET_AMOUNT = 4200;

export const test = base.extend({
  // Opens isolated API clients (own cookie jar each), optionally signed in.
  clients: async ({ playwright, app }, use) => {
    const opened = [];
    await use(async user => {
      const client = await playwright.request.newContext({ baseURL: app.baseURL });
      opened.push(client);
      if (user) {
        const response = await client.post('/api/login', { data: { email: user.email, password: user.password } });
        expect(response.status(), `sign-in for ${user.email}`).toBe(200);
      }
      return client;
    });
    await Promise.all(opened.map(client => client.dispose()));
  },

  // Reads this test's messages from Mailpit and deletes only those on teardown.
  inbox: async ({ playwright, mailpit }, use) => {
    const http = await playwright.request.newContext({ baseURL: mailpit.baseURL });
    const watched = new Set();
    const owned = new Set();
    const list = async address => {
      watched.add(address);
      const response = await http.get('/api/v1/search', { params: { query: `to:"${address}"` } });
      expect(response.ok(), 'Mailpit search').toBe(true);
      const { messages } = await response.json();
      const mine = messages.filter(m => m.To.some(to => to.Address.toLowerCase() === address.toLowerCase()));
      for (const message of mine) owned.add(message.ID);
      return mine;
    };
    const inbox = {
      list,
      async waitForMessages(address, count = 1) {
        await expect.poll(async () => (await list(address)).length, { message: `mail for ${address}`, timeout: 10000 })
          .toBeGreaterThanOrEqual(count);
        const summaries = await list(address);
        return Promise.all(summaries.map(async summary => {
          const response = await http.get(`/api/v1/message/${summary.ID}`);
          expect(response.ok()).toBe(true);
          return response.json();
        }));
      },
    };
    try {
      await use(inbox);
    } finally {
      for (const address of watched) await list(address).catch(() => {});
      if (owned.size) await http.delete('/api/v1/messages', { data: { IDs: [...owned] } });
      await http.dispose();
    }
  },
});

export function resetLink(message) {
  const match = message.Text.match(/https?:\/\/\S+\/reset-password\?token=[^\s"<]+/);
  expect(match, 'reset link in plaintext body').not.toBeNull();
  return new URL(match[0]);
}

export async function placeOrder(client, { key, items = BASKET, currency = 'EUR', extra = {} }) {
  const headers = key === undefined ? {} : { 'Idempotency-Key': key };
  return client.post('/api/orders', { headers, data: { currency, items, ...extra } });
}

export async function createOrder(client, key, items = BASKET) {
  const response = await placeOrder(client, { key, items });
  expect(response.status(), `create order ${key}`).toBe(201);
  return (await response.json()).order;
}

export function paymentEvent(id, order, overrides = {}) {
  return {
    id,
    type: 'payment.succeeded',
    data: { order_id: order.id, currency: order.currency, amount: order.amount, ...overrides },
  };
}

export function sign(secret, body) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// Sends exact bytes; signature defaults to a valid HMAC of those bytes, null omits the header.
export async function deliverPayment(client, app, event, { body, signature } = {}) {
  const bytes = body ?? JSON.stringify(event);
  const headers = { 'Content-Type': 'application/json' };
  const value = signature === undefined ? sign(app.paymentSecret, bytes) : signature;
  if (value !== null) headers['X-Test-Payment-Signature'] = value;
  return client.post('/api/webhooks/payment', { headers, data: Buffer.from(bytes) });
}

export async function supportState(client, app) {
  const response = await client.get('/test-support/state', { headers: { 'X-Test-Admin-Key': app.testAdminKey } });
  expect(response.status(), 'test-support state').toBe(200);
  return response.json();
}

export async function advanceClock(client, app, seconds) {
  const response = await client.post('/test-support/clock', {
    headers: { 'X-Test-Admin-Key': app.testAdminKey },
    data: { advance_seconds: seconds },
  });
  expect(response.ok(), 'advance fixture clock').toBe(true);
}

export async function expectError(response, status, error) {
  const body = await response.text();
  expect(response.status(), `${response.url()} -> ${body}`).toBe(status);
  expect(JSON.parse(body)).toEqual({ error });
}

export const byItem = items => [...items].sort((a, b) => (a.sku ?? a.item_id).localeCompare(b.sku ?? b.item_id));
