import { test, expect, BASKET, sessionCookie, sessionsOf } from './shop-helpers.mjs';

test('sign-in issues a hardened session cookie and sign-out revokes it on the server', async ({ app, client, admin }) => {
  const { alice } = app.users;
  const anonymous = await client();

  const me = await anonymous.get('/api/me');
  expect(me.status()).toBe(401);
  expect(await me.json()).toEqual({ error: 'unauthenticated' });
  for (const response of [
    await anonymous.get('/api/orders'),
    await anonymous.get('/api/orders/any-id'),
    await anonymous.post('/api/orders', { headers: { 'Idempotency-Key': 'anon-1' }, data: { currency: 'EUR', items: BASKET } }),
  ]) expect(response.status(), response.url()).toBe(401);

  for (const headers of [{}, { 'X-Test-Admin-Key': 'wrong-key' }]) {
    const guarded = await anonymous.get('/test-support/state', { headers });
    expect(guarded.status()).toBe(403);
    expect(await guarded.json()).toEqual({ error: 'forbidden' });
  }

  const rejected = await anonymous.post('/api/login', { data: { email: alice.email, password: 'not-the-password' } });
  expect(rejected.status()).toBe(401);
  expect(await rejected.json()).toEqual({ error: 'invalid_credentials' });
  expect(sessionCookie(rejected)).toBeUndefined();

  const browser = await client();
  const login = await browser.post('/api/login', { data: { email: alice.email, password: alice.password } });
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual({ user: { id: 'alice', email: alice.email } });
  const cookie = sessionCookie(login);
  expect(cookie, 'shop_session cookie is set').toBeTruthy();
  const attributes = cookie.split(';').slice(1).map(part => part.trim().toLowerCase());
  expect(attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));
  expect(attributes).not.toContain('secure');

  const signedIn = await browser.get('/api/me');
  expect(signedIn.status()).toBe(200);
  expect(await signedIn.json()).toEqual({ user: { id: 'alice', email: alice.email } });
  expect(sessionsOf(await admin.state(), 'alice')).toBe(1);

  const logout = await browser.post('/api/logout');
  expect(logout.status()).toBe(204);
  expect((await browser.get('/api/me')).status()).toBe(401);

  // Replaying the old cookie from another client proves the session was revoked server-side.
  const replay = await anonymous.get('/api/me', { headers: { Cookie: cookie.split(';')[0] } });
  expect(replay.status()).toBe(401);
  expect(sessionsOf(await admin.state(), 'alice')).toBe(0);
});

test('five failed sign-ins lock an address, even for the right password, until the window passes', async ({ app, client, admin }) => {
  const { alice, bob } = app.users;
  const attacker = await client();
  const attempt = (email, password) => attacker.post('/api/login', { data: { email, password } });
  const expectLocked = async response => {
    expect(response.status()).toBe(429);
    expect(response.headers()['retry-after']).toBe('60');
    expect(await response.json()).toEqual({ error: 'too_many_attempts' });
    expect(sessionCookie(response)).toBeUndefined();
  };

  for (let i = 1; i <= 5; i++) expect((await attempt(alice.email, `wrong-${i}`)).status()).toBe(401);
  await expectLocked(await attempt(alice.email, alice.password));
  expect((await attacker.get('/api/me')).status()).toBe(401);
  expect(sessionsOf(await admin.state(), 'alice')).toBe(0);

  // The lock is per address: bob is unaffected.
  await client(bob);

  // Unknown addresses behave identically, so the lock does not reveal which accounts exist.
  const ghost = `ghost+${app.namespace}@example.test`;
  for (let i = 1; i <= 5; i++) {
    const response = await attempt(ghost, `wrong-${i}`);
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_credentials' });
  }
  await expectLocked(await attempt(ghost, 'whatever-password'));

  await admin.advanceClock(61);
  expect((await attempt(alice.email, alice.password)).status()).toBe(200);
  expect((await attacker.get('/api/me')).status()).toBe(200);

  // A successful sign-in resets the counter: 4 failures + success + 5 failures stays unlocked until the 6th.
  const bobClient = await client();
  const bobAttempt = password => bobClient.post('/api/login', { data: { email: bob.email, password } });
  for (let i = 1; i <= 4; i++) expect((await bobAttempt(`wrong-${i}`)).status()).toBe(401);
  expect((await bobAttempt(bob.password)).status()).toBe(200);
  for (let i = 5; i <= 9; i++) expect((await bobAttempt(`wrong-${i}`)).status()).toBe(401);
  await expectLocked(await bobAttempt(bob.password));
});
