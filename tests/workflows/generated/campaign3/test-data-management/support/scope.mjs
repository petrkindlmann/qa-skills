import { request as playwrightRequest } from '@playwright/test';
import { setTimeout as pause } from 'node:timers/promises';
import { createFactories } from '../factories/index.mjs';
import { Ledger } from './ledger.mjs';

// A scope is what one test (or one concurrent actor inside a test) owns: a
// user, a factory set, a ledger, and its own HTTP context (own cookie jar).
// All writes go through here so the ledger cannot drift from what was sent.
export async function openScope({ app, mailpit, user, name, seed }) {
  const factories = createFactories({ scope: name, seed, secret: app.paymentSecret });
  const ledger = new Ledger({ scope: factories.scope, userId: user.id });
  const http = await playwrightRequest.newContext({ baseURL: app.baseURL });
  const mail = mailpit ? await playwrightRequest.newContext({ baseURL: mailpit.baseURL }) : null;
  const seenMail = new Set();
  const adminHeaders = { 'X-Test-Admin-Key': app.testAdminKey };

  async function json(response) {
    const text = await response.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  const scope = {
    name: factories.scope,
    seed: factories.seed,
    user,
    factories,
    ledger,

    async login(password = user.password) {
      const response = await http.post('/api/login', { data: { email: user.email, password } });
      const body = await json(response);
      if (response.status() === 200) ledger.record('login', { userId: user.id });
      return { status: response.status(), ...body };
    },

    async logout() {
      const response = await http.post('/api/logout');
      if (response.status() === 204) ledger.record('logout', { userId: user.id });
      return { status: response.status() };
    },

    async me() {
      const response = await http.get('/api/me');
      return { status: response.status(), ...(await json(response)) };
    },

    async catalogue() {
      const response = await http.get('/api/catalog');
      return { status: response.status(), ...(await json(response)) };
    },

    // Records an order only when the Shop says it created one (201).
    async createOrder(built) {
      const response = await http.post('/api/orders', {
        headers: { 'Idempotency-Key': built.idempotencyKey },
        data: built.payload,
      });
      const status = response.status();
      const body = await json(response);
      if (status === 201 && body.order) {
        ledger.record('order', {
          id: body.order.id, user_id: user.id, idempotencyKey: built.idempotencyKey,
          currency: built.expected.currency, amount: built.expected.amount, items: built.expected.items,
          status: built.expected.status, fulfillment_count: built.expected.fulfillment_count,
        });
      } else if (status === 200 && body.replayed) {
        ledger.record('replay', { id: body.order.id, idempotencyKey: built.idempotencyKey });
      } else {
        ledger.record('rejected-order', { idempotencyKey: built.idempotencyKey, status, error: body.error ?? null });
      }
      return { status, ...body };
    },

    async readOrder(id) {
      const response = await http.get(`/api/orders/${id}`);
      return { status: response.status(), ...(await json(response)) };
    },

    async listOrders() {
      const response = await http.get('/api/orders');
      const body = await json(response);
      return { status: response.status(), orders: body.orders ?? [], ...(body.error ? { error: body.error } : {}) };
    },

    // The scoped view: only orders this ledger created. Use this for
    // assertions on a shared Shop; the raw list may contain other scopes' data.
    async visibleOrders() {
      const { orders } = await scope.listOrders();
      return orders.filter(order => ledger.owns(order.id));
    },

    // Orders the Shop lists for this user that this scope did not create.
    async foreignOrders() {
      const { orders } = await scope.listOrders();
      return orders.filter(order => !ledger.owns(order.id));
    },

    async pay(envelope) {
      const response = await http.post('/api/webhooks/payment', { headers: envelope.headers, data: envelope.body });
      const status = response.status();
      const body = await json(response);
      if (status === 200 && body.received && !body.duplicate) ledger.markPaid(body.order_id, envelope.event.id);
      else if (status === 200 && body.duplicate) ledger.record('duplicate-receipt', { eventId: envelope.event.id, orderId: body.order_id });
      else ledger.record('rejected-payment', { eventId: envelope.event.id, status, error: body.error ?? null });
      return { status, ...body };
    },

    async requestReset(built) {
      const response = await http.post('/api/password-reset/request', { data: { email: built.email } });
      const body = await json(response);
      if (response.status() === 202) ledger.record('reset-request', { userId: built.userId, email: built.email, consumed: false });
      return { status: response.status(), ...body };
    },

    // Reads the real inbox. Only messages to the built address with the reset
    // subject count, and a message is consumed once per scope.
    async readResetEmail(built, { timeoutMs = 8000 } = {}) {
      if (!mail) throw new Error('openScope needs mailpit to read reset email');
      const deadline = Date.now() + timeoutMs;
      let attempts = 0;
      while (Date.now() < deadline) {
        attempts += 1;
        const search = await mail.get('/api/v1/search', { params: { query: `to:"${built.email}"` } });
        const found = await json(search);
        const candidates = (found.messages ?? [])
          .filter(message => message.Subject === built.subject && !seenMail.has(message.ID)
            && (message.To ?? []).some(to => to.Address === built.email))
          .sort((a, b) => String(b.Created).localeCompare(String(a.Created)));
        if (candidates.length > 0) {
          const summary = candidates[0];
          const message = await json(await mail.get(`/api/v1/message/${summary.ID}`));
          const match = built.linkPattern.exec(message.Text ?? '');
          if (!match) throw new Error(`Reset email ${summary.ID} has no reset link in its text part`);
          seenMail.add(summary.ID);
          ledger.record('reset-email', { userId: built.userId, messageId: summary.ID, attempts });
          return { token: match[1], messageId: summary.ID, to: summary.To.map(to => to.Address), subject: summary.Subject, text: message.Text, html: message.HTML };
        }
        await pause(150);
      }
      throw new Error(`No "${built.subject}" message for ${built.email} within ${timeoutMs}ms after ${attempts} inbox reads`);
    },

    async confirmReset(built, token) {
      const response = await http.post('/api/password-reset/confirm', { data: { token, password: built.newPassword } });
      const body = await json(response);
      if (response.status() === 200 && body.reset) ledger.markResetConsumed(built.userId);
      return { status: response.status(), ...body };
    },

    async state() {
      const response = await http.get('/test-support/state', { headers: adminHeaders });
      if (response.status() !== 200) throw new Error(`test-support/state answered ${response.status()}`);
      return json(response);
    },

    async advanceClock(seconds) {
      const response = await http.post('/test-support/clock', { headers: adminHeaders, data: { advance_seconds: seconds } });
      return { status: response.status(), ...(await json(response)) };
    },

    async close() {
      await http.dispose();
      if (mail) await mail.dispose();
    },
  };
  return scope;
}
