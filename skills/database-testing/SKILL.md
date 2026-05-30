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

For runnable migration test code, see `references/migration-tests.md`.

### Forward Migration Validation

Spin up a fresh, empty database, run all migrations with `prisma migrate deploy`, then assert against `information_schema` that the expected tables and columns exist with the right types, nullability, and defaults. See `references/migration-tests.md` for the full forward-migration suite.

### Rollback Testing

Prisma Migrate has no first-class `rollback` command. Production rollbacks happen by writing a *new* forward migration that reverts the previous one. For tests, the supported pattern is `prisma migrate resolve` to mark a migration as rolled back, plus a fresh DB reset between tests. See `references/migration-tests.md` for the rollback and idempotent re-apply tests.

For Drizzle (v1.0+): `drizzle-kit generate` + `drizzle-kit migrate`, plus `--ignore-conflicts` (SQLite) for explicit migration-conflict detection. Pin `drizzle-kit` in CI — v1.0-rc.1 (April 2026) shipped breaking changes to the `casing` API and removed RQB v1 `._query` for Postgres.

For TypeORM and Sequelize: both ship native `migration:revert` commands and the rollback test pattern above translates directly — replace `prisma migrate resolve` + manual down.sql with the framework's revert command.

### Data Preservation During Migration

Apply migrations up to N-1, insert data, then apply the migration under test and assert the existing rows survived (and that any new column carries its default or null). See `references/migration-tests.md` for the data-preservation test.

### Schema Snapshot Comparison

Capture a `pg_dump --schema-only` snapshot before and after the migration and diff table-by-table so only the intended tables changed. See `references/migration-tests.md` for the snapshot-comparison test.

### Other ORMs

**TypeORM:** Use `DataSource` with `migrationsRun: false`, then call `dataSource.runMigrations()` and `dataSource.undoLastMigration()` in tests. Same pattern: apply all, verify schema, revert last, verify rollback.

**Alembic (Python):** Test `alembic upgrade head` from empty DB, `alembic downgrade base` for full rollback, and upgrade-downgrade-upgrade cycle to verify schema consistency. Use a fresh test database via fixture.

---

## Data Integrity Testing

For runnable constraint and referential-integrity test code, see `references/integrity-and-seed.md`.

### Constraint Testing

Assert that each constraint rejects invalid data: `NOT NULL` rejects missing required columns, `UNIQUE` rejects duplicates, `FOREIGN KEY` rejects dangling references, `CHECK` rejects out-of-range values, and `ON DELETE CASCADE` removes dependent rows. See `references/integrity-and-seed.md` for the full constraint suite.

### Referential Integrity

Run anti-join queries (`LEFT JOIN ... WHERE parent.id IS NULL`) to assert there are no orphan records pointing at deleted parents. See `references/integrity-and-seed.md` for the orphan-detection tests.

### Data Type Validation

Test: monetary values stored with correct precision (no float loss), VARCHAR length enforcement (`value too long` on overflow), and timezone-aware timestamps stored as UTC. Insert with offset (`+02:00`), retrieve and verify ISO UTC output.

---

## Seed Data Management

For runnable factory, seed-script, and isolation code, see `references/integrity-and-seed.md`.

### Factory Pattern (TypeScript)

Build records from a `buildUser(overrides)` factory that increments a counter for stable, deterministic IDs and emails, with a `createUser(pool, overrides)` helper that inserts and returns the record. See `references/integrity-and-seed.md` for the factory implementation.

### Prisma Seed Script

Use `upsert` with fixed IDs so the seed is idempotent and re-runnable. See `references/integrity-and-seed.md` for the `prisma/seed.ts` script.

### Environment-Specific Seeds

Use `SEED_ENV` to select seed profiles: `test` (minimal, fast), `staging` (realistic volume), `demo` (curated data for sales). Each profile calls a function keyed by environment name. The `test` profile should create the minimum data needed -- 2-3 users, a few products. The `staging` profile extends `test` with realistic volume (50+ users, 200+ products).

### Test Isolation with Transaction Rollback

Wrap each test in `BEGIN`/`ROLLBACK` so inserts never persist between tests, eliminating order-dependence and cleanup. See `references/integrity-and-seed.md` for the `setupTestTransaction`/`rollbackTestTransaction` helpers and example.

---

## Query Performance Testing

For runnable EXPLAIN ANALYZE and index-validation code, see `references/performance-and-docker.md`.

### EXPLAIN ANALYZE Patterns

Run `EXPLAIN (ANALYZE, FORMAT JSON)` on critical queries and assert the plan uses an index scan (not `Seq Scan`) and that execution time is under threshold. See `references/performance-and-docker.md` for the query-plan assertions.

### Index Validation

Query `pg_indexes` and assert that the columns you rely on for lookups and range scans (e.g. `users.email`, `orders.user_id`, `orders.created_at`) are actually indexed. See `references/performance-and-docker.md` for the index-validation test.

### Slow Query Detection

Seed realistic data volume (10K+ rows), then measure query execution time with `performance.now()`. Assert that critical queries (e.g., dashboard aggregations with JOINs, GROUP BY, ORDER BY) complete under a threshold (e.g., 100ms).

**MongoDB:** Use `collection.find(...).explain('executionStats')` to verify index usage (`stage` should not be `COLLSCAN`). Check that `totalDocsExamined` is close to `nReturned`. Verify compound indexes exist for common query patterns via `collection.indexes()`.

---

## Docker-Based Test Database

**Preferred (2026): Testcontainers.** `testcontainers-node` v11.14+ (April 2026) is the lower-friction default — programmatic container lifecycle, auto-cleanup, parallel execution for distinct UIDs. Hand-rolled compose still works, but Testcontainers removes the docker-compose file and port-conflict bookkeeping. See `references/performance-and-docker.md` for the `PostgreSqlContainer` setup.

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

## Reference Files (in `references/`)

- **migration-tests.md** — Forward migration validation, rollback, data preservation, and schema snapshot comparison code.
- **integrity-and-seed.md** — Constraint and referential-integrity tests, factory pattern, Prisma seed script, and transaction-rollback isolation helpers.
- **performance-and-docker.md** — EXPLAIN ANALYZE plan assertions, index validation, and Testcontainers test-database setup.

## Related Skills

- **test-data-management** -- Factory patterns, synthetic data generation, data masking for non-production environments.
- **test-environments** -- Docker-based test database provisioning, environment parity, infrastructure-as-code for test databases.
- **security-testing** -- SQL injection testing, access control validation at the database level, data encryption verification.
- **ci-cd-integration** -- Database migration testing in CI pipelines, test database provisioning in GitHub Actions.
- **performance-testing** -- Load testing database performance, connection pool sizing, query optimization under concurrent load.
