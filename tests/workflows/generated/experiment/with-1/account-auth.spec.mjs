import { test, expect, signIn, sessionCookie } from './helpers.mjs';

test('sign-in issues a hardened session cookie and sign-out revokes it on the server', async ({ app, clients }) => {
  const { alice } = app.users;
  const shopper = await clients.open();

  await test.step('anonymous and rejected sign-ins get no session', async () => {
    const me = await shopper.get('/api/me');
    expect(me.status()).toBe(401);
    expect(await me.json()).toEqual({ error: 'unauthenticated' });

    const rejected = await signIn(shopper, alice, 'not-the-password-1');
    expect(rejected.status()).toBe(401);
    expect(await rejected.json()).toEqual({ error: 'invalid_credentials' });
    expect(sessionCookie(rejected)).toBeNull();
  });

  let cookie;
  await test.step('valid credentials return the user and a scoped HttpOnly cookie', async () => {
    const response = await signIn(shopper, alice);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(await response.json()).toEqual({ user: { id: 'alice', email: alice.email } });

    cookie = sessionCookie(response);
    expect(cookie, 'shop_session Set-Cookie header').not.toBeNull();
    const attributes = cookie.split(';').slice(1).map(part => part.trim().toLowerCase());
    expect(attributes).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));

    const me = await shopper.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ user: { id: 'alice', email: alice.email } });
    expect((await clients.state()).sessions.alice).toBe(1);
  });

  // Replaying the captured credential from an independent client proves server-side
  // revocation; the healthy replay first shows the replay mechanism itself works.
  const replay = await clients.open({ extraHTTPHeaders: { Cookie: cookie.split(';')[0] } });
  expect((await replay.get('/api/me')).status(), 'captured cookie works before logout').toBe(200);

  await test.step('logout invalidates the session for every holder of the cookie', async () => {
    const logout = await shopper.post('/api/logout');
    expect(logout.status()).toBe(204);

    for (const client of [shopper, replay]) {
      const me = await client.get('/api/me');
      expect(me.status()).toBe(401);
      expect(await me.json()).toEqual({ error: 'unauthenticated' });
    }
    expect((await replay.get('/api/orders')).status()).toBe(401);
    expect((await clients.state()).sessions.alice ?? 0).toBe(0);
  });
});

test('failed sign-ins are throttled per address until the window passes', async ({ app, clients }) => {
  const { alice, bob } = app.users;
  const client = await clients.open();
  const ghost = { email: `ghost+${app.namespace}@example.test` };

  const failFiveTimes = async user => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await signIn(client, user, `wrong-password-${attempt}`);
      expect(response.status(), `failed attempt ${attempt} for ${user.email}`).toBe(401);
      expect(await response.json()).toEqual({ error: 'invalid_credentials' });
    }
  };
  const expectThrottled = async (user, password) => {
    const response = await signIn(client, user, password);
    expect(response.status()).toBe(429);
    expect(await response.json()).toEqual({ error: 'too_many_attempts' });
    expect(response.headers()['retry-after']).toBe('60');
    expect(sessionCookie(response)).toBeNull();
  };

  await test.step('after five failures even the correct password is refused without a session', async () => {
    await failFiveTimes(alice);
    await expectThrottled(alice, alice.password);
    expect((await client.get('/api/me')).status()).toBe(401);
    expect((await clients.state()).sessions.alice ?? 0).toBe(0);
  });

  await test.step('unknown addresses throttle identically', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await signIn(client, ghost, `guess-${attempt}`);
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ error: 'invalid_credentials' });
    }
    await expectThrottled(ghost, 'another-guess');
  });

  await test.step('the limit is per address: four failures then success clears the counter', async () => {
    const bobClient = await clients.open();
    for (let round = 1; round <= 2; round += 1) {
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect((await signIn(bobClient, bob, `bad-${round}-${attempt}`)).status()).toBe(401);
      }
      const success = await signIn(bobClient, bob);
      expect(success.status(), `bob signs in after four failures, round ${round}`).toBe(200);
    }
  });

  await test.step('once the 60 second window passes on the fixture clock, the account recovers', async () => {
    await clients.advanceClock(61);
    const response = await signIn(client, alice);
    expect(response.status()).toBe(200);
    expect(sessionCookie(response)).not.toBeNull();
    expect((await client.get('/api/me')).status()).toBe(200);

    const nextFailure = await signIn(client, alice, 'wrong-again-1');
    expect(nextFailure.status(), 'a successful sign-in reset the failure counter').toBe(401);
  });
});
