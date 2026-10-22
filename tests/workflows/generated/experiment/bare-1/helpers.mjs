import { createHmac } from 'node:crypto';
import { test as base, expect } from '../../../support/fixtures.mjs';

export const TEA_AND_CUP = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];

export const test = base.extend({
  // Opens an API context against the app, signed in as `user` when given.
  client: async ({ playwright, app }, use) => {
    const opened = [];
    await use(async user => {
      const context = await playwright.request.newContext({ baseURL: app.baseURL });
      opened.push(context);
      if (user) {
        const response = await signIn(context, user);
        expect(response.status(), `sign in as ${user.email}`).toBe(200);
      }
      return context;
    });
    await Promise.all(opened.map(context => context.dispose()));
  },

  admin: async ({ playwright, app }, use) => {
    const context = await playwright.request.newContext({
      baseURL: app.baseURL,
      extraHTTPHeaders: { 'X-Test-Admin-Key': app.testAdminKey },
    });
    await use({
      async state() {
        const response = await context.get('/test-support/state');
        expect(response.status()).toBe(200);
        return response.json();
      },
      async advanceClock(seconds) {
        const response = await context.post('/test-support/clock', { data: { advance_seconds: seconds } });
        expect(response.ok()).toBe(true);
      },
    });
    await context.dispose();
  },

  // Reads Mailpit through its API and, on teardown, deletes only messages sent to
  // addresses this test looked at. Addresses are namespaced per test by the app fixture.
  inbox: async ({ playwright, mailpit }, use) => {
    const context = await playwright.request.newContext({ baseURL: mailpit.baseURL });
    const watched = new Set();
    const search = async address => {
      watched.add(address);
      const response = await context.get('/api/v1/search', { params: { query: `to:"${address}"` } });
      expect(response.status()).toBe(200);
      return (await response.json()).messages;
    };
    await use({
      search,
      async onlyMessageTo(address) {
        let messages = [];
        await expect.poll(async () => (messages = await search(address)).length, {
          message: `waiting for mail to ${address}`,
          timeout: 10_000,
        }).toBeGreaterThan(0);
        expect(messages, `exactly one message to ${address}`).toHaveLength(1);
        const response = await context.get(`/api/v1/message/${messages[0].ID}`);
        expect(response.status()).toBe(200);
        return response.json();
      },
    });
    const ids = [];
    for (const address of watched) ids.push(...(await search(address)).map(message => message.ID));
    if (ids.length) {
      const deleted = await context.delete('/api/v1/messages', { data: { IDs: ids } });
      expect(deleted.status(), 'delete this test\'s Mailpit messages').toBe(200);
    }
    await context.dispose();
  },
});

export { expect };

export function signIn(context, { email, password }) {
  return context.post('/api/login', { data: { email, password } });
}

export function placeOrder(context, key, body = { currency: 'EUR', items: TEA_AND_CUP }) {
  return context.post('/api/orders', { headers: { 'Idempotency-Key': key }, data: body });
}

export function paymentEvent(id, orderId, amount, currency = 'EUR') {
  return JSON.stringify({ id, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } });
}

export function signature(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// Sends the exact body bytes. Pass `signatureHeader: null` to omit the header.
export function deliverPayment(context, app, body, signatureHeader = signature(body, app.paymentSecret)) {
  const headers = { 'Content-Type': 'application/json' };
  if (signatureHeader !== null) headers['X-Test-Payment-Signature'] = signatureHeader;
  return context.post('/api/webhooks/payment', { headers, data: Buffer.from(body) });
}

export async function orderOf(context, id) {
  const response = await context.get(`/api/orders/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).order;
}

export function resetLinkFrom(message, baseURL) {
  const match = message.Text.match(/(\S+\/reset-password\?token=[^\s"<]+)/);
  expect(match, 'reset link in plaintext body').not.toBeNull();
  expect(match[1].startsWith(`${baseURL}/reset-password?token=`)).toBe(true);
  return match[1];
}
