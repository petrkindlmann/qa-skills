import {
  test, expect, BASKET, byItem, deliverPayment, paymentEvent, resetLink, supportState,
} from './helpers.mjs';

async function openShop(page, url) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}

const analytics = (page, name) => page.evaluate(event => window.dataLayer.filter(e => e.event === event), name);

async function signIn(page, email, password) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('shopper signs in, checks out once, sees payment, survives reload and signs out', async ({ page, app, clients }) => {
  const { alice } = app.users;
  await openShop(page, app.baseURL + '/');
  const notice = page.getByRole('status');
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();

  await signIn(page, alice.email, 'wrong-password-1');
  await expect(notice).toHaveText('invalid_credentials');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();
  expect(await analytics(page, 'login')).toEqual([]);

  await signIn(page, alice.email, alice.password);
  await expect(notice).toHaveText('Signed in.');
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  expect(await analytics(page, 'login')).toEqual([{ event: 'login', method: 'password' }]);

  await page.getByLabel('Mountain tea 50 g quantity').fill('2');
  await page.getByLabel('Tea cup quantity').fill('1');
  await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();

  // Record how many purchase events existed when each order first appeared in the list.
  await page.evaluate(() => {
    window.__purchasesWhenListed = {};
    new MutationObserver(() => {
      for (const li of document.querySelectorAll('#orders li[data-order-id]')) {
        const id = li.dataset.orderId;
        if (!(id in window.__purchasesWhenListed)) {
          window.__purchasesWhenListed[id] = window.dataLayer
            .filter(e => e.event === 'purchase' && e.ecommerce?.transaction_id === id).length;
        }
      }
    }).observe(document.querySelector('#orders'), { childList: true });
  });

  // An impatient double click must still produce exactly one order.
  await page.getByRole('button', { name: 'Place order' }).dblclick();
  await expect(notice).toHaveText(/^Order created: \S+\. Amount: EUR 42\.00$/);
  const orderId = (await notice.textContent()).match(/^Order created: (\S+)\./)[1];

  const orderRow = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${orderId}` }) });
  await expect(orderRow).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

  const api = await clients();
  let state = await supportState(api, app);
  expect(state.orders).toHaveLength(1);
  expect(state.orders[0]).toMatchObject({ id: orderId, user_id: 'alice', amount: 4200, status: 'pending' });

  const purchases = await analytics(page, 'purchase');
  expect(purchases).toHaveLength(1);
  expect(purchases[0].ecommerce).toMatchObject({ transaction_id: orderId, value: 42, currency: 'EUR' });
  expect(byItem(purchases[0].ecommerce.items)).toEqual(byItem(BASKET).map(i => ({ item_id: i.sku, quantity: i.quantity })));
  expect(await page.evaluate(id => window.__purchasesWhenListed[id], orderId)).toBe(1);

  const payment = await deliverPayment(api, app, paymentEvent('evt-browser-1', state.orders[0]));
  expect(payment.status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh orders' }).click();
  await expect(orderRow).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  await expect(orderRow).toContainText('Status: paid · Fulfillments: 1');
  // A restored session is not a new sign-in and must not re-report revenue.
  expect(await analytics(page, 'login')).toEqual([]);
  expect(await analytics(page, 'purchase')).toEqual([]);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(notice).toHaveText('Signed out.');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  expect((await page.request.get(app.baseURL + '/api/me')).status()).toBe(401);
  expect((await page.request.get(app.baseURL + '/api/orders')).status()).toBe(401);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(orderRow).toHaveCount(0);

  state = await supportState(api, app);
  expect(state.orders).toHaveLength(1);
  expect(state.orders[0]).toMatchObject({ status: 'paid', fulfillment_count: 1 });
});

test('password reset from the real inbox replaces the password and ends old sessions', async ({ page, app, clients, inbox }) => {
  const { alice } = app.users;
  const newPassword = 'Fresh-browser-pass-2026';
  const oldSession = await clients(alice);

  await openShop(page, app.baseURL + '/');
  await page.getByLabel('Account email').fill(alice.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toHaveText('If this account exists, a reset email has been sent.');

  const [message] = await inbox.waitForMessages(alice.email);
  expect(message.Subject).toBe('Reset your Shop password');
  expect(message.To.map(to => to.Address)).toEqual([alice.email]);
  const link = resetLink(message);
  expect(link.origin).toBe(app.baseURL);
  expect(link.pathname).toBe('/reset-password');
  const token = link.searchParams.get('token');
  expect(token).toBeTruthy();
  expect(message.HTML).toContain(`href="${link.href}"`);

  await openShop(page, link.href);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('status')).toHaveText('Your password has been reset. Sign in with your new password.');

  expect((await oldSession.get('/api/me')).status()).toBe(401);
  const anonymous = await clients();
  expect((await anonymous.post('/api/login', { data: { email: alice.email, password: alice.password } })).status()).toBe(401);

  // The same link cannot be used twice; the form surfaces the server's error.
  await openShop(page, link.href);
  await page.getByLabel('New password').fill('Another-password-99');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('status')).toHaveText('invalid_or_expired_token');

  await openShop(page, app.baseURL + '/');
  await signIn(page, alice.email, newPassword);
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();

  const state = await supportState(anonymous, app);
  expect(state.reset_tokens.filter(t => t.user_id === 'alice')).toEqual([expect.objectContaining({ consumed: expect.anything() })]);
  expect(JSON.stringify(state)).not.toContain(token);
  expect(state.smtp_errors).toBe(0);
});
