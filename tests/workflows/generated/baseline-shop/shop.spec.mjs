import { test, expect, json, create, basket, state, payment, signature, deliver, resetLink, signIn } from './helpers.mjs';

test('API auth, cookie contract and logout revoke access', async ({app,clients})=>{
  const c=clients.guest;
  expect(await json(await c.get('/health'),200)).toEqual({status:'ok',build:'shop-lab-v1'});
  expect(await json(await c.get('/api/me'),401)).toEqual({error:'unauthenticated'});
  expect(await json(await c.post('/api/login',{data:{email:app.users.alice.email,password:'wrong'}}),401)).toEqual({error:'invalid_credentials'});
  const login=await c.post('/api/login',{data:app.users.alice});
  expect(await json(login,200)).toEqual({user:{id:app.users.alice.id,email:app.users.alice.email}});
  const cookie=login.headers()['set-cookie'];expect(cookie).toMatch(/shop_session=/);expect(cookie).toMatch(/httponly/i);expect(cookie).toMatch(/samesite=lax/i);expect(cookie).toMatch(/path=\//i);
  expect(await json(await c.get('/api/me'),200)).toEqual({user:{id:app.users.alice.id,email:app.users.alice.email}});
  const logout=await c.post('/api/logout');expect(logout.status()).toBe(204);
  expect(await json(await c.get('/api/me'),401)).toEqual({error:'unauthenticated'});
  expect(await json(await c.get('/api/orders'),401)).toEqual({error:'unauthenticated'});
  expect(await json(await c.get('/api/orders/missing'),401)).toEqual({error:'unauthenticated'});
  expect(await json(await c.post('/api/orders',{headers:{'Idempotency-Key':'unauth'},data:basket}),401)).toEqual({error:'unauthenticated'});
});

test('catalog controls money and malformed orders never create state',async({app,clients,request})=>{
  const catalog=await json(await clients.guest.get('/api/catalog'),200);expect(catalog.currency).toBe('EUR');expect(catalog.products.map(p=>p.sku).sort()).toEqual(['CUP-01','TEA-50']);
  const bad=[{...basket,currency:'USD'},{...basket,items:[]},...[0,11,1.5,'2'].map(quantity=>({...basket,items:[{sku:'TEA-50',quantity}]})),{...basket,items:[{sku:'MISSING',quantity:1}]},{...basket,items:[{sku:'TEA-50',quantity:1},{sku:'TEA-50',quantity:2}]}];
  for(const [i,data] of bad.entries()) expect(await json(await clients.alice.post('/api/orders',{headers:{'Idempotency-Key':`invalid-${i}`},data}),400)).toEqual({error:'invalid_order'});
  expect((await state(app,request)).orders).toHaveLength(0);
  const {order}=await create(clients.alice,'priced',{...basket,amount:1});expect(order.amount).toBe(4200);expect(order.status).toBe('pending');expect(order.fulfillment_count).toBe(0);
});

test('order ownership is private and idempotency keys belong to users',async({clients})=>{
  const a=(await create(clients.alice,'same-key')).order;const b=(await create(clients.bob,'same-key')).order;expect(a.id).not.toBe(b.id);
  expect((await json(await clients.alice.get('/api/orders'),200)).orders.map(o=>o.id)).toEqual([a.id]);expect((await json(await clients.bob.get('/api/orders'),200)).orders.map(o=>o.id)).toEqual([b.id]);
  expect(await json(await clients.bob.get(`/api/orders/${a.id}`),404)).toEqual({error:'not_found'});expect(await json(await clients.bob.get('/api/orders/unknown'),404)).toEqual({error:'not_found'});
});

test('concurrent equivalent checkout replays once and persists across restart',async({app,clients,request})=>{
  const results=await Promise.all(Array.from({length:6},(_,i)=>clients.alice.post('/api/orders',{headers:{'Idempotency-Key':'parallel'},data:{...basket,items:i%2?[...basket.items].reverse():basket.items}})));
  expect(results.map(r=>r.status()).sort()).toEqual([200,200,200,200,200,201]);const bodies=await Promise.all(results.map(r=>r.json()));const id=bodies[0].order.id;expect(new Set(bodies.map(x=>x.order.id)).size).toBe(1);expect(bodies.filter(b=>!b.replayed)).toHaveLength(1);
  for(const data of [{...basket,currency:'USD'},{...basket,items:[{sku:'TEA-50',quantity:3}]}]) expect(await json(await clients.alice.post('/api/orders',{headers:{'Idempotency-Key':'parallel'},data}),409)).toEqual({error:'idempotency_conflict'});
  expect((await state(app,request)).orders).toHaveLength(1);await app.restart({failFulfillmentOnce:false});
  const replay=await create(clients.alice,'parallel',basket,200);expect(replay.replayed).toBe(true);expect(replay.order.id).toBe(id);expect((await state(app,request)).orders).toHaveLength(1);
});

test('payment signatures, exact raw bytes and mismatched values reject without side effects',async({app,clients,request})=>{
  const order=(await create(clients.alice)).order;const event=payment(order);const bytes=JSON.stringify(event);
  for(const headers of [{},{'X-Test-Payment-Signature':'sha256=bad'},{'X-Test-Payment-Signature':signature(app,bytes+' ')}]) expect(await json(await request.post(`${app.baseURL}/api/webhooks/payment`,{data:bytes,headers:{'Content-Type':'application/json',...headers}}),401)).toEqual({error:'invalid_signature'});
  for(const data of [{...event.data,amount:1},{...event.data,currency:'USD'}]) expect(await json(await deliver(app,request,{...event,data}),422)).toEqual({error:'payment_mismatch'});
  expect((await deliver(app,request,{...event,data:{...event.data,order_id:'unknown'}})).status()).toBe(404);
  expect((await deliver(app,request,{})).status()).toBe(400);
  let s=await state(app,request);expect(s.receipts).toHaveLength(0);expect(s.orders[0].fulfillment_count).toBe(0);
  expect(await json(await deliver(app,request,event),200)).toEqual({received:true,duplicate:false,order_id:order.id});
  expect((await json(await clients.alice.get(`/api/orders/${order.id}`),200)).order).toMatchObject({status:'paid',fulfillment_count:1});
});

test('concurrent payment redelivery, conflict and distinct event IDs fulfill once durably',async({app,clients,request})=>{
  const order=(await create(clients.alice)).order;const event=payment(order);
  const responses=await Promise.all(Array.from({length:6},()=>deliver(app,request,event)));const bodies=await Promise.all(responses.map(r=>json(r,200)));expect(bodies.filter(b=>!b.duplicate)).toHaveLength(1);
  expect(await json(await deliver(app,request,{...event,data:{...event.data,amount:1}}),409)).toEqual({error:'event_conflict'});
  expect((await json(await deliver(app,request,payment(order,'evt-other')),200)).duplicate).toBe(false);
  let s=await state(app,request);expect(s.receipts).toHaveLength(2);expect(s.orders[0]).toMatchObject({status:'paid',fulfillment_count:1});
  await app.restart({failFulfillmentOnce:false});expect((await json(await deliver(app,request,event),200)).duplicate).toBe(true);
  s=await state(app,request);expect(s.receipts).toHaveLength(2);expect(s.orders[0]).toMatchObject({status:'paid',fulfillment_count:1});
});

test('transient fulfillment rolls back receipt then same event succeeds after restart',async({app,clients,request})=>{
  const order=(await create(clients.alice)).order;const event=payment(order);
  await app.restart({failFulfillmentOnce:true});expect(await json(await deliver(app,request,event),503)).toEqual({error:'fulfillment_unavailable'});
  expect((await json(await clients.alice.get(`/api/orders/${order.id}`),200)).order).toMatchObject({status:'pending',fulfillment_count:0});expect((await state(app,request)).receipts).toHaveLength(0);
  await app.restart({failFulfillmentOnce:false});expect((await json(await deliver(app,request,event),200)).duplicate).toBe(false);
  expect((await json(await deliver(app,request,event),200)).duplicate).toBe(true);const s=await state(app,request);expect(s.receipts).toHaveLength(1);expect(s.orders[0]).toMatchObject({status:'paid',fulfillment_count:1});
});

test('browser checkout restores order on reload and reflects server payment',async({page,app,request})=>{
  await signIn(page,app);await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();
  await page.getByRole('spinbutton',{name:'Mountain tea 50 g quantity'}).fill('2');await page.getByRole('spinbutton',{name:'Tea cup quantity'}).fill('1');
  await expect(page.getByText('Cart total: EUR 42.00',{exact:true})).toBeVisible();
  const result=page.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST');await page.getByRole('button',{name:'Place order'}).click();const {order}=await json(await result,201);expect(order.amount).toBe(4200);
  const row=page.getByRole('listitem').filter({hasText:order.id});await expect(row).toContainText('pending');await expect(row).toContainText('42.00');
  await page.reload();await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();await expect(row).toContainText('pending');
  await json(await deliver(app,request,payment(order)),200);await page.getByRole('button',{name:'Refresh orders'}).click();await expect(row).toContainText('paid');
  await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('button',{name:'Place order'})).toBeDisabled();expect((await page.request.get(`${app.baseURL}/api/orders`)).status()).toBe(401);
});

test('actual reset email completes browser flow and revokes all sessions',async({page,app,clients,inbox,request})=>{
  await signIn(page,app);await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();
  await page.getByLabel('Account email').fill(app.users.alice.email);await page.getByRole('button',{name:'Send reset link'}).click();
  const m=await inbox.receive(app.users.alice.email);const link=await resetLink(page,m,app);const token=link.searchParams.get('token');
  await page.goto(link.href);await page.getByLabel('New password',{exact:true}).fill('New-password-987!');const result=page.waitForResponse(r=>r.url().endsWith('/api/password-reset/confirm'));await page.getByRole('button',{name:/reset password|save password|change password/i}).click();expect(await json(await result,200)).toEqual({reset:true});
  expect((await clients.alice.get('/api/me')).status()).toBe(401);expect((await page.request.get(`${app.baseURL}/api/me`)).status()).toBe(401);
  expect(await json(await clients.guest.post('/api/login',{data:app.users.alice}),401)).toEqual({error:'invalid_credentials'});
  expect(await json(await clients.guest.post('/api/password-reset/confirm',{data:{token,password:'Another-password-123!'}}),400)).toEqual({error:'invalid_or_expired_token'});
  await signIn(page,app,'New-password-987!');await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();expect((await state(app,request)).smtp_errors).toBe(0);
});

test('reset requests resist account enumeration and tokens expire on the server clock',async({page,app,clients,inbox,request})=>{
  const unknown=`absent+${app.namespace}@example.test`;
  const known=await json(await clients.guest.post('/api/password-reset/request',{data:{email:app.users.alice.email}}),202);
  expect(await json(await clients.guest.post('/api/password-reset/request',{data:{email:unknown}}),202)).toEqual(known);expect(known).toEqual({message:'If this account exists, a reset email has been sent.'});
  const m=await inbox.receive(app.users.alice.email);const link=await resetLink(page,m,app);expect(await inbox.search(unknown)).toHaveLength(0);
  await json(await request.post(`${app.baseURL}/test-support/clock`,{headers:{'X-Test-Admin-Key':app.testAdminKey},data:{advance_seconds:301}}),200);
  expect(await json(await clients.guest.post('/api/password-reset/confirm',{data:{token:link.searchParams.get('token'),password:'New-password-987!'}}),400)).toEqual({error:'invalid_or_expired_token'});
  expect((await clients.guest.post('/api/login',{data:app.users.alice})).status()).toBe(200);
});
