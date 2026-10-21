import { createHmac } from 'node:crypto';
import { expect } from '../../../../../support/fixtures.mjs';

export async function json(response, status) {
  expect(response.status(), `${response.request?.()?.method?.() ?? 'HTTP'} ${response.url()}`).toBe(status);
  expect(response.headers()['content-type']).toContain('application/json');
  return response.json();
}

export async function login(app, client) {
  const body = await json(await client.post(`${app.baseURL}/api/login`, {
    data: { email: app.users.alice.email, password: app.users.alice.password },
  }), 200);
  expect(body).toEqual({ user: { id: app.users.alice.id, email: app.users.alice.email } });
}

export async function createOrder(app, client, key, sku, quantity) {
  return json(await client.post(`${app.baseURL}/api/orders`, {
    headers: { 'Idempotency-Key': key },
    data: { currency: 'EUR', items: [{ sku, quantity }] },
  }), 201);
}

export function signedRawEvent(app, client, raw, signedBytes = raw) {
  const digest = createHmac('sha256', app.paymentSecret).update(signedBytes).digest('hex');
  return client.post(`${app.baseURL}/api/webhooks/payment`, {
    data: Buffer.from(raw, 'utf8'),
    headers: {
      'Content-Type': 'application/json',
      'X-Test-Payment-Signature': `sha256=${digest}`,
    },
  });
}

export async function state(app, client) {
  return json(await client.get(`${app.baseURL}/test-support/state`, {
    headers: { 'X-Test-Admin-Key': app.testAdminKey },
  }), 200);
}
