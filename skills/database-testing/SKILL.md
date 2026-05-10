---
name: database-testing
description: >-
  Validate database integrity, test migrations forward and backward, verify schema
  constraints, manage seed data, and identify query performance issues. Covers
  PostgreSQL, MySQL, MongoDB with ORMs like Prisma, TypeORM, and SQLAlchemy.
  Use when: "database test," "migration test," "data integrity," "SQL test,"
  "schema validation," "seed data," "query performance."
  Related: test-data-management, test-environments, security-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Validate database integrity, test migrations safely, verify constraints, and detect query performance issues.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains database type, ORM, migration tooling, and environment configuration that shape every pattern below.
</objective>

---

## Discovery Questions

1. **Database type:** PostgreSQL, MySQL, SQLite, MongoDB, or multi-database? Each has different constraint syntax, migration tools, and performance profiling approaches.
2. **ORM / query builder:** Prisma, TypeORM, Drizzle, Sequelize, SQLAlchemy, Django ORM, or raw SQL? The ORM determines migration tooling and test patterns.
3. **Migration tool:** Prisma Migrate, TypeORM migrations, Flyway, Liquibase, Alembic, knex migrations, or custom? This determines how to test forward and backward migrations.
4. **Test database strategy:** Isolated database per test? Transaction rollback? Docker containers? Shared database with cleanup? This affects speed and reliability.
5. **Existing seed data:** Are there factories, fixtures, or seed scripts? Check for `prisma/seed.ts`, `seeds/`, `fixtures/`, or factory patterns.
6. **Performance baselines:** Are there existing query performance benchmarks or slow query monitoring?

---

## Core Principles

1. **Test migrations forward AND backward.** Every migration should be reversible. If a rollback fails, you cannot recover from a bad deploy. Test the `down` migration, not just the `up`.

2. **Constraints are the first line of defense.** `NOT NULL`, `UNIQUE`, `FOREIGN KEY`, and `CHECK` constraints prevent bad data at the database level, regardless of what application code does. Test that they exist and enforce correctly.

3. **Deterministic seed data.** Tests must produce the same results every run. Use factories with fixed seeds, not random data. Timestamp-based IDs, `uuid()`, and `now()` in seed data create non-deterministic tests.

4. **Isolate database state per test.** Tests that share database state are order-dependent and flaky. Use transaction rollback, per-test databases, or guaranteed cleanup.

5. **Test the migration, not the ORM.** The ORM's `sync` or `push` command skips the migration path users will experience. Always test the actual migration files.

---

## Migration Testing

### Forward Migration Validation

```typescript
// test/migrations/forward.test.ts
import { execSync } from 'child_process';
import { Pool } from 'pg';

describe('Forward migrations', () => {
  let pool: Pool;

  beforeAll(async () => {
    // Create a fresh database for migration testing
    const adminPool = new Pool({ database: 'postgres' });
    await adminPool.query('DROP DATABASE IF EXISTS test_migrations');
    await adminPool.query('CREATE DATABASE test_migrations');
    await adminPool.end();

    pool = new Pool({ database: 'test_migrations' });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should apply all migrations from empty database', () => {
    // Run all migrations against empty database
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: 'postgresql://localhost/test_migrations' },
    });
  });

  it('should have correct schema after all migrations', async () => {
    // Verify expected tables exist
    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    const tableNames = tables.rows.map((r) => r.table_name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('orders');
    expect(tableNames).toContain('products');
  });

  it('should have correct columns on users table', async () => {
    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position
    `);
    const colMap = Object.fromEntries(
      columns.rows.map((r) => [r.column_name, r])
    );

    expect(colMap.id.data_type).toBe('uuid');
    expect(colMap.email.is_nullable).toBe('NO');
    expect(colMap.created_at.column_default).toContain('now()');
  });
});
```

### Rollback Testing

Prisma Migrate has no first-class `rollback` command. Production rollbacks happen by writing a *new* forward migration that reverts the previous one. For tests, the supported pattern is `prisma migrate resolve` to mark a migration as rolled back, plus a fresh DB reset between tests.

```typescript
import { execSync } from 'node:child_process';

describe('Migration rollback', () => {
  it('the down migration cleanly reverses the latest up', async () => {
    // Apply all migrations to a fresh DB
    execSync('npx prisma migrate deploy', { env: migrationEnv });

    // Capture pre-rollback state and insert test data
    await pool.query(
      `INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`,
      ['550e8400-e29b-41d4-a716-446655440000', 'alice@example.com', 'Alice'],
    );

    // Get the latest applied migration name (Prisma stores in _prisma_migrations)
    const { rows } = await pool.query(
      `SELECT migration_name FROM _prisma_migrations
         WHERE finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT 1`,
    );
    const latest = rows[0].migration_name;

    // Mark the migration as rolled back in Prisma's metadata table
    execSync(`npx prisma migrate resolve --rolled-back ${latest}`, { env: migrationEnv });

    // Apply the inverse SQL (you maintain a parallel down.sql per migration, or reset)
    // Pattern A: hand-written down.sql checked in alongside each migration directory
    execSync(`psql $DATABASE_URL -f prisma/migrations/${latest}/down.sql`, { env: migrationEnv });

    // Verify the rollback succeeded: column/table removed by the down migration is gone
  });

  it('can re-apply after rollback (idempotent up)', async () => {
    execSync('npx prisma migrate deploy', { env: migrationEnv });
    // Verify schema matches the expected post-up state
  });
});
```

For Drizzle (v1.0+): `drizzle-kit generate` + `drizzle-kit migrate`, plus `--ignore-conflicts` (SQLite) for explicit migration-conflict detection. Pin `drizzle-kit` in CI — v1.0-rc.1 (April 2026) shipped breaking changes to the `casing` API and removed RQB v1 `._query` for Postgres.

For TypeORM and Sequelize: both ship native `migration:revert` commands and the rollback test pattern above translates directly — replace `prisma migrate resolve` + manual down.sql with the framework's revert command.

### Data Preservation During Migration

```typescript
it('should preserve existing data when adding a column', async () => {
  // Setup: apply migrations up to N-1
  execSync('npx prisma migrate deploy --to 20260101000000_add_users', { env: migrationEnv });

  // Insert data before the migration under test
  await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2)`,
    ['550e8400-e29b-41d4-a716-446655440000', 'alice@example.com']);

  // Apply the migration under test (adds 'display_name' column)
  execSync('npx prisma migrate deploy', { env: migrationEnv });

  // Verify existing data survived
  const result = await pool.query('SELECT email, display_name FROM users WHERE id = $1',
    ['550e8400-e29b-41d4-a716-446655440000']);
  expect(result.rows[0].email).toBe('alice@example.com');
  // New column should have default value or null
  expect(result.rows[0].display_name).toBeNull();
});
```

### Schema Snapshot Comparison

```typescript
// Compare schema before and after migration to detect unintended changes
import { execSync } from 'child_process';

function getSchemaSnapshot(dbUrl: string): string {
  return execSync(`pg_dump --schema-only --no-owner --no-privileges ${dbUrl}`, {
    encoding: 'utf-8',
  });
}

it('should only change the expected tables', () => {
  const before = getSchemaSnapshot(testDbUrl);
  execSync('npx prisma migrate deploy', { env: migrationEnv });
  const after = getSchemaSnapshot(testDbUrl);

  // Parse both schemas and compare table-by-table
  // Only 'orders' table should have changed
  const changedTables = diffSchemas(before, after);
  expect(changedTables).toEqual(['orders']);
});
```

### Other ORMs

**TypeORM:** Use `DataSource` with `migrationsRun: false`, then call `dataSource.runMigrations()` and `dataSource.undoLastMigration()` in tests. Same pattern: apply all, verify schema, revert last, verify rollback.

**Alembic (Python):** Test `alembic upgrade head` from empty DB, `alembic downgrade base` for full rollback, and upgrade-downgrade-upgrade cycle to verify schema consistency. Use a fresh test database via fixture.

---

## Data Integrity Testing

### Constraint Testing

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

### Referential Integrity

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

### Data Type Validation

Test: monetary values stored with correct precision (no float loss), VARCHAR length enforcement (`value too long` on overflow), and timezone-aware timestamps stored as UTC. Insert with offset (`+02:00`), retrieve and verify ISO UTC output.

---

## Seed Data Management

### Factory Pattern (TypeScript)

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

### Prisma Seed Script

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

### Environment-Specific Seeds

Use `SEED_ENV` to select seed profiles: `test` (minimal, fast), `staging` (realistic volume), `demo` (curated data for sales). Each profile calls a function keyed by environment name. The `test` profile should create the minimum data needed -- 2-3 users, a few products. The `staging` profile extends `test` with realistic volume (50+ users, 200+ products).

### Test Isolation with Transaction Rollback

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

---

## Query Performance Testing

### EXPLAIN ANALYZE Patterns

```typescript
describe('Query performance', () => {
  it('should use index for user lookup by email', async () => {
    const explain = await pool.query(
      'EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM users WHERE email = $1',
      ['alice@example.com']
    );
    const plan = explain.rows[0]['QUERY PLAN'][0];

    // Verify index scan, not sequential scan
    expect(plan.Plan['Node Type']).toMatch(/Index/);
    // Execution time under threshold
    expect(plan['Execution Time']).toBeLessThan(10); // ms
  });

  it('should use index for order date range queries', async () => {
    const explain = await pool.query(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT * FROM orders WHERE created_at BETWEEN $1 AND $2`,
      ['2026-01-01', '2026-01-31']
    );
    const plan = explain.rows[0]['QUERY PLAN'][0];
    expect(plan.Plan['Node Type']).not.toBe('Seq Scan');
  });
});
```

### Index Validation

```typescript
it('should have indexes on frequently queried columns', async () => {
  const indexes = await pool.query(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);

  const indexMap = new Map<string, string[]>();
  for (const row of indexes.rows) {
    const key = row.tablename;
    if (!indexMap.has(key)) indexMap.set(key, []);
    indexMap.get(key)!.push(row.indexdef);
  }

  // Verify critical indexes exist
  const userIndexes = indexMap.get('users')?.join(' ') ?? '';
  expect(userIndexes).toContain('email');

  const orderIndexes = indexMap.get('orders')?.join(' ') ?? '';
  expect(orderIndexes).toContain('user_id');
  expect(orderIndexes).toContain('created_at');
});
```

### Slow Query Detection

Seed realistic data volume (10K+ rows), then measure query execution time with `performance.now()`. Assert that critical queries (e.g., dashboard aggregations with JOINs, GROUP BY, ORDER BY) complete under a threshold (e.g., 100ms).

**MongoDB:** Use `collection.find(...).explain('executionStats')` to verify index usage (`stage` should not be `COLLSCAN`). Check that `totalDocsExamined` is close to `nReturned`. Verify compound indexes exist for common query patterns via `collection.indexes()`.

---

## Docker-Based Test Database

**Preferred (2026): Testcontainers.** `testcontainers-node` v11.14+ (April 2026) is the lower-friction default — programmatic container lifecycle, auto-cleanup, parallel execution for distinct UIDs. Hand-rolled compose still works, but Testcontainers removes the docker-compose file and port-conflict bookkeeping:

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let pg: Awaited<ReturnType<PostgreSqlContainer['start']>>;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('test')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .start();
  process.env.DATABASE_URL = pg.getConnectionUri();
});

afterAll(async () => {
  await pg.stop();
});
```

**Hand-rolled compose (still valid):** `docker-compose.test.yml` with `postgres:17-alpine`, `tmpfs` for RAM-backed storage (speed), and a healthcheck on `pg_isready`. Map to a non-default port (e.g., 5433) to avoid conflicts with local Postgres. Match the major version to production — Postgres 17 is current; bump from 16 unless production is pinned.

Chain scripts in `package.json`: `test:db:up` (docker compose up), `test:db:migrate` (prisma migrate deploy), `test:db:seed` (prisma db seed), `test:db` (all three + jest), `test:db:down` (docker compose down -v).

---

## Anti-Patterns

**Testing against production database copies.** Production data contains PII, is non-deterministic, and changes unpredictably. Use factories and seed scripts with synthetic data.

**Shared database state between tests.** Test A inserts a user. Test B assumes that user exists. Test A runs after Test B in a different order on CI. Test B fails. Use transaction rollback or per-test cleanup.

**Ignoring rollback testing.** "We never roll back migrations" is true until the first time a migration breaks production. Test the `down` migration. If the ORM does not support it, that is a risk to document.

**Using ORM sync instead of migrations.** `prisma db push`, `typeorm synchronize: true`, and Django `migrate --run-syncdb` skip the actual migration path. Tests must use the same migration mechanism as production.

**Testing only happy-path queries.** A query that returns results when data exists is the easy case. Test: empty result sets, null values in optional columns, maximum result sizes, and queries against the wrong data.

**No performance baselines.** A query that takes 50ms today takes 5 seconds after a missing index or data growth. Set explicit performance thresholds in tests and fail when they are exceeded.

**Seeding with random data.** `faker.random()` without a fixed seed produces different data every run. Tests become non-deterministic. Use fixed seeds: `faker.seed(42)` or explicit values.

---

## Done When

- Migration tests run both forward (`migrate deploy` from empty DB) and backward (rollback last step) for every schema change.
- Data integrity constraints (NOT NULL, UNIQUE, FOREIGN KEY, CHECK) verified in CI with tests that assert correct rejection of invalid data.
- Seed data covers all test scenarios (admin user, regular user, edge-case records, empty states) without requiring manual database setup.
- Query performance assertions in place for known slow queries (e.g., dashboard aggregations, date range filters), with explicit execution time thresholds.
- Migration rollback tested in the staging environment before each production deploy, confirming the application runs correctly after reverting.

## Related Skills

- **test-data-management** -- Factory patterns, synthetic data generation, data masking for non-production environments.
- **test-environments** -- Docker-based test database provisioning, environment parity, infrastructure-as-code for test databases.
- **security-testing** -- SQL injection testing, access control validation at the database level, data encryption verification.
- **ci-cd-integration** -- Database migration testing in CI pipelines, test database provisioning in GitHub Actions.
- **performance-testing** -- Load testing database performance, connection pool sizing, query optimization under concurrent load.
