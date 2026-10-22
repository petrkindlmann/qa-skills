import { test, expect, signIn, expectError, fixtureState, advanceClock } from './helpers.mjs';

test('sign-in issues an HttpOnly session and logout revokes it on the server', async ({ app, clients }) => {
  const alice = app.users.alice;
  const api = await clients();

  await test.step('anonymous requests are rejected', async () => {
    await expectError(await api.get('/api/me'), 401, 'unauthenticated');
    await expectError(await api.get('/api/orders'), 401, 'unauthenticated');
    await expectError(await api.get('/api/orders/does-not-matter'), 401, 'unauthenticated');
  });

  await test.step('wrong password is 401 and creates no session', async () => {
    await expectError(await api.post('/api/login', { data: { email: alice.email, password: 'Alice-wrong-123!' } }),
      401, 'invalid_credentials');
    expect((await fixtureState(api, app)).sessions.alice ?? 0).toBe(0);
  });

  const login = await signIn(api, alice);
  await test.step('session cookie and user shape', async () => {
    expect(await login.json()).toEqual({ user: { id: 'alice', email: alice.email } });
    expect(login.headers()['content-type']).toContain('application/json');
    const cookie = login.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie')
      .map(h => h.value).find(value => value.startsWith('shop_session='));
    expect(cookie, 'shop_session Set-Cookie').toBeDefined();
    const attributes = cookie.split(';').slice(1).map(part => part.trim().toLowerCase());
    expect(attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));
    expect(attributes).not.toContain('secure');
    expect(await (await api.get('/api/me')).json()).toEqual({ user: { id: 'alice', email: alice.email } });
  });

  await test.step('logout invalidates the captured session for every holder', async () => {
    const captured = await api.storageState();
    const replay = await clients({ storageState: captured });
    expect((await replay.get('/api/me')).status()).toBe(200);

    expect((await api.post('/api/logout')).status()).toBe(204);
    await expectError(await replay.get('/api/me'), 401, 'unauthenticated');
    await expectError(await replay.get('/api/orders'), 401, 'unauthenticated');
    expect((await fixtureState(api, app)).sessions.alice ?? 0).toBe(0);
  });
});

test('five failed sign-ins throttle that address until the window passes', async ({ app, clients }) => {
  const { alice, bob } = app.users;
  const api = await clients();
  const attempt = (email, password) => api.post('/api/login', { data: { email, password } });

  await test.step('a success clears the failure counter', async () => {
    for (let i = 0; i < 4; i++) expect((await attempt(alice.email, 'nope-nope-nope')).status()).toBe(401);
    await signIn(api, alice);
    expect((await api.post('/api/logout')).status()).toBe(204);
  });

  await test.step('failures 1-5 are 401; the sixth is 429 even with the right password', async () => {
    for (let i = 1; i <= 5; i++) {
      await expectError(await attempt(alice.email, `wrong-${i}-password`), 401, 'invalid_credentials');
    }
    const locked = await attempt(alice.email, alice.password);
    await expectError(locked, 429, 'too_many_attempts');
    expect(locked.headers()['retry-after']).toBe('60');
    expect(locked.headers()['set-cookie']).toBeUndefined();
    await expectError(await api.get('/api/me'), 401, 'unauthenticated');
    expect((await fixtureState(api, app)).sessions.alice ?? 0).toBe(0);
  });

  await test.step('throttling is per address and unknown addresses throttle identically', async () => {
    const response = await signIn(api, bob);
    expect((await response.json()).user.id).toBe('bob');
    const ghost = `ghost+${app.namespace}@example.test`;
    for (let i = 1; i <= 5; i++) await expectError(await attempt(ghost, 'whatever-1234'), 401, 'invalid_credentials');
    const ghostLocked = await attempt(ghost, 'whatever-1234');
    await expectError(ghostLocked, 429, 'too_many_attempts');
    expect(ghostLocked.headers()['retry-after']).toBe('60');
  });

  await test.step('the lock lifts once the fixture clock passes 60 seconds', async () => {
    await advanceClock(api, app, 61);
    const response = await signIn(await clients(), alice);
    expect((await response.json()).user).toEqual({ id: 'alice', email: alice.email });
  });
});
