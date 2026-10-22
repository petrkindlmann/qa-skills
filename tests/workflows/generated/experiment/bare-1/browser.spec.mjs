import { test, expect, deliverPayment, paymentEvent, resetLinkFrom, signIn } from './helpers.mjs';

const dataLayer = page => page.evaluate(() => window.dataLayer);
const byItemId = items => [...items].sort((a, b) => a.item_id.localeCompare(b.item_id));

test('shopper signs in, checks out, sees the payment land, survives reload and signs out', async ({ page, app, client, admin }) => {
  const alice = app.users.alice;
  const status = page.getByRole('status');
  await page.goto(app.baseURL);

  await page.getByLabel('Email', { exact: true }).fill(alice.email);
  await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(status).toHaveText('invalid_credentials');
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  expect(await dataLayer(page), 'rejected sign-in pushes no analytics').toEqual([]);

  await page.getByLabel('Password', { exact: true }).fill(alice.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(status).toHaveText('Signed in.');
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  await expect(page.getByText('No orders yet.')).toBeVisible();
  expect(await dataLayer(page)).toEqual([{ event: 'login', method: 'password' }]);

  await page.getByLabel('Mountain tea 50 g quantity').fill('2');
  await page.getByLabel('Tea cup quantity').fill('1');
  await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();

  const created = page.waitForResponse(r => r.url().endsWith('/api/orders') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Place order' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { order } = await response.json();
  expect(order).toMatchObject({ user_id: 'alice', currency: 'EUR', amount: 4200, status: 'pending', fulfillment_count: 0 });
  await expect(status).toHaveText(`Order created: ${order.id}. Amount: EUR 42.00`);

  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${order.id}` }) });
  await expect(row).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

  const purchases = (await dataLayer(page)).filter(event => event.event === 'purchase');
  expect(purchases).toHaveLength(1);
  expect(purchases[0].ecommerce).toMatchObject({ transaction_id: order.id, value: 42, currency: 'EUR' });
  expect(byItemId(purchases[0].ecommerce.items)).toEqual([
    { item_id: 'CUP-01', quantity: 1 },
    { item_id: 'TEA-50', quantity: 2 },
  ]);

  const psp = await client();
  const paid = await deliverPayment(psp, app, paymentEvent(`evt-${order.id}`, order.id, 4200));
  expect(paid.status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh orders' }).click();
  await expect(row).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');

  await page.reload();
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  await expect(row).toContainText('Status: paid · Fulfillments: 1');
  expect((await dataLayer(page)).filter(event => event.event === 'purchase'), 'reload creates no purchase event').toEqual([]);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(status).toHaveText('Signed out.');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
  expect((await page.request.get(`${app.baseURL}/api/me`)).status()).toBe(401);
  expect((await admin.state()).sessions.alice ?? 0).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
});

test('password reset through a real Mailpit message revokes old sessions and credentials', async ({ page, app, client, inbox }) => {
  const alice = app.users.alice;
  const stranger = `nobody+${app.namespace}@example.test`;
  const newPassword = 'Fresh-tea-password-789!';
  const status = page.getByRole('status');
  const generic = 'If this account exists, a reset email has been sent.';
  const existingSession = await client(alice);

  await page.goto(app.baseURL);
  await page.getByLabel('Account email').fill(stranger);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(status).toHaveText(generic);
  await page.getByLabel('Account email').fill(alice.email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(status).toHaveText(generic);

  const message = await inbox.onlyMessageTo(alice.email);
  expect(message.Subject).toBe('Reset your Shop password');
  expect(message.To.map(to => to.Address)).toEqual([alice.email]);
  const link = resetLinkFrom(message, app.baseURL);
  expect(message.HTML).toContain(`href="${link}"`);
  expect(await inbox.search(stranger), 'unknown account receives no mail').toEqual([]);

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('New password').fill(newPassword);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(status).toHaveText('Your password has been reset. Sign in with your new password.');

  expect((await existingSession.get('/api/me')).status(), 'pre-reset session is invalidated').toBe(401);
  const fresh = await client();
  expect((await signIn(fresh, alice)).status()).toBe(401);
  expect((await signIn(fresh, { email: alice.email, password: newPassword })).status()).toBe(200);

  await page.reload();
  await page.getByLabel('New password').fill('Another-password-000!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(status).toHaveText('invalid_or_expired_token');
  expect(await dataLayer(page), 'password reset pushes no analytics').toEqual([]);
});
