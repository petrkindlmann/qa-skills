import { test, expect } from '../../../../../support/fixtures.mjs';
import { readDataLayerTrace } from './helpers/datalayer.mjs';
import { validateEvent } from './helpers/validate.mjs';
import { openShop, signIn, signInAndSettle, status, signOutQuietly } from './helpers/shop.mjs';
import { plan } from './helpers/plan.mjs';

const LOGIN_EVENT = { event: 'login', method: plan.login.expected.method };

test.afterEach(async ({ page, app }) => { await signOutQuietly(page, app); });

test('login is pushed exactly once after a successful sign-in, and not on load or reload', async ({ page, app }) => {
  await openShop(page, app);
  const onLoad = await readDataLayerTrace(page);
  expect(onLoad.errors, 'observer installed cleanly').toEqual([]);
  expect(onLoad.entries, 'page load pushes nothing').toEqual([]);
  expect(await page.evaluate(() => Array.isArray(window.dataLayer) && window.dataLayer.length), 'dataLayer exists and is empty on load').toBe(0);

  await signInAndSettle(page, app.users.alice);
  const me = await page.request.get(app.baseURL + '/api/me');
  expect(me.status(), 'the sign-in really created a session').toBe(200);
  expect((await me.json()).user.id).toBe('alice');

  const trace = await readDataLayerTrace(page);
  expect(trace.errors).toEqual([]);
  expect(trace.replacements, 'application replaced its dataLayer').toBe(0);
  const fresh = trace.entries.slice(onLoad.entries.length);
  expect(fresh, 'exactly one login input after sign-in').toEqual([LOGIN_EVENT]);
  expect(validateEvent(plan, 'login', fresh[0])).toEqual([]);
  expect(trace.entries.filter(entry => entry.event === 'login')).toHaveLength(1);
  expect(await page.evaluate(() => window.dataLayer.length), 'raw layer agrees with the observer').toBe(1);

  // A reload restores the session from /api/me; that is not a sign-in and must push nothing.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#account-section')).toBeVisible();
  const afterReload = await readDataLayerTrace(page);
  expect(afterReload.errors).toEqual([]);
  expect(afterReload.entries, 'session restore pushes nothing').toEqual([]);
});

test('a rejected sign-in pushes nothing; the following successful one pushes login once', async ({ page, app }) => {
  await openShop(page, app);
  await signIn(page, { email: app.users.alice.email, password: 'definitely-not-the-password' });
  await expect(status(page)).toHaveText('invalid_credentials');
  expect((await page.request.get(app.baseURL + '/api/me')).status(), 'no session after rejection').toBe(401);
  await expect(page.locator('#login-section')).toBeVisible();

  const afterReject = await readDataLayerTrace(page);
  expect(afterReject.errors).toEqual([]);
  expect(afterReject.entries, 'rejected sign-in pushes nothing').toEqual([]);
  expect(await page.evaluate(() => window.dataLayer.length)).toBe(0);

  // Control in the same page: the observer must see the healthy push, or the empty
  // trace above proves nothing.
  await page.getByLabel('Password', { exact: true }).fill(app.users.alice.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(status(page)).toHaveText('Signed in.');
  const trace = await readDataLayerTrace(page);
  expect(trace.entries).toEqual([LOGIN_EVENT]);
});

test('sign-out and a password-reset request push nothing after the login event', async ({ page, app, mailpit }) => {
  await openShop(page, app);
  await signInAndSettle(page, app.users.alice);
  const checkpoint = (await readDataLayerTrace(page)).entries.length;
  expect(checkpoint, 'login was observed before the checkpoint').toBe(1);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(status(page)).toHaveText('Signed out.');
  expect((await page.request.get(app.baseURL + '/api/me')).status(), 'session really ended').toBe(401);
  const afterSignOut = await readDataLayerTrace(page);
  expect(afterSignOut.entries.slice(checkpoint), 'sign-out pushes nothing').toEqual([]);
  expect(await page.evaluate(() => window.dataLayer.length), 'the layer is not cleared on sign-out').toBe(1);

  const resetResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/password-reset/request');
  try {
    await page.getByLabel('Account email').fill(app.users.alice.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    expect((await resetResponse).status(), 'the request reached the server').toBe(202);
    await expect(status(page)).toHaveText('If this account exists, a reset email has been sent.');
    const afterReset = await readDataLayerTrace(page);
    expect(afterReset.errors).toEqual([]);
    expect(afterReset.entries.slice(checkpoint), 'password-reset request pushes nothing').toEqual([]);
    expect(afterReset.entries).toEqual([LOGIN_EVENT]);
  } finally {
    // Scoped inbox cleanup: the request above mails this instance's alice address only.
    // Delivery is asynchronous; poll briefly, delete what arrived, and do not fail the
    // tracking assertion on inbox state (that is email-testing's job).
    const query = encodeURIComponent(`to:"${app.users.alice.email}"`);
    for (let attempt = 0; attempt < 10; attempt++) {
      const found = await page.request.get(`${mailpit.baseURL}/api/v1/search?query=${query}`);
      const ids = found.ok() ? (await found.json()).messages?.map(message => message.ID) ?? [] : [];
      if (ids.length) { await page.request.delete(`${mailpit.baseURL}/api/v1/messages`, { data: { IDs: ids } }); break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
});
