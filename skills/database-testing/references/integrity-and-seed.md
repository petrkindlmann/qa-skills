# Data Integrity & Seed Data Code

Runnable code for constraint tests, referential integrity, seed factories, and transaction-rollback isolation. The decision prose lives in `SKILL.md`.

## Constraint Testing

```typescript
describe('Database constraints', () => {
  // NOT NULL
  it('should reject user without email', async () => {
    await expect(
      pool.query(`INSERT INTO users (id, name) VALUES ($1, $2)`,
        ['550e8400-e29b-41d4-a716-446655440001', 'Bob'])
    ).rejects.toThrow(/null value in column "email"/);
  });

  // UNIQUE
  it('should reject duplicate email', async () => {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2)`,
      ['550e8400-e29b-41d4-a716-446655440001', 'alice@example.com']);
    await expect(
      pool.query(`INSERT INTO users (id, email) VALUES ($1, $2)`,
        ['550e8400-e29b-41d4-a716-446655440002', 'alice@example.com'])
    ).rejects.toThrow(/unique constraint/i);
  });

  // FOREIGN KEY
  it('should reject order with nonexistent user', async () => {
    await expect(
      pool.query(`INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)`,
        ['ord-1', 'nonexistent-user-id', 100])
    ).rejects.toThrow(/foreign key constraint/i);
  });

  // CHECK constraint
  it('should reject negative order total', async () => {
    await expect(
      pool.query(`INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)`,
        ['ord-1', existingUserId, -50])
    ).rejects.toThrow(/check constraint/i);
  });

  // CASCADE behavior
  it('should cascade delete orders when user is deleted', async () => {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2)`,
      ['user-cascade', 'cascade@example.com']);
    await pool.query(`INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)`,
      ['ord-cascade', 'user-cascade', 100]);

    await pool.query('DELETE FROM users WHERE id = $1', ['user-cascade']);

    const orders = await pool.query('SELECT * FROM orders WHERE user_id = $1', ['user-cascade']);
    expect(orders.rows).toHaveLength(0);
  });
});
```

## Referential Integrity

```typescript
it('should not create orphan records', async () => {
  // Check for orders referencing nonexistent users
  const orphans = await pool.query(`
    SELECT o.id FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE u.id IS NULL
  `);
  expect(orphans.rows).toHaveLength(0);
});

it('should not create orphan line items', async () => {
  const orphans = await pool.query(`
    SELECT li.id FROM line_items li
    LEFT JOIN orders o ON li.order_id = o.id
    WHERE o.id IS NULL
  `);
  expect(orphans.rows).toHaveLength(0);
});
```

## Factory Pattern (TypeScript)

```typescript
// test/factories/user.factory.ts
let userCounter = 0;

export function buildUser(overrides: Partial<User> = {}): User {
  userCounter++;
  return {
    id: overrides.id ?? `user-${userCounter.toString().padStart(4, '0')}`,
    email: overrides.email ?? `user${userCounter}@example.com`,
    name: overrides.name ?? `Test User ${userCounter}`,
    role: overrides.role ?? 'user',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
  };
}

export async function createUser(pool: Pool, overrides: Partial<User> = {}) {
  const user = buildUser(overrides);
  await pool.query(
    `INSERT INTO users (id, email, name, role, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [user.id, user.email, user.name, user.role, user.createdAt]
  );
  return user;
}
// Usage: const admin = await createUser(pool, { role: 'admin' });
```

## Prisma Seed Script

```typescript
// prisma/seed.ts -- use upsert for idempotency, fixed IDs for stability
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seed() {
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: { id: 'seed-admin-001', email: 'admin@example.com', name: 'Admin User', role: 'ADMIN' },
  });
  await prisma.user.upsert({
    where: { email: 'testuser@example.com' },
    update: {},
    create: { id: 'seed-user-001', email: 'testuser@example.com', name: 'Test User', role: 'USER' },
  });
  for (const p of [
    { id: 'seed-prod-001', name: 'Widget', price: 29.99, stock: 100 },
    { id: 'seed-prod-002', name: 'Gadget', price: 49.99, stock: 50 },
    { id: 'seed-prod-003', name: 'Doohickey', price: 9.99, stock: 0 },
  ]) {
    await prisma.product.upsert({ where: { id: p.id }, update: {}, create: p });
  }
}

seed().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

## Test Isolation with Transaction Rollback

```typescript
// test/helpers/db.ts
import { Pool, PoolClient } from 'pg';

let pool: Pool;
let client: PoolClient;

export async function setupTestTransaction() {
  pool = new Pool({ database: 'test_db' });
  client = await pool.connect();
  await client.query('BEGIN');
  return client;
}

export async function rollbackTestTransaction() {
  await client.query('ROLLBACK');
  client.release();
}

// In tests:
describe('OrderService', () => {
  let db: PoolClient;

  beforeEach(async () => { db = await setupTestTransaction(); });
  afterEach(async () => { await rollbackTestTransaction(); });

  it('should create order and decrement stock', async () => {
    // This runs inside a transaction that rolls back after the test
    await db.query(`INSERT INTO products (id, name, stock) VALUES ($1, $2, $3)`,
      ['prod-1', 'Widget', 10]);

    const service = new OrderService(db);
    await service.createOrder({ productId: 'prod-1', quantity: 2 });

    const result = await db.query('SELECT stock FROM products WHERE id = $1', ['prod-1']);
    expect(result.rows[0].stock).toBe(8);
    // Transaction rolls back -- no persistent state
  });
});
```
