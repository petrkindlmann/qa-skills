// Detector self-check (AGENTS.md: exercise a known-good and a deliberately broken case).
// Run: node tests/workflows/generated/campaign3/analytics-tracking-testing/selfcheck-validator.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateEvent } from './helpers/validate.mjs';

const plan = JSON.parse(await readFile(new URL('./tracking-plan.json', import.meta.url), 'utf8'));
const good = { transaction_id: 'ord-1', value: 42, currency: 'EUR', items: [{ item_id: 'TEA-50', quantity: 2 }] };
assert.deepEqual(validateEvent(plan, 'purchase', good), []);
assert.deepEqual(validateEvent(plan, 'login', { method: 'password' }), []);

const broken = { transaction_id: '', value: '42.00', currency: 'EUR', items: [{ item_id: 'TEA-50' }] };
const violations = validateEvent(plan, 'purchase', broken);
assert.deepEqual(violations, [
  { param: 'transaction_id', problem: 'type', expected: 'nonempty string' },
  { param: 'value', problem: 'type', expected: 'finite number' },
  { param: 'items[0].quantity', problem: 'missing' },
]);
assert.deepEqual(validateEvent(plan, 'purchase', { value: 4200 }), [
  { param: 'transaction_id', problem: 'missing' },
  { param: 'currency', problem: 'missing' },
  { param: 'items', problem: 'missing' },
]);
assert.deepEqual(validateEvent(plan, 'refund', good), [{ param: 'refund', problem: 'missing', expected: 'event in plan' }]);
assert.deepEqual(validateEvent(plan, 'purchase', { ...good, items: [] }), [{ param: 'items', problem: 'type', expected: 'nonempty array' }]);
console.log('validator self-check: 2 good payloads pass; broken payloads produce the expected', violations.length, '+ 3 + 1 + 1 violations');
