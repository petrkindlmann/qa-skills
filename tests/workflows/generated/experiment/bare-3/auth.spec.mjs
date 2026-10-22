import { test, expect, advanceClock, expectError, supportState } from './helpers.mjs';

test('public surface, session cookie and server-side logout', async ({ app, clients }) => {
  const { alice } = app.users;
  const anonymous = await clients();

  const started = Date.now();
  const health = await anonymous.get('/health');
  expect(Date.now() - started).toBeLessThan(500);
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', build: 'shop-lab-v1' });

  const catalog = await (await anonymous.get('/api/catalog')).json();
  expect(catalog.currency).toBe('EUR');
  const price = sku => catalog.products.find(p => p.sku === sku)?.unit_amount;
  expect([price('TEA-50'), price('CUP-01')]).toEqual([1200, 1800]);

  await expectError(await anonymous.get('/api/me'), 401, 'unauthenticated');
  expect((await anonymous.get('/api/orders')).status()).toBe(401);
  expect((await anonymous.get('/api/orders/anything')).status()).toBe(401);
  expect((await anonymous.post('/api/orders', { headers: { 'Idempotency-Key': 'anon-1' }, data: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }] } })).status()).toBe(401);

  for (const headers of [{}, { 'X-Test-Admin-Key': 'not-the-key' }]) {
    await expectError(await anonymous.get('/test-support/state', { headers }), 403, 'forbidden');
    await expectError(await anonymous.post('/test-support/clock', { headers, data: { advance_seconds: 1 } }), 403, 'forbidden');
  }

  const client = await clients();
  const login = await client.post('/api/login', { data: { email: alice.email, password: alice.password } });
  expect(login.status()).toBe(200);
  expect(await login.json()).toEqual({ user: { id: 'alice', email: alice.email } });
  const setCookie = login.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value);
  expect(setCookie).toHaveLength(1);
  const attributes = setCookie[0].split(';').map(part => part.trim());
  const [name, value] = attributes[0].split('=');
  expect(name).toBe('shop_session');
  expect(value).toBeTruthy();
  expect(attributes.map(a => a.toLowerCase())).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));
  expect(attributes.map(a => a.toLowerCase())).not.toContain('secure');

  expect(await (await client.get('/api/me')).json()).toEqual({ user: { id: 'alice', email: alice.email } });
  const replayCookie = { headers: { Cookie: `shop_session=${value}` } };
  expect((await anonymous.get('/api/me', replayCookie)).status()).toBe(200);

  const logout = await client.post('/api/logout');
  expect(logout.status()).toBe(204);
  await expectError(await client.get('/api/me'), 401, 'unauthenticated');
  // The captured cookie must be dead on the server, not just cleared in this client.
  await expectError(await anonymous.get('/api/me', replayCookie), 401, 'unauthenticated');
  expect((await anonymous.get('/api/orders', replayCookie)).status()).toBe(401);
  expect((await supportState(anonymous, app)).sessions.alice ?? 0).toBe(0);
});

test('failed sign-ins lock the address, not the account holder elsewhere, until the window passes', async ({ app, clients }) => {
  const { alice, bob } = app.users;
  const client = await clients();
  const attempt = (email, password) => client.post('/api/login', { data: { email, password } });

  for (let i = 1; i <= 5; i += 1) await expectError(await attempt(alice.email, `wrong-${i}`), 401, 'invalid_credentials');
  const locked = await attempt(alice.email, alice.password);
  await expectError(locked, 429, 'too_many_attempts');
  expect(locked.headers()['retry-after']).toBe('60');
  expect(locked.headers()['set-cookie']).toBeUndefined();
  await expectError(await client.get('/api/me'), 401, 'unauthenticated');
  expect((await supportState(client, app)).sessions.alice ?? 0).toBe(0);

  // Throttling is per address: bob still signs in from the same client.
  expect((await attempt(bob.email, bob.password)).status()).toBe(200);

  const ghost = `ghost+${app.namespace}@example.test`;
  for (let i = 1; i <= 5; i += 1) await expectError(await attempt(ghost, `wrong-${i}`), 401, 'invalid_credentials');
  const ghostLocked = await attempt(ghost, 'anything-at-all');
  await expectError(ghostLocked, 429, 'too_many_attempts');
  expect(ghostLocked.headers()['retry-after']).toBe('60');

  await advanceClock(client, app, 61);
  expect((await attempt(alice.email, alice.password)).status()).toBe(200);
  expect((await client.get('/api/me')).status()).toBe(200);

  // A successful sign-in clears the counter: 4 + 4 failures around it must not lock.
  for (let i = 1; i <= 4; i += 1) await expectError(await attempt(alice.email, `again-${i}`), 401, 'invalid_credentials');
  expect((await attempt(alice.email, alice.password)).status()).toBe(200);
  for (let i = 1; i <= 4; i += 1) await expectError(await attempt(alice.email, `later-${i}`), 401, 'invalid_credentials');
  expect((await attempt(alice.email, alice.password)).status()).toBe(200);
});
