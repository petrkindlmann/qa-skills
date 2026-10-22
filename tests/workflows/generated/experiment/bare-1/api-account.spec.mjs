import { test, expect, placeOrder, resetLinkFrom, signIn } from './helpers.mjs';

test('health, session cookie, logout and unauthenticated access', async ({ app, client }) => {
  const anonymous = await client();
  const started = Date.now();
  const health = await anonymous.get('/health');
  expect(Date.now() - started).toBeLessThan(500);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', build: 'shop-lab-v1' });

  for (const response of [
    await anonymous.get('/api/me'),
    await anonymous.get('/api/orders'),
    await anonymous.get('/api/orders/any-id'),
    await placeOrder(anonymous, 'anon-key'),
  ]) {
    expect(response.status(), response.url()).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthenticated' });
  }

  for (const headers of [{}, { 'X-Test-Admin-Key': 'wrong-key' }]) {
    const response = await anonymous.get('/test-support/state', { headers });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  }

  const alice = app.users.alice;
  const session = await client();
  const rejected = await signIn(session, { email: alice.email, password: 'Alice-wrong-123!' });
  expect(rejected.status()).toBe(401);
  expect(await rejected.json()).toEqual({ error: 'invalid_credentials' });
  expect(rejected.headers()['set-cookie']).toBeUndefined();

  const login = await signIn(session, alice);
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual({ user: { id: 'alice', email: alice.email } });
  const cookie = login.headers()['set-cookie'];
  expect(cookie).toMatch(/^shop_session=[^;]+/);
  expect(cookie).toMatch(/;\s*HttpOnly/i);
  expect(cookie).toMatch(/;\s*SameSite=Lax/i);
  expect(cookie).toMatch(/;\s*Path=\//);
  expect(cookie).not.toMatch(/Secure/i);

  const me = await session.get('/api/me');
  expect(me.status()).toBe(200);
  expect(await me.json()).toEqual({ user: { id: 'alice', email: alice.email } });

  expect((await session.post('/api/logout')).status()).toBe(204);
  expect((await session.get('/api/me')).status()).toBe(401);
  expect((await session.get('/api/orders')).status()).toBe(401);
});

test('sign-in throttling locks an address after five failures until the window passes', async ({ app, client, admin }) => {
  const { alice, bob } = app.users;
  const http = await client();
  const fail = email => signIn(http, { email, password: 'Definitely-wrong-1!' });

  for (let attempt = 1; attempt <= 5; attempt++) expect((await fail(alice.email)).status(), `failure ${attempt}`).toBe(401);
  const locked = await signIn(http, alice);
  expect(locked.status(), 'correct password is refused while locked').toBe(429);
  expect(await locked.json()).toEqual({ error: 'too_many_attempts' });
  expect(locked.headers()['retry-after']).toBe('60');
  expect(locked.headers()['set-cookie']).toBeUndefined();
  expect((await http.get('/api/me')).status()).toBe(401);
  expect((await admin.state()).sessions.alice ?? 0).toBe(0);

  const ghost = `ghost+${app.namespace}@example.test`;
  for (let attempt = 1; attempt <= 5; attempt++) expect((await fail(ghost)).status()).toBe(401);
  expect((await fail(ghost)).status(), 'unknown addresses throttle identically').toBe(429);

  // Throttling is per address, and a success clears that address's counter.
  for (let attempt = 1; attempt <= 4; attempt++) expect((await fail(bob.email)).status()).toBe(401);
  expect((await signIn(await client(), bob)).status()).toBe(200);
  for (let attempt = 1; attempt <= 4; attempt++) expect((await fail(bob.email)).status()).toBe(401);
  expect((await signIn(await client(), bob)).status()).toBe(200);

  await admin.advanceClock(61);
  const afterWindow = await client();
  expect((await signIn(afterWindow, alice)).status()).toBe(200);
  expect((await afterWindow.get('/api/me')).status()).toBe(200);
});

test('reset tokens reject short passwords, expire after 300 seconds and leave the password intact', async ({ app, client, admin, inbox }) => {
  const alice = app.users.alice;
  const http = await client();

  const requested = await http.post('/api/password-reset/request', { data: { email: alice.email } });
  expect(requested.status()).toBe(202);
  expect(await requested.json()).toEqual({ message: 'If this account exists, a reset email has been sent.' });
  const token = new URL(resetLinkFrom(await inbox.onlyMessageTo(alice.email), app.baseURL)).searchParams.get('token');

  const confirm = password => http.post('/api/password-reset/confirm', { data: { token, password } });
  expect((await confirm('Short-pw-11')).status(), '11 characters is too short').toBe(400);
  const [pending] = (await admin.state()).reset_tokens.filter(entry => entry.user_id === 'alice');
  expect(pending.consumed, 'a rejected password does not consume the token').toBeFalsy();

  await admin.advanceClock(301);
  const expired = await confirm('Long-enough-password-1');
  expect(expired.status()).toBe(400);
  expect(await expired.json()).toEqual({ error: 'invalid_or_expired_token' });

  const bogus = await http.post('/api/password-reset/confirm', { data: { token: 'not-a-real-token', password: 'Long-enough-password-1' } });
  expect(bogus.status()).toBe(400);
  expect(await bogus.json()).toEqual({ error: 'invalid_or_expired_token' });

  expect((await signIn(http, alice)).status(), 'old password still works').toBe(200);
});
