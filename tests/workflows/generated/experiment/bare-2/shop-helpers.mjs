import crypto from 'node:crypto';
import { test as base, expect } from '../../../support/fixtures.mjs';

export { expect };

// TEA-50 x2 (2 * 1200) + CUP-01 x1 (1800) = 4200 minor units.
export const BASKET = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];
export const BASKET_AMOUNT = 4200;
export const RESET_ACCEPTED = { message: 'If this account exists, a reset email has been sent.' };

export const test = base.extend({
  // Opens an isolated cookie jar against this test's Shop, optionally signed in.
  client: async ({ playwright, app }, use) => {
    const contexts = [];
    await use(async user => {
      const context = await playwright.request.newContext({ baseURL: app.baseURL });
      contexts.push(context);
      if (user) {
        const response = await context.post('/api/login', { data: { email: user.email, password: user.password } });
        expect(response.status(), `sign-in as ${user.id}`).toBe(200);
      }
      return context;
    });
    for (const context of contexts) await context.dispose();
  },

  // Independent view of durable state through the documented test-support routes.
  admin: async ({ playwright, app }, use) => {
    const context = await playwright.request.newContext({
      baseURL: app.baseURL,
      extraHTTPHeaders: { 'X-Test-Admin-Key': app.testAdminKey },
    });
    await use({
      async state() {
        const response = await context.get('/test-support/state');
        expect(response.status(), 'test-support state').toBe(200);
        return response.json();
      },
      async advanceClock(seconds) {
        const response = await context.post('/test-support/clock', { data: { advance_seconds: seconds } });
        expect(response.ok(), `advance clock by ${seconds}s`).toBe(true);
      },
    });
    await context.dispose();
  },

  // Mailpit access scoped to this test's addresses; teardown deletes only those messages.
  inbox: async ({ playwright, app, mailpit }, use) => {
    const api = await playwright.request.newContext({ baseURL: mailpit.baseURL });
    const addresses = new Set(Object.values(app.users).map(user => user.email));
    const search = async address => {
      const response = await api.get('/api/v1/search', { params: { query: `to:"${address}"`, limit: '50' } });
      expect(response.status(), `Mailpit search for ${address}`).toBe(200);
      const { messages } = await response.json();
      return messages
        .filter(message => message.To.some(to => to.Address.toLowerCase() === address.toLowerCase()))
        .sort((a, b) => Date.parse(a.Created) - Date.parse(b.Created));
    };
    await use({
      watch(address) { addresses.add(address); },
      list(address) { addresses.add(address); return search(address); },
      async waitFor(address, count = 1) {
        addresses.add(address);
        let found = [];
        await expect.poll(async () => (found = await search(address)).length, {
          message: `expected ${count} message(s) for ${address} in Mailpit`,
          timeout: 10_000,
        }).toBeGreaterThanOrEqual(count);
        return Promise.all(found.map(async ({ ID }) => {
          const [message, headers] = await Promise.all([
            api.get(`/api/v1/message/${ID}`).then(response => response.json()),
            api.get(`/api/v1/message/${ID}/headers`).then(response => response.json()),
          ]);
          return { ...message, headers };
        }));
      },
    });
    const ids = [];
    for (const address of addresses) ids.push(...(await search(address)).map(message => message.ID));
    if (ids.length) {
      const response = await api.delete('/api/v1/messages', { data: { IDs: ids } });
      expect(response.ok(), 'delete this test\'s Mailpit messages').toBe(true);
    }
    await api.dispose();
  },
});

export function createOrder(context, key, items = BASKET, extra = {}) {
  return context.post('/api/orders', {
    headers: { 'Idempotency-Key': key },
    data: { currency: 'EUR', items, ...extra },
  });
}

export async function getOrder(context, id) {
  const response = await context.get(`/api/orders/${id}`);
  expect(response.status(), `GET order ${id}`).toBe(200);
  return (await response.json()).order;
}

export function paymentEvent(id, orderId, { amount = BASKET_AMOUNT, currency = 'EUR' } = {}) {
  return JSON.stringify({ id, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } });
}

export function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// Sends the exact body bytes; pass signature: null to omit the header entirely.
export function deliver(context, app, body, { signature = sign(app.paymentSecret, body), bytes = body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (signature !== null) headers['X-Test-Payment-Signature'] = signature;
  return context.post('/api/webhooks/payment', { headers, data: Buffer.from(bytes) });
}

export function sessionCookie(response) {
  return response.headersArray()
    .filter(header => header.name.toLowerCase() === 'set-cookie')
    .map(header => header.value)
    .find(value => value.startsWith('shop_session='));
}

// Reads the reset link from both MIME alternatives and checks they agree and point at this app.
export function resetLinkFrom(message, app) {
  const fromText = message.Text.match(/https?:\/\/[^\s"<>]+\/reset-password\?token=[^\s"<>]+/)?.[0];
  const fromHtml = message.HTML.match(/href="([^"]+\/reset-password\?token=[^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  expect(fromText, 'plaintext part carries the reset link').toBeTruthy();
  expect(fromHtml, 'HTML part links to the same reset page').toBe(fromText);
  const url = new URL(fromText);
  expect(url.origin).toBe(new URL(app.baseURL).origin);
  expect(url.pathname).toBe('/reset-password');
  expect(url.searchParams.get('token')).toBeTruthy();
  return url;
}

export function sessionsOf(state, userId) {
  return state.sessions[userId] ?? 0;
}
