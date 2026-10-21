// Support report 1: "After I click Sign out in the browser, a colleague who had copied my
// session cookie earlier can still load /api/me and my orders."
// Contract clauses: "POST /api/logout: invalidates the current session and returns 204",
// "All order endpoints return 401 without a valid session", "Logout removes access".
// Both tests pass on a healthy Shop and go red if sign-out only clears the browser cookie.
import { test, expect } from '../../../support/fixtures.mjs';
import { copiedSession, createOrder, disposeAll, expectSessionRevoked, listOrders, signIn } from './helpers.mjs';

test('browser Sign out revokes a session cookie copied by someone else', async ({ app, page }) => {
  const alice = app.users.alice;
  let colleague;
  try {
    await page.goto(app.baseURL + '/');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await page.getByLabel('Email', { exact: true }).fill(alice.email);
    await page.getByLabel('Password', { exact: true }).fill(alice.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('status')).toHaveText('Signed in.');
    await expect(page.locator('#identity')).toHaveText(`Signed in as ${alice.email}`);

    // The order the reporter is worried about, placed through the page (TEA-50 x1 by default).
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('status')).toHaveText(/^Order created: .+ Amount: EUR 12\.00$/);
    await expect(page.locator('#orders li')).toHaveCount(1);

    // The colleague copies the browser's cookie while the session is live.
    const cookie = (await page.context().cookies(app.baseURL)).find(c => c.name === 'shop_session');
    expect(cookie, 'browser holds a shop_session cookie after sign-in').toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    colleague = await copiedSession(app.baseURL, cookie.value);

    // Baseline: the copy really works before sign-out, otherwise the later 401s prove nothing.
    const meBefore = await colleague.get('/api/me');
    expect(meBefore.status()).toBe(200);
    expect(await meBefore.json()).toEqual({ user: { id: alice.id, email: alice.email } });
    const ordersBefore = await listOrders(colleague);
    expect(ordersBefore).toHaveLength(1);
    const orderId = ordersBefore[0].id;

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('status')).toHaveText('Signed out.');
    await expect(page.locator('#login-section')).toBeVisible();
    await expect(page.locator('#account-section')).toBeHidden();

    // The report's expectation: revoked everywhere, not just in this browser.
    await expectSessionRevoked(colleague, orderId);

    // And the browser itself stays signed out across a reload (the "just in my browser" half).
    const meInBrowser = await page.request.get(app.baseURL + '/api/me');
    expect(meInBrowser.status()).toBe(401);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#login-section')).toBeVisible();
    await expect(page.locator('#account-section')).toBeHidden();
  } finally {
    await disposeAll(colleague);
  }
});

test('POST /api/logout invalidates the session for every holder of the cookie', async ({ app }) => {
  const alice = app.users.alice;
  let owner, colleague, fresh;
  try {
    const signedIn = await signIn(app.baseURL, alice);
    owner = signedIn.ctx;
    colleague = await copiedSession(app.baseURL, signedIn.cookie);

    // Baseline: the copied cookie is a full session; it can even place an order.
    expect((await colleague.get('/api/me')).status()).toBe(200);
    const order = await createOrder(colleague, 'report-1-colleague-order');
    expect(order.user_id).toBe(alice.id);

    const logout = await owner.post('/api/logout');
    expect(logout.status(), 'logout returns 204').toBe(204);

    // Owner's own client is out, and so is every copy of the same cookie.
    expect((await owner.get('/api/me')).status()).toBe(401);
    await expectSessionRevoked(colleague, order.id);

    // Control: the account is not locked, a new sign-in works and still sees the order,
    // and the new session does not resurrect the old cookie (sessions are per token, not per user).
    fresh = (await signIn(app.baseURL, alice)).ctx;
    expect((await fresh.get('/api/me')).status()).toBe(200);
    expect((await listOrders(fresh)).map(o => o.id)).toEqual([order.id]);
    await expectSessionRevoked(colleague, order.id);
  } finally {
    await disposeAll(owner, colleague, fresh);
  }
});
