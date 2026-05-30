# Migration Testing Code

Runnable migration test code for forward migrations, rollback, data preservation, and schema snapshot comparison. The decision prose and ORM notes live in `SKILL.md`.

## Forward Migration Validation

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

## Rollback Testing

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

## Data Preservation During Migration

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

## Schema Snapshot Comparison

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
