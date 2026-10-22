import { test, expect } from '../../../support/fixtures.mjs';
import { advanceClock, apiClient, replaySession, sessionCookie, supportState } from './helpers.mjs';

function setCookieHeaders(response) {
  return response.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value);
}

test('session cookie contract, protected endpoints and server-side logout revocation', async ({ app }) => {
  const { alice } = app.users;
  const client = await apiClient(app);
  try {
    await test.step('anonymous requests are refused', async () => {
      const me = await client.get('/api/me');
      expect(me.status()).toBe(401);
      expect(await me.json()).toEqual({ error: 'unauthenticated' });
      expect((await client.get('/api/orders')).status()).toBe(401);
      expect((await client.get('/api/orders/does-not-exist')).status()).toBe(401);
      const create = await client.post('/api/orders', {
        headers: { 'Idempotency-Key': 'anon-1' },
        data: { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 1 }] },
      });
      expect(create.status()).toBe(401);
    });

    await test.step('wrong password is 401 and sets no session', async () => {
      const bad = await client.post('/api/login', { data: { email: alice.email, password: 'Alice-wrong-000!' } });
      expect(bad.status()).toBe(401);
      expect(await bad.json()).toEqual({ error: 'invalid_credentials' });
      expect(setCookieHeaders(bad).some(v => v.startsWith('shop_session='))).toBe(false);
    });

    let cookieValue;
    await test.step('valid sign-in returns the user and a hardened cookie', async () => {
      const ok = await client.post('/api/login', { data: { email: alice.email, password: alice.password } });
      expect(ok.status()).toBe(200);
      expect(ok.headers()['content-type']).toContain('application/json');
      expect(await ok.json()).toEqual({ user: { id: 'alice', email: alice.email } });
      const cookie = setCookieHeaders(ok).find(v => v.startsWith('shop_session='));
      expect(cookie, 'shop_session Set-Cookie header').toBeTruthy();
      const attributes = cookie.split(';').slice(1).map(a => a.trim().toLowerCase());
      expect(attributes).toContain('httponly');
      expect(attributes).toContain('samesite=lax');
      expect(attributes).toContain('path=/');
      expect(attributes).not.toContain('secure');
      const me = await client.get('/api/me');
      expect(me.status()).toBe(200);
      expect(await me.json()).toEqual({ user: { id: 'alice', email: alice.email } });
      cookieValue = await sessionCookie(client);
    });

    await test.step('logout revokes the session on the server, not only in this client', async () => {
      expect(await replaySession(app, cookieValue), 'control: replayed cookie works before logout').toBe(200);
      const logout = await client.post('/api/logout');
      expect(logout.status()).toBe(204);
      expect((await client.get('/api/me')).status()).toBe(401);
      expect(await replaySession(app, cookieValue), 'replayed cookie after logout').toBe(401);
    });
  } finally {
    await client.dispose();
  }
});

test('sign-in throttling locks an address after five failures until the window passes', async ({ app }) => {
  const { alice, bob } = app.users;
  const unknown = `nobody+${app.namespace}@example.test`;
  const client = await apiClient(app);
  const attempt = (email, password) => client.post('/api/login', { data: { email, password } });
  try {
    await test.step('a successful sign-in clears earlier failures', async () => {
      for (let i = 0; i < 4; i++) expect((await attempt(alice.email, `wrong-${i}-password`)).status()).toBe(401);
      expect((await attempt(alice.email, alice.password)).status()).toBe(200);
      await client.post('/api/logout');
    });

    const sessionsBefore = (await supportState(app)).sessions.alice ?? 0;

    await test.step('five failures, then even the correct password is refused with 429', async () => {
      for (let i = 0; i < 5; i++) {
        expect((await attempt(alice.email, `wrong-again-${i}`)).status(), `failure ${i + 1}`).toBe(401);
      }
      const locked = await attempt(alice.email, alice.password);
      expect(locked.status()).toBe(429);
      expect(locked.headers()['retry-after']).toBe('60');
      expect(await locked.json()).toEqual({ error: 'too_many_attempts' });
      expect(setCookieHeaders(locked).some(v => v.startsWith('shop_session='))).toBe(false);
      expect((await client.get('/api/me')).status()).toBe(401);
      expect((await supportState(app)).sessions.alice ?? 0).toBe(sessionsBefore);
    });

    await test.step('throttling is per address and identical for unknown addresses', async () => {
      const bobLogin = await attempt(bob.email, bob.password);
      expect(bobLogin.status()).toBe(200);
      await client.post('/api/logout');
      for (let i = 0; i < 5; i++) {
        const r = await attempt(unknown, `guess-${i}-password`);
        expect(r.status()).toBe(401);
        expect(await r.json()).toEqual({ error: 'invalid_credentials' });
      }
      const lockedUnknown = await attempt(unknown, 'guess-final');
      expect(lockedUnknown.status()).toBe(429);
      expect(lockedUnknown.headers()['retry-after']).toBe('60');
      expect(await lockedUnknown.json()).toEqual({ error: 'too_many_attempts' });
    });

    await test.step('after the 60 s window (fixture clock) the correct password works again', async () => {
      await advanceClock(app, 61);
      const ok = await attempt(alice.email, alice.password);
      expect(ok.status()).toBe(200);
      expect((await client.get('/api/me')).status()).toBe(200);
      expect((await supportState(app)).sessions.alice).toBe(sessionsBefore + 1);
    });
  } finally {
    await client.dispose();
  }
});
