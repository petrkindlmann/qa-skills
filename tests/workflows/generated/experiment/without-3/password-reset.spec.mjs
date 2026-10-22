import { test, expect, RESET_MESSAGE, resetLinks } from './helpers.mjs';

async function tokenFrom(message, app) {
  const links = resetLinks(message);
  expect(links.text, 'reset link in plaintext part').toBeTruthy();
  expect(links.html, 'HTML part links to the same reset URL').toBe(links.text);
  const url = new URL(links.text);
  expect(url.origin).toBe(app.baseURL);
  expect(url.pathname).toBe('/reset-password');
  expect(url.searchParams.get('token')).toBeTruthy();
  return url;
}

test('reset link from the real inbox sets a new password and ends every existing session', async ({ app, shop, inbox, page }) => {
  const alice = app.users.alice;
  const unknown = `nobody+${app.namespace}@example.test`;
  const newPassword = 'Fresh-pass1!'; // exactly the 12-character minimum
  const existingSession = await shop.signIn(alice);
  expect((await shop.state()).sessions.alice).toBe(1);

  const anonymous = await shop.client();
  const unknownResponse = await anonymous.post('/api/password-reset/request', { data: { email: unknown } });
  expect(unknownResponse.status()).toBe(202);
  expect(await unknownResponse.json()).toEqual({ message: RESET_MESSAGE });

  await page.goto(`${app.baseURL}/`);
  await page.getByLabel('Account email').fill(alice.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toHaveText(RESET_MESSAGE);
  expect(await page.evaluate(() => window.dataLayer)).toEqual([]);

  const message = await inbox.waitForOnly(alice.email);
  expect(message.Subject).toBe('Reset your Shop password');
  expect(message.To.map(to => to.Address)).toEqual([alice.email]);
  const link = await tokenFrom(message, app);
  expect(await inbox.messagesTo(unknown), 'unknown account receives no mail').toEqual([]);
  expect((await shop.state()).smtp_errors).toBe(0);

  await page.goto(link.href);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('status')).toHaveText('Your password has been reset. Sign in with your new password.');

  await test.step('existing sessions end and only the new password works', async () => {
    expect((await existingSession.get('/api/me')).status()).toBe(401);
    const state = await shop.state();
    expect(state.sessions.alice ?? 0).toBe(0);
    expect(state.reset_tokens.filter(t => t.user_id === 'alice').map(t => Boolean(t.consumed))).toEqual([true]);

    const client = await shop.client();
    const old = await client.post('/api/login', { data: { email: alice.email, password: alice.password } });
    expect(old.status()).toBe(401);
    expect(await old.json()).toEqual({ error: 'invalid_credentials' });
    const fresh = await client.post('/api/login', { data: { email: alice.email, password: newPassword } });
    expect(fresh.status()).toBe(200);
    expect((await fresh.json()).user).toEqual({ id: 'alice', email: alice.email });
  });

  await test.step('the consumed link reports the server error and changes nothing', async () => {
    await page.reload();
    await page.getByLabel('New password').fill('Another-pass-2024!');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('status')).toHaveText('invalid_or_expired_token');
    const client = await shop.client();
    const login = await client.post('/api/login', { data: { email: alice.email, password: newPassword } });
    expect(login.status()).toBe(200);
  });
});

test('expired, unknown and too-short reset submissions leave the password unchanged', async ({ app, shop, inbox }) => {
  const bob = app.users.bob;
  const attempted = 'Brand-new-pass-99!';
  const anonymous = await shop.client();
  const confirm = data => anonymous.post('/api/password-reset/confirm', { data });

  expect((await anonymous.post('/api/password-reset/request', { data: { email: bob.email } })).status()).toBe(202);
  const token = (await tokenFrom(await inbox.waitForOnly(bob.email), app)).searchParams.get('token');

  const tooShort = await confirm({ token, password: 'Short-pass1' }); // 11 characters
  expect(tooShort.status()).toBe(400);

  const unknown = await confirm({ token: `${token}x`, password: attempted });
  expect(unknown.status()).toBe(400);
  expect(await unknown.json()).toEqual({ error: 'invalid_or_expired_token' });

  await shop.advanceClock(301);
  const expired = await confirm({ token, password: attempted });
  expect(expired.status()).toBe(400);
  expect(await expired.json()).toEqual({ error: 'invalid_or_expired_token' });

  const client = await shop.client();
  expect((await client.post('/api/login', { data: { email: bob.email, password: attempted } })).status()).toBe(401);
  expect((await client.post('/api/login', { data: { email: bob.email, password: 'Short-pass1' } })).status()).toBe(401);
  expect((await client.post('/api/login', { data: { email: bob.email, password: bob.password } })).status()).toBe(200);
});
