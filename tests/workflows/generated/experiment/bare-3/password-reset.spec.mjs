import { test, expect, advanceClock, expectError, resetLink, supportState } from './helpers.mjs';

const GENERIC = { message: 'If this account exists, a reset email has been sent.' };

test('reset requests do not reveal accounts; tokens enforce length, expiry and single use', async ({ app, clients, inbox }) => {
  const { alice, bob } = app.users;
  const client = await clients();
  const requestReset = email => client.post('/api/password-reset/request', { data: { email } });
  const confirm = (token, password) => client.post('/api/password-reset/confirm', { data: { token, password } });
  const login = (user, password) => client.post('/api/login', { data: { email: user.email, password } });

  const stranger = `nobody+${app.namespace}@example.test`;
  for (const email of [stranger, bob.email, alice.email]) {
    const response = await requestReset(email);
    expect(response.status(), email).toBe(202);
    expect(await response.json()).toEqual(GENERIC);
  }
  const [bobMail] = await inbox.waitForMessages(bob.email);
  const [aliceMail] = await inbox.waitForMessages(alice.email);
  // Both known-account mails were sent after the stranger's request, so its absence is settled.
  expect(await inbox.list(stranger)).toEqual([]);
  for (const mail of [bobMail, aliceMail]) expect(mail.Subject).toBe('Reset your Shop password');
  const aliceToken = resetLink(aliceMail).searchParams.get('token');
  const bobToken = resetLink(bobMail).searchParams.get('token');
  expect(aliceToken).not.toBe(bobToken);

  await expectError(await confirm('not-a-real-token', 'Long-enough-password-1'), 400, 'invalid_or_expired_token');
  expect((await confirm(aliceToken, 'Short-pw-11')).status()).toBe(400);

  await advanceClock(client, app, 299);
  const reset = await confirm(aliceToken, 'Exactly-12ch');
  expect(reset.status()).toBe(200);
  expect(await reset.json()).toEqual({ reset: true });
  await expectError(await confirm(aliceToken, 'Yet-another-pass-3'), 400, 'invalid_or_expired_token');
  await expectError(await login(alice, alice.password), 401, 'invalid_credentials');
  expect((await login(alice, 'Exactly-12ch')).status()).toBe(200);

  await advanceClock(client, app, 2);
  await expectError(await confirm(bobToken, 'Bob-would-like-this-1'), 400, 'invalid_or_expired_token');
  expect((await login(bob, bob.password)).status()).toBe(200);
  await expectError(await login(bob, 'Bob-would-like-this-1'), 401, 'invalid_credentials');

  const state = await supportState(client, app);
  const tokens = Object.fromEntries(state.reset_tokens.map(t => [t.user_id, t]));
  expect(tokens.alice.consumed).not.toBeNull();
  expect(tokens.bob.consumed).toBeNull();
  expect(JSON.stringify(state)).not.toContain(aliceToken);
  expect(JSON.stringify(state)).not.toContain(bobToken);
  expect(state.smtp_errors).toBe(0);
});
