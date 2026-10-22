import { test, expect } from './helpers.mjs';

const WRONG = 'Wrong-password-0!';

async function attempts(client, email, passwords) {
  const results = [];
  for (const password of passwords) {
    const response = await client.post('/api/login', { data: { email, password } });
    results.push({ status: response.status(), body: await response.json(), headers: response.headers() });
  }
  return results;
}

test('five failed sign-ins lock the address for 60 seconds, per address, and a success clears the counter', async ({ app, shop }) => {
  const { alice, bob } = app.users;
  const client = await shop.client();

  await test.step('the sixth attempt is throttled even with the correct password and creates no session', async () => {
    const failures = await attempts(client, alice.email, Array(5).fill(WRONG));
    expect(failures.map(r => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(failures[0].body).toEqual({ error: 'invalid_credentials' });

    const [locked] = await attempts(client, alice.email, [alice.password]);
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ error: 'too_many_attempts' });
    expect(locked.headers['retry-after']).toBe('60');
    expect(locked.headers['set-cookie']).toBeUndefined();
    expect((await client.get('/api/me')).status()).toBe(401);
    expect((await shop.state()).sessions.alice ?? 0).toBe(0);
  });

  await test.step('an unknown address is throttled identically', async () => {
    const unknown = `ghost+${app.namespace}@example.test`;
    const results = await attempts(client, unknown, [...Array(5).fill(WRONG), WRONG]);
    expect(results.map(r => r.status)).toEqual([401, 401, 401, 401, 401, 429]);
    expect(results[0].body).toEqual({ error: 'invalid_credentials' });
    expect(results[5].headers['retry-after']).toBe('60');
  });

  await test.step('another address is unaffected and its counter clears on success', async () => {
    const results = await attempts(client, bob.email,
      [WRONG, WRONG, WRONG, WRONG, bob.password, WRONG, WRONG, WRONG, WRONG, bob.password]);
    expect(results.map(r => r.status)).toEqual([401, 401, 401, 401, 200, 401, 401, 401, 401, 200]);
  });

  await test.step('once the window passes on the fixture clock, the correct password signs in', async () => {
    await shop.advanceClock(61);
    const fresh = await shop.client();
    const response = await fresh.post('/api/login', { data: { email: alice.email, password: alice.password } });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ user: { id: 'alice', email: alice.email } });
    const cookie = response.headersArray().find(h => h.name.toLowerCase() === 'set-cookie')?.value ?? '';
    expect(cookie).toMatch(/^shop_session=[^;]+/);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie).not.toMatch(/;\s*Secure/i);

    const me = await fresh.get('/api/me');
    expect(me.status()).toBe(200);
    expect(await me.json()).toEqual({ user: { id: 'alice', email: alice.email } });

    const logout = await fresh.post('/api/logout');
    expect(logout.status()).toBe(204);
    const after = await fresh.get('/api/me');
    expect(after.status()).toBe(401);
    expect(await after.json()).toEqual({ error: 'unauthenticated' });
  });
});
