// Page drivers for the Shop. Selectors come from the served page: labelled controls
// (contract "Browser journeys"), the role=status notice, and the orders list rows.
import { expect } from '../../../../../../support/fixtures.mjs';
import { installDataLayerObserver } from './datalayer.mjs';

// What the observer snapshots at the instant of every dataLayer push.
export const uiProbes = [
  ['notice', '#notice', 'text'],
  ['loginVisible', '#login-section', 'visible'],
  ['accountVisible', '#account-section', 'visible'],
  ['orderRows', '#orders li', 'count'],
  ['orderIds', '#orders li[data-order-id]', 'attr:data-order-id'],
  ['checkoutDisabled', '#checkout-button', 'disabled'],
];

export async function openShop(page, app) {
  await installDataLayerObserver(page, { uiProbes });
  await page.goto(app.baseURL + '/');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
}

export const status = page => page.getByRole('status');

export async function signIn(page, { email, password }) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAndSettle(page, user) {
  await signIn(page, user);
  await expect(status(page)).toHaveText('Signed in.');
}

export async function catalog(page, app) {
  const response = await page.request.get(app.baseURL + '/api/catalog');
  expect(response.status()).toBe(200);
  return response.json();
}

// quantities: { 'TEA-50': 2, 'CUP-01': 1 }. Unlisted SKUs are set to 0.
export async function setCart(page, { products }, quantities) {
  for (const product of products) {
    await page.getByLabel(`${product.name} quantity`).fill(String(quantities[product.sku] ?? 0));
  }
}

// Clicks Place order and returns the POST /api/orders response the page received.
export async function placeOrder(page, { clicks = 1 } = {}) {
  const button = page.getByRole('button', { name: 'Place order' });
  const responsePromise = page.waitForResponse(response =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/orders');
  if (clicks === 2) await button.dblclick(); else await button.click();
  return responsePromise;
}

export const major = minor => minor / 100;

export const money = minor => 'EUR ' + (minor / 100).toFixed(2);

export function expectedPurchase(order) {
  return {
    event: 'purchase',
    ecommerce: {
      transaction_id: order.id,
      value: major(order.amount),
      currency: order.currency,
      items: order.items.map(item => ({ item_id: item.sku, quantity: item.quantity })),
    },
  };
}

export async function ordersFromApi(page, app) {
  const response = await page.request.get(app.baseURL + '/api/orders');
  expect(response.status()).toBe(200);
  return (await response.json()).orders;
}

// Scoped cleanup: end the browser session on this test's own Shop instance.
export async function signOutQuietly(page, app) {
  try { await page.request.post(app.baseURL + '/api/logout'); } catch {}
}
