# TDD and Pairing Code Examples

Runnable code for the dev/QA pairing and TDD facilitation sections. The decision prose, diagrams, and decision guides live in `SKILL.md`.

## Pairing on Test-First Design — Example Output

The artifact a QA + developer pairing session produces: agreed test signatures across unit, integration, and E2E levels before implementation begins.

```typescript
// Agreed test cases for: coupon code feature
// Unit tests (developer writes)
describe('CouponValidator', () => {
  test('accepts valid percentage coupon and returns discount amount');
  test('accepts valid fixed-amount coupon and returns discount amount');
  test('rejects expired coupon with COUPON_EXPIRED error');
  test('rejects already-redeemed single-use coupon with ALREADY_USED error');
  test('rejects coupon below minimum order amount with MIN_ORDER_NOT_MET error');
  test('caps percentage discount at product price (no negative totals)');
  test('handles currency rounding to 2 decimal places');
});

// Integration tests (developer or QA writes)
describe('POST /api/checkout/apply-coupon', () => {
  test('returns 200 with updated total when valid coupon applied');
  test('returns 400 with error code when coupon is expired');
  test('returns 409 when coupon already redeemed by this user');
  test('marks single-use coupon as redeemed after successful checkout');
});

// E2E tests (QA writes)
describe('Checkout coupon flow', () => {
  test('user applies valid coupon and sees discounted total');
  test('user sees clear error message for invalid coupon code');
  test('coupon discount persists through checkout to confirmation page');
});
```

## Red-Green-Refactor — Password Strength Validator

A full TDD walk-through: first failing test, minimum passing code, then a refactor that preserves behavior.

```typescript
// RED — write the first failing test
test('rejects passwords shorter than 8 characters', () => {
  expect(validatePassword('short')).toEqual({
    valid: false, errors: ['Password must be at least 8 characters'],
  });
});
// Run → FAIL (validatePassword does not exist yet)

// GREEN — write minimum code to pass
function validatePassword(password: string) {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Password must be at least 8 characters');
  return { valid: errors.length === 0, errors };
}
// Run → PASS. Now RED again: add test for uppercase, then GREEN, repeat.

// REFACTOR — after several RED-GREEN cycles, extract pattern
const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, message: 'Password must be at least 8 characters' },
  { test: (p: string) => /[A-Z]/.test(p), message: 'Must contain uppercase letter' },
  { test: (p: string) => /[0-9]/.test(p), message: 'Must contain a number' },
  { test: (p: string) => /[!@#$%^&*]/.test(p), message: 'Must contain special character' },
];

function validatePassword(password: string) {
  const errors = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.message);
  return { valid: errors.length === 0, errors };
}
// Run → ALL PASS (behavior unchanged, structure improved)
```

## TDD for Bugs — Failing Test First

Every bug fix starts with a failing test that reproduces the bug, then the fix turns it green.

```typescript
// BUG-4521: Discount rounds incorrectly for JPY (zero-decimal currency)
test('rounds JPY discount to whole number (no decimals)', () => {
  // JPY has no minor units — 1000 JPY is 1000, not 10.00
  const result = calculateDiscount({ amount: 1000, currency: 'JPY', percent: 15 });
  expect(result.discount).toBe(150);   // not 150.00
  expect(result.total).toBe(850);      // not 849.99
});
// RED: fails because current code returns 150.00

// Fix: check currency decimal places
// GREEN: passes after fix
// Commit with message: "fix(checkout): round JPY discounts to whole numbers (BUG-4521)"
```
