import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunctions } from './snippets.mjs';

const { validateEvent } = loadFunctions('skills/analytics-tracking-testing/references/tracking-plan.md',
  'function validateEvent(', ['validateEvent']);
const plan = { add_to_cart: { required: {
  currency: 'string', value: 'number',
  items: { array: { item_id: 'string', price: 'number', quantity: 'number' } },
} } };
const good = { currency: 'USD', value: 0, items: [{ item_id: 'FREE-1', price: 0, quantity: 1 }] };

test('a typed ecommerce event accepts real zero values and nested products', () => {
  assert.deepEqual(validateEvent(plan, 'add_to_cart', good), []);
});
test('blank, null, boolean and nonfinite numbers cannot become a passing zero', () => {
  for (const value of ['', ' ', '0', null, undefined, true, NaN, Infinity, -Infinity]) {
    assert.ok(validateEvent(plan, 'add_to_cart', { ...good, value }).some(v => v.param === 'value'));
  }
});
test('strings retain their type and nonempty requirement', () => {
  for (const currency of [12, null, false, '', ' ']) {
    assert.ok(validateEvent(plan, 'add_to_cart', { ...good, currency }).some(v => v.param === 'currency'));
  }
});
test('all missing and mismatched product fields have explicit locations', () => {
  const result = validateEvent(plan, 'add_to_cart', { ...good, items: [{ item_id: 'A', price: '0' }, {}] });
  assert.deepEqual(result.map(v => v.param), ['items[0].price', 'items[0].quantity', 'items[1].item_id', 'items[1].price', 'items[1].quantity']);
});
test('empty, malformed and sparse item arrays cannot satisfy ecommerce coverage', () => {
  for (const items of [[], null, {}, 'item', [null], Array(1)]) {
    assert.ok(validateEvent(plan, 'add_to_cart', { ...good, items }).length > 0);
  }
});
test('unknown events, inherited fields and wrong payload shapes cannot pass', () => {
  assert.ok(validateEvent(plan, 'purchase', good).length > 0);
  assert.ok(validateEvent(plan, 'toString', good).length > 0);
  for (const payload of [null, [], 'data', Object.create(good), new URLSearchParams('value=0')]) {
    assert.ok(validateEvent(plan, 'add_to_cart', payload).length > 0);
  }
});
test('invalid or unsupported plans are configuration errors', () => {
  for (const invalid of [null, [], { x: {} }, { x: { required: {} } },
    { x: { required: { value: 'integer' } } }, { x: { required: { items: { array: {} } } } }]) {
    assert.throws(() => validateEvent(invalid, 'x', {}));
  }
});
