import { test, expect } from '../../../support/fixtures.mjs';
import { oracle } from '../../../support/oracle.mjs';
import { readDataLayerTrace } from './helpers/datalayer.mjs';
import { validateEvent } from './helpers/validate.mjs';
import {
  openShop, signInAndSettle, status, catalog, setCart, placeOrder,
  expectedPurchase, money, major, ordersFromApi, signOutQuietly,
} from './helpers/shop.mjs';
import { plan } from './helpers/plan.mjs';

test.afterEach(async ({ page, app }) => { await signOutQuietly(page, app); });

test('purchase carries the created order: transaction_id, major-unit value, currency and items match the API', async ({ page, app }) => {
  await openShop(page, app);
  const products = await catalog(page, app);
  await signInAndSettle(page, app.users.alice);
  const checkpoint = (await readDataLayerTrace(page)).entries.length;

  await setCart(page, products, { 'TEA-50': 2, 'CUP-01': 1 });
  await expect(page.locator('#cart-total')).toHaveText('Cart total: EUR 42.00');
  const response = await placeOrder(page);
  expect(response.status()).toBe(201);
  const { order, replayed } = await response.json();
  expect(replayed).toBe(false);
  await expect(status(page)).toHaveText(`Order created: ${order.id}. Amount: ${money(order.amount)}`);

  const trace = await readDataLayerTrace(page);
  expect(trace.errors).toEqual([]);
  expect(trace.replacements).toBe(0);
  const fresh = trace.entries.slice(checkpoint);
  expect(fresh, 'exactly one input after the order').toHaveLength(1);
  const [pushed] = fresh;
  expect(pushed.event).toBe('purchase');
  expect(validateEvent(plan, 'purchase', pushed.ecommerce), 'tracking-plan schema').toEqual([]);

  // Independent view of the same order through the public API, not the page's response.
  const fetched = await page.request.get(`${app.baseURL}/api/orders/${order.id}`);
  expect(fetched.status()).toBe(200);
  const apiOrder = (await fetched.json()).order;
  expect(apiOrder).toMatchObject({ id: order.id, amount: 4200, currency: 'EUR', status: 'pending' });
  await oracle('c3-analytics-currency', 'toEqual', () =>
    expect(pushed, 'push equals the order the API created').toEqual(expectedPurchase(apiOrder)));

  // Scenario values, stated from the contract rather than derived from the API.
  expect(pushed.ecommerce.transaction_id).toBe(order.id);
  expect(pushed.ecommerce.value, 'value is 4200 minor units expressed in major units').toBe(42);
  expect(pushed.ecommerce.currency).toBe(plan.purchase.expected.currency);
  expect(pushed.ecommerce.items).toHaveLength(2);
  expect(pushed.ecommerce.items).toEqual(expect.arrayContaining([
    { item_id: 'TEA-50', quantity: 2 },
    { item_id: 'CUP-01', quantity: 1 },
  ]));
  for (const item of pushed.ecommerce.items) expect(Object.keys(item).sort()).toEqual(['item_id', 'quantity']);
  expect(Object.keys(pushed.ecommerce).sort()).toEqual(['currency', 'items', 'transaction_id', 'value']);

  // The page shows the same order.
  const row = page.locator(`#orders li[data-order-id="${order.id}"]`);
  await expect(row).toContainText(`Order ${order.id}`);
  await expect(row).toContainText(money(apiOrder.amount));
});

test('two orders push two purchase inputs, one per created order, with distinct transaction ids', async ({ page, app }) => {
  await openShop(page, app);
  const products = await catalog(page, app);
  await signInAndSettle(page, app.users.alice);
  const checkpoint = (await readDataLayerTrace(page)).entries.length;

  const created = [];
  for (const cart of [{ 'TEA-50': 1 }, { 'CUP-01': 3 }]) {
    await setCart(page, products, cart);
    const response = await placeOrder(page);
    expect(response.status()).toBe(201);
    const { order } = await response.json();
    created.push(order);
    await expect(status(page)).toHaveText(`Order created: ${order.id}. Amount: ${money(order.amount)}`);
  }
  expect(created.map(order => order.amount)).toEqual([1200, 5400]);
  expect(new Set(created.map(order => order.id)).size).toBe(2);

  const trace = await readDataLayerTrace(page);
  expect(trace.errors).toEqual([]);
  const purchases = trace.entries.slice(checkpoint);
  expect(purchases.map(entry => entry.event)).toEqual(['purchase', 'purchase']);
  expect(purchases).toEqual(created.map(expectedPurchase));
  expect(await page.evaluate(() => window.dataLayer.map(entry => entry.event)), 'raw layer: login then both purchases, nothing cleared').toEqual(['login', 'purchase', 'purchase']);

  const apiOrders = await ordersFromApi(page, app);
  expect(apiOrders, 'the API created exactly two orders').toHaveLength(2);
  for (const order of apiOrders) {
    const matching = trace.entries.filter(entry => entry.event === 'purchase' && entry.ecommerce?.transaction_id === order.id);
    expect(matching, `exactly one purchase for ${order.id}`).toHaveLength(1);
    expect(validateEvent(plan, 'purchase', matching[0].ecommerce)).toEqual([]);
    expect(matching[0]).toEqual(expectedPurchase(order));
    expect(matching[0].ecommerce.value).toBe(major(order.amount));
  }
});

test('a double-click on Place order creates one order and pushes purchase once', async ({ page, app }) => {
  await openShop(page, app);
  await signInAndSettle(page, app.users.alice);
  const checkpoint = (await readDataLayerTrace(page)).entries.length;
  await expect(page.locator('#cart-total')).toHaveText('Cart total: EUR 12.00'); // default cart: TEA-50 x1

  const response = await placeOrder(page, { clicks: 2 });
  expect(response.status()).toBe(201);
  const { order } = await response.json();
  await expect(status(page)).toHaveText(`Order created: ${order.id}. Amount: ${money(order.amount)}`);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();

  const apiOrders = await ordersFromApi(page, app);
  expect(apiOrders.map(item => item.id), 'one order for one double-click').toEqual([order.id]);

  const trace = await readDataLayerTrace(page);
  expect(trace.errors).toEqual([]);
  const purchases = trace.entries.slice(checkpoint);
  expect(purchases, 'one purchase for one order').toEqual([expectedPurchase(apiOrders[0])]);
  expect(await page.evaluate(() => window.dataLayer.filter(entry => entry.event === 'purchase').length)).toBe(1);
});

test('a rejected order pushes no purchase; the next accepted order pushes exactly one', async ({ page, app }) => {
  await openShop(page, app);
  const products = await catalog(page, app);
  await signInAndSettle(page, app.users.alice);
  const checkpoint = (await readDataLayerTrace(page)).entries.length;

  await setCart(page, products, {});
  await expect(page.locator('#cart-total')).toHaveText('Cart total: EUR 0.00');
  const rejected = await placeOrder(page);
  expect(rejected.status()).toBe(400);
  expect(await rejected.json()).toEqual({ error: 'invalid_order' });
  await expect(status(page)).toHaveText('invalid_order');
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();

  expect(await ordersFromApi(page, app), 'no order was created').toEqual([]);
  const afterReject = await readDataLayerTrace(page);
  expect(afterReject.errors).toEqual([]);
  expect(afterReject.entries.slice(checkpoint), 'rejected order pushes nothing').toEqual([]);

  // Control: the same page still reports a healthy purchase.
  await setCart(page, products, { 'TEA-50': 1 });
  const accepted = await placeOrder(page);
  expect(accepted.status()).toBe(201);
  const { order } = await accepted.json();
  await expect(status(page)).toHaveText(`Order created: ${order.id}. Amount: ${money(order.amount)}`);
  const trace = await readDataLayerTrace(page);
  const purchases = trace.entries.slice(checkpoint);
  expect(purchases).toEqual([expectedPurchase(order)]);
  expect(purchases[0].ecommerce.value).toBe(12);
  expect(await ordersFromApi(page, app)).toHaveLength(1);
});

test('ordering: login after the account UI shows and before orders load; purchase after the order response and before the list refreshes', async ({ page, app }) => {
  await openShop(page, app);
  const products = await catalog(page, app);
  await signInAndSettle(page, app.users.alice);

  const afterLogin = await readDataLayerTrace(page);
  expect(afterLogin.entries.map(entry => entry.event)).toEqual(['login']);
  const loginContext = afterLogin.context[0];
  expect(loginContext, 'at the login push the account UI is already shown').toMatchObject({ accountVisible: true, loginVisible: false });
  expect(loginContext.orderRows, 'at the login push the orders list has not loaded yet').toBe(0);
  expect(loginContext.notice).not.toBe('Signed in.');
  await expect(page.locator('#orders li'), 'after completion the list has loaded').toHaveCount(1);

  await setCart(page, products, { 'TEA-50': 1, 'CUP-01': 1 });
  const response = await placeOrder(page);
  expect(response.status()).toBe(201);
  const { order } = await response.json();
  await expect(status(page)).toHaveText(`Order created: ${order.id}. Amount: ${money(order.amount)}`);
  await expect(page.locator(`#orders li[data-order-id="${order.id}"]`)).toHaveCount(1);

  const trace = await readDataLayerTrace(page);
  expect(trace.errors).toEqual([]);
  expect(trace.entries.map(entry => entry.event)).toEqual(['login', 'purchase']);
  expect(trace.context[1].at, 'purchase was recorded after login').toBeGreaterThan(trace.context[0].at);
  const purchaseContext = trace.context[1];
  // After the response: the push carries the server-assigned id, which did not exist before the response.
  expect(trace.entries[1].ecommerce.transaction_id).toBe(order.id);
  // Before the list refresh: the new order was not in the list and the handler was still running.
  expect(purchaseContext.orderIds, 'order not yet listed at push time').not.toContain(order.id);
  expect(purchaseContext.orderRows, 'list still shows the pre-order state at push time').toBe(1);
  expect(purchaseContext.checkoutDisabled, 'checkout handler still running at push time').toBe(true);
  expect(purchaseContext.notice).toBe('Signed in.');
  await expect(page.getByRole('button', { name: 'Place order' })).toBeEnabled();
});
