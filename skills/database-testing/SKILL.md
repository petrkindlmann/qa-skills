---
name: database-testing
description: >-
  Validate database integrity, test migrations forward and backward, verify schema
  constraints, manage seed data, detect migration drift, and identify query performance
  issues. Covers PostgreSQL, MySQL, MongoDB with Prisma, TypeORM, Drizzle, and SQLAlchemy,
  plus Testcontainers test databases.
  Use when: "database test," "migration test," "migration rollback," "rollback test,"
  "data integrity," "SQL test," "schema validation," "seed data," "query performance,"
  "Testcontainers."
  Not for: synthetic data generation/masking at scale — use test-data-management;
  Docker/IaC test-environment provisioning — use test-environments; SQL injection — use security-testing.
  Related: test-data-management, test-environments, security-testing, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
A migration that passes `prisma migrate deploy` can still silently drop a column's data, and an `EXPLAIN` assertion that never fails will green-light a query that lost its index — both ship to production looking fine. This skill produces database tests that catch those: forward AND backward migration tests, constraint-rejection tests, deterministic seed data, drift detection, and query-plan assertions that actually fail when the index disappears.

**Before starting:** check `.agents/qa-project-context.md` for database type, ORM, migration tooling, and environment config — they shape every pattern below.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there. Then:

1. **Database type:** PostgreSQL, MySQL, SQLite, MongoDB, or multi-database? Each has different constraint syntax, migration tools, and performance profiling.
2. **ORM / query builder:** Prisma, TypeORM, Drizzle, Sequelize, SQLAlchemy, Django ORM, or raw SQL? The ORM determines migration tooling and test patterns.
3. **Migration tool:** Prisma Migrate, TypeORM migrations, Flyway, Liquibase, Alembic, knex, or custom? This determines how to test forward and backward migrations.
4. **Test database strategy:** isolated DB per test, transaction rollback, Testcontainers, or shared DB with cleanup? Affects speed and reliability.
5. **Existing seed data:** factories, fixtures, or seed scripts? Check `prisma/seed.ts`, `seeds/`, `fixtures/`, or factory patterns.
6. **Performance baselines:** any existing query benchmarks or slow-query monitoring?

---

## Core Principles

1. **Test migrations forward AND backward.** Every migration should be reversible. If a rollback fails, you cannot recover from a bad deploy. Test the `down` path, not just the `up` — and test it with the *actual* revert mechanism (a hand-written `down.sql` for Prisma, a native revert command elsewhere), not a metadata flag.

2. **Constraints are the first line of defense.** `NOT NULL`, `UNIQUE`, `FOREIGN KEY`, and `CHECK` constraints stop bad data at the database, regardless of application code. Test that each one exists and rejects invalid data with the right error.

3. **Deterministic seed data.** Tests must produce the same result every run. Use factories with fixed IDs and fixed timestamps, not random data. `faker.random()` without a seed, `uuid()`, and `now()` in seed data create non-deterministic tests.

4. **Isolate database state per test.** Tests that share state are order-dependent and flaky. Use transaction rollback, per-test databases, or guaranteed cleanup.

5. **Test the migration, not the ORM's sync.** `prisma db push` / `typeorm synchronize: true` skip the migration path your users will actually run. Always exercise the real migration files.

6. **A performance assertion that can't fail is worthless.** Prove the EXPLAIN test goes red when the index is dropped before trusting it green. See Verification.

---

## Migration Testing

For runnable migration test code, see `references/migration-tests.md`.

### Forward Migration Validation

Spin up a fresh, empty database, run all migrations with `prisma migrate deploy`, then assert against `information_schema` that the expected tables and columns exist with the right types, nullability, and defaults. Prefer a Testcontainers-provided `DATABASE_URL`; the admin-Pool `CREATE DATABASE` path is the fallback when you must target a standing Postgres — pick one strategy per suite, don't mix.

### Rollback Testing

Prisma has **no** `migrate down` / `migrate rollback` command. `prisma migrate resolve --rolled-back` is **not** a rollback tool — it only fixes a migration whose `migrate deploy` *failed*, and it throws on a cleanly-applied one. The supported test for a reversible change: apply forward, capture state, run the hand-written `down.sql` directly (`psql -f down.sql`), assert the reverted object is gone, then re-apply. Maintain a `down.sql` per migration directory.

For **TypeORM and Sequelize**, both ship native revert commands (`dataSource.undoLastMigration()`, `sequelize-cli db:migrate:undo`); swap them in for the `psql -f down.sql` step — the capture → revert → assert → re-apply shape is identical.

For **Drizzle Kit v1.0 (rc as of mid-2026 — `drizzle-kit@1.0.0-rc.1`, no stable GA yet)**: `drizzle-kit generate` + `drizzle-kit migrate`. Pin the exact version in CI — the rc reworked the casing API (per-table `snakeCase.table` / `camelCase.table` imports from `drizzle-orm/dialect-core`) and removed RQB v1 `._query` for Postgres. Drizzle has no down-migration generator; check in your own inverse SQL, same as Prisma.

### Data Preservation During Migration

To test that an added column preserves existing rows, apply migrations up to N-1, insert data, then apply the migration under test and assert the rows survived (new nullable column carries its default or null). **`prisma migrate deploy` has no `--to` flag** — it applies *all* pending migrations. To stop at N-1, deploy a migrations directory containing only migrations up to N-1 (stage it in CI), then deploy the full directory. Tools with real targeting (Flyway `-target=`, Alembic `upgrade <rev>`) use the native flag instead.

### Migration Drift Detection

The most common real migration bug: someone edits the DB or the schema without a matching migration, so the committed migrations no longer reproduce `schema.prisma`. `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` returns non-zero on drift — wire it into CI as a fast pre-flight before the heavier tests. See `references/migration-tests.md`.

### Schema Snapshot Comparison

Capture a `pg_dump --schema-only` snapshot before and after the migration and diff table-by-table so only the intended tables changed. See `references/migration-tests.md`.

### Other ORMs

**TypeORM:** `DataSource` with `migrationsRun: false`, then `dataSource.runMigrations()` and `dataSource.undoLastMigration()` in tests. Same shape: apply all, verify schema, revert last, verify rollback.

**Alembic (Python):** test `alembic upgrade head` from empty DB, `alembic downgrade base` for full rollback, and an upgrade→downgrade→upgrade cycle to verify schema consistency. Use a fresh test database via fixture.

---

## Data Integrity Testing

For runnable constraint and referential-integrity code, see `references/integrity-and-seed.md`.

### Constraint Testing

Assert that each constraint rejects invalid data: `NOT NULL` rejects missing required columns, `UNIQUE` rejects duplicates, `FOREIGN KEY` rejects dangling references, `CHECK` rejects out-of-range values, `ON DELETE CASCADE` removes dependent rows. Assert on the database error message (`/null value in column/`, `/unique constraint/i`, etc.) at the `pool.query` level — not at the ORM or application-validation layer, which can mask a missing DB constraint.

### Referential Integrity & Data-Quality Audit

Run anti-join queries (`LEFT JOIN … WHERE parent.id IS NULL`) to assert there are no orphan records pointing at deleted parents. Then audit for the gap between *intended* and *enforced* integrity: `COUNT(*)` vs `COUNT(DISTINCT col)` flags a column that should be unique but lacks a constraint; `COUNT(*) FILTER (WHERE col IS NULL)` flags one that should be non-null. See `references/integrity-and-seed.md`.

### Data Type Validation

Test: monetary values stored with correct precision (no float loss), VARCHAR length enforcement (`value too long` on overflow), and timezone-aware timestamps stored as UTC — insert with an offset (`+02:00`), retrieve, and verify ISO UTC output.

---

## Seed Data Management

For runnable factory, seed-script, and isolation code, see `references/integrity-and-seed.md`.

### Factory Pattern (TypeScript)

Build records from a `buildUser(overrides)` factory that increments a counter for stable, deterministic IDs and emails and uses a fixed timestamp (`new Date('2026-01-01T00:00:00Z')`, never `new Date()` with no argument), with a `createUser(pool, overrides)` helper that inserts and returns the record. See `references/integrity-and-seed.md`.

### Prisma Seed Script

Use `upsert` with fixed IDs so the seed is idempotent and re-runnable, and switch profiles on `process.env.SEED_ENV`: `test` (minimal, 2–3 users), `staging` (realistic volume, 50+ users), `demo` (curated). `staging` and `demo` extend `test`. See `references/integrity-and-seed.md`.

### Test Isolation with Transaction Rollback

Wrap each test in `BEGIN`/`ROLLBACK` so inserts never persist between tests. The module-level shared client works for serial runs (`jest --runInBand`); parallel test files in one worker need a per-suite client or savepoints. See `references/integrity-and-seed.md`.

---

## Query Performance Testing

For runnable EXPLAIN ANALYZE and index-validation code, see `references/performance-and-docker.md`.

### EXPLAIN ANALYZE Patterns

Run `EXPLAIN (ANALYZE, FORMAT JSON)` on critical queries, read `plan.Plan['Node Type']`, and assert it matches `/Index/` (not `Seq Scan`) and that `plan['Execution Time']` is under threshold. See `references/performance-and-docker.md`.

### Index Validation

Query `pg_indexes` and assert the columns you rely on for lookups and range scans (`users.email`, `orders.user_id`, `orders.created_at`) are actually indexed. See `references/performance-and-docker.md`.

### Slow Query Detection

Seed realistic volume (10K+ rows), then measure execution time with `performance.now()` and assert critical queries (dashboard aggregations with JOINs, GROUP BY, ORDER BY) complete under a threshold (e.g. 100ms).

**MongoDB:** use `collection.find(...).explain('executionStats')` to verify index usage (`stage` must not be `COLLSCAN`), check `totalDocsExamined` is close to `nReturned`, and verify compound indexes exist via `collection.indexes()`.

---

## Docker-Based Test Database

**Preferred (2026): Testcontainers.** `@testcontainers/postgresql` 11.14+ (May 2026) is the lower-friction default — programmatic container lifecycle, auto-cleanup, parallel execution with distinct ports. It removes the docker-compose file and port-conflict bookkeeping. See `references/performance-and-docker.md` for the `PostgreSqlContainer` setup.

**Hand-rolled compose (still valid):** `docker-compose.test.yml` with `postgres:18-alpine`, `tmpfs` for RAM-backed storage, and a `pg_isready` healthcheck. Map to a non-default port (e.g. 5433) to avoid conflicts with local Postgres. Match the major version to production — Postgres 18 is current (18.4, May 2026); bump from 17 unless production is pinned.

Chain scripts in `package.json`: `test:db:up` (compose up), `test:db:migrate` (prisma migrate deploy), `test:db:seed` (prisma db seed), `test:db` (all + jest), `test:db:down` (compose down -v).

---

## Anti-Patterns

### 1. Testing against production database copies
Production data contains PII, is non-deterministic, and changes unpredictably. Use factories and seed scripts with synthetic data.

### 2. Shared database state between tests
Test A inserts a user; Test B assumes it exists; CI reorders them; Test B fails. Use transaction rollback or per-test cleanup.

### 3. Ignoring rollback testing
"We never roll back migrations" holds until the first migration breaks production. Test the `down` path. If the tool has no revert, that is a risk to document, not to skip.

### 4. Faking rollback with `migrate resolve --rolled-back`
That command only repairs a *failed* migration and throws on a clean one. It does not revert schema. Revert with the real mechanism: `down.sql` for Prisma, `undoLastMigration()` for TypeORM.

### 5. Using ORM sync instead of migrations
`prisma db push`, `typeorm synchronize: true`, Django `migrate --run-syncdb` skip the real migration path. Tests must use the same mechanism as production.

### 6. Testing only happy-path queries
A query that returns rows when data exists is the easy case. Test empty result sets, nulls in optional columns, max result sizes, and queries against the wrong data.

### 7. Performance assertions that can never fail
An EXPLAIN test that passes whether or not the index exists gives false confidence. Prove it goes red on a dropped index (see Verification).

### 8. Seeding with random data
`faker.random()` without a fixed seed, `uuid()`, and `now()` produce different data every run, making tests non-deterministic. Use fixed seeds and fixed values: `faker.seed(42)`, explicit IDs, `new Date('2026-01-01T00:00:00Z')`.

---

## Verification

Prove the suite actually catches regressions, smallest check first:

1. **Suite is green from clean:** `npm run test:db` exits 0 against a fresh Testcontainers database.
2. **The EXPLAIN test has teeth:** in a scratch DB, `DROP INDEX users_email_idx`, re-run the query-performance test, confirm it **fails** (planner falls back to `Seq Scan`), then restore the index and confirm it passes again. A perf test that stays green with the index gone is broken — fix it before trusting it. See `references/performance-and-docker.md`.
3. **Drift check fires:** `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` returns 0 on a clean repo; hand-edit `schema.prisma` and confirm it returns non-zero.

---

## Done When

- A forward+rollback test file exists for the latest migration: forward applies from an empty DB and asserts schema via `information_schema`; rollback applies `down.sql`, asserts the reverted object absent, then re-applies — and it passes in CI.
- A constraints test asserts a rejection (with the DB error message) for each of NOT NULL, UNIQUE, FOREIGN KEY, and CHECK, at the `pool.query` level.
- A data-preservation test inserts rows before the migration under test and asserts they survive it (no fake `--to` flag).
- A migration-drift check (`prisma migrate diff … --exit-code`) runs in CI and exits 0 on a clean repo.
- Seed data is idempotent (`upsert` + fixed IDs) and switches profiles on `SEED_ENV`; re-running it twice produces identical state.
- An EXPLAIN test asserts `Node Type` matches `/Index/` and `Execution Time` is under threshold, and has been shown to fail when the index is dropped.
- The `test:db` CI job exits 0 (green) against a Testcontainers database.

## Reference Files (in `references/`)

- **migration-tests.md** — Forward validation, rollback via `down.sql`, data preservation, drift detection (`migrate diff`), and schema snapshot comparison.
- **integrity-and-seed.md** — Constraint and referential-integrity tests, data-quality audits, factory pattern, `SEED_ENV` seed script, and transaction-rollback isolation helpers.
- **performance-and-docker.md** — EXPLAIN ANALYZE plan assertions, index validation, the dropped-index teeth test, and Testcontainers setup.

## Related Skills

- **test-data-management** — Synthetic data generation and masking *at scale* for non-production environments. Come here for in-test factories and seed scripts; go there for large realistic datasets and PII masking.
- **test-environments** — Docker/IaC provisioning of test databases, environment parity. This skill uses Testcontainers inside a test suite; test-environments owns the standing infrastructure.
- **security-testing** — SQL injection, database-level access control, and encryption verification. This skill tests integrity and correctness, not adversarial input.
- **ci-cd-integration** — Running migration and DB test jobs in CI pipelines and provisioning test databases in GitHub Actions.
- **performance-testing** — Load testing DB performance, connection-pool sizing, and query optimization under concurrent load (out of scope here).
