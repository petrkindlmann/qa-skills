import { test, expect, EXAMPLE_ITEMS, RESET_ACK, RESET_SUBJECT, paymentEvent, resetLinks, sameItems } from './helpers.mjs';

const dataLayer = (page, name) => page.evaluate((event) => window.dataLayer.filter((e) => e.event === event), name);

async function open(page, url) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}

async function signInThroughForm(page, email, password) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('shopper signs in, checks out, sees payment after reload and signs out', async ({ app, shop, page }) => {
  const { alice } = app.users;
  const notice = page.getByRole('status');
  await open(page, app.baseURL);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();

  await signInThroughForm(page, alice.email, 'not-her-password');
  await expect(notice).toHaveText('invalid_credentials');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await dataLayer(page, 'login')).toEqual([]);

  await signInThroughForm(page, alice.email, alice.password);
  await expect(notice).toHaveText('Signed in.');
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  expect(await dataLayer(page, 'login')).toEqual([{ event: 'login', method: 'password' }]);

  await page.getByLabel('Mountain tea 50 g quantity').fill('2');
  await page.getByLabel('Tea cup quantity').fill('1');
  await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(notice).toHaveText(/^Order created: .+\. Amount: EUR 42\.00$/);
  const orderId = (await notice.textContent()).match(/^Order created: (.+)\. Amount/)[1];

  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${orderId}` }) });
  await expect(row).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

  const purchases = await dataLayer(page, 'purchase');
  expect(purchases).toHaveLength(1);
  expect(purchases[0].ecommerce).toMatchObject({ transaction_id: orderId, value: 42, currency: 'EUR' });
  sameItems(purchases[0].ecommerce.items.map((i) => ({ sku: i.item_id, quantity: i.quantity })), EXAMPLE_ITEMS);

  // The browser's own session sees the same server-owned order.
  const serverOrder = (await (await page.request.get(`${app.baseURL}/api/orders/${orderId}`)).json()).order;
  expect(serverOrder).toMatchObject({ amount: 4200, status: 'pending' });

  const paid = await shop.deliver(paymentEvent('evt-browser-1', serverOrder));
  expect(paid.status()).toBe(200);

  await page.reload();
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  await expect(row).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');

  const eventsBeforeSignOut = await page.evaluate(() => window.dataLayer.length);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(notice).toHaveText('Signed out.');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
  expect(await page.evaluate(() => window.dataLayer.length), 'sign-out pushes no analytics event').toBe(eventsBeforeSignOut);
  expect((await page.request.get(`${app.baseURL}/api/me`)).status()).toBe(401);
  expect((await page.request.get(`${app.baseURL}/api/orders/${orderId}`)).status()).toBe(401);

  await open(page, app.baseURL);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Order ${orderId}` })).toHaveCount(0);
});

test('reset link from the inbox opens a working new-password form', async ({ app, shop, inbox, page }) => {
  const { alice } = app.users;
  const notice = page.getByRole('status');
  const newPassword = 'Browser-reset-pass-2026';
  await open(page, app.baseURL);

  await page.getByLabel('Account email').fill(alice.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(notice).toHaveText(RESET_ACK.message);

  const message = await inbox.waitForMessage(alice.email, RESET_SUBJECT);
  const link = resetLinks(message, app.baseURL).fromHtml[0];
  expect(link).toBeTruthy();

  await open(page, `${app.baseURL}/reset-password?token=forged-token`);
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(notice).toHaveText('invalid_or_expired_token');

  await open(page, link);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(notice).toHaveText('Your password has been reset. Sign in with your new password.');
  expect(await dataLayer(page, 'login')).toEqual([]);

  await open(page, link);
  await page.getByLabel('New password').fill('Second-use-pass-2026');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(notice).toHaveText('invalid_or_expired_token');

  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await page.waitForURL(`${app.baseURL}/`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await signInThroughForm(page, alice.email, newPassword);
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();

  const oldPassword = await (await shop.client()).post('/api/login', { data: { email: alice.email, password: alice.password } });
  expect(oldPassword.status()).toBe(401);
});
