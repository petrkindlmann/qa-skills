import { test as base, expect } from '../../../support/fixtures.mjs';
import { shopFixtures } from './helpers.mjs';

const test = base.extend(shopFixtures);

const sessionCookie = (res) => res.headersArray()
  .filter((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('shop_session='))
  .map((h) => h.value);

test('sign-in issues a protected session cookie and sign-out revokes it on the server', async ({ app, shop }) => {
  const { alice } = app.users;
  const ctx = await shop.session(null);

  const rejected = await ctx.post('/api/login', { data: { email: alice.email, password: 'not-the-password' } });
  expect(rejected.status()).toBe(401);
  expect(await rejected.json()).toEqual({ error: 'invalid_credentials' });
  expect(sessionCookie(rejected)).toEqual([]);

  const anonymous = await ctx.get('/api/me');
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toEqual({ error: 'unauthenticated' });

  const login = await ctx.post('/api/login', { data: { email: alice.email, password: alice.password } });
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual({ user: { id: 'alice', email: alice.email } });
  const [cookie] = sessionCookie(login);
  expect(cookie, 'shop_session cookie is set').toBeTruthy();
  const attributes = cookie.split(';').slice(1).map((a) => a.trim().toLowerCase());
  expect(attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));
  expect(attributes).not.toContain('secure');

  const me = await ctx.get('/api/me');
  expect(me.status()).toBe(200);
  expect(await me.json()).toEqual({ user: { id: 'alice', email: alice.email } });
  expect((await shop.state()).sessions.alice).toBe(1);

  const logout = await ctx.post('/api/logout');
  expect(logout.status()).toBe(204);
  expect((await ctx.get('/api/me')).status()).toBe(401);

  // Replaying the old cookie value proves the session died server side, not just in this client's jar.
  const replay = await shop.session(null);
  const replayed = await replay.get('/api/me', { headers: { Cookie: cookie.split(';')[0] } });
  expect(replayed.status()).toBe(401);
  expect(await replayed.json()).toEqual({ error: 'unauthenticated' });
  expect((await shop.state()).sessions.alice ?? 0).toBe(0);
});

test('repeated failed sign-ins lock the address, even for the right password, until the window passes', async ({ app, shop }) => {
  const { alice, bob } = app.users;
  const ctx = await shop.session(null);
  const attempt = (email, password) => ctx.post('/api/login', { data: { email, password } });

  for (let i = 1; i <= 5; i += 1) {
    expect((await attempt(alice.email, `wrong-${i}`)).status(), `failure ${i}`).toBe(401);
  }
  const locked = await attempt(alice.email, alice.password);
  expect(locked.status()).toBe(429);
  expect(await locked.json()).toEqual({ error: 'too_many_attempts' });
  expect(locked.headers()['retry-after']).toBe('60');
  expect(sessionCookie(locked)).toEqual([]);
  expect((await ctx.get('/api/me')).status()).toBe(401);
  expect((await shop.state()).sessions.alice ?? 0).toBe(0);

  // Unknown addresses throttle identically, so the lock does not reveal which accounts exist.
  const unknown = `nobody+${app.namespace}@example.test`;
  for (let i = 1; i <= 5; i += 1) {
    const res = await attempt(unknown, `wrong-${i}`);
    expect(res.status(), `unknown failure ${i}`).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_credentials' });
  }
  const unknownLocked = await attempt(unknown, 'anything-at-all');
  expect(unknownLocked.status()).toBe(429);
  expect(unknownLocked.headers()['retry-after']).toBe('60');

  // The throttle is per address: bob is unaffected.
  const bobSession = await shop.session(null);
  expect((await bobSession.post('/api/login', { data: { email: bob.email, password: bob.password } })).status()).toBe(200);

  await shop.advanceClock(61);
  const afterWindow = await attempt(alice.email, alice.password);
  expect(afterWindow.status()).toBe(200);
  expect((await ctx.get('/api/me')).status()).toBe(200);
  // A successful sign-in clears the counter: the next failure is an ordinary 401, not a lock.
  expect((await attempt(alice.email, 'wrong-again')).status()).toBe(401);
});
