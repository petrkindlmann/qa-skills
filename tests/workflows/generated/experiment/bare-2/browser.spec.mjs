import { test, expect, RESET_ACCEPTED, paymentEvent, deliver, resetLinkFrom } from './shop-helpers.mjs';

async function open(page, url) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}

async function signIn(page, user, password = user.password) {
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(user.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const trackedEvents = page => page.evaluate(() => window.dataLayer.filter(entry => entry.event));

test('shopper signs in, checks out, sees payment land, survives reload and signs out', async ({ page, app, client }) => {
  const { alice } = app.users;
  // Observation only: record which purchases were already tracked each time the orders list re-renders.
  await page.addInitScript(() => {
    window.__ordersRenders = [];
    document.addEventListener('DOMContentLoaded', () => {
      const list = document.getElementById('orders');
      new MutationObserver(() => window.__ordersRenders.push({
        listed: [...list.querySelectorAll('li[data-order-id]')].map(item => item.dataset.orderId),
        tracked: window.dataLayer.filter(entry => entry.event === 'purchase').map(entry => entry.ecommerce.transaction_id),
      })).observe(list, { childList: true });
    });
  });
  await open(page, `${app.baseURL}/`);
  const status = page.getByRole('status');

  await signIn(page, alice, 'definitely-wrong');
  await expect(status).toHaveText('invalid_credentials');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await trackedEvents(page)).toEqual([]);

  await signIn(page, alice);
  await expect(status).toHaveText('Signed in.');
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'No orders yet.' })).toBeVisible();
  expect(await trackedEvents(page)).toEqual([{ event: 'login', method: 'password' }]);

  await page.getByRole('spinbutton', { name: 'Mountain tea 50 g quantity' }).fill('2');
  await page.getByRole('spinbutton', { name: 'Tea cup quantity' }).fill('1');
  await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(status).toHaveText(/^Order created: \S+\. Amount: EUR 42\.00$/);
  const orderId = (await status.textContent()).match(/^Order created: (\S+)\./)[1];

  const orderItem = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${orderId}` }) });
  await expect(orderItem).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

  const events = await trackedEvents(page);
  const purchases = events.filter(entry => entry.event === 'purchase');
  expect(purchases).toHaveLength(1);
  expect(purchases[0]).toMatchObject({ ecommerce: { transaction_id: orderId, value: 42, currency: 'EUR' } });
  expect(purchases[0].ecommerce.items).toHaveLength(2);
  expect(purchases[0].ecommerce.items).toEqual(expect.arrayContaining([
    { item_id: 'TEA-50', quantity: 2 }, { item_id: 'CUP-01', quantity: 1 },
  ]));
  const renders = await page.evaluate(() => window.__ordersRenders);
  expect(renders.some(render => render.listed.includes(orderId)), 'observer saw the order rendered').toBe(true);
  for (const render of renders) {
    for (const id of render.listed) expect(render.tracked, 'purchase tracked before the list shows the order').toContain(id);
  }

  const serverView = await page.request.get(`${app.baseURL}/api/orders`);
  expect((await serverView.json()).orders).toEqual([expect.objectContaining({ id: orderId, amount: 4200, status: 'pending' })]);

  const paid = await deliver(await client(), app, paymentEvent('evt-browser', orderId));
  expect(paid.status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh orders' }).click();
  await expect(orderItem).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  await expect(orderItem).toContainText('Status: paid · Fulfillments: 1');
  expect(await trackedEvents(page), 'restoring a session is not a new sign-in or purchase').toEqual([]);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(status).toHaveText('Signed out.');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  expect((await page.request.get(`${app.baseURL}/api/me`)).status()).toBe(401);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(orderId)).toHaveCount(0);
});

test('shopper resets a forgotten password from the emailed link and signs in with it', async ({ page, app, inbox }) => {
  const { bob } = app.users;
  await open(page, `${app.baseURL}/`);
  const status = page.getByRole('status');

  await page.getByRole('textbox', { name: 'Account email' }).fill(bob.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(status).toHaveText(RESET_ACCEPTED.message);
  expect(await trackedEvents(page)).toEqual([]);

  const [mail] = await inbox.waitFor(bob.email);
  const link = resetLinkFrom(mail, app);

  await open(page, link.href);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  const newPassword = 'Bob-new-secret-2026';
  await page.getByRole('textbox', { name: 'New password' }).fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(status).toHaveText('Your password has been reset. Sign in with your new password.');
  expect(await trackedEvents(page)).toEqual([]);

  // The same link cannot be used twice; the form reports the server's error.
  await page.getByRole('textbox', { name: 'New password' }).fill('Bob-other-secret-2026');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(status).toHaveText('invalid_or_expired_token');

  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page).toHaveURL(`${app.baseURL}/`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await signIn(page, bob);
  await expect(status).toHaveText('invalid_credentials');
  await signIn(page, bob, newPassword);
  await expect(status).toHaveText('Signed in.');
  await expect(page.getByText(`Signed in as ${bob.email}`)).toBeVisible();
  expect(await trackedEvents(page)).toEqual([{ event: 'login', method: 'password' }]);
});
