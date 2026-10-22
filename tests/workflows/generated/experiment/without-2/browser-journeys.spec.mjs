import { test as base, expect } from '../../../support/fixtures.mjs';
import { paymentBody, resetLinks, shopFixtures } from './helpers.mjs';

const test = base.extend(shopFixtures);

const dataLayer = (page) => page.evaluate(() => structuredClone(window.dataLayer ?? []));
const eventsNamed = async (page, name) => (await dataLayer(page)).filter((e) => e.event === name);

async function signIn(page, email, password) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('shopper signs in, checks out, sees the payment land and keeps state until sign-out', async ({ app, shop, page }) => {
  const { alice } = app.users;
  const status = page.getByRole('status');
  await page.goto(app.baseURL);

  await signIn(page, alice.email, 'wrong-password-1');
  await expect(status).toContainText('invalid_credentials');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeHidden();
  expect(await eventsNamed(page, 'login')).toEqual([]);

  await signIn(page, alice.email, alice.password);
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain('shop_session');
  await expect.poll(() => eventsNamed(page, 'login')).toEqual([{ event: 'login', method: 'password' }]);

  // Out-of-range quantities are stopped by the form itself (the API rejection is covered in orders.spec).
  const tea = page.getByLabel('Mountain tea 50 g quantity');
  const cups = page.getByLabel('Tea cup quantity');
  const orderPosts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/orders')) orderPosts.push(r.url()); });
  await cups.fill('11');
  await page.getByRole('button', { name: 'Place order' }).click();
  expect(await cups.evaluate((el) => el.validity.rangeOverflow)).toBe(true);
  await expect(status).toHaveText('Signed in.');
  expect(orderPosts, 'no order request for an invalid cart').toEqual([]);
  await expect(page.getByRole('listitem')).toHaveText(['No orders yet.']);
  expect((await (await page.request.get(`${app.baseURL}/api/orders`)).json()).orders).toEqual([]);
  expect(await eventsNamed(page, 'purchase')).toEqual([]);

  await tea.fill('2');
  await cups.fill('1');
  await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(status).toContainText(/Order created: \S+\. Amount: EUR 42\.00/);
  const orderId = (await status.textContent()).match(/Order created: (\S+)\./)[1];
  expect(orderPosts).toHaveLength(1);

  const serverOrder = await page.request.get(`${app.baseURL}/api/orders/${orderId}`);
  expect(serverOrder.status()).toBe(200);
  expect((await serverOrder.json()).order).toMatchObject({ amount: 4200, currency: 'EUR', status: 'pending' });

  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${orderId}` }) });
  await expect(card).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

  const purchases = await eventsNamed(page, 'purchase');
  expect(purchases).toHaveLength(1);
  expect(purchases[0].ecommerce).toMatchObject({ transaction_id: orderId, value: 42, currency: 'EUR' });
  expect([...purchases[0].ecommerce.items].sort((a, b) => a.item_id.localeCompare(b.item_id)))
    .toEqual([{ item_id: 'CUP-01', quantity: 1 }, { item_id: 'TEA-50', quantity: 2 }]);

  const payment = await shop.deliver(paymentBody('evt-browser', orderId));
  expect(payment.status).toBe(200);
  await page.getByRole('button', { name: 'Refresh orders' }).click();
  await expect(card).toContainText('Status: paid · Fulfillments: 1');

  await page.reload();
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  await expect(card).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');
  // Restoring a session on reload is not a new sign-in or purchase.
  expect(await dataLayer(page)).toEqual([]);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
  expect(await dataLayer(page), 'sign-out pushes no analytics').toEqual([]);
  expect((await page.request.get(`${app.baseURL}/api/me`)).status()).toBe(401);
  expect((await page.request.get(`${app.baseURL}/api/orders`)).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(orderId)).toHaveCount(0);
});

test('a user resets a forgotten password from the emailed link and signs in with it', async ({ app, inbox, page, request }) => {
  const { bob } = app.users;
  const status = page.getByRole('status');
  await page.goto(app.baseURL);

  await page.getByLabel('Account email').fill(bob.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(status).toContainText('If this account exists, a reset email has been sent.');

  const message = await inbox.next(bob.email);
  expect(message.Subject).toBe('Reset your Shop password');
  const { html } = resetLinks(message);
  expect(html).toHaveLength(1);
  expect(new URL(html[0]).origin).toBe(app.baseURL);

  await page.goto(html[0]);
  const newPassword = 'Bob-browser-secret-321!';
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(status).toContainText('Your password has been reset.');

  const oldLogin = await request.post(`${app.baseURL}/api/login`, { data: { email: bob.email, password: bob.password } });
  expect(oldLogin.status()).toBe(401);

  // The link is single use: submitting it again reports the server's error.
  await page.goto(html[0]);
  await page.getByLabel('New password').fill('Bob-second-secret-654!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(status).toContainText('invalid_or_expired_token');

  await page.goto(app.baseURL);
  await signIn(page, bob.email, newPassword);
  await expect(page.getByText(`Signed in as ${bob.email}`)).toBeVisible();
  await expect.poll(() => dataLayer(page)).toEqual([{ event: 'login', method: 'password' }]);
});
