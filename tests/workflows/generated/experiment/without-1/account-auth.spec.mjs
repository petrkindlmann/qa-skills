import { test, expect } from './helpers.mjs';

test('sign-in issues a server session that sign-out revokes', async ({ app, shop }) => {
  const { alice, bob } = app.users;
  const anonymous = await shop.client();

  const started = Date.now();
  const health = await anonymous.get('/health');
  expect(Date.now() - started).toBeLessThan(500);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', build: 'shop-lab-v1' });

  const catalog = await (await anonymous.get('/api/catalog')).json();
  expect(catalog.currency).toBe('EUR');
  const price = Object.fromEntries(catalog.products.map((p) => [p.sku, p.unit_amount]));
  expect(price).toMatchObject({ 'TEA-50': 1200, 'CUP-01': 1800 });

  const me = await anonymous.get('/api/me');
  expect(me.status()).toBe(401);
  expect(await me.json()).toEqual({ error: 'unauthenticated' });
  expect((await anonymous.get('/test-support/state')).status()).toBe(403);

  const rejected = await anonymous.post('/api/login', { data: { email: alice.email, password: bob.password } });
  expect(rejected.status()).toBe(401);
  expect(await rejected.json()).toEqual({ error: 'invalid_credentials' });
  expect(rejected.headers()['set-cookie']).toBeUndefined();

  const api = await shop.client();
  const login = await api.post('/api/login', { data: { email: alice.email, password: alice.password } });
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual({ user: { id: 'alice', email: alice.email } });
  const [cookie, ...attributes] = login.headers()['set-cookie'].split(';').map((part) => part.trim());
  expect(cookie).toMatch(/^shop_session=.+/);
  expect(attributes).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/']));
  expect(attributes).not.toContain('Secure');

  expect(await (await api.get('/api/me')).json()).toEqual({ user: { id: 'alice', email: alice.email } });
  const bobApi = await shop.signIn(bob);
  expect((await (await bobApi.get('/api/me')).json()).user.id).toBe('bob');
  expect((await shop.state()).sessions.alice).toBe(1);

  const logout = await api.post('/api/logout');
  expect(logout.status()).toBe(204);
  expect((await api.get('/api/me')).status()).toBe(401);

  // The old cookie must be dead on the server, not merely dropped by the client.
  const replay = await anonymous.get('/api/me', { headers: { Cookie: cookie } });
  expect(replay.status()).toBe(401);
  expect((await shop.state()).sessions.alice ?? 0).toBe(0);
  expect((await bobApi.get('/api/me')).status()).toBe(200);
});

test('repeated failed sign-ins are throttled per address until the window passes', async ({ app, shop }) => {
  const { alice, bob } = app.users;
  const ghost = `ghost+${app.namespace}@example.test`;
  const api = await shop.client();
  const attempt = (email, password) => api.post('/api/login', { data: { email, password } });

  for (let i = 1; i <= 5; i += 1) {
    expect((await attempt(alice.email, `wrong-${i}`)).status(), `failure ${i}`).toBe(401);
    expect((await attempt(ghost, `wrong-${i}`)).status(), `unknown address failure ${i}`).toBe(401);
  }

  const locked = await attempt(alice.email, alice.password);
  expect(locked.status()).toBe(429);
  expect(await locked.json()).toEqual({ error: 'too_many_attempts' });
  expect(locked.headers()['retry-after']).toBe('60');
  expect(locked.headers()['set-cookie']).toBeUndefined();
  expect((await api.get('/api/me')).status()).toBe(401);

  const ghostLocked = await attempt(ghost, 'anything');
  expect(ghostLocked.status()).toBe(429);
  expect(ghostLocked.headers()['retry-after']).toBe('60');

  // Bob's counter is separate, and a successful sign-in clears it.
  for (let i = 1; i <= 4; i += 1) expect((await attempt(bob.email, 'nope')).status()).toBe(401);
  expect((await attempt(bob.email, bob.password)).status()).toBe(200);
  for (let i = 1; i <= 4; i += 1) expect((await attempt(bob.email, 'nope')).status(), `bob failure after reset ${i}`).toBe(401);

  expect((await shop.state()).sessions.alice ?? 0).toBe(0);

  await shop.advanceClock(61);
  const afterWindow = await shop.client();
  const login = await afterWindow.post('/api/login', { data: { email: alice.email, password: alice.password } });
  expect(login.status()).toBe(200);
  expect((await afterWindow.get('/api/me')).status()).toBe(200);
  expect((await attempt(ghost, 'still-wrong')).status()).toBe(401);
});
