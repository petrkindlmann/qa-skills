import { test as base, expect } from '../../../support/fixtures.mjs';
import { resetLinks, shopFixtures, tokenFrom } from './helpers.mjs';

const test = base.extend(shopFixtures);

const GENERIC = { message: 'If this account exists, a reset email has been sent.' };

test('a reset email from the real inbox changes the password once and ends every session', async ({ app, shop, inbox, request }) => {
  const { alice } = app.users;
  const unknown = `nobody+${app.namespace}@example.test`;
  inbox.own(unknown);
  const requestReset = (email) => request.post(`${app.baseURL}/api/password-reset/request`, { data: { email } });

  const forUnknown = await requestReset(unknown);
  expect(forUnknown.status()).toBe(202);
  expect(await forUnknown.json()).toEqual(GENERIC);
  const forAlice = await requestReset(alice.email);
  expect(forAlice.status()).toBe(202);
  expect(await forAlice.json()).toEqual(GENERIC);

  const message = await inbox.next(alice.email);
  expect(message.Subject).toBe('Reset your Shop password');
  expect(message.To.map((to) => to.Address)).toEqual([alice.email]);
  const links = resetLinks(message);
  expect(links.text, 'plaintext part carries the reset link').toHaveLength(1);
  expect(links.html, 'HTML part carries the reset link').toContain(links.text[0]);
  const link = new URL(links.text[0]);
  expect(link.origin).toBe(app.baseURL);
  expect(link.pathname).toBe('/reset-password');
  const token = tokenFrom(links.text[0]);
  expect(token).toBeTruthy();
  // Alice's message arrived after the unknown address was requested; the unknown address got nothing.
  expect(await inbox.messagesTo(unknown)).toHaveLength(0);
  expect((await shop.state()).smtp_errors).toBe(0);

  const phone = await shop.session(alice);
  const laptop = await shop.session(alice);
  expect((await shop.state()).sessions.alice).toBe(2);

  const confirm = (body) => request.post(`${app.baseURL}/api/password-reset/confirm`, { data: body });
  const tooShort = await confirm({ token, password: 'short-pw-11' });
  expect(tooShort.status(), 'an 11-character password is refused').toBeGreaterThanOrEqual(400);
  expect(tooShort.status()).toBeLessThan(500);
  expect((await phone.get('/api/me')).status(), 'refused reset leaves sessions alone').toBe(200);

  const newPassword = 'Alice-new-secret-789!';
  const reset = await confirm({ token, password: newPassword });
  expect(reset.status()).toBe(200);
  expect(await reset.json()).toEqual({ reset: true });

  expect((await phone.get('/api/me')).status()).toBe(401);
  expect((await laptop.get('/api/me')).status()).toBe(401);
  expect((await shop.state()).sessions.alice ?? 0).toBe(0);

  const login = (password) => request.post(`${app.baseURL}/api/login`, { data: { email: alice.email, password } });
  expect((await login(alice.password)).status(), 'old password no longer works').toBe(401);
  expect((await login(newPassword)).status(), 'new password works').toBe(200);

  const reused = await confirm({ token, password: 'Another-new-secret-000!' });
  expect(reused.status()).toBe(400);
  expect(await reused.json()).toEqual({ error: 'invalid_or_expired_token' });
  const bogus = await confirm({ token: 'not-a-real-token', password: 'Another-new-secret-000!' });
  expect(bogus.status()).toBe(400);
  expect(await bogus.json()).toEqual({ error: 'invalid_or_expired_token' });
  expect((await login(newPassword)).status()).toBe(200);
});

test('a reset token stops working after 300 seconds', async ({ app, shop, inbox, request }) => {
  const { bob } = app.users;
  const res = await request.post(`${app.baseURL}/api/password-reset/request`, { data: { email: bob.email } });
  expect(res.status()).toBe(202);
  const token = tokenFrom(resetLinks(await inbox.next(bob.email)).text[0]);

  const [stored] = (await shop.state()).reset_tokens.filter((t) => t.user_id === 'bob');
  expect(stored).toMatchObject({ consumed: null });
  expect(stored).not.toHaveProperty('token');

  await shop.advanceClock(301);
  const expired = await request.post(`${app.baseURL}/api/password-reset/confirm`, {
    data: { token, password: 'Bob-late-secret-000!' },
  });
  expect(expired.status()).toBe(400);
  expect(await expired.json()).toEqual({ error: 'invalid_or_expired_token' });

  const login = await request.post(`${app.baseURL}/api/login`, { data: { email: bob.email, password: bob.password } });
  expect(login.status(), 'password unchanged after an expired token').toBe(200);
});
