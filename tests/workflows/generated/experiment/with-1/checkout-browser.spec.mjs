import { test, expect, deliverPayment, paymentEvent } from './helpers.mjs';

const analytics = page => page.evaluate(() => structuredClone(window.dataLayer ?? []));

test('a shopper signs in, checks out in the browser and sees payment confirmed after the signed event', async ({ app, clients, page }) => {
  const { alice } = app.users;
  const ordersList = page.getByRole('list').filter({ has: page.getByRole('heading', { level: 3 }) });
  const expectOnlyOrder = async (id, summary) => {
    const rows = ordersList.getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.getByRole('heading', { name: `Order ${id}` })).toBeVisible();
    await expect(rows).toContainText(summary);
  };

  await page.goto(`${app.baseURL}/`);

  await test.step('a rejected sign-in shows the server error and grants nothing', async () => {
    await page.getByLabel('Email', { exact: true }).fill(alice.email);
    await page.getByLabel('Password', { exact: true }).fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('status')).toHaveText('invalid_credentials');
    await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    expect((await page.request.get(`${app.baseURL}/api/me`)).status()).toBe(401);
    expect((await analytics(page)).filter(event => event.event === 'login')).toEqual([]);
  });

  await test.step('valid credentials sign the shopper in', async () => {
    await page.getByLabel('Password', { exact: true }).fill(alice.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveText(['No orders yet.']);
  });

  let orderId;
  await test.step('the cart total and the created order come from the server', async () => {
    await page.getByRole('spinbutton', { name: 'Mountain tea 50 g quantity' }).fill('2');
    await page.getByRole('spinbutton', { name: 'Tea cup quantity' }).fill('1');
    await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();

    const created = page.waitForResponse(response =>
      response.url().endsWith('/api/orders') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Place order' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    expect(order).toEqual(expect.objectContaining({ amount: 4200, currency: 'EUR', status: 'pending' }));
    orderId = order.id;

    await expect(page.getByRole('status')).toHaveText(`Order created: ${orderId}. Amount: EUR 42.00`);
    await expectOnlyOrder(orderId, 'EUR 42.00 · Status: pending · Fulfillments: 0');
  });

  await test.step('analytics record one login and one purchase for this order', async () => {
    const events = await analytics(page);
    expect(events.filter(event => event.event === 'login')).toEqual([{ event: 'login', method: 'password' }]);
    const purchases = events.filter(event => event.event === 'purchase');
    expect(purchases).toHaveLength(1);
    const { items, ...rest } = purchases[0].ecommerce;
    expect(rest).toEqual({ transaction_id: orderId, value: 42, currency: 'EUR' });
    expect([...items].sort((a, b) => a.item_id.localeCompare(b.item_id))).toEqual([
      { item_id: 'CUP-01', quantity: 1 }, { item_id: 'TEA-50', quantity: 2 },
    ]);
  });

  await test.step('the browser does not claim payment until the signed event arrives', async () => {
    await page.reload();
    await expectOnlyOrder(orderId, 'EUR 42.00 · Status: pending · Fulfillments: 0');
    const webhook = await clients.open();
    const response = await deliverPayment(webhook, app, paymentEvent(orderId, 4200));
    expect(response.status()).toBe(200);
  });

  await test.step('reloading restores the signed-in user and shows the paid order', async () => {
    await page.reload();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    await expectOnlyOrder(orderId, 'EUR 42.00 · Status: paid · Fulfillments: 1');
  });

  await test.step('sign-out removes access in the page and on the server', async () => {
    const [session] = (await page.context().cookies(app.baseURL)).filter(cookie => cookie.name === 'shop_session');
    expect(session, 'browser holds a shop_session cookie').toBeDefined();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('status')).toHaveText('Signed out.');
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();

    const replay = await clients.open({ extraHTTPHeaders: { Cookie: `shop_session=${session.value}` } });
    expect((await replay.get('/api/me')).status()).toBe(401);
    expect((await replay.get(`/api/orders/${orderId}`)).status()).toBe(401);
  });
});
