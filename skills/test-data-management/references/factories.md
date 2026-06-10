# Factory & Fixture Patterns

Full implementations for Fishery (TypeScript), FactoryBot (Ruby), Factory Boy (Python),
and Playwright fixtures. Cited from `SKILL.md` (Factory Patterns and Fixture Strategies).

Factories are functions that produce test data with sensible defaults, allowing individual
tests to override only what matters for their scenario.

## Fishery (TypeScript)

Fishery (2.4.0) is the recommended factory library for TypeScript projects. It provides type
safety, traits, sequences, associations, and transient parameters.

```bash
npm install --save-dev fishery @faker-js/faker
```

> **Faker v10 (latest v10.4.0) needs modern Node.** v10 is ESM-only but still loads from
> CommonJS via Node's `require(esm)` support on **Node 20.19+ / 22.13+ / 24+**. Pin
> `@faker-js/faker@^9` only if you must support older Node or a bundler that lacks
> `require(esm)`. On supported Node, `require('@faker-js/faker')` works in v10 — no migration
> needed.

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

### Using in Tests

```typescript
import { userFactory } from '../factories/user.factory';

const user = userFactory.build();                                        // Sensible defaults
const admin = userFactory.build({ role: 'admin' });                      // Override specific fields
const users = userFactory.buildList(5);                                   // Build multiple
const orgMembers = userFactory.buildList(3, { organizationId: 'org-1' }); // With associations
```

### Associations Between Factories

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

### Deterministic IDs for Snapshot Assertions

Sequences (`user-${sequence}`) already produce stable IDs. When a field genuinely needs a UUID
that must stay stable across runs (e.g. snapshot/golden comparisons), seed Faker first so
`faker.string.uuid()` is reproducible:

```typescript
import { faker } from '@faker-js/faker';
faker.seed(42); // Same UUID sequence on every run
const stableId = faker.string.uuid(); // deterministic under the seed
```

Never use a raw `crypto.randomUUID()` in data you assert on — it changes every run and breaks
snapshots.

## FactoryBot (Ruby)

FactoryBot (6.6.0, thoughtbot). The Product example below shows the `out_of_stock` and
`discounted` traits with a price field:

```ruby
# spec/factories/products.rb
FactoryBot.define do
  factory :product do
    sequence(:name) { |n| "Product #{n}" }
    price { Faker::Commerce.price(range: 1.0..500.0) }
    category { Faker::Commerce.department }
    stock { 50 }
    trait :out_of_stock do stock { 0 } end
    trait :discounted do price { 9.99 } end
  end
end

# Usage: create(:product), create(:product, :out_of_stock), create(:product, :discounted)
```

A User factory with `:admin` / `:inactive` traits and an association:

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

## Factory Boy (Python)

factory-boy (3.3.3). Use `class Params` with `factory.Trait` for variant flags:

```python
# tests/factories.py
import factory
from myapp.models import User

class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
    email = factory.Sequence(lambda n: f"user-{n}@test.example.com")
    username = factory.Sequence(lambda n: f"user{n}")
    name = factory.Faker("name")
    role = "member"
    is_active = True
    class Params:
        admin = factory.Trait(role="admin")
        inactive = factory.Trait(is_active=False)

# Usage: UserFactory(), UserFactory(admin=True), UserFactory.create_batch(3, inactive=True)
# Multiple users with different is_active values:
active_users = UserFactory.create_batch(2)
inactive_users = UserFactory.create_batch(2, inactive=True)
```

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
import { userFactory } from '../factories/user.factory';

export const test = base.extend<{ testOrder: { id: string; userId: string } }>({
  testOrder: async ({ request }, use) => {
    // Unique userId from the factory sequence -- never `Date.now()` (Core Principle 4)
    const response = await request.post('/api/test/orders', {
      data: { userId: userFactory.build().id, items: [{ productId: 'prod-1', quantity: 1 }] },
    });
    expect(response.ok()).toBeTruthy();
    const order = await response.json();
    await use(order);
    await request.delete(`/api/test/orders/${order.id}`);
  },
});
```

### Fixture Composition

Compose fixtures from smaller, reusable pieces by combining factory-generated data with
Playwright fixtures:

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

### Worker-Scoped Seeding (Playwright parallel workers)

A worker-scoped fixture seeds baseline reference data once per parallel worker instead of once
per test — balancing speed and isolation. Use it for read-only data that every test in a worker
shares; keep mutable data per-test.

```typescript
// e2e/fixtures/worker-seed.fixture.ts
import { test as base } from '@playwright/test';

export const test = base.extend<{}, { workerSeed: { orgId: string } }>({
  workerSeed: [async ({}, use, workerInfo) => {
    const orgId = `org-w${workerInfo.parallelIndex}`;
    // seed baseline rows scoped to this worker's org so workers never collide
    await seedOrg(orgId);
    await use({ orgId });
    await cleanupOrg(orgId);
  }, { scope: 'worker' }],
});
```
