import { test, expect, RESET_ACCEPTED, resetLinkFrom, sessionsOf } from './shop-helpers.mjs';

test('a reset link delivered to Mailpit changes the password once and revokes every session', async ({ app, client, admin, inbox }) => {
  const { alice } = app.users;
  const laptop = await client(alice);
  const phone = await client(alice);
  expect(sessionsOf(await admin.state(), 'alice')).toBe(2);

  const anonymous = await client();
  const ghost = `ghost+${app.namespace}@example.test`;
  inbox.watch(ghost);
  for (const email of [ghost, alice.email]) {
    const response = await anonymous.post('/api/password-reset/request', { data: { email } });
    expect(response.status(), email).toBe(202);
    expect(await response.json(), email).toEqual(RESET_ACCEPTED);
  }

  const [mail] = await inbox.waitFor(alice.email);
  expect(mail.Subject).toBe('Reset your Shop password');
  expect(mail.To.map(to => to.Address)).toEqual([alice.email]);
  expect(mail.headers['Content-Type'][0]).toMatch(/^multipart\/alternative/);
  const link = resetLinkFrom(mail, app);
  const token = link.searchParams.get('token');

  // The ghost request was made first, so its mail would already be there if one had been sent.
  expect(await inbox.list(ghost)).toEqual([]);
  const before = await admin.state();
  expect(before.reset_tokens).toEqual([expect.objectContaining({ user_id: 'alice' })]);
  expect(before.reset_tokens[0].consumed).toBeFalsy();
  expect(before.smtp_errors).toBe(0);

  const newPassword = 'Fresh-alice-pass-789!';
  const confirmed = await anonymous.post('/api/password-reset/confirm', { data: { token, password: newPassword } });
  expect(confirmed.status()).toBe(200);
  expect(await confirmed.json()).toEqual({ reset: true });

  expect((await laptop.get('/api/me')).status()).toBe(401);
  expect((await phone.get('/api/me')).status()).toBe(401);
  const after = await admin.state();
  expect(sessionsOf(after, 'alice')).toBe(0);
  expect(after.reset_tokens[0].consumed).toBeTruthy();

  const login = (password) => anonymous.post('/api/login', { data: { email: alice.email, password } });
  expect((await login(alice.password)).status()).toBe(401);
  expect((await login(newPassword)).status()).toBe(200);

  for (const reused of [token, 'not-a-real-token']) {
    const response = await anonymous.post('/api/password-reset/confirm', { data: { token: reused, password: 'Another-pass-0001' } });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_or_expired_token' });
  }
});

test('reset tokens expire after 300 seconds and a too-short password does not consume them', async ({ app, client, admin, inbox }) => {
  const { bob } = app.users;
  const anonymous = await client();
  const requestReset = async () => {
    const response = await anonymous.post('/api/password-reset/request', { data: { email: bob.email } });
    expect(response.status()).toBe(202);
  };
  const confirm = (token, password) => anonymous.post('/api/password-reset/confirm', { data: { token, password } });
  const login = password => anonymous.post('/api/login', { data: { email: bob.email, password } });

  await requestReset();
  const [firstMail] = await inbox.waitFor(bob.email);
  const firstToken = resetLinkFrom(firstMail, app).searchParams.get('token');

  // Eleven characters is one short of the minimum; the contract names no status, so any client error is accepted.
  const tooShort = await confirm(firstToken, 'Short-pw-11');
  expect(tooShort.status()).toBeGreaterThanOrEqual(400);
  expect(tooShort.status()).toBeLessThan(500);
  expect((await admin.state()).reset_tokens[0].consumed).toBeFalsy();

  await admin.advanceClock(301);
  const expired = await confirm(firstToken, 'Long-enough-pass-1');
  expect(expired.status()).toBe(400);
  expect(await expired.json()).toEqual({ error: 'invalid_or_expired_token' });
  expect((await login('Long-enough-pass-1')).status()).toBe(401);
  expect((await login(bob.password)).status()).toBe(200);

  await requestReset();
  const mails = await inbox.waitFor(bob.email, 2);
  const tokens = mails.map(mail => resetLinkFrom(mail, app).searchParams.get('token'));
  const secondToken = tokens.find(token => token !== firstToken);
  expect(secondToken, 'a fresh token is issued').toBeTruthy();

  const exactlyTwelve = 'Twelve-chars';
  expect(exactlyTwelve).toHaveLength(12);
  const reset = await confirm(secondToken, exactlyTwelve);
  expect(reset.status()).toBe(200);
  expect(await reset.json()).toEqual({ reset: true });
  expect((await login(exactlyTwelve)).status()).toBe(200);
});
