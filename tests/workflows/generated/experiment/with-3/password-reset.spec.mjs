import {
  test, expect, signIn, signedInClient, expectError, extractResetLink, fixtureState, advanceClock,
} from './helpers.mjs';

const ACCEPTED = { message: 'If this account exists, a reset email has been sent.' };

test('reset email from Mailpit resets the password in the browser and revokes old sessions', async ({ page, app, clients, inbox }) => {
  const alice = app.users.alice;
  const stranger = inbox.watch(`nobody+${app.namespace}@example.test`);
  const oldSession = await signedInClient(clients, alice);
  const newPassword = 'Alice-renewed-2026!';

  await test.step('request resets in the page for an unknown and a known address', async () => {
    await page.goto(`${app.baseURL}/`);
    for (const email of [stranger, alice.email]) {
      const requested = page.waitForResponse(r => r.url().endsWith('/api/password-reset/request'));
      await page.getByLabel('Account email').fill(email);
      await page.getByRole('button', { name: 'Send reset link' }).click();
      const response = await requested;
      expect(response.status()).toBe(202);
      expect(await response.json()).toEqual(ACCEPTED);
      await expect(page.getByRole('status')).toHaveText(ACCEPTED.message);
    }
  });

  const message = await inbox.waitFor(alice.email);
  let link;
  await test.step('the email is addressed, templated and links back to this app', async () => {
    expect(message.Subject).toBe('Reset your Shop password');
    expect(message.To.map(to => to.Address)).toEqual([alice.email]);
    expect(message.From?.Address).toBeTruthy();
    link = await extractResetLink(page, message, app.baseURL);
    expect(message.Text).toContain(link);
    expect(await inbox.search(alice.email), 'search finds the delivered message').toHaveLength(1);
    expect(await inbox.search(stranger), 'unknown address receives no mail').toEqual([]);
  });

  await test.step('the link opens the new-password form and the reset succeeds', async () => {
    await page.goto(link);
    await page.getByLabel('New password').fill(newPassword);
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('status')).toHaveText(/password has been reset/i);
  });

  await test.step('existing sessions and the old password stop working; the new one works', async () => {
    await expectError(await oldSession.get('/api/me'), 401, 'unauthenticated');
    const api = await clients();
    await expectError(await api.post('/api/login', { data: { email: alice.email, password: alice.password } }),
      401, 'invalid_credentials');
    await signIn(api, alice, newPassword);
  });

  await test.step('the consumed link reports the server error', async () => {
    await page.goto(link);
    await page.getByLabel('New password').fill('Another-password-99');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('status')).toHaveText(/invalid_or_expired_token/);
    await signIn(await clients(), alice, newPassword);
  });
});

test('reset tokens expire after 300 seconds, are single use and need 12 characters', async ({ page, app, clients, inbox }) => {
  const bob = app.users.bob;
  const api = await clients();
  const confirm = (token, password) => api.post('/api/password-reset/confirm', { data: { token, password } });
  const requestReset = async () => {
    const response = await api.post('/api/password-reset/request', { data: { email: bob.email } });
    expect(response.status()).toBe(202);
    expect(await response.json()).toEqual(ACCEPTED);
  };
  const tokenOf = async message => new URL(await extractResetLink(page, message, app.baseURL)).searchParams.get('token');

  await requestReset();
  const first = await inbox.waitFor(bob.email);
  const firstToken = await tokenOf(first);

  await test.step('an 11-character password is rejected without consuming the token', async () => {
    const short = await confirm(firstToken, 'Bob-new-123');
    expect(short.status()).toBe(400);
    expect((await fixtureState(api, app)).reset_tokens.filter(t => t.user_id === 'bob').map(t => t.consumed))
      .toEqual([null]);
  });

  await test.step('after 301 seconds the token is expired and the password unchanged', async () => {
    await advanceClock(api, app, 301);
    await expectError(await confirm(firstToken, 'Bob-expired-attempt-1'), 400, 'invalid_or_expired_token');
    await signIn(await clients(), bob);
  });

  await requestReset();
  const second = await inbox.waitFor(bob.email, { excludeIds: [first.ID] });
  const secondToken = await tokenOf(second);
  expect(secondToken).not.toBe(firstToken);

  await test.step('at 299 seconds a 12-character password is accepted once', async () => {
    await advanceClock(api, app, 299);
    const reset = await confirm(secondToken, 'Bob-new-1234');
    expect(reset.status()).toBe(200);
    expect(await reset.json()).toEqual({ reset: true });
    await expectError(await confirm(secondToken, 'Bob-again-12345'), 400, 'invalid_or_expired_token');
    await expectError(await confirm('not-a-real-token', 'Bob-again-12345'), 400, 'invalid_or_expired_token');
  });

  await test.step('only the new password signs in', async () => {
    const fresh = await clients();
    await expectError(await fresh.post('/api/login', { data: { email: bob.email, password: bob.password } }),
      401, 'invalid_credentials');
    await signIn(fresh, bob, 'Bob-new-1234');
  });
});
