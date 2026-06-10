# Query Performance & Docker Test Database Code

Runnable code for EXPLAIN ANALYZE checks, index validation, and Testcontainers/Docker-based test databases. The decision prose and ORM/MongoDB notes live in `SKILL.md`.

## EXPLAIN ANALYZE Patterns

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

## Index Validation

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

## Testcontainers Test Database

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let pg: Awaited<ReturnType<PostgreSqlContainer['start']>>;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('test')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
    .start();
  process.env.DATABASE_URL = pg.getConnectionUri();
});

afterAll(async () => {
  await pg.stop();
});
```

## Proving the EXPLAIN test has teeth

A performance assertion that can never fail gives false confidence — it is the #1 false-positive trap in DB testing. Before trusting the EXPLAIN test, confirm it *fails* when the index is gone. Drop the index, re-run, expect red; restore it, expect green.

```typescript
it('the index assertion actually catches a missing index', async () => {
  await pool.query('DROP INDEX IF EXISTS users_email_idx');
  const explain = await pool.query(
    'EXPLAIN (ANALYZE, FORMAT JSON) SELECT * FROM users WHERE email = $1',
    ['alice@example.com'],
  );
  const plan = explain.rows[0]['QUERY PLAN'][0];
  // With the index dropped the planner must fall back to Seq Scan
  expect(plan.Plan['Node Type']).toBe('Seq Scan');
  // restore for the rest of the suite
  await pool.query('CREATE INDEX users_email_idx ON users (email)');
});
```
