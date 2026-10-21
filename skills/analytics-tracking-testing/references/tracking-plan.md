# The Tracking Plan as a Typed Contract

A tracking plan describes logical event payloads. Keep it versioned and use the same
contract in application and test code. Required types and per-scenario expected values
serve different purposes: check both. A schema alone accepts the wrong finite price.

## Ecommerce plan

Google's [ecommerce guide](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
puts `currency` and `value` at event level and product details in `items[]`. For GTM
object pushes, these fields are normally inside `ecommerce`; for gtag event commands,
they are in the event payload. The example below is an application contract requiring
an ID, price and quantity per item, which is stricter than Google's minimum fields.
Take the required fields from the application's own contract: an application whose
items carry no price must not be made to fail a plan copied from this example. Keep
the scenario literals (`currency: "EUR"`, `method: "password"`) versioned beside the
schema in an `expected` block per event that the validator ignores and the tests read,
so that a literal change is a plan change and not a hidden edit in one test.

```json
{
  "add_to_cart": {
    "required": {
      "currency": "string",
      "value": "number",
      "items": { "array": { "item_id": "string", "price": "number", "quantity": "number" } }
    }
  },
  "purchase": {
    "required": {
      "transaction_id": "string",
      "currency": "string",
      "value": "number",
      "items": { "array": { "item_id": "string", "price": "number", "quantity": "number" } }
    }
  }
}
```

## Validate normalized payloads

Pass a logical JavaScript payload, not `URLSearchParams`. The browser web-tag transport
has reserved fields and item encodings; `ep.<name>` / `epn.<name>` are not a universal
mapping for standard ecommerce. Use a version-specific decoder checked against actual
redacted tag captures for network events. Keep a numeric wire field missing/blank/invalid
as an error; coercing `null` or an empty string with `Number()` creates a false zero.
Do not strip wire type information before checking it. Input validation and network
emission are separate observations, and neither proves downstream ingestion.

This helper supports nonempty strings, finite numbers, and nonempty arrays of required
objects. Add a reviewed schema for booleans, enums, ranges, optional values or other
structures. An unsupported or empty plan is a configuration error, not a passing check.

```ts
type Rule = 'string' | 'number' | { array: Record<string, Rule> };
type Plan = Record<string, { required: Record<string, Rule> }>;
type Violation = { param: string; problem: 'missing' | 'type'; expected?: string };

export function validateEvent(plan: Plan, eventName: string, payload: unknown): Violation[] {
  const object = (value: unknown): value is Record<string, any> => value !== null
    && typeof value === 'object' && !Array.isArray(value);
  if (!object(plan)) throw new Error('Tracking plan must be an object');
  if (!Object.hasOwn(plan, eventName)) return [{ param: eventName, problem: 'missing', expected: 'event in plan' }];
  const required = plan[eventName]?.required;
  const checkRules = (rules: Record<string, Rule>) => {
    if (!object(rules) || !Object.keys(rules).length) throw new Error('Required tracking fields must be nonempty');
    for (const rule of Object.values(rules)) {
      if (rule === 'string' || rule === 'number') continue;
      if (!object(rule) || Object.keys(rule).length !== 1 || !Object.hasOwn(rule, 'array')) {
        throw new Error('Unsupported tracking field rule');
      }
      checkRules(rule.array);
    }
  };
  checkRules(required);
  const violations: Violation[] = [];
  const inspect = (rules: Record<string, Rule>, value: unknown, prefix: string) => {
    if (!object(value)) { violations.push({ param: prefix || eventName, problem: 'type', expected: 'object' }); return; }
    for (const [name, rule] of Object.entries(rules)) {
      const param = prefix ? `${prefix}.${name}` : name;
      if (!Object.hasOwn(value, name) || value[name] === undefined) {
        violations.push({ param, problem: 'missing' }); continue;
      }
      const actual = value[name];
      if (rule === 'string') {
        if (typeof actual !== 'string' || !actual.trim()) violations.push({ param, problem: 'type', expected: 'nonempty string' });
      } else if (rule === 'number') {
        if (typeof actual !== 'number' || !Number.isFinite(actual)) violations.push({ param, problem: 'type', expected: 'finite number' });
      } else if (!Array.isArray(actual) || actual.length === 0) {
        violations.push({ param, problem: 'type', expected: 'nonempty array' });
      } else {
        for (let i = 0; i < actual.length; i++) inspect(rule.array, actual[i], `${param}[${i}]`);
      }
    }
  };
  inspect(required, payload, '');
  return violations;
}
```

## Use both schema and scenario assertions

```ts
import { expect } from '@playwright/test';
import plan from './tracking-plan.json';
import { validateEvent } from './validate';
// In an ESM .mjs suite a bare JSON import needs `with { type: 'json' }` under Node 22+;
// if the test runner's loader is in doubt, read the file once in a small loader
// (readFileSync + JSON.parse) and export the parsed plan instead.

// viewItem is an observed GTM object event from the passive data-layer observer.
expect(validateEvent(plan, 'add_to_cart', addToCart.ecommerce)).toEqual([]);
expect(addToCart.ecommerce).toMatchObject({
  currency: 'USD', value: 49.99,
  items: [{ item_id: 'SKU-42', price: 49.99, quantity: 1 }],
});
```

For a network assertion, decode the observed web-tag payload through the application's
capture-tested adapter, then run the same validator and scenario assertions. Missing
or unsupported wire fields must fail that adapter. Do not fabricate a decoder by
assuming every logical field is an `ep.` key, and do not count a gtag/dataLayer input
object as evidence that a beacon left the browser.
