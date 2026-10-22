import { createHmac } from 'node:crypto';
import { expect } from '../../../support/fixtures.mjs';

export const BASKET = Object.freeze({
  currency: 'EUR',
  items: [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }],
});
export const BASKET_AMOUNT = 4200;

export const bySku = (items) => [...items].sort((a, b) => a.sku.localeCompare(b.sku));

export function paymentBody(eventId, orderId, { amount = BASKET_AMOUNT, currency = 'EUR' } = {}) {
  return JSON.stringify({ id: eventId, type: 'payment.succeeded', data: { order_id: orderId, currency, amount } });
}

export function sign(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

// Fixture additions shared by every spec: signed-in API sessions, the signed payment
// webhook, test-support observation, and an inbox that only touches this test's addresses.
export const shopFixtures = {
  shop: async ({ app, playwright, request }, use) => {
    const contexts = [];
    const adminHeaders = { 'X-Test-Admin-Key': app.testAdminKey };

    const shop = {
      async session(user, password = user?.password) {
        const ctx = await playwright.request.newContext({ baseURL: app.baseURL });
        contexts.push(ctx);
        if (user) {
          const res = await ctx.post('/api/login', { data: { email: user.email, password } });
          expect(res.status(), `sign-in for ${user.email}`).toBe(200);
        }
        return ctx;
      },
      async placeOrder(ctx, key, body = BASKET) {
        const res = await ctx.post('/api/orders', { headers: { 'Idempotency-Key': key }, data: body });
        return { status: res.status(), body: await res.json().catch(() => null) };
      },
      async deliver(body, { signature } = {}) {
        const headers = { 'content-type': 'application/json' };
        const sig = signature === undefined ? sign(body, app.paymentSecret) : signature;
        if (sig !== null) headers['X-Test-Payment-Signature'] = sig;
        const res = await request.post(`${app.baseURL}/api/webhooks/payment`, { headers, data: Buffer.from(body) });
        return { status: res.status(), body: await res.json().catch(() => null) };
      },
      async state() {
        const res = await request.get(`${app.baseURL}/test-support/state`, { headers: adminHeaders });
        expect(res.status(), 'test-support state').toBe(200);
        return res.json();
      },
      async advanceClock(seconds) {
        const res = await request.post(`${app.baseURL}/test-support/clock`, {
          headers: adminHeaders, data: { advance_seconds: seconds },
        });
        expect(res.status(), 'advance fixture clock').toBe(200);
      },
    };

    try {
      await use(shop);
    } finally {
      for (const ctx of contexts) await ctx.dispose().catch(() => {});
    }
  },

  inbox: async ({ app, mailpit, request }, use) => {
    const owned = new Set(Object.values(app.users).map((u) => u.email.toLowerCase()));
    const seen = new Set();

    async function messagesTo(address) {
      const res = await request.get(`${mailpit.baseURL}/api/v1/search`, { params: { query: `to:"${address}"`, limit: '200' } });
      expect(res.status(), 'Mailpit search').toBe(200);
      const { messages } = await res.json();
      return messages.filter((m) => m.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()));
    }

    const inbox = {
      own(address) { owned.add(address.toLowerCase()); },
      messagesTo,
      // Waits for a message to `address` that this test has not consumed yet and returns the full message.
      async next(address, { timeout = 10000 } = {}) {
        let fresh;
        await expect.poll(async () => {
          fresh = (await messagesTo(address)).find((m) => !seen.has(m.ID));
          return Boolean(fresh);
        }, { timeout, message: `waiting for a new message to ${address}` }).toBe(true);
        seen.add(fresh.ID);
        const res = await request.get(`${mailpit.baseURL}/api/v1/message/${fresh.ID}`);
        expect(res.status()).toBe(200);
        return res.json();
      },
    };

    try {
      await use(inbox);
    } finally {
      const ids = [];
      for (const address of owned) ids.push(...(await messagesTo(address)).map((m) => m.ID));
      // An empty ID list would delete every message in the shared worker inbox, so never send one.
      if (ids.length > 0) {
        const res = await request.delete(`${mailpit.baseURL}/api/v1/messages`, { data: { IDs: ids } });
        expect(res.status(), 'scoped Mailpit cleanup').toBe(200);
      }
      for (const address of owned) expect(await messagesTo(address), `inbox for ${address} cleaned`).toHaveLength(0);
    }
  },
};

export function resetLinks(message) {
  const pattern = /https?:\/\/[^\s"'<>]+\/reset-password\?token=[^\s"'<>]+/g;
  const decode = (s) => s.replaceAll('&amp;', '&');
  return {
    text: (message.Text.match(pattern) ?? []).map(decode),
    html: (message.HTML.match(pattern) ?? []).map(decode),
  };
}

export function tokenFrom(link) {
  return new URL(link).searchParams.get('token');
}
