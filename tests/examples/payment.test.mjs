import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunctions } from './snippets.mjs';

const source = 'skills/payment-testing/references/webhooks-and-clocks.md';
function fixture({ failFirst = false } = {}) {
  // This transaction adapter deliberately enforces rollback. It tests the exact
  // documented handler's use of the transaction, not a Stripe or PostgreSQL service.
  const state = { processed: new Set(), fulfilled: new Set(), calls: 0 };
  const client = {
    async query(sql, values) {
      if (sql === 'BEGIN') this.snapshot = { processed: new Set(state.processed), fulfilled: new Set(state.fulfilled) };
      else if (sql === 'ROLLBACK') {
        state.processed = this.snapshot.processed;
        state.fulfilled = this.snapshot.fulfilled;
      } else if (sql.includes('INSERT INTO processed_events')) {
        if (state.processed.has(values[0])) return { rowCount: 0 };
        state.processed.add(values[0]);
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
    release() {},
  };
  const fulfill = async (_client, payment) => {
    state.calls++;
    if (failFirst && state.calls === 1) throw new Error('injected fulfillment failure');
    state.fulfilled.add(payment.id);
  };
  const { handleEvent } = loadFunctions(source, 'INSERT INTO processed_events', ['handleEvent'], {
    pool: { connect: async () => client }, db: client,
    fulfillOrderInTransaction: fulfill,
    fulfillOrder: payment => fulfill(client, payment),
  });
  const event = { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } };
  const deliver = async (evt = event) => {
    const response = { statusCode: 200, body: '', status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; } };
    await handleEvent(evt, response);
    return response;
  };
  return { state, deliver, event, client };
}

test('sequential redelivery fulfills once', async () => {
  const { state, deliver } = fixture();
  assert.equal((await deliver()).statusCode, 200);
  assert.equal((await deliver()).statusCode, 200);
  assert.equal(state.calls, 1);
  assert.equal(state.fulfilled.size, 1);
});

test('failure after dedup insertion remains retryable instead of losing fulfillment', async () => {
  const { state, deliver } = fixture({ failFirst: true });
  await assert.rejects(deliver(), /injected fulfillment failure/);
  assert.equal(state.processed.size, 0, 'a failed operation must not remain marked processed');
  assert.equal((await deliver()).statusCode, 200);
  assert.equal(state.calls, 2);
  assert.equal(state.fulfilled.has('pi_1'), true);
});

test('success commits before acknowledgment and releases its connection', async () => {
  const { client, deliver } = fixture();
  const commands = [];
  const original = client.query;
  client.query = async function(sql, values) { commands.push(sql); return original.call(this, sql, values); };
  client.release = () => commands.push('RELEASE');
  await deliver();
  assert.equal(commands[0], 'BEGIN');
  assert.deepEqual(commands.slice(-2), ['COMMIT', 'RELEASE']);
});

test('duplicate path closes the transaction before returning', async () => {
  const { client, deliver } = fixture();
  await deliver();
  const commands = [];
  const original = client.query;
  client.query = async function(sql, values) { commands.push(sql); return original.call(this, sql, values); };
  client.release = () => commands.push('RELEASE');
  await deliver();
  assert.deepEqual(commands.slice(-2), ['COMMIT', 'RELEASE']);
});
