import { test, expect, RESET_ACCEPTED, extractResetLink, tokenOf, signIn } from './helpers.mjs';

const SUBJECT = 'Reset your Shop password';

test('the emailed reset link sets a new password in the browser and revokes old sessions', async ({ app, clients, inbox, page }) => {
  const { alice } = app.users;
  const newPassword = 'Fresh-password-2026!';
  const existingSession = await clients.signedIn(alice);

  await test.step('request a reset from the sign-in page', async () => {
    await page.goto(`${app.baseURL}/`);
    await page.getByLabel('Account email').fill(alice.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toHaveText(RESET_ACCEPTED);
  });

  let link;
  await test.step('the real message is addressed, titled and linked correctly', async () => {
    const message = await inbox.waitFor(alice.email);
    expect(message.Subject).toBe(SUBJECT);
    expect(message.To.map(to => to.Address)).toEqual([alice.email]);
    expect(message.From.Address).toMatch(/@/);
    expect(message.Text.trim().length).toBeGreaterThan(0);
    expect(message.HTML.trim().length).toBeGreaterThan(0);
    link = await extractResetLink(page, message, app.baseURL);
  });

  await test.step('the link opens a labelled form that accepts the new password', async () => {
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('New password').fill(newPassword);
    const confirmation = page.waitForResponse(response =>
      response.url().endsWith('/api/password-reset/confirm') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Reset password' }).click();
    const response = await confirmation;
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ reset: true });
    await expect(page.getByRole('status')).not.toBeEmpty();
    await expect(page.getByRole('status')).not.toHaveText(/invalid|error|expired/i);
  });

  await test.step('existing sessions are invalidated, the old password fails and the new one works', async () => {
    expect((await existingSession.get('/api/me')).status()).toBe(401);
    expect((await clients.state()).sessions.alice ?? 0).toBe(0);

    const client = await clients.open();
    const old = await signIn(client, alice);
    expect(old.status()).toBe(401);
    expect(await old.json()).toEqual({ error: 'invalid_credentials' });
    expect((await signIn(client, alice, newPassword)).status()).toBe(200);
  });

  await test.step('the consumed link reports the server error and changes nothing', async () => {
    await page.goto(link);
    await page.getByLabel('New password').fill('Yet-another-password-1');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('status')).toHaveText('invalid_or_expired_token');

    await page.goto(`${app.baseURL}/`);
    await page.getByLabel('Email', { exact: true }).fill(alice.email);
    await page.getByLabel('Password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  });
});

test('reset requests do not reveal accounts, and expired or invalid tokens are refused', async ({ app, clients, inbox, page }) => {
  const { bob } = app.users;
  const client = await clients.open();
  const unknown = `nobody+${app.namespace}@example.test`;

  const requestReset = async email => {
    const response = await client.post('/api/password-reset/request', { data: { email } });
    expect(response.status(), email).toBe(202);
    expect(await response.json()).toEqual({ message: RESET_ACCEPTED });
  };
  const confirm = (token, password) =>
    client.post('/api/password-reset/confirm', { data: { token, password } });
  const expectRefused = async (response, label) => {
    expect(response.status(), label).toBe(400);
    expect(await response.json(), label).toEqual({ error: 'invalid_or_expired_token' });
  };

  let first;
  await test.step('known and unknown addresses get the same answer; only the account gets mail', async () => {
    await requestReset(unknown);
    await requestReset(bob.email);
    first = await inbox.waitFor(bob.email);
    expect(first.Subject).toBe(SUBJECT);
    // Bob's later message has arrived, so an earlier one for the unknown address would have too.
    expect(await inbox.messagesTo(unknown)).toEqual([]);
    const tokens = (await clients.state()).reset_tokens;
    expect(tokens.map(token => token.user_id)).toEqual(['bob']);
    expect(JSON.stringify(tokens)).not.toContain(tokenOf(await extractResetLink(page, first, app.baseURL)));
  });

  await test.step('an invalid token is refused', async () => {
    await expectRefused(await confirm('not-a-real-token', 'Valid-length-pass-1'), 'invalid token');
  });

  await test.step('a token older than 300 seconds on the fixture clock is refused', async () => {
    const expiredToken = tokenOf(await extractResetLink(page, first, app.baseURL));
    await clients.advanceClock(301);
    await expectRefused(await confirm(expiredToken, 'Expired-token-pass-1'), 'expired token');
    expect((await signIn(client, bob)).status(), 'old password still valid').toBe(200);
  });

  await test.step('a fresh token enforces the 12-character minimum and then resets', async () => {
    await requestReset(bob.email);
    const second = await inbox.waitFor(bob.email, { exclude: [first.ID] });
    const token = tokenOf(await extractResetLink(page, second, app.baseURL));

    const short = await confirm(token, 'Short-pass1');
    expect('Short-pass1').toHaveLength(11);
    expect(short.status(), '11-character password').toBeGreaterThanOrEqual(400);
    expect(short.status(), '11-character password').toBeLessThan(500);

    const exactMinimum = 'Twelve-char1';
    expect(exactMinimum).toHaveLength(12);
    const reset = await confirm(token, exactMinimum);
    expect(reset.status(), 'a rejected short password must not consume the token').toBe(200);
    expect(await reset.json()).toEqual({ reset: true });

    const fresh = await clients.open();
    expect((await signIn(fresh, bob)).status()).toBe(401);
    expect((await signIn(fresh, bob, exactMinimum)).status()).toBe(200);
    await expectRefused(await confirm(token, 'Second-use-pass-1'), 'consumed token');
  });
});
