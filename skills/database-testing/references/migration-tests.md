# Migration Testing Code

Runnable migration test code for forward migrations, rollback, data preservation, drift detection, and schema snapshot comparison. The decision prose and ORM notes live in `SKILL.md`.

## Forward Migration Validation

```typescript
// test/migrations/forward.test.ts
import { execSync } from 'child_process';
import { Pool } from 'pg';

// Prefer a Testcontainers-provided DATABASE_URL (see performance-and-docker.md).
// The admin-Pool / CREATE DATABASE path below works against a standing Postgres
// when you cannot use Testcontainers; pick ONE strategy per suite, do not mix.

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

Prisma has **no** `migrate down` / `migrate rollback`. `prisma migrate resolve --rolled-back` only fixes a migration whose `migrate deploy` *failed* — it errors on a cleanly-applied migration, so it is the wrong tool for testing a reversible change. The supported test is: apply forward, capture state, run the hand-written `down.sql` directly with `psql`, assert the reverted object is gone, then re-apply.

```typescript
import { execSync } from 'node:child_process';

describe('Migration rollback', () => {
  it('the down migration cleanly reverses the latest up', async () => {
    // Apply all migrations to a fresh DB
    execSync('npx prisma migrate deploy', { env: migrationEnv });

    // Capture pre-rollback state: the column the latest migration added exists
    const before = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'display_name'
    `);
    expect(before.rows).toHaveLength(1);

    // Get the latest applied migration name (Prisma stores in _prisma_migrations)
    const { rows } = await pool.query(
      `SELECT migration_name FROM _prisma_migrations
         WHERE finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT 1`,
    );
    const latest = rows[0].migration_name;

    // Revert by applying the hand-written down.sql checked in alongside the
    // migration. Do NOT use `migrate resolve --rolled-back` here — that command
    // is only valid against a FAILED migration and throws on a clean one.
    execSync(`psql $DATABASE_URL -f prisma/migrations/${latest}/down.sql`, { env: migrationEnv });

    // Verify rollback succeeded: the column added by the up migration is gone
    const after = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'display_name'
    `);
    expect(after.rows).toHaveLength(0);
  });

  it('can re-apply after rollback (idempotent up)', async () => {
    // Mark the reverted migration as un-applied so deploy will re-run it, then re-apply
    execSync('npx prisma migrate reset --force --skip-seed', { env: migrationEnv });
    execSync('npx prisma migrate deploy', { env: migrationEnv });

    const after = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'display_name'
    `);
    expect(after.rows).toHaveLength(1);
  });
});
```

> **TypeORM / Sequelize** ship a native revert. Replace the `psql -f down.sql` line with `dataSource.undoLastMigration()` (TypeORM) or `npx sequelize-cli db:migrate:undo` (Sequelize); the capture → revert → assert → re-apply shape is identical.

## Data Preservation During Migration

`prisma migrate deploy` has **no `--to` target** — it applies *all* pending migrations. To stop at N-1, point Prisma at a migrations directory that contains only migrations up to N-1 (here, a `migrations-upto-n1` fixture dir), insert data, then deploy the full directory to apply the migration under test.

```typescript
it('should preserve existing data when adding a column', async () => {
  // Setup: apply migrations up to N-1 by deploying a directory holding only those.
  // (Stage the dir in CI, or copy real migrations and drop the latest one.)
  execSync('npx prisma migrate deploy --schema=prisma/schema-upto-n1.prisma', { env: migrationEnv });

  // Insert data before the migration under test
  await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2)`,
    ['550e8400-e29b-41d4-a716-446655440000', 'alice@example.com']);

  // Apply the migration under test (adds nullable 'display_name' column) — full dir
  execSync('npx prisma migrate deploy', { env: migrationEnv });

  // Verify existing data survived
  const result = await pool.query('SELECT email, display_name FROM users WHERE id = $1',
    ['550e8400-e29b-41d4-a716-446655440000']);
  expect(result.rows[0].email).toBe('alice@example.com');  // data survived
  // New nullable column carries its default (or null when no default)
  expect(result.rows[0].display_name).toBeNull();
});
```

For tools with real targeting (Flyway `migrate -target=`, Alembic `upgrade <rev>`), use the native flag instead of staging a directory.

## Migration Drift Detection (shadow-DB check)

The most common real migration bug: someone edits the schema or the DB without a matching migration, so the committed migrations no longer reproduce `schema.prisma`. `prisma migrate diff` with `--exit-code` returns non-zero on any drift — wire it into CI as a fast pre-flight check before the heavier tests.

```typescript
it('committed migrations reproduce schema.prisma exactly', () => {
  // Non-zero exit (and a thrown error) means the migrations and the schema disagree.
  execSync(
    'npx prisma migrate diff ' +
      '--from-migrations prisma/migrations ' +
      '--to-schema-datamodel prisma/schema.prisma ' +
      '--shadow-database-url "$SHADOW_DATABASE_URL" ' +
      '--exit-code',
    { env: migrationEnv },
  );
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
