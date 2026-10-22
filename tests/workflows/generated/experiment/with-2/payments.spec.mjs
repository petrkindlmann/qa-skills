import { test, expect } from '../../../support/fixtures.mjs';
import {
  apiClient, deliverPayment, expectOrder, orderBody, paymentEvent, postOrder, sign, signIn, supportState,
} from './helpers.mjs';

async function createOrder(client, key, items) {
  const response = await postOrder(client, key, orderBody(items));
  expect(response.status()).toBe(201);
  return (await response.json()).order;
}

async function readOrder(client, id) {
  const response = await client.get(`/api/orders/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).order;
}

const receiptsFor = (state, orderId) => state.receipts.filter(r => r.order_id === orderId);

test('rejects unsigned, forged, malformed and mismatched events without side effects', async ({ app }) => {
  const alice = await signIn(app, app.users.alice);
  const psp = await apiClient(app);
  try {
    const order = await createOrder(alice, 'pay-reject-1', [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }]);
    const eventId = `evt-${app.namespace}-ok`;
    const body = paymentEvent(eventId, order.id, 4200);
    const secret = app.paymentSecret;

    await test.step('missing, wrong-secret, unprefixed and byte-tampered signatures are 401', async () => {
      const tampered = body.replace('"amount":4200', '"amount":4200 ');
      const attempts = {
        missing: [body, null],
        'wrong secret': [body, sign('not-the-secret', body)],
        'no sha256= prefix': [body, sign(secret, body).slice('sha256='.length)],
        'whitespace-tampered bytes': [tampered, sign(secret, body)],
        'tampered event id': [body.replace(eventId, `${eventId}-x`), sign(secret, body)],
      };
      for (const [name, [bytes, signature]] of Object.entries(attempts)) {
        const response = await deliverPayment(psp, bytes, signature);
        expect(response.status(), name).toBe(401);
        expect(await response.json(), name).toEqual({ error: 'invalid_signature' });
      }
    });

    await test.step('signed but malformed, unknown or mismatched events are refused', async () => {
      const signed = async bytes => deliverPayment(psp, bytes, sign(secret, bytes));
      expect((await signed('{"id":"evt-broken",')).status(), 'invalid JSON').toBe(400);
      expect((await signed(JSON.stringify({ id: `evt-${app.namespace}-nodata`, type: 'payment.succeeded' }))).status(), 'no data').toBe(400);
      const unknown = await signed(paymentEvent(`evt-${app.namespace}-unknown`, 'no-such-order', 4200));
      expect(unknown.status(), 'unknown order').toBe(404);
      for (const [name, bytes] of [
        ['amount', paymentEvent(`evt-${app.namespace}-amt`, order.id, 4100)],
        ['currency', paymentEvent(`evt-${app.namespace}-cur`, order.id, 4200, 'USD')],
      ]) {
        const response = await signed(bytes);
        expect(response.status(), `${name} mismatch`).toBe(422);
        expect(await response.json(), `${name} mismatch`).toEqual({ error: 'payment_mismatch' });
      }
    });

    await test.step('nothing was recorded or fulfilled', async () => {
      expectOrder(await readOrder(alice, order.id), { status: 'pending', fulfillment_count: 0 });
      expect(receiptsFor(await supportState(app), order.id)).toEqual([]);
    });

    await test.step('control: the same event ID, signed over exact noncanonical bytes, is accepted', async () => {
      const pretty = JSON.stringify(JSON.parse(body), null, 2) + '\n';
      const response = await deliverPayment(psp, pretty, sign(secret, pretty));
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
      expectOrder(await readOrder(alice, order.id), { status: 'paid', fulfillment_count: 1, amount: 4200 });
      expect(receiptsFor(await supportState(app), order.id).map(r => r.id)).toEqual([eventId]);
    });
  } finally {
    await alice.dispose();
    await psp.dispose();
  }
});

test('duplicate, conflicting and concurrent deliveries fulfill each order once', async ({ app }) => {
  const alice = await signIn(app, app.users.alice);
  const psp = await apiClient(app);
  const send = bytes => deliverPayment(psp, bytes, sign(app.paymentSecret, bytes));
  try {
    const a = await createOrder(alice, 'dup-a', [{ sku: 'TEA-50', quantity: 1 }, { sku: 'CUP-01', quantity: 1 }]);
    const b = await createOrder(alice, 'dup-b', [{ sku: 'CUP-01', quantity: 1 }, { sku: 'TEA-50', quantity: 1 }]);
    const c = await createOrder(alice, 'dup-c', [{ sku: 'TEA-50', quantity: 1 }]);
    expect(a.amount).toBe(3000);
    expect(b.amount).toBe(3000);

    const e1 = paymentEvent(`evt-${app.namespace}-a1`, a.id, 3000);

    await test.step('six concurrent deliveries of one event: one fulfillment, five duplicates', async () => {
      const responses = await Promise.all(Array.from({ length: 6 }, () => send(e1)));
      const bodies = await Promise.all(responses.map(r => r.json()));
      expect(responses.map(r => r.status()), JSON.stringify(bodies)).toEqual(Array(6).fill(200));
      expect(bodies.filter(x => x.duplicate === false)).toHaveLength(1);
      expect(bodies.filter(x => x.duplicate === true)).toHaveLength(5);
      for (const x of bodies) expect(x).toMatchObject({ received: true, order_id: a.id });
      expectOrder(await readOrder(alice, a.id), { status: 'paid', fulfillment_count: 1 });
    });

    await test.step('sequential redelivery is a duplicate; same ID with another body is a conflict', async () => {
      const again = await send(e1);
      expect(again.status()).toBe(200);
      expect(await again.json()).toEqual({ received: true, duplicate: true, order_id: a.id });
      const conflicting = await send(paymentEvent(`evt-${app.namespace}-a1`, b.id, 3000));
      expect(conflicting.status()).toBe(409);
      expect(await conflicting.json()).toEqual({ error: 'event_conflict' });
      expectOrder(await readOrder(alice, b.id), { status: 'pending', fulfillment_count: 0 });
    });

    await test.step('a distinct event for an already-paid order does not fulfill it again', async () => {
      const second = await send(paymentEvent(`evt-${app.namespace}-a2`, a.id, 3000));
      expect(second.status()).toBeLessThan(500);
      expectOrder(await readOrder(alice, a.id), { status: 'paid', fulfillment_count: 1 });
    });

    await test.step('distinct events racing for one unpaid order fulfill it once', async () => {
      const racing = Array.from({ length: 4 }, (_, i) => paymentEvent(`evt-${app.namespace}-c${i}`, c.id, 1200));
      const responses = await Promise.all(racing.map(send));
      for (const r of responses) expect(r.status()).toBeLessThan(500);
      expect(responses.some(r => r.status() === 200)).toBe(true);
      expectOrder(await readOrder(alice, c.id), { status: 'paid', fulfillment_count: 1 });
    });

    const state = await supportState(app);
    expect(state.orders.find(o => o.id === a.id).fulfillment_count).toBe(1);
    expect(state.orders.find(o => o.id === b.id)).toMatchObject({ status: 'pending', fulfillment_count: 0 });
    expect(state.orders.find(o => o.id === c.id).fulfillment_count).toBe(1);
    expect(receiptsFor(state, b.id)).toEqual([]);
    expect(state.receipts.filter(r => r.id === `evt-${app.namespace}-a1`)).toHaveLength(1);
  } finally {
    await alice.dispose();
    await psp.dispose();
  }
});

test('transient fulfillment failure rolls back, the retry succeeds, and the outcome survives restart', async ({ app }) => {
  const items = [{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }];
  const seller = await signIn(app, app.users.alice);
  const order = await createOrder(seller, 'transient-1', items);
  await seller.dispose();

  const eventId = `evt-${app.namespace}-transient`;
  const event = paymentEvent(eventId, order.id, 4200);
  const signature = sign(app.paymentSecret, event);

  await app.restart({ failFulfillmentOnce: true });

  const alice = await signIn(app, app.users.alice);
  const psp = await apiClient(app);
  try {
    await test.step('the injected failure returns 503 and commits nothing', async () => {
      expectOrder(await readOrder(alice, order.id), { status: 'pending', fulfillment_count: 0, amount: 4200 });
      const failed = await deliverPayment(psp, event, signature);
      expect(failed.status()).toBe(503);
      expect(await failed.json()).toEqual({ error: 'fulfillment_unavailable' });
      expectOrder(await readOrder(alice, order.id), { status: 'pending', fulfillment_count: 0 });
      expect(receiptsFor(await supportState(app), order.id)).toEqual([]);
    });

    await test.step('retrying the same event succeeds as a first delivery', async () => {
      const retry = await deliverPayment(psp, event, signature);
      expect(retry.status()).toBe(200);
      expect(await retry.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
      expectOrder(await readOrder(alice, order.id), { status: 'paid', fulfillment_count: 1 });
    });
  } finally {
    await alice.dispose();
    await psp.dispose();
  }

  await app.restart();

  const afterRestart = await signIn(app, app.users.alice);
  const pspAfter = await apiClient(app);
  try {
    expectOrder(await readOrder(afterRestart, order.id), { status: 'paid', fulfillment_count: 1 });
    expect(receiptsFor(await supportState(app), order.id).map(r => r.id)).toEqual([eventId]);
    const redelivery = await deliverPayment(pspAfter, event, signature);
    expect(redelivery.status()).toBe(200);
    expect(await redelivery.json()).toEqual({ received: true, duplicate: true, order_id: order.id });
    expectOrder(await readOrder(afterRestart, order.id), { status: 'paid', fulfillment_count: 1 });
  } finally {
    await afterRestart.dispose();
    await pspAfter.dispose();
  }
});
