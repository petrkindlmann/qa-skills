import { test, expect, RESET_ACK, RESET_SUBJECT, resetLinks } from './helpers.mjs';

const tokenOf = (link) => new URL(link).searchParams.get('token');

test('a reset link delivered to Mailpit changes the password once and ends old sessions', async ({ app, shop, inbox }) => {
  const { alice } = app.users;
  const stranger = `nobody+${app.namespace}@example.test`;
  const oldSession = await shop.signIn(alice);
  const api = await shop.client();

  for (const email of [stranger, alice.email]) {
    const response = await api.post('/api/password-reset/request', { data: { email } });
    expect(response.status(), email).toBe(202);
    expect(await response.json(), email).toEqual(RESET_ACK);
  }

  const message = await inbox.waitForMessage(alice.email, RESET_SUBJECT);
  expect(message.To.map((to) => to.Address)).toEqual([alice.email]);
  const { fromText, fromHtml } = resetLinks(message, app.baseURL);
  expect(fromText, 'plaintext part carries the reset link').toHaveLength(1);
  expect(fromHtml, 'HTML part carries the reset link').toHaveLength(1);
  expect(fromHtml[0]).toBe(fromText[0]);
  const token = tokenOf(fromText[0]);

  // Alice's mail has arrived, so the earlier request for the unknown address had its chance.
  expect(await inbox.messagesTo(stranger)).toEqual([]);
  expect((await shop.state()).smtp_errors).toBe(0);

  const tooShort = await api.post('/api/password-reset/confirm', { data: { token, password: 'short-pw-11' } });
  expect(tooShort.status()).toBe(400);
  expect((await oldSession.get('/api/me')).status(), 'a rejected password must not end sessions').toBe(200);

  const newPassword = 'Fresh-alice-pass-2026';
  const confirmed = await api.post('/api/password-reset/confirm', { data: { token, password: newPassword } });
  expect(confirmed.status()).toBe(200);
  expect(await confirmed.json()).toEqual({ reset: true });

  expect((await oldSession.get('/api/me')).status()).toBe(401);
  const state = await shop.state();
  expect(state.sessions.alice ?? 0).toBe(0);
  expect(state.reset_tokens.filter((t) => t.user_id === 'alice').every((t) => t.consumed)).toBe(true);
  expect(JSON.stringify(state)).not.toContain(token);

  expect((await api.post('/api/login', { data: { email: alice.email, password: alice.password } })).status()).toBe(401);
  await shop.signIn(alice, newPassword);

  for (const reused of [token, 'not-a-real-token']) {
    const response = await api.post('/api/password-reset/confirm', { data: { token: reused, password: 'Another-pass-2026!' } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_or_expired_token' });
  }
  await shop.signIn(alice, newPassword);
});

test('a reset token expires after 300 seconds on the fixture clock', async ({ app, shop, inbox }) => {
  const { bob } = app.users;
  const api = await shop.client();
  expect((await api.post('/api/password-reset/request', { data: { email: bob.email } })).status()).toBe(202);
  const message = await inbox.waitForMessage(bob.email, RESET_SUBJECT);
  const token = tokenOf(resetLinks(message, app.baseURL).fromText[0]);
  expect(token).toBeTruthy();

  await shop.advanceClock(301);
  const expired = await api.post('/api/password-reset/confirm', { data: { token, password: 'Too-late-for-bob-2026' } });
  expect(expired.status()).toBe(400);
  expect(await expired.json()).toEqual({ error: 'invalid_or_expired_token' });

  await shop.signIn(bob);
  expect((await api.post('/api/login', { data: { email: bob.email, password: 'Too-late-for-bob-2026' } })).status()).toBe(401);
});
