import { randomUUID } from 'node:crypto';
import {
  test, expect, TEA2_CUP1, PRICE, burst, createOrder, deliverPayment, paymentEvent, paymentSignature,
  receiptsFor, orderIn, signIn,
} from './helpers.mjs';

test('only a correctly signed, matching event marks an order paid, exactly once', async ({ app, clients }) => {
  const alice = await clients.signedIn(app.users.alice);
  const webhook = await clients.open();
  const order = await createOrder(alice, TEA2_CUP1);
  const otherOrder = await createOrder(alice, [{ sku: 'TEA-50', quantity: 1 }]);

  const expectUnpaid = async (orderId, label) => {
    const { order: stored } = await (await alice.get(`/api/orders/${orderId}`)).json();
    expect(stored.status, label).toBe('pending');
    expect(stored.fulfillment_count, label).toBe(0);
    expect(receiptsFor(await clients.state(), orderId), label).toEqual([]);
  };

  await test.step('missing, wrong-secret, unprefixed and byte-tampered signatures are refused', async () => {
    const body = paymentEvent(order.id, 4200);
    const tampered = body.replace('"amount":4200', '"amount":4200 ');
    expect(tampered).not.toBe(body);
    const attempts = {
      'missing signature': [body, null],
      'wrong secret': [body, paymentSignature(body, 'not-the-secret')],
      'hex without sha256= prefix': [body, paymentSignature(body, app.paymentSecret).slice('sha256='.length)],
      'whitespace added after signing': [tampered, paymentSignature(body, app.paymentSecret)],
      'order changed after signing': [body.replace(order.id, otherOrder.id), paymentSignature(body, app.paymentSecret)],
    };
    for (const [name, [sent, signature]] of Object.entries(attempts)) {
      const response = await deliverPayment(webhook, app, sent, { signature });
      expect(response.status(), name).toBe(401);
      expect(await response.json(), name).toEqual({ error: 'invalid_signature' });
    }
    await expectUnpaid(order.id, 'after rejected signatures');
  });

  await test.step('signed but malformed, unknown or mismatched events are refused', async () => {
    const malformed = await deliverPayment(webhook, app, '{"id":"evt-broken","type":');
    expect(malformed.status(), 'malformed JSON').toBe(400);
    const noOrder = await deliverPayment(webhook, app,
      JSON.stringify({ id: `evt-${randomUUID()}`, type: 'payment.succeeded', data: { currency: 'EUR', amount: 4200 } }));
    expect(noOrder.status(), 'event without order_id').toBe(400);

    const unknown = await deliverPayment(webhook, app, paymentEvent(randomUUID(), 4200));
    expect(unknown.status(), 'unknown order').toBe(404);

    for (const [name, body] of [
      ['amount', paymentEvent(order.id, 4100)],
      ['currency', paymentEvent(order.id, 4200, { currency: 'USD' })],
    ]) {
      const response = await deliverPayment(webhook, app, body);
      expect(response.status(), `mismatched ${name}`).toBe(422);
      expect(await response.json()).toEqual({ error: 'payment_mismatch' });
    }
    await expectUnpaid(order.id, 'after rejected events');
  });

  const eventId = `evt-${randomUUID()}`;
  // Pretty-printed JSON: the signature must cover the exact bytes, not a re-serialization.
  const validBody = paymentEvent(order.id, 4200, { id: eventId, indent: 2 });

  await test.step('a valid signed event pays and fulfills the order once', async () => {
    const response = await deliverPayment(webhook, app, validBody);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false, order_id: order.id });

    const { order: paid } = await (await alice.get(`/api/orders/${order.id}`)).json();
    expect(paid).toEqual({ ...order, status: 'paid', fulfillment_count: 1 });
    expect(receiptsFor(await clients.state(), order.id)).toHaveLength(1);
  });

  await test.step('redelivery, a conflicting reuse of the event ID and a second event do not refulfill', async () => {
    const repeat = await deliverPayment(webhook, app, validBody);
    expect(repeat.status()).toBe(200);
    expect(await repeat.json()).toEqual({ received: true, duplicate: true, order_id: order.id });

    // Valid on its own for the other order, so a 409 here can only come from the event ID.
    const conflicting = await deliverPayment(webhook, app,
      paymentEvent(otherOrder.id, PRICE['TEA-50'], { id: eventId }));
    expect(conflicting.status()).toBe(409);
    expect(await conflicting.json()).toEqual({ error: 'event_conflict' });
    await expectUnpaid(otherOrder.id, 'event ID conflict must not pay the other order');

    // The contract fixes the invariant for a distinct event on a paid order, not its status.
    const second = await deliverPayment(webhook, app, paymentEvent(order.id, 4200));
    expect(second.status(), 'distinct event for a paid order').toBeLessThan(500);

    const { order: stored } = await (await alice.get(`/api/orders/${order.id}`)).json();
    expect(stored.status).toBe('paid');
    expect(stored.fulfillment_count).toBe(1);
  });

  await test.step('the other order is still payable with its own event', async () => {
    const response = await deliverPayment(webhook, app, paymentEvent(otherOrder.id, PRICE['TEA-50']));
    expect(response.status()).toBe(200);
    expect(orderIn(await clients.state(), otherOrder.id)).toEqual(
      expect.objectContaining({ status: 'paid', fulfillment_count: 1 }));
  });
});

test('concurrent duplicate and distinct deliveries fulfill an order once', async ({ app, clients }) => {
  const alice = await clients.signedIn(app.users.alice);
  const webhook = await clients.open();

  await test.step('ten parallel copies of one event: one fulfillment, nine duplicates', async () => {
    const order = await createOrder(alice, TEA2_CUP1);
    const body = paymentEvent(order.id, 4200);
    const { responses, transportErrors } = await burst(10, () => deliverPayment(webhook, app, body));
    expect.soft(transportErrors, 'every parallel delivery received an HTTP response').toEqual([]);
    expect(responses.length, 'enough deliveries were answered to race').toBeGreaterThanOrEqual(2);
    expect(responses.map(response => response.status())).toEqual(Array(responses.length).fill(200));
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(bodies.filter(result => result.duplicate === false)).toHaveLength(1);
    expect(bodies.filter(result => result.duplicate === true)).toHaveLength(responses.length - 1);

    const state = await clients.state();
    expect(orderIn(state, order.id)).toEqual(expect.objectContaining({ status: 'paid', fulfillment_count: 1 }));
    expect(receiptsFor(state, order.id)).toHaveLength(1);
  });

  await test.step('six parallel distinct events for one order still fulfill it once', async () => {
    const order = await createOrder(alice, [{ sku: 'CUP-01', quantity: 2 }]);
    const { responses, transportErrors } = await burst(6, () =>
      deliverPayment(webhook, app, paymentEvent(order.id, 2 * PRICE['CUP-01'])));
    expect.soft(transportErrors, 'every parallel delivery received an HTTP response').toEqual([]);
    for (const response of responses) expect(response.status()).toBeLessThan(500);
    expect(responses.some(response => response.status() === 200), 'at least one event accepted').toBe(true);

    const { order: stored } = await (await alice.get(`/api/orders/${order.id}`)).json();
    expect(stored.status).toBe('paid');
    expect(stored.fulfillment_count).toBe(1);
  });
});

test('a transient fulfillment failure rolls back, and retry and restart keep one fulfillment', async ({ app, clients }) => {
  const firstClient = await clients.signedIn(app.users.alice);
  const order = await createOrder(firstClient, TEA2_CUP1);
  const crashWindowOrder = await createOrder(firstClient, [{ sku: 'TEA-50', quantity: 3 }]);
  const body = paymentEvent(order.id, 4200);

  const signedInAgain = async () => {
    const client = await clients.open();
    expect((await signIn(client, app.users.alice)).status()).toBe(200);
    return client;
  };
  const readOrder = async (client, id) => (await (await client.get(`/api/orders/${id}`)).json()).order;

  await test.step('the injected failure returns 503 and commits neither receipt nor fulfillment', async () => {
    await app.restart({ failFulfillmentOnce: true });
    const client = await signedInAgain();
    expect(await readOrder(client, order.id), 'order survived the restart').toEqual(order);

    const failed = await deliverPayment(client, app, body);
    expect(failed.status()).toBe(503);
    expect(await failed.json()).toEqual({ error: 'fulfillment_unavailable' });

    expect(await readOrder(client, order.id)).toEqual(order);
    expect(receiptsFor(await clients.state(), order.id)).toEqual([]);
  });

  await test.step('retrying the same event in the same process succeeds once', async () => {
    const client = await clients.open();
    const retry = await deliverPayment(client, app, body);
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual({ received: true, duplicate: false, order_id: order.id });
    expect(receiptsFor(await clients.state(), order.id)).toHaveLength(1);
  });

  await test.step('a restart between the failure and the retry leaves nothing half-committed', async () => {
    await app.restart({ failFulfillmentOnce: true });
    const crashBody = paymentEvent(crashWindowOrder.id, 3 * PRICE['TEA-50']);
    const failed = await deliverPayment(await clients.open(), app, crashBody);
    expect(failed.status()).toBe(503);

    await app.restart();
    const client = await signedInAgain();
    expect(await readOrder(client, crashWindowOrder.id)).toEqual(crashWindowOrder);
    expect(receiptsFor(await clients.state(), crashWindowOrder.id)).toEqual([]);

    const retry = await deliverPayment(client, app, crashBody);
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toEqual({ received: true, duplicate: false, order_id: crashWindowOrder.id });
  });

  await test.step('after another restart both orders stay paid once and redelivery is a duplicate', async () => {
    await app.restart();
    const client = await signedInAgain();
    for (const id of [order.id, crashWindowOrder.id]) {
      expect(await readOrder(client, id)).toEqual(expect.objectContaining({ status: 'paid', fulfillment_count: 1 }));
    }
    const repeat = await deliverPayment(client, app, body);
    expect(repeat.status()).toBe(200);
    expect(await repeat.json()).toEqual({ received: true, duplicate: true, order_id: order.id });

    const state = await clients.state();
    expect(receiptsFor(state, order.id)).toHaveLength(1);
    expect(receiptsFor(state, crashWindowOrder.id)).toHaveLength(1);
    expect(orderIn(state, order.id).fulfillment_count).toBe(1);
  });
});
