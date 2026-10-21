// The storefront page against a virtualized /api: responses the healthy Shop rarely or never
// produces, every stub derived from a cassette in recordings/ (see virtual-api.mjs). Each test
// starts a real Shop; only the routes listed in `passthrough` may reach it, everything else
// under /api/ is aborted and logged by the guard.
import { test, expect } from '../../../../../support/fixtures.mjs';
import { virtualize, scenarios } from './virtual-api.mjs';
import { loadRecording } from './cassette.mjs';

const REAL_READS = ['GET /api/catalog', 'GET /api/me'];
const REAL_SESSION = [...REAL_READS, 'POST /api/login', 'GET /api/orders'];

async function openShop(page, app) {
  await page.goto(app.baseURL + '/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}

async function signIn(page, user) {
  const form = page.locator('#login-form');
  await form.getByLabel('Email').fill(user.email);
  await form.getByLabel('Password').fill(user.password);
  await form.getByRole('button', { name: 'Sign in' }).click();
}

const notice = page => page.getByRole('status');
const orderRows = page => page.locator('#orders li[data-order-id]');
const events = (page, name) => page.evaluate(n => window.dataLayer.filter(e => e.event === n), name);

// Unrouted: page.request shares the browser's cookie jar but bypasses page.route.
async function liveOrders(page, app) {
  const response = await page.request.get(app.baseURL + '/api/orders');
  expect(response.status()).toBe(200);
  return (await response.json()).orders;
}

test('500 on order creation: error shown, no purchase event, retry reuses the key and creates exactly one order', async ({ page, app }) => {
  const api = await virtualize(page, { passthrough: [...REAL_SESSION, 'POST /api/orders'] });
  const failed = await api.stub('POST /api/orders', scenarios.orderCreateServerError(), { once: true });
  const sentKeys = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/orders') sentKeys.push(request.headers()['idempotency-key']);
  });

  await openShop(page, app);
  await signIn(page, app.users.alice);
  await expect(notice(page)).toHaveText('Signed in.');

  const placeOrder = page.getByRole('button', { name: 'Place order' });
  await placeOrder.click();
  await expect(notice(page)).toHaveText('internal_error');
  expect(failed).toHaveLength(1);
  await expect(placeOrder).toBeEnabled();
  await expect(orderRows(page)).toHaveCount(0);
  expect(await events(page, 'purchase')).toEqual([]);
  expect(await liveOrders(page, app)).toEqual([]);

  await placeOrder.click();
  await expect(notice(page)).toHaveText(/^Order created: \S+\. Amount: EUR 12\.00$/);
  await expect(orderRows(page)).toHaveCount(1);
  expect(sentKeys).toHaveLength(2);
  expect(sentKeys[1]).toBe(sentKeys[0]);
  expect(failed[0].headers['idempotency-key']).toBe(sentKeys[0]);
  const live = await liveOrders(page, app);
  expect(live).toHaveLength(1);
  expect(live[0].amount).toBe(1200);
  expect(await events(page, 'purchase')).toHaveLength(1);
  expect(api.log.unhandled).toEqual([]);
});

test('429 on login: too_many_attempts shown, sign-in form kept, no login event; the real sign-in works once the stub steps aside', async ({ page, app }) => {
  const api = await virtualize(page, { passthrough: REAL_SESSION });
  const throttled = await api.stub('POST /api/login', scenarios.loginThrottled(), { once: true });
  expect(scenarios.loginThrottled().headers['retry-after']).toBe('60');

  await openShop(page, app);
  await signIn(page, app.users.alice);
  await expect(notice(page)).toHaveText('too_many_attempts');
  expect(throttled).toHaveLength(1);
  await expect(page.locator('#login-section')).toBeVisible();
  await expect(page.locator('#account-section')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  expect(await events(page, 'login')).toEqual([]);
  expect((await page.request.get(app.baseURL + '/api/me')).status()).toBe(401);

  await page.locator('#login-form').getByRole('button', { name: 'Sign in' }).click();
  await expect(notice(page)).toHaveText('Signed in.');
  await expect(page.locator('#account-section')).toBeVisible();
  expect(await events(page, 'login')).toHaveLength(1);
  expect(api.log.passed.filter(r => r.path === '/api/login')).toHaveLength(1);
  expect(api.log.unhandled).toEqual([]);
});

test('slow /api/orders: sign-in does not claim completion before the list arrives; overlapping refreshes never duplicate rows', async ({ page, app }) => {
  const api = await virtualize(page, { passthrough: [...REAL_SESSION, 'POST /api/orders'] });
  const first = await api.hold('GET /api/orders');

  await openShop(page, app);
  await signIn(page, app.users.alice);
  await expect.poll(() => first.held.length).toBe(1);
  await expect(page.locator('#account-section')).toBeVisible();
  await expect(notice(page)).not.toHaveText('Signed in.');
  await expect(page.locator('#orders li')).toHaveCount(0);

  first.release();
  await expect(notice(page)).toHaveText('Signed in.');
  await expect(page.locator('#orders li')).toHaveText(['No orders yet.']);

  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(orderRows(page)).toHaveCount(1);

  const second = await api.hold('GET /api/orders');
  const refresh = page.getByRole('button', { name: 'Refresh orders' });
  await refresh.click();
  await refresh.click();
  await expect.poll(() => second.held.length).toBe(2);
  await expect(orderRows(page)).toHaveCount(1);

  second.release();
  await expect.poll(() => api.log.passed.filter(r => r.method === 'GET' && r.path === '/api/orders').length).toBe(4);
  await expect(page.locator('#orders li')).toHaveCount(1);
  await expect(orderRows(page)).toHaveCount(1);
  expect(api.log.unhandled).toEqual([]);
});

test('malformed JSON on a 200 login response is reported as an error, never as a sign-in', async ({ page, app }) => {
  const api = await virtualize(page, { passthrough: REAL_SESSION });
  const malformed = await api.stub('POST /api/login', scenarios.loginMalformed(), { once: true });

  await openShop(page, app);
  await signIn(page, app.users.alice);
  await expect(notice(page)).toContainText('JSON');
  expect(malformed).toHaveLength(1);
  await expect(page.locator('#login-section')).toBeVisible();
  await expect(page.locator('#account-section')).toBeHidden();
  expect(await events(page, 'login')).toEqual([]);

  await page.locator('#login-form').getByRole('button', { name: 'Sign in' }).click();
  await expect(notice(page)).toHaveText('Signed in.');
  expect(await events(page, 'login')).toHaveLength(1);
  expect(api.log.unhandled).toEqual([]);
});

test('empty catalogue: no products, zero total, and an order attempt is a visible error, never a silent success', async ({ page, app }) => {
  const api = await virtualize(page, { passthrough: ['GET /api/me', 'POST /api/login', 'GET /api/orders', 'POST /api/orders'] });
  const catalogue = await api.stub('GET /api/catalog', scenarios.emptyCatalogue());

  await openShop(page, app);
  expect(catalogue).toHaveLength(1);
  await expect(page.locator('#products .product')).toHaveCount(0);
  await expect(page.locator('#cart-total')).toHaveText('Cart total: EUR 0.00');
  await expect(notice(page)).toHaveText('');
  const placeOrder = page.getByRole('button', { name: 'Place order' });
  await expect(placeOrder).toBeDisabled();

  await signIn(page, app.users.alice);
  await expect(notice(page)).toHaveText('Signed in.');
  // Either the page refuses the order (button stays disabled) or the attempt ends in a visible
  // error. Today the button is enabled and the real Shop rejects the empty items list.
  const enabled = await placeOrder.isEnabled();
  test.info().annotations.push({ type: 'observation', description: enabled
    ? 'Place order is enabled with an empty catalogue; the real Shop answered 400 invalid_order'
    : 'Place order stays disabled with an empty catalogue' });
  if (enabled) {
    await placeOrder.click();
    await expect(notice(page)).toHaveText('invalid_order');
    expect(api.log.passed.filter(r => r.method === 'POST' && r.path === '/api/orders')).toHaveLength(1);
  }
  expect(await liveOrders(page, app)).toEqual([]);
  expect(await events(page, 'purchase')).toEqual([]);
  expect(api.log.unhandled).toEqual([]);
});

test('500 on the orders list right after sign-in is shown; Refresh orders recovers', async ({ page, app }) => {
  const api = await virtualize(page, { passthrough: REAL_SESSION });
  const failed = await api.stub('GET /api/orders', scenarios.ordersListServerError(), { once: true });

  await openShop(page, app);
  await signIn(page, app.users.alice);
  await expect(notice(page)).toHaveText('internal_error');
  expect(failed).toHaveLength(1);
  await expect(page.locator('#account-section')).toBeVisible();
  await expect(page.locator('#orders li')).toHaveCount(0);
  expect((await page.request.get(app.baseURL + '/api/me')).status()).toBe(200);

  await page.getByRole('button', { name: 'Refresh orders' }).click();
  await expect(page.locator('#orders li')).toHaveText(['No orders yet.']);
  expect(api.log.passed.filter(r => r.path === '/api/orders')).toHaveLength(1);
  expect(api.log.unhandled).toEqual([]);
});

test('fully virtualized load from recordings; an unstubbed call is rejected and logged, not sent to the Shop', async ({ page, app }) => {
  const api = await virtualize(page);
  const catalogue = await api.stub('GET /api/catalog', scenarios.recordedCatalogue());
  const me = await api.stub('GET /api/me', scenarios.recordedMeUnauthenticated());

  await openShop(page, app);
  const products = loadRecording('catalog').response.body.products;
  await expect(page.locator('#products .product p')).toHaveText(products.map(p => `${p.name} · EUR ${(p.unit_amount / 100).toFixed(2)}`));
  await expect(page.locator('#cart-total')).toHaveText('Cart total: EUR 12.00');
  expect(catalogue).toHaveLength(1);
  expect(me).toHaveLength(1);
  expect(api.log.handled).toEqual([{ method: 'GET', path: '/api/catalog' }, { method: 'GET', path: '/api/me' }]);
  expect(api.log.unhandled).toEqual([]);

  const reset = page.locator('#request-reset-form');
  await reset.getByLabel('Account email').fill(app.users.alice.email);
  await reset.getByRole('button', { name: 'Send reset link' }).click();
  await expect(notice(page)).toHaveText('Failed to fetch');
  expect(api.log.unhandled).toEqual([{ method: 'POST', path: '/api/password-reset/request' }]);
  expect(api.log.passed).toEqual([]);
});
