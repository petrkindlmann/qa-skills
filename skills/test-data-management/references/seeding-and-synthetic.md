# Seeding, Anonymization & Synthetic Data

Full code for idempotent seeding, the anonymization pipeline, cleanup strategies, and synthetic
data generation. Cited from `SKILL.md` (Database Seeding, Data Anonymization, Synthetic Data).

## Idempotent Seed Scripts

Seed scripts must be safe to run multiple times without duplicating data. Use upsert
(`INSERT ... ON CONFLICT ... DO UPDATE`) keyed on a stable natural key — not the primary key —
so a re-run updates the existing row instead of inserting a duplicate.

```sql
-- seeds/reference_data.sql -- countries and currencies (reference data)
INSERT INTO countries (code, name, currency) VALUES
  ('US', 'United States', 'USD'),
  ('GB', 'United Kingdom', 'GBP'),
  ('JP', 'Japan',         'JPY')
ON CONFLICT (code) DO UPDATE
  SET name     = EXCLUDED.name,
      currency = EXCLUDED.currency;
```

`ON CONFLICT (code) DO UPDATE` matters because reference data (country codes, currency lists)
is seeded into every environment and CI run. Without it, a second run either errors on the
unique constraint or — if you wrote `DELETE` then `INSERT` to "reset" the table — is **not
idempotent**: the DELETE breaks foreign keys from rows created between runs and reassigns serial
IDs, so anything referencing those rows now points at the wrong record. Upsert leaves IDs and
foreign keys intact.

## Anonymization with Faker.js

When production data is needed for realistic testing, anonymize it before use.

```typescript
// scripts/anonymize.ts
import { faker } from '@faker-js/faker';
faker.seed(42); // Deterministic output across runs

function anonymizeUser(user: Record<string, unknown>, index: number) {
  return {
    ...user,
    email: `user-${index + 1}@test.example.com`,
    name: faker.person.fullName(),
    phone: faker.phone.number(),
    // faker.date.birthdate returns a Date -- serialize to ISO before a DB write
    dateOfBirth: faker.date.birthdate({ min: 18, max: 80, mode: 'age' }).toISOString(),
    ssn: `000-00-${String(index + 1).padStart(4, '0')}`,
  };
}
```

## Referential Integrity During Anonymization

Anonymizing a user's email must also update their email in orders, comments, audit logs, and
every other table that references it. Build an anonymization pipeline that:

1. Maps original values to anonymized values in a lookup table (in memory, for the duration of
   the run only).
2. Processes **parent records first**, then child records using the same lookup, so foreign
   keys stay consistent.
3. Validates referential integrity after anonymization.
4. Runs in a **transaction** so partial anonymization cannot occur.

```typescript
// scripts/anonymize-pipeline.ts -- sketch
const lookup = new Map<string, string>(); // origEmail -> anonEmail, never persisted

await db.transaction(async (tx) => {
  // parents first: users
  for (const [i, u] of users.entries()) {
    const anon = anonymizeUser(u, i);
    lookup.set(u.email as string, anon.email as string);
    await tx.users.update(u.id, anon);
  }
  // children: rewrite the FK email column using the same lookup
  for (const o of orders) {
    await tx.orders.update(o.id, { customerEmail: lookup.get(o.customerEmail) });
  }
});
```

The lookup is held in memory for the run and discarded — do **not** persist a reversible
mapping back to originals (that defeats GDPR irreversibility).

## Cleanup Strategies

**Transaction Rollback (Fastest):** Wrap each test in a transaction and roll back after. Works
for unit and integration tests with direct DB access. Not usable for E2E tests that hit the app
over HTTP — the app opens its own connections, so a test-side transaction can't roll back the
app's writes.

```typescript
let tx: Transaction;
beforeEach(async () => { tx = await db.beginTransaction(); });
afterEach(async () => { await tx.rollback(); });
```

**Truncation (Thorough):** Delete all data from test tables between suites. Use
`TRUNCATE TABLE ... CASCADE` for efficiency.

**API-Based Cleanup (E2E Tests):** For E2E tests that cannot access the database directly,
register resources for cleanup via a fixture and delete in reverse creation order (children
before parents):

```typescript
export const test = base.extend<{ cleanup: (id: string, type: string) => void }>({
  cleanup: async ({ request }, use) => {
    const toClean: Array<{ id: string; type: string }> = [];
    await use((id, type) => toClean.push({ id, type }));
    for (const r of toClean.reverse()) {
      await request.delete(`/api/test/${r.type}/${r.id}`);
    }
  },
});
```

## Synthetic Data Generation

### Edge Case Distributions

Factories should make it easy to generate edge case data:

```typescript
// tests/factories/edge-cases.ts
export const edgeCaseStrings = [
  '',                               // Empty string
  '  leading and trailing  ',       // Whitespace
  'a'.repeat(10_000),               // Very long string
  '<script>alert("xss")</script>',  // XSS attempt
  "Robert'); DROP TABLE users;--",  // SQL injection
  '\u0000\u0001\u0002',             // Null/control characters
  '\u202Eoverride\u202C',           // RTL override
];

export const edgeCaseDates = [
  new Date('1970-01-01T00:00:00Z'), // Unix epoch
  new Date('2038-01-19T03:14:07Z'), // 32-bit overflow
  new Date('2024-02-29T00:00:00Z'), // Leap day
  new Date('2025-03-09T02:30:00-05:00'), // During DST transition
];
```

### Boundary Value Generation

```typescript
export function boundaryValues(min: number, max: number): number[] {
  return [min - 1, min, min + 1, Math.floor((min + max) / 2), max - 1, max, max + 1];
}

// Usage
test.each(boundaryValues(1, 100).map(v => [v]))(
  'validates quantity %i correctly',
  (quantity) => {
    const result = validateQuantity(quantity);
    if (quantity >= 1 && quantity <= 100) {
      expect(result.valid).toBe(true);
    } else {
      expect(result.valid).toBe(false);
    }
  }
);
```
