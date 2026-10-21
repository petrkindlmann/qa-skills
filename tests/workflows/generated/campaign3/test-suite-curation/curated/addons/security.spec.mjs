import { oracle } from '../../../../../support/oracle.mjs';
import { test, expect, json, adminHeaders, state, startShopWithoutMail } from './helpers.mjs';

const LIMIT = 5;

async function failLogins(client, email, times) {
  for (let attempt = 1; attempt <= times; attempt += 1) {
    expect(await json(await client.post('/api/login', { data: { email, password: `wrong-password-${attempt}` } }), 401))
      .toEqual({ error: 'invalid_credentials' });
  }
}

test('repeated sign-in failures are throttled per account and recover after the window', async ({ app, clients, request }) => {
  const client = clients.guest;
  const sessionsBefore = (await state(app, request)).sessions;
  await failLogins(client, app.users.alice.email, LIMIT);

  const throttled = await client.post('/api/login', { data: { email: app.users.alice.email, password: 'wrong-again' } });
  await oracle('shop-no-login-throttle', 'toBe', async () => expect(throttled.status(), await throttled.text()).toBe(429));
  expect(await throttled.json()).toEqual({ error: 'too_many_attempts' });
  expect(throttled.headers()['retry-after']).toBe('60');
  // The correct password does not bypass the throttle, and no session was created.
  expect((await client.post('/api/login', { data: app.users.alice })).status()).toBe(429);
  expect(await json(await client.get('/api/me'), 401)).toEqual({ error: 'unauthenticated' });
  expect((await state(app, request)).sessions).toEqual(sessionsBefore);

  // Other accounts are unaffected, and unknown accounts throttle identically (no enumeration).
  expect(await json(await client.post('/api/login', { data: app.users.bob }), 200)).toEqual({ user: { id: 'bob', email: app.users.bob.email } });
  const unknown = `nobody+${app.namespace}@example.test`;
  await failLogins(client, unknown, LIMIT);
  expect((await client.post('/api/login', { data: { email: unknown, password: 'wrong-again' } })).status()).toBe(429);

  // The window is time based: advance the fixture clock instead of sleeping.
  expect((await request.post(`${app.baseURL}/test-support/clock`, { headers: adminHeaders(app), data: { advance_seconds: 61 } })).status()).toBe(200);
  expect(await json(await client.post('/api/login', { data: app.users.alice }), 200)).toEqual({ user: { id: 'alice', email: app.users.alice.email } });
  expect(await json(await client.get('/api/me'), 200)).toEqual({ user: { id: 'alice', email: app.users.alice.email } });
});

test('test-support routes stay locked without the admin key', async ({ app, request }) => {
  for (const headers of [{}, { 'X-Test-Admin-Key': 'guessed-key' }, { 'X-Test-Admin-Key': '' }]) {
    expect(await oracle('shop-open-test-support', 'toBe', async () => json(await request.get(`${app.baseURL}/test-support/state`, { headers }), 403))).toEqual({ error: 'forbidden' });
    expect(await json(await request.post(`${app.baseURL}/test-support/clock`, { headers, data: { advance_seconds: 1 } }), 403)).toEqual({ error: 'forbidden' });
  }
  // The key is not accepted anywhere else, and the locked route reveals no state shape.
  expect(await json(await request.get(`${app.baseURL}/api/orders`, { headers: adminHeaders(app) }), 401)).toEqual({ error: 'unauthenticated' });
  const observed = await state(app, request);
  expect(observed.orders).toEqual([]);
  expect(observed.now).toBeGreaterThan(0);
});

test('password reset stays uniform and accepted when the mail service is down', async ({ mailpit, playwright, request }, testInfo) => {
  const app = await startShopWithoutMail(testInfo);
  const client = await playwright.request.newContext({ baseURL: app.baseURL });
  try {
    const unknown = `nobody+${app.namespace}@example.test`;
    const accepted = { message: 'If this account exists, a reset email has been sent.' };
    expect(await json(await client.post('/api/password-reset/request', { data: { email: unknown } }), 202)).toEqual(accepted);
    expect((await state(app, request)).smtp_errors).toBe(0);

    expect(await oracle('shop-smtp-failure', 'toBe', async () => json(await client.post('/api/password-reset/request', { data: { email: app.users.alice.email } }), 202))).toEqual(accepted);
    const observed = await state(app, request);
    expect(observed.smtp_errors).toBe(1);
    expect(observed.reset_tokens.map(token => token.user_id)).toEqual(['alice']);

    // Nothing reached the real inbox, and the account still signs in normally.
    const search = await json(await request.get(`${mailpit.baseURL}/api/v1/search`, { params: { query: `to:${app.users.alice.email}` } }), 200);
    expect(search.messages.filter(m => m.To.some(t => t.Address.toLowerCase() === app.users.alice.email.toLowerCase()))).toEqual([]);
    expect(await json(await client.post('/api/login', { data: app.users.alice }), 200)).toEqual({ user: { id: 'alice', email: app.users.alice.email } });
  } finally {
    await client.dispose();
    await app.stop();
  }
});
