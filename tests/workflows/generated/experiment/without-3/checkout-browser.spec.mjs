import { test, expect, BASKET_AMOUNT, paymentEvent } from './helpers.mjs';

async function openShop(page, app) {
  await page.goto(`${app.baseURL}/`);
  const catalog = await (await page.request.get(`${app.baseURL}/api/catalog`)).json();
  const name = sku => catalog.products.find(product => product.sku === sku).name;
  const quantity = sku => page.getByRole('spinbutton', { name: `${name(sku)} quantity`, exact: true });
  await expect(quantity('TEA-50')).toBeVisible();
  return { quantity };
}

async function signIn(page, user, password = user.password) {
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const dataLayer = (page, event) => page.evaluate(name => window.dataLayer.filter(entry => entry.event === name), event);

const orderRow = (page, id) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${id}` }) });

test('shopper checks out in the browser, sees the payment land, keeps it across reload and loses access on sign-out', async ({ app, shop, page }) => {
  const alice = app.users.alice;
  const notice = page.getByRole('status');
  const { quantity } = await openShop(page, app);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();

  await signIn(page, alice);
  await expect(notice).toHaveText('Signed in.');
  await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
  const session = (await page.context().cookies(app.baseURL)).find(cookie => cookie.name === 'shop_session');
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: false });

  await quantity('TEA-50').fill('2');
  await quantity('CUP-01').fill('1');
  await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(notice).toHaveText(/^Order created: [\w-]+\. Amount: EUR 42\.00$/);
  const orderId = (await notice.textContent()).match(/^Order created: ([\w-]+)\./)[1];
  await expect(orderRow(page, orderId)).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

  await test.step('server holds the same order the page shows', async () => {
    const order = (await (await page.request.get(`${app.baseURL}/api/orders/${orderId}`)).json()).order;
    expect(order).toMatchObject({ id: orderId, user_id: 'alice', amount: BASKET_AMOUNT, currency: 'EUR', status: 'pending', fulfillment_count: 0 });
    expect((await shop.state()).orders.map(o => o.id)).toEqual([orderId]);
  });

  await test.step('analytics: one login and one purchase matching the server order', async () => {
    expect(await dataLayer(page, 'login')).toEqual([{ event: 'login', method: 'password' }]);
    const purchases = await dataLayer(page, 'purchase');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].ecommerce).toMatchObject({ transaction_id: orderId, value: 42, currency: 'EUR' });
    expect(purchases[0].ecommerce.items).toHaveLength(2);
    expect(purchases[0].ecommerce.items).toEqual(expect.arrayContaining([
      { item_id: 'TEA-50', quantity: 2 }, { item_id: 'CUP-01', quantity: 1 },
    ]));
  });

  await test.step('signed payment event moves the order to paid in the page', async () => {
    const response = await shop.pay(paymentEvent(`evt-browser-${app.namespace}`, orderId));
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false, order_id: orderId });
    await page.getByRole('button', { name: 'Refresh orders' }).click();
    await expect(orderRow(page, orderId)).toContainText('Status: paid · Fulfillments: 1');
  });

  await test.step('reload restores the user and orders without re-sending analytics', async () => {
    await page.reload();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    await expect(orderRow(page, orderId)).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');
    expect(await dataLayer(page, 'purchase')).toEqual([]);
    expect(await dataLayer(page, 'login')).toEqual([]);
  });

  await test.step('sign-out removes access in the page and on the server', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(notice).toHaveText('Signed out.');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
    expect((await page.request.get(`${app.baseURL}/api/me`)).status()).toBe(401);

    const replay = await shop.client();
    const stale = await replay.get('/api/orders', { headers: { Cookie: `shop_session=${session.value}` } });
    expect(stale.status(), 'old session cookie replayed after logout').toBe(401);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(`Order ${orderId}`)).toHaveCount(0);
  });
});

test('rejected sign-in and rejected order are reported in the page with no analytics or stored order', async ({ app, shop, page }) => {
  const alice = app.users.alice;
  const notice = page.getByRole('status');
  const { quantity } = await openShop(page, app);

  await signIn(page, alice, 'Not-the-password-1!');
  await expect(notice).toHaveText('invalid_credentials');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect((await page.context().cookies(app.baseURL)).filter(cookie => cookie.name === 'shop_session')).toEqual([]);
  expect(await dataLayer(page, 'login')).toEqual([]);

  await signIn(page, alice);
  await expect(notice).toHaveText('Signed in.');
  await expect(page.getByText('No orders yet.')).toBeVisible();

  await quantity('TEA-50').fill('0');
  await quantity('CUP-01').fill('0');
  await expect(page.getByText('Cart total: EUR 0.00')).toBeVisible();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(notice).toHaveText('invalid_order');
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
  expect(await dataLayer(page, 'purchase')).toEqual([]);
  expect((await shop.state()).orders).toEqual([]);

  await test.step('the shopper can recover and order after the rejection', async () => {
    await quantity('CUP-01').fill('1');
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(notice).toHaveText(/^Order created: [\w-]+\. Amount: EUR 18\.00$/);
    const purchases = await dataLayer(page, 'purchase');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].ecommerce).toMatchObject({ value: 18, currency: 'EUR', items: [{ item_id: 'CUP-01', quantity: 1 }] });
    const { orders } = await shop.state();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ id: purchases[0].ecommerce.transaction_id, amount: 1800, status: 'pending' });
  });
});
