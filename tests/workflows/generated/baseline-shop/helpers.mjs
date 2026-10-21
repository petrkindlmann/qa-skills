import { createHmac } from 'node:crypto';
import { test as base, expect } from '../../support/fixtures.mjs';
export { expect };
export const test = base.extend({
  clients: async ({ app, playwright }, use) => {
    const clients = {};
    for (const who of ['alice', 'bob', 'guest']) {
      clients[who] = await playwright.request.newContext({ baseURL: app.baseURL });
      if (who !== 'guest') await json(await clients[who].post('/api/login', { data: app.users[who] }), 200);
    }
    try { await use(clients); } finally { await Promise.all(Object.values(clients).map(c => c.dispose())); }
  },
  inbox: async ({ app, mailpit, request }, use) => {
    const owned = new Set();
    const search = async email => {
      const r = await json(await request.get(`${mailpit.baseURL}/api/v1/search`, { params: { query: `to:${email}` } }), 200);
      expect(Array.isArray(r.messages)).toBe(true);
      return r.messages.filter(m => m.To.some(t => t.Address.toLowerCase() === email.toLowerCase()));
    };
    const receive = async email => {
      let found;
      await expect.poll(async () => { found = (await search(email)).find(m => !owned.has(m.ID)); return Boolean(found); }, { timeout: 10000, intervals: [100, 250, 500] }).toBe(true);
      owned.add(found.ID);
      const m = await json(await request.get(`${mailpit.baseURL}/api/v1/message/${encodeURIComponent(found.ID)}`), 200);
      expect(m.ID).toBe(found.ID); expect(m.To.map(t=>t.Address)).toContain(email);
      expect(m.Subject).toBe('Reset your Shop password'); expect(m.From.Address).toMatch(/^[^@\s]+@[^@\s]+$/);
      expect(m.Text.length).toBeGreaterThan(0); expect(m.HTML.length).toBeGreaterThan(0);
      return m;
    };
    try { await use({ receive, search }); }
    finally {
      for (const user of Object.values(app.users)) for (const m of await search(user.email)) owned.add(m.ID);
      if (owned.size) { const r=await request.delete(`${mailpit.baseURL}/api/v1/messages`,{data:{IDs:[...owned]}});expect(r.ok()).toBe(true); }
    }
  }
});
export async function json(response, status) {
  expect(response.status(), `${response.url()} ${await response.text()}`).toBe(status);
  expect(response.headers()['content-type']).toContain('application/json');
  return response.json();
}
export const basket = { currency: 'EUR', items: [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }] };
export async function create(client, key='checkout', data=basket, status=201) {
  const body=await json(await client.post('/api/orders',{headers:{'Idempotency-Key':key},data}),status);
  const o=body.order;
  expect(o).toEqual(expect.objectContaining({ id:expect.any(String), user_id:expect.any(String), currency:'EUR', amount:expect.any(Number), items:expect.any(Array), status:expect.stringMatching(/^(pending|paid)$/), fulfillment_count:expect.any(Number) }));
  expect(o.id.length).toBeGreaterThan(0);expect(Number.isInteger(o.amount)).toBe(true);expect(o.amount).toBeGreaterThan(0);expect(Number.isInteger(o.fulfillment_count)).toBe(true);
  expect(o.items.length).toBeGreaterThan(0);
  for(const item of o.items){expect(item).toEqual(expect.objectContaining({sku:expect.any(String),quantity:expect.any(Number)}));expect(Number.isInteger(item.quantity)).toBe(true);}
  expect(typeof body.replayed).toBe('boolean');return body;
}
export async function state(app, request){return json(await request.get(`${app.baseURL}/test-support/state`,{headers:{'X-Test-Admin-Key':app.testAdminKey}}),200);}
export const payment=(order,id='evt-test')=>({id,type:'payment.succeeded',data:{order_id:order.id,currency:order.currency,amount:order.amount}});
export const signature=(app,bytes)=>'sha256='+createHmac('sha256',app.paymentSecret).update(bytes).digest('hex');
export const deliver=(app,request,event)=>{const bytes=JSON.stringify(event);return request.post(`${app.baseURL}/api/webhooks/payment`,{data:bytes,headers:{'Content-Type':'application/json','X-Test-Payment-Signature':signature(app,bytes)}});};
export async function resetLink(page,m,app){
  const candidates=await page.evaluate(html=>[...new DOMParser().parseFromString(html,'text/html').querySelectorAll('a[href]')].map(a=>a.getAttribute('href')),m.HTML);
  const valid=candidates.map(x=>new URL(x)).filter(u=>u.origin===app.baseURL&&u.pathname==='/reset-password'&&u.searchParams.get('token')&&!u.username&&!u.password);
  expect([...new Set(valid.map(u=>u.href))]).toHaveLength(1);
  expect(m.Text).toContain(valid[0].href);return valid[0];
}
export async function signIn(page,app,password=app.users.alice.password){await page.goto(app.baseURL);await page.getByLabel('Email',{exact:true}).fill(app.users.alice.email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();}
