import { catalogue, unitAmount } from './catalogue.mjs';
import { createSequence } from './prng.mjs';

// Named item sets. Use these instead of a fixture file per variation.
export const ITEMS = Object.freeze({
  contractExample: Object.freeze([{ sku: 'TEA-50', quantity: 2 }, { sku: 'CUP-01', quantity: 1 }]), // 4200
  singleTea: Object.freeze([{ sku: 'TEA-50', quantity: 1 }]),                                        // 1200
  maxQuantity: Object.freeze([{ sku: 'CUP-01', quantity: 10 }]),                                     // 18000
  unknownSku: Object.freeze([{ sku: 'NOPE-99', quantity: 1 }]),
  tooMany: Object.freeze([{ sku: 'TEA-50', quantity: 11 }]),
});

// The server stores items as a set and returns them sorted by SKU; the promise
// is made in that canonical shape so a read-back can be compared with toEqual.
export function canonicalItems(items) {
  return items.map(({ sku, quantity }) => ({ sku, quantity })).sort((a, b) => a.sku.localeCompare(b.sku));
}

function validOrder(items, currency) {
  if (currency !== catalogue.currency || items.length === 0) return false;
  if (new Set(items.map(item => item.sku)).size !== items.length) return false;
  return items.every(item => unitAmount(item.sku) !== undefined
    && Number.isInteger(item.quantity)
    && item.quantity >= catalogue.quantity.min && item.quantity <= catalogue.quantity.max);
}

export function orderFactory({ scope, prng }) {
  const nextSequence = createSequence();

  function defaultItems() {
    const pool = catalogue.products.map(product => product.sku);
    const count = prng.int(1, pool.length);
    const chosen = [];
    for (let i = 0; i < count; i++) chosen.push(pool.splice(prng.int(0, pool.length - 1), 1)[0]);
    return chosen.map(sku => ({ sku, quantity: prng.int(catalogue.quantity.min, catalogue.quantity.max) }));
  }

  // build(overrides) -> { sequence, idempotencyKey, payload, expected }
  //   payload  is what goes on the wire (POST /api/orders body)
  //   expected is what the Shop must hand back for it, or { rejected: code }
  function build(overrides = {}) {
    const sequence = nextSequence();
    const items = overrides.items ? overrides.items.map(item => ({ ...item })) : defaultItems();
    const currency = overrides.currency ?? catalogue.currency;
    const idempotencyKey = overrides.idempotencyKey ?? `${scope}.order-${sequence}`;
    const expected = validOrder(items, currency)
      ? {
          currency,
          amount: items.reduce((sum, item) => sum + unitAmount(item.sku) * item.quantity, 0),
          items: canonicalItems(items),
          status: 'pending',
          fulfillment_count: 0,
        }
      : { rejected: 'invalid_order' };
    return { sequence, idempotencyKey, payload: { currency, items }, expected };
  }

  function buildList(count, overrides) {
    return Array.from({ length: count }, () => build(overrides));
  }

  // Same key, same intent, items listed in another order: the Shop must replay.
  function permuted(built) {
    return { ...built, payload: { ...built.payload, items: [...built.payload.items].reverse() } };
  }

  // Same key, different intent: the Shop must refuse with idempotency_conflict.
  function conflicting(built) {
    const items = built.payload.items.map((item, index) => index === 0
      ? { ...item, quantity: item.quantity === catalogue.quantity.max ? item.quantity - 1 : item.quantity + 1 }
      : item);
    return { ...built, payload: { ...built.payload, items }, expected: { rejected: 'idempotency_conflict' } };
  }

  return { build, buildList, permuted, conflicting };
}
