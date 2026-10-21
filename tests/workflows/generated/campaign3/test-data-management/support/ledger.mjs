import { canonicalItems } from '../factories/order.factory.mjs';

// The ledger is the single record of what a scope created. Every assertion
// about "my data" derives from it; nothing is ever read back from the Shop and
// then trusted as the expectation. The Shop cannot delete, so the ledger is
// also what the durable state is reconciled against.
export class Ledger {
  constructor({ scope, userId }) {
    this.scope = scope;
    this.userId = userId;
    this.entries = [];
  }

  record(type, data) {
    const entry = { seq: this.entries.length + 1, type, ...data };
    this.entries.push(entry);
    return entry;
  }

  ofType(type) { return this.entries.filter(entry => entry.type === type); }
  orders() { return this.ofType('order'); }
  receipts() { return this.ofType('receipt'); }
  resets() { return this.ofType('reset-request'); }
  orderIds() { return new Set(this.orders().map(order => order.id)); }
  owns(id) { return this.orderIds().has(id); }
  findOrder(id) { return this.orders().find(order => order.id === id); }

  markPaid(orderId, eventId) {
    const order = this.findOrder(orderId);
    if (order) { order.status = 'paid'; order.fulfillment_count = 1; }
    return this.record('receipt', { eventId, orderId, ownedOrder: Boolean(order) });
  }

  markResetConsumed(userId) {
    const open = this.resets().find(reset => reset.userId === userId && !reset.consumed);
    if (open) open.consumed = true;
    this.record('sessions-cleared', { userId });
    return open;
  }

  // The ORDER shape the contract promises, derived from the ledger alone.
  expectedOrders() {
    return this.orders().map(order => ({
      id: order.id,
      user_id: order.user_id,
      currency: order.currency,
      amount: order.amount,
      items: canonicalItems(order.items),
      status: order.status,
      fulfillment_count: order.fulfillment_count,
    }));
  }

  expectedSessions() {
    let count = 0;
    for (const entry of this.entries) {
      if (entry.type === 'login') count += 1;
      else if (entry.type === 'logout') count = Math.max(0, count - 1);
      else if (entry.type === 'sessions-cleared' && entry.userId === this.userId) count = 0;
    }
    return count;
  }

  summary() {
    const counts = {};
    for (const entry of this.entries) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    return { scope: this.scope, userId: this.userId, counts };
  }

  toJSON() { return { scope: this.scope, userId: this.userId, entries: this.entries }; }
}

export function orderView(order) {
  return {
    id: order.id,
    user_id: order.user_id,
    currency: order.currency,
    amount: order.amount,
    items: canonicalItems(order.items),
    status: order.status,
    fulfillment_count: order.fulfillment_count,
  };
}

// Compare /test-support/state with one or more ledgers. With exclusive=true
// (a Shop this test owns) anything in the state the ledgers do not explain is
// a finding; with exclusive=false (a shared Shop) only the ledgers' own
// records are checked.
export function reconcileState(state, ledgers, { exclusive = true } = {}) {
  // Accepts scopes (which carry .ledger) or bare ledgers.
  const list = (Array.isArray(ledgers) ? ledgers : [ledgers]).map(item => item.ledger ?? item);
  const result = { missingOrders: [], mismatchedOrders: [], unexpectedOrders: [],
    missingReceipts: [], unexpectedReceipts: [], resetTokens: [], sessions: [] };

  const expectedOrders = new Map(list.flatMap(ledger => ledger.expectedOrders()).map(order => [order.id, order]));
  const actualOrders = new Map((state.orders ?? []).map(order => [order.id, orderView(order)]));
  for (const [id, expected] of expectedOrders) {
    const actual = actualOrders.get(id);
    if (!actual) result.missingOrders.push(id);
    else if (JSON.stringify(actual) !== JSON.stringify(expected)) result.mismatchedOrders.push({ id, expected, actual });
  }
  if (exclusive) for (const id of actualOrders.keys()) if (!expectedOrders.has(id)) result.unexpectedOrders.push(id);

  const expectedReceipts = new Map(list.flatMap(ledger => ledger.receipts()).map(receipt => [receipt.eventId, receipt.orderId]));
  const actualReceipts = new Map((state.receipts ?? []).map(receipt => [receipt.id, receipt.order_id]));
  for (const [eventId, orderId] of expectedReceipts) {
    if (actualReceipts.get(eventId) !== orderId) result.missingReceipts.push({ eventId, orderId, actual: actualReceipts.get(eventId) ?? null });
  }
  if (exclusive) for (const eventId of actualReceipts.keys()) if (!expectedReceipts.has(eventId)) result.unexpectedReceipts.push(eventId);

  // reset_tokens carry no id; compare per-user counts and consumed flags.
  const perUser = userId => (list.flatMap(ledger => ledger.resets()).filter(reset => reset.userId === userId));
  const users = new Set([...list.flatMap(ledger => ledger.resets()).map(reset => reset.userId), ...(state.reset_tokens ?? []).map(token => token.user_id)]);
  for (const userId of users) {
    const expected = perUser(userId).map(reset => Boolean(reset.consumed)).sort();
    const actual = (state.reset_tokens ?? []).filter(token => token.user_id === userId).map(token => Boolean(token.consumed)).sort();
    const comparable = exclusive ? actual : actual.slice(0, expected.length);
    if (JSON.stringify(expected) !== JSON.stringify(comparable)) result.resetTokens.push({ userId, expected, actual });
  }

  if (exclusive) {
    const expectedSessions = {};
    for (const ledger of list) expectedSessions[ledger.userId] = (expectedSessions[ledger.userId] ?? 0) + ledger.expectedSessions();
    const actualSessions = state.sessions ?? {};
    const userIds = new Set([...Object.keys(expectedSessions), ...Object.keys(actualSessions)]);
    for (const userId of userIds) {
      if ((expectedSessions[userId] ?? 0) !== (actualSessions[userId] ?? 0)) {
        result.sessions.push({ userId, expected: expectedSessions[userId] ?? 0, actual: actualSessions[userId] ?? 0 });
      }
    }
  }

  result.clean = Object.values(result).every(value => !Array.isArray(value) || value.length === 0);
  return result;
}
