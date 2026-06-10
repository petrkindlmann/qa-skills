# The Tracking Plan as a Typed Contract

The tracking plan is the single source of truth: for each event, its required params and their types. Keep it versioned and import it into both app and tests. Tests validate captured events against it — they do not hardcode expected values inline.

## JSON form

```json
{
  "add_to_cart": {
    "required": { "currency": "string", "value": "number", "item_id": "string" }
  },
  "purchase": {
    "required": { "transaction_id": "string", "value": "number", "currency": "string" }
  }
}
```

## YAML form (often easier for non-engineers to maintain)

```yaml
add_to_cart:
  required:
    currency: string
    value: number
    item_id: string
purchase:
  required:
    transaction_id: string
    value: number
    currency: string
```

## Zod-typed contract

```ts
import { z } from 'zod';

export const plan = {
  add_to_cart: z.object({ currency: z.string(), value: z.number(), item_id: z.string() }),
  purchase: z.object({ transaction_id: z.string(), value: z.number(), currency: z.string() }),
} as const;
```

## The validator — report violations, not a boolean

GA4 splits params into `ep.` (string) and `epn.` (number). The validator reads either prefix, then checks presence and type. It returns an array of violations — empty means the event satisfies the contract.

```ts
type Violation = { param: string; problem: 'missing' | 'type'; expected?: string };

export function validateEvent(
  plan: Record<string, { required: Record<string, 'string' | 'number'> }>,
  eventName: string,
  params: URLSearchParams,
): Violation[] {
  const spec = plan[eventName];
  if (!spec) return [{ param: eventName, problem: 'missing', expected: 'event in plan' }];

  const violations: Violation[] = [];
  for (const [name, type] of Object.entries(spec.required)) {
    const raw = params.get(`ep.${name}`) ?? params.get(`epn.${name}`);
    if (raw == null) { violations.push({ param: name, problem: 'missing' }); continue; }
    if (type === 'number' && Number.isNaN(Number(raw)))
      violations.push({ param: name, problem: 'type', expected: 'number' });
  }
  return violations;
}
```

## Reusable matcher

```ts
import plan from './tracking-plan.json';

export function assertAgainstPlan(eventName: string, params: URLSearchParams) {
  const violations = validateEvent(plan, eventName, params);
  expect(violations, `tracking-plan violations for ${eventName}: ${JSON.stringify(violations)}`).toEqual([]);
}
```

Usage in a test:

```ts
const params = new URL(request.url()).searchParams;
expect(params.get('en')).toBe('add_to_cart');
assertAgainstPlan('add_to_cart', params); // fails listing every missing/mismatched param
```

## Why external

A plan file gives one place to change when a param is renamed, makes the contract reviewable in PRs, and lets the same schema power the CI regression gate (see `ci-gating.md`). Inline hardcoded values rot on the first change and assert nothing about the params you forgot to list.
