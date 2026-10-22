import { test, expect } from '../../../support/fixtures.mjs';
import { apiClient, deliverPayment, paymentEvent, replaySession, sign, sortItems } from './helpers.mjs';

const dataLayer = page => page.evaluate(() => window.dataLayer ?? null);
const eventsNamed = async (page, name) => (await dataLayer(page)).filter(e => e.event === name);

test('shopper signs in, checks out, sees the verified payment after reload, and signs out', async ({ page, app }) => {
  const { alice } = app.users;
  const signIn = page.getByRole('heading', { name: 'Sign in' });
  const status = page.getByRole('status');

  await page.goto(app.baseURL);

  await test.step('a rejected sign-in shows the error and pushes no analytics', async () => {
    await page.getByLabel('Email', { exact: true }).fill(alice.email);
    await page.getByLabel('Password', { exact: true }).fill('Alice-wrong-000!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(status).toHaveText('invalid_credentials');
    await expect(signIn).toBeVisible();
    expect(await eventsNamed(page, 'login')).toEqual([]);
  });

  await test.step('sign in', async () => {
    await page.getByLabel('Password', { exact: true }).fill(alice.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    await expect(signIn).toBeHidden();
    await expect.poll(() => eventsNamed(page, 'login')).toEqual([{ event: 'login', method: 'password' }]);
  });

  let order;
  await test.step('build the cart and place the order', async () => {
    await page.getByLabel('Mountain tea 50 g quantity').fill('2');
    await page.getByLabel('Tea cup quantity').fill('1');
    await expect(page.getByText('Cart total: EUR 42.00')).toBeVisible();
    const created = page.waitForResponse(r => r.url() === `${app.baseURL}/api/orders` && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Place order' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    order = (await response.json()).order;
    expect(order.amount).toBe(4200);

    await expect(status).toHaveText(`Order created: ${order.id}. Amount: EUR 42.00`);
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${order.id}` }) });
    await expect(card).toContainText('EUR 42.00 · Status: pending · Fulfillments: 0');

    const purchases = await eventsNamed(page, 'purchase');
    expect(purchases).toHaveLength(1);
    expect(purchases[0].ecommerce).toMatchObject({ transaction_id: order.id, value: 42, currency: 'EUR' });
    expect(sortItems(purchases[0].ecommerce.items.map(i => ({ sku: i.item_id, quantity: i.quantity }))))
      .toEqual([{ sku: 'CUP-01', quantity: 1 }, { sku: 'TEA-50', quantity: 2 }]);
  });

  await test.step('the PSP confirms payment; reload restores the user and the paid order', async () => {
    const psp = await apiClient(app);
    try {
      const event = paymentEvent(`evt-${app.namespace}-browser`, order.id, 4200);
      const paid = await deliverPayment(psp, event, sign(app.paymentSecret, event));
      expect(paid.status()).toBe(200);
    } finally {
      await psp.dispose();
    }
    await page.reload();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: `Order ${order.id}` }) });
    await expect(card).toContainText('EUR 42.00 · Status: paid · Fulfillments: 1');
    await expect(page.getByRole('heading', { name: /^Order / })).toHaveCount(1);
  });

  await test.step('sign out removes access in the page and on the server', async () => {
    const cookie = (await page.context().cookies()).find(c => c.name === 'shop_session');
    expect(cookie, 'browser holds a session cookie').toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(await replaySession(app, cookie.value), 'control: cookie valid before sign-out').toBe(200);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(status).toHaveText('Signed out.');
    await expect(signIn).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeHidden();
    expect(await replaySession(app, cookie.value), 'captured cookie after sign-out').toBe(401);

    await page.reload();
    await expect(signIn).toBeVisible();
    await expect(page.getByText(`Signed in as ${alice.email}`)).toBeHidden();
    const events = await dataLayer(page);
    expect(events.filter(e => e.event === 'login' || e.event === 'purchase')).toEqual([]);
  });
});
