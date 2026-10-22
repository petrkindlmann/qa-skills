import { test, expect, deliverPayment, paymentEvent, expectError } from './helpers.mjs';

function shop(page) {
  return {
    status: page.getByRole('status'),
    email: page.getByLabel('Email', { exact: true }),
    password: page.getByLabel('Password', { exact: true }),
    signIn: page.getByRole('button', { name: 'Sign in' }),
    signOut: page.getByRole('button', { name: 'Sign out' }),
    tea: page.getByLabel('Mountain tea 50 g quantity'),
    cup: page.getByLabel('Tea cup quantity'),
    placeOrder: page.getByRole('button', { name: 'Place order' }),
    refreshOrders: page.getByRole('button', { name: 'Refresh orders' }),
    order: id => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${id}` }) }),
  };
}

const dataLayer = page => page.evaluate(() => structuredClone(window.dataLayer));

test('shopper signs in, checks out, sees the paid state after reload and signs out', async ({ page, app, clients }) => {
  const alice = app.users.alice;
  const ui = shop(page);
  await page.goto(`${app.baseURL}/`);

  await test.step('a rejected sign-in shows the server error and pushes no login event', async () => {
    await ui.email.fill(alice.email);
    await ui.password.fill('not-alice-password');
    await ui.signIn.click();
    await expect(ui.status).toHaveText(/invalid_credentials/);
    await expect(ui.signOut).toHaveCount(0);
    expect((await dataLayer(page)).filter(e => e.event === 'login')).toEqual([]);
  });

  await test.step('sign in', async () => {
    await ui.password.fill(alice.password);
    await ui.signIn.click();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveText(['No orders yet.']);
    expect((await dataLayer(page)).filter(e => e.event === 'login')).toEqual([{ event: 'login', method: 'password' }]);
  });

  let orderId;
  await test.step('place an order for 2 tea and 1 cup', async () => {
    await ui.tea.fill('2');
    await ui.cup.fill('1');
    await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();
    const created = page.waitForResponse(r => r.url().endsWith('/api/orders') && r.request().method() === 'POST');
    await ui.placeOrder.click();
    const response = await created;
    expect(response.status()).toBe(201);
    orderId = (await response.json()).order.id;
    await expect(ui.status).toHaveText(`Order created: ${orderId}. Amount: EUR 42.00`);
    await expect(ui.order(orderId)).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

    const server = await page.request.get(`${app.baseURL}/api/orders/${orderId}`);
    expect((await server.json()).order).toMatchObject({ amount: 4200, status: 'pending', user_id: 'alice' });

    const purchases = (await dataLayer(page)).filter(e => e.event === 'purchase');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].ecommerce).toMatchObject({ transaction_id: orderId, value: 42, currency: 'EUR' });
    expect([...purchases[0].ecommerce.items].sort((a, b) => a.item_id.localeCompare(b.item_id)))
      .toEqual([{ item_id: 'CUP-01', quantity: 1 }, { item_id: 'TEA-50', quantity: 2 }]);
  });

  await test.step('the signed payment event marks the order paid in the page', async () => {
    const api = await clients();
    const delivered = await deliverPayment(api, app, paymentEvent(`evt-ui-${orderId}`, orderId, 4200));
    expect(delivered.status()).toBe(200);
    await ui.refreshOrders.click();
    await expect(ui.order(orderId)).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');
  });

  await test.step('reload restores the user and their orders', async () => {
    await page.reload();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    await expect(ui.order(orderId)).toContainText('Status: paid · Fulfillments: 1');
  });

  await test.step('sign-out removes access, also for a copy of the old cookie', async () => {
    const before = await page.context().storageState();
    const eventsBefore = await dataLayer(page);
    await ui.signOut.click();
    await expect(ui.signIn).toBeVisible();
    await expect(ui.order(orderId)).toHaveCount(0);
    expect(await dataLayer(page), 'sign-out pushes no analytics event').toEqual(eventsBefore);
    await page.reload();
    await expect(ui.signIn).toBeVisible();
    await expect(ui.signOut).toHaveCount(0);
    await expectError(await page.request.get(`${app.baseURL}/api/me`), 401, 'unauthenticated');
    const replay = await clients({ storageState: before });
    await expectError(await replay.get('/api/orders'), 401, 'unauthenticated');
  });
});
