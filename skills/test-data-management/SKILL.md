---
name: test-data-management
description: >-
  Create and manage test data with factory patterns, fixture strategies, data
  anonymization, and synthetic data generation. Covers Fishery (TypeScript),
  FactoryBot (Ruby), Factory Boy (Python), database seeding, cleanup strategies,
  and GDPR-compliant data handling. Use when: "test data," "fixtures," "factories,"
  "seed data," "synthetic data," "test database," "data anonymization."
  Related: test-environments, database-testing, api-testing, unit-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: infrastructure
---

# Test Data Management Skill

Create, maintain, and clean up test data that is deterministic, isolated, realistic, and safe. Good test data is the foundation of reliable tests -- without it, tests are either flaky (shared mutable state), unrealistic (hardcoded nonsense values), or dangerous (production PII in test environments).

---

## Discovery Questions

Before designing a test data strategy, understand the current state. Check `.agents/qa-project-context.md` first -- if it exists, use it as the foundation and skip questions already answered there.

### Current Data Practices
- How is test data created today? (manually, scripts, copy of production, none)
- Do tests share data or does each test create its own?
- How is test data cleaned up? (truncate, rollback, manual, never)
- Are there seed scripts? Are they idempotent?

### Privacy and Compliance
- Does the product handle PII? (names, emails, addresses, phone numbers, SSNs)
- Are there GDPR, HIPAA, PCI-DSS, or other data protection requirements?
- Is production data ever used in test environments?

### Scale and Complexity
- How large are the test datasets? (dozens of records, thousands, millions)
- How complex are the data relationships? (simple CRUD, deep nested hierarchies, polymorphic)
- Are there cross-service data dependencies? (microservices sharing data)

---

## Core Principles

### 1. Each Test Owns Its Data
Tests that rely on pre-existing shared data are fragile. When Test A modifies shared data, Test B breaks. Every test should create exactly the data it needs, verify against that data, and clean up after itself. This enables parallel execution and eliminates ordering dependencies.

### 2. Factories Over Fixtures for Dynamic Data
Static fixtures (JSON/YAML files) are appropriate for reference data that does not change (country codes, currency lists). For entity data that tests create and manipulate (users, orders, products), use factory functions that generate fresh instances with sensible defaults and allow per-test overrides.

### 3. Anonymize Production Data Before Use
Production databases contain the most realistic data, but they also contain real user information. Never copy production data to test environments without anonymization. Replace PII with synthetic equivalents while preserving data distributions and relationships.

### 4. Deterministic Data Enables Reproducible Tests
Tests should produce the same results regardless of when or where they run. Avoid `Math.random()`, `Date.now()`, or auto-increment IDs in assertions. Use seeded random generators, fixed timestamps, and explicit IDs where possible.

### 5. Minimize Data, Maximize Signal
Create only the data each test needs. A test for user search does not need a complete user profile with billing address, payment method, and order history. Over-specified test data obscures the intent of the test and increases maintenance burden.

---

## Factory Patterns

Factories are functions that produce test data with sensible defaults, allowing individual tests to override only what matters for their scenario.

### Fishery (TypeScript)

Fishery is the recommended factory library for TypeScript projects. It provides type safety, traits, sequences, associations, and transient parameters.

```bash
npm install --save-dev fishery @faker-js/faker
```

```typescript
// tests/factories/user.factory.ts
import { Factory } from 'fishery';
import { faker } from '@faker-js/faker';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  organizationId: string;
  createdAt: Date;
  isActive: boolean;
}

export const userFactory = Factory.define<User>(({ sequence, params }) => ({
  id: `user-${sequence}`,
  email: `user-${sequence}@test.example.com`,
  name: faker.person.fullName(),
  role: params.role ?? 'member',
  organizationId: params.organizationId ?? `org-${sequence}`,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  isActive: true,
}));

// Trait variants
const adminUser = userFactory.params({ role: 'admin' });
const orgMembers = userFactory.params({ organizationId: 'org-shared' });
```

#### Using in Tests

```typescript
import { userFactory } from '../factories/user.factory';

const user = userFactory.build();                                        // Sensible defaults
const admin = userFactory.build({ role: 'admin' });                      // Override specific fields
const users = userFactory.buildList(5);                                   // Build multiple
const orgMembers = userFactory.buildList(3, { organizationId: 'org-1' }); // With associations
```

#### Associations Between Factories

```typescript
// tests/factories/order.factory.ts
import { Factory } from 'fishery';
import { userFactory } from './user.factory';

interface Order {
  id: string;
  userId: string;
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  totalCents: number;
  status: 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled';
}

export const orderFactory = Factory.define<Order>(({ sequence }) => {
  const items = [{ productId: `prod-${sequence}`, quantity: 2, unitPrice: 1999 }];
  return {
    id: `order-${sequence}`,
    userId: userFactory.build().id,
    items,
    totalCents: items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
    status: 'pending',
  };
});
```

### FactoryBot (Ruby)

```ruby
# spec/factories/users.rb
FactoryBot.define do
  factory :user do
    sequence(:email) { |n| "user-#{n}@test.example.com" }
    name { Faker::Name.name }
    role { :member }
    organization
    trait :admin do role { :admin } end
    trait :inactive do is_active { false } end
  end
end

# Usage: create(:user), create(:user, :admin), create_list(:user, 3, :inactive)
```

### Factory Boy (Python)

```python
# tests/factories.py
import factory
from myapp.models import User

class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
    email = factory.Sequence(lambda n: f"user-{n}@test.example.com")
    name = factory.Faker("name")
    role = "member"
    class Params:
        admin = factory.Trait(role="admin")
        inactive = factory.Trait(is_active=False)

# Usage: UserFactory(), UserFactory(admin=True), UserFactory.create_batch(3, inactive=True)
```

### When to Use Factories vs Fixtures

| Scenario | Factories | Static Fixtures |
|----------|-----------|----------------|
| Entity data that tests create/modify | Yes | No |
| Reference data (countries, currencies, configs) | No | Yes |
| Data with many variations per test | Yes | No -- file explosion |
| Data with complex relationships | Yes -- associations | No -- hard to maintain |
| API response mocks | No | Yes -- JSON fixtures |
| Snapshot/golden file comparisons | No | Yes |

**Decision rule:** If the data has a lifecycle (created, modified, deleted during tests), use a factory. If the data is read-only reference material, use a fixture file.

---

## Fixture Strategies

### Static Fixtures (JSON/YAML)

Best for API response mocks, configuration data, and golden file comparisons.

```typescript
// Using JSON fixtures in Playwright tests
import productsResponse from '../fixtures/data/api-responses/products.json';

test('displays products from API', async ({ page }) => {
  await page.route('**/api/products*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(productsResponse) });
  });
  await page.goto('/products');
  await expect(page.getByText('Widget')).toBeVisible();
});
```

### Dynamic Fixtures (Playwright)

Use Playwright fixtures to create and clean up data per test:

```typescript
// e2e/fixtures/data.fixture.ts
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ testOrder: { id: string; userId: string } }>({
  testOrder: async ({ request }, use) => {
    const response = await request.post('/api/test/orders', {
      data: { userId: `test-user-${Date.now()}`, items: [{ productId: 'prod-1', quantity: 1 }] },
    });
    expect(response.ok()).toBeTruthy();
    const order = await response.json();
    await use(order);
    await request.delete(`/api/test/orders/${order.id}`);
  },
});
```

### Fixture Composition

Compose fixtures from smaller, reusable pieces by combining factory-generated data with Playwright fixtures:

```typescript
// e2e/fixtures/composed.fixture.ts
import { test as base } from '@playwright/test';
import { userFactory } from '../factories/user.factory';
import { orderFactory } from '../factories/order.factory';

export const test = base.extend<{ seedData: { user: { id: string }; orders: Array<{ id: string }> } }>({
  seedData: async ({ request }, use) => {
    const resp = await request.post('/api/test/seed', {
      data: { user: userFactory.build(), orders: orderFactory.buildList(3) },
    });
    const seedData = await resp.json();
    await use(seedData);
    await request.post('/api/test/cleanup', { data: { userId: seedData.user.id } });
  },
});
```

---

## Data Anonymization

When production data is needed for realistic testing, anonymize it before use.

### PII Masking Rules

| Data Type | Anonymization Method | Example |
|-----------|---------------------|---------|
| Email | Faker email with original domain pattern | `jane.doe@acme.com` -> `user-7291@test.example.com` |
| Full name | Faker name | `Jane Doe` -> `Alice Johnson` |
| Phone number | Faker phone, preserve format | `+1-555-123-4567` -> `+1-555-987-6543` |
| Address | Faker address, preserve country/region | `123 Main St, NYC` -> `456 Oak Ave, NYC` |
| SSN/National ID | Test pattern | `123-45-6789` -> `000-00-0001` |
| Credit card | Test card numbers | `4111-...` -> `4242-4242-4242-4242` |
| Date of birth | Shift by fixed offset | `1990-03-15` -> `1987-07-22` |

### Anonymization with Faker.js

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
    dateOfBirth: faker.date.birthdate({ min: 18, max: 80, mode: 'age' }),
    ssn: `000-00-${String(index + 1).padStart(4, '0')}`,
  };
}
```

### Referential Integrity During Anonymization

Anonymizing a user's email must also update their email in orders, comments, audit logs, and every other table that references it. Build an anonymization pipeline that:

1. Maps original values to anonymized values in a lookup table
2. Processes parent records first, then child records using the same lookup
3. Validates referential integrity after anonymization
4. Runs in a transaction so partial anonymization cannot occur

### GDPR Compliance Checklist

- [ ] No real PII exists in any non-production environment
- [ ] Anonymization is irreversible (no lookup table mapping back to originals is stored)
- [ ] Anonymization preserves data distributions (age ranges, geographic spread) for realistic testing
- [ ] Anonymized data cannot be re-identified through combination of quasi-identifiers
- [ ] Data retention policies apply to test environments (auto-delete after N days)
- [ ] The anonymization pipeline runs automatically, not manually (eliminates human error)

---

## Database Seeding

### Idempotent Seed Scripts

Seed scripts should be safe to run multiple times without duplicating data. Use upsert patterns (`ON CONFLICT ... DO UPDATE`) for idempotency.

### Per-Test vs Per-Suite Data

| Strategy | When to Use | Pros | Cons |
|----------|------------|------|------|
| Per-test setup/teardown | Tests that modify data | Full isolation, parallel-safe | Slower, more setup code |
| Per-suite seed | Read-only reference data | Fast, simple | Cannot be modified by tests |
| Per-worker seed | Playwright parallel workers | Balances speed and isolation | Requires worker-scoped fixtures |
| Global seed | Environment bootstrap | Runs once, sets up baseline | Must be idempotent, shared state risk |

### Cleanup Strategies

**Transaction Rollback (Fastest):** Wrap each test in a transaction and roll back after. Works for unit and integration tests with direct DB access.

```typescript
let tx: Transaction;
beforeEach(async () => { tx = await db.beginTransaction(); });
afterEach(async () => { await tx.rollback(); });
```

**Truncation (Thorough):** Delete all data from test tables between suites. Use `TRUNCATE TABLE ... CASCADE` for efficiency.

**API-Based Cleanup (E2E Tests):** For E2E tests that cannot access the database directly, register resources for cleanup via a fixture:

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

---

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

---

## Anti-Patterns

### Shared Mutable Test Data
Multiple tests reading and writing the same database rows. Test A creates a user, Test B modifies it, Test C asserts on the original state and fails. Fix by having each test create its own data through factories.

### Production Data Without Anonymization
Copying the production database to staging for "realistic testing." This violates GDPR, risks data breaches in less-secured environments, and creates compliance liability. Always anonymize before use, or generate synthetic data that matches production distributions.

### Non-Deterministic Data
Using `Math.random()` or `Date.now()` in test data creation without seeding. Tests pass on Monday and fail on Tuesday because the random name generated happens to exceed a field length limit. Use seeded Faker instances and fixed timestamps.

### No Cleanup Strategy
Tests that create data and never clean it up. The test database grows until it affects performance, or stale data causes false positives in other tests. Every data creation must have a corresponding cleanup.

### Fixture File Explosion
Creating a separate JSON fixture file for every test variation. Instead of `user-admin.json`, `user-inactive.json`, `user-admin-inactive.json`, use a factory with traits. Fixtures should be reserved for static reference data and API response mocks.

### Over-Specified Test Data
Creating a complete user object with 30 fields when the test only cares about `role`. This obscures intent and makes tests brittle. Factories with sensible defaults solve this: override only what the test cares about.

### Hard-Coded IDs
Using `userId: '1'` in tests. This couples tests to database state and breaks when running in parallel (ID collision) or against a database with existing data. Use factory sequences or UUIDs.

---

## Related Skills

- **unit-testing** -- Unit tests are the primary consumer of factory-generated data; this skill provides the data layer.
- **api-testing** -- API tests use both factories (for request bodies) and fixtures (for mocked responses).
- **playwright-automation** -- E2E tests need test data seeded via API or fixtures before browser interaction.
- **test-reliability** -- Deterministic test data eliminates a major source of test flakiness.
- **ci-cd-integration** -- Database seeding and cleanup must be integrated into CI pipeline stages.
