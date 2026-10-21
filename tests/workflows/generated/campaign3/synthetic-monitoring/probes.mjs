// Probe bodies. Each one is a single critical path with its own hard budget
// (fails the probe) and warning line (annotates it). They take the Shop's
// base URL and the synthetic account explicitly so a scheduler, a spec file
// and a broken-case check can all drive the same code.
import { expect } from '../../../support/fixtures.mjs';
import { CONTRACT, json, mailbox } from './probe-support.mjs';
import { oracle } from '../../../support/oracle.mjs';

const money = minor => `${CONTRACT.currency} ${(minor / 100).toFixed(2)}`;

// --- health -----------------------------------------------------------------
// FAIL: non-200, wrong body or build, any sample over the contract's 500 ms.
// WARN: slowest sample over 250 ms (half the budget), or a cacheable response.
export async function healthProbe({ request, baseURL, probe, samples = 3 }) {
  const latencies = [];
  for (let i = 0; i < samples; i++) {
    const { value: response, ms } = await probe.timed(`health-${i + 1}`, () => request.get(`${baseURL}/health`, { timeout: 3000 }));
    latencies.push(ms);
    expect(response.status(), `GET /health sample ${i + 1}`).toBe(200);
    const body = await json(response, 'GET /health');
    expect(body, 'health body').toEqual({ status: 'ok', build: CONTRACT.build });
    if (i === 0 && !/no-store/.test(response.headers()['cache-control'] ?? '')) {
      probe.warn('health response is cacheable; a stale cache could mask an origin outage');
    }
  }
  probe.note('latenciesMs', latencies);
  await probe.budget('slowest /health sample', Math.max(...latencies), { warnAt: CONTRACT.healthBudgetMs / 2, failAt: CONTRACT.healthBudgetMs, oracleId: 'c3-synth-slow-health' });
}

// --- storefront ---------------------------------------------------------------
// FAIL: GET / not 200, sign-in or reset controls missing, catalogue not rendered
// with the contract prices within 3 s.
// WARN: catalogue rendered later than 1 s after navigation starts.
export async function storefrontProbe({ page, baseURL, probe }) {
  const { value: response, ms: navigationMs } = await probe.timed('navigation', () => page.goto(`${baseURL}/`));
  expect(response?.status(), 'GET /').toBe(200);
  const { ms: renderMs } = await probe.timed('catalogue-render', async () => {
    for (const [sku, price] of Object.entries(CONTRACT.catalog)) {
      await expect(page.getByText(money(price)).first(), `${sku} priced ${money(price)}`).toBeVisible({ timeout: 3000 });
      await expect(page.locator(`#quantity-${sku}`), `${sku} quantity control`).toBeVisible();
    }
    await expect(page.getByLabel(/quantity$/), 'one labelled quantity control per catalogue product').toHaveCount(Object.keys(CONTRACT.catalog).length);
  });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
  await probe.budget('storefront ready (navigation + catalogue)', navigationMs + renderMs, { warnAt: 1000, failAt: 3000 });
}

// --- sign-in ------------------------------------------------------------------
async function signInThroughPage(page, baseURL, user) {
  await page.goto(`${baseURL}/`);
  // Two labels contain "Email" ("Email" and "Account email"), hence exact.
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/login'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  return response;
}

async function signOutThroughPage(page, baseURL) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  const me = await page.request.get(`${baseURL}/api/me`);
  expect(me.status(), 'session must be gone after sign-out').toBe(401);
}

// FAIL: login not 200 (429 means the synthetic account is throttled), the
// account view not shown within 5 s, /api/me not recognising the session, or
// the sign-out cleanup leaving a session behind.
// WARN: submit-to-signed-in over 2 s; missing `login` analytics event.
export async function signInProbe({ page, baseURL, user, probe }) {
  const { value: login, ms } = await probe.timed('submit-to-signed-in', async () => {
    const response = await signInThroughPage(page, baseURL, user);
    await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible({ timeout: 5000 });
    return response;
  });
  expect(login.status(), `POST /api/login (429 = throttled synthetic account)`).toBe(200);
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
  const me = await page.request.get(`${baseURL}/api/me`);
  expect(me.status(), 'GET /api/me with the new session').toBe(200);
  expect((await json(me, 'GET /api/me')).user?.email).toBe(user.email);
  await probe.budget('submit to signed-in view', ms, { warnAt: 2000, failAt: 5000 });

  const events = await page.evaluate(() => window.dataLayer ?? []);
  if (!events.some(event => event.event === 'login' && event.method === 'password')) {
    probe.warn('no {event:"login",method:"password"} in window.dataLayer after sign-in');
  }
  await signOutThroughPage(page, baseURL);
}

// --- order journey --------------------------------------------------------------
// FAIL: sign-in fails, POST /api/orders not 201 with a fresh pending order for
// 1 x TEA-50 (1200), the confirmation notice or the orders list not showing it,
// the order not readable by its owner, more than one new order left behind,
// or click-to-listed over 5 s.
// WARN: click-to-listed over 2.5 s; purchase analytics event missing or wrong.
// Footprint: exactly one pending, unpaid order in the synthetic account, recorded
// in ledger.json. The Shop has no order deletion, so the account owns it.
export async function orderJourneyProbe({ page, baseURL, user, probe, testInfo }) {
  const login = await signInThroughPage(page, baseURL, user);
  expect(login.status(), 'POST /api/login').toBe(200);
  await expect(page.getByText(`Signed in as ${user.email}`)).toBeVisible({ timeout: 5000 });
  const before = (await json(await page.request.get(`${baseURL}/api/orders`), 'GET /api/orders before')).orders;

  await page.locator('#quantity-TEA-50').fill('1');
  await page.locator('#quantity-CUP-01').fill('0');
  await expect(page.getByText(`Cart total: ${money(CONTRACT.catalog['TEA-50'])}`)).toBeVisible();

  const { value: created, ms } = await probe.timed('click-to-listed', async () => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/orders'),
      page.getByRole('button', { name: 'Place order' }).click(),
    ]);
    expect(response.status(), 'POST /api/orders').toBe(201);
    const body = await json(response, 'POST /api/orders');
    expect(body.replayed, 'a fresh order, not an idempotent replay').toBe(false);
    const order = body.order;
    await expect(page.getByRole('status')).toHaveText(`Order created: ${order.id}. Amount: ${money(order.amount)}`, { timeout: 5000 });
    await expect(page.getByRole('listitem').filter({ hasText: `Order ${order.id}` }))
      .toContainText(`${money(order.amount)} · Status: pending · Fulfillments: 0`, { timeout: 5000 });
    return order;
  });
  expect(created).toMatchObject({ user_id: user.id, currency: CONTRACT.currency, amount: CONTRACT.catalog['TEA-50'], status: 'pending', fulfillment_count: 0 });
  expect(created.items).toEqual([{ sku: 'TEA-50', quantity: 1 }]);

  const byId = await page.request.get(`${baseURL}/api/orders/${created.id}`);
  expect(byId.status(), 'GET /api/orders/:id as owner').toBe(200);
  const after = (await json(await page.request.get(`${baseURL}/api/orders`), 'GET /api/orders after')).orders;
  expect(after.length - before.length, 'exactly one order left behind').toBe(1);
  await probe.budget('place order to listed', ms, { warnAt: 2500, failAt: 5000 });

  const events = await page.evaluate(() => window.dataLayer ?? []);
  const purchases = events.filter(event => event.event === 'purchase' && event.ecommerce?.transaction_id === created.id);
  if (purchases.length !== 1) probe.warn(`expected one purchase event for ${created.id}, saw ${purchases.length}`);
  else if (purchases[0].ecommerce.value !== created.amount / 100 || purchases[0].ecommerce.currency !== created.currency) {
    probe.warn(`purchase event carries ${JSON.stringify(purchases[0].ecommerce)} for a ${money(created.amount)} order`);
  }

  const ledger = { probe: 'order-journey', account: user.email, orderId: created.id, amount: created.amount, status: created.status, createdAt: new Date().toISOString() };
  probe.note('ledger', ledger);
  await testInfo.attach('ledger.json', { body: JSON.stringify(ledger, null, 2), contentType: 'application/json' });
  await signOutThroughPage(page, baseURL);
}

// --- password-reset email -----------------------------------------------------------
// FAIL: request not 202, no message for the exact recipient with the contract
// subject within 10 s, extra recipients, missing text or HTML alternative, no
// link to this Shop's /reset-password?token=..., or cleanup failing.
// WARN: delivery over 2 s.
// Footprint: one unconsumed reset token for the synthetic account (expires in
// 300 s). The token is never confirmed, so the password stays unchanged.
export async function passwordResetEmailProbe({ request, baseURL, mailpitURL, user, probe }) {
  const inbox = mailbox(request, mailpitURL, user.email);
  const seen = new Set((await inbox.list()).map(message => message.ID));
  probe.note('messagesAlreadyInInbox', seen.size);

  let captured;
  const { ms } = await probe.timed('request-to-delivered', async () => {
    const response = await request.post(`${baseURL}/api/password-reset/request`, { data: { email: user.email }, timeout: 3000 });
    expect(response.status(), 'POST /api/password-reset/request').toBe(202);
    await oracle('c3-synth-reset-email', 'toBe', () => expect.poll(async () => {
      captured = (await inbox.list()).find(message => !seen.has(message.ID) && message.Subject === CONTRACT.resetSubject);
      return Boolean(captured);
    }, { timeout: 10_000, intervals: [50, 100, 250], message: `no "${CONTRACT.resetSubject}" email for ${user.email}` }).toBe(true));
  });
  await probe.budget('reset email delivery', ms, { warnAt: 2000, failAt: 10_000 });

  const message = await inbox.message(captured.ID);
  expect(message.To, 'exactly one recipient').toHaveLength(1);
  expect(message.Cc ?? [], 'no Cc').toHaveLength(0);
  expect(message.Bcc ?? [], 'no Bcc').toHaveLength(0);
  const link = new RegExp(`${baseURL.replaceAll('.', '\\.')}${CONTRACT.resetPath.replace('?', '\\?')}[A-Za-z0-9_-]+`);
  expect(message.Text, 'plaintext alternative with the reset link').toMatch(link);
  expect(message.HTML, 'HTML alternative with the reset link').toMatch(link);
  probe.note('messageId', message.ID);

  await inbox.remove([message.ID]);
}
