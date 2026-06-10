---
name: test-data-management
description: >-
  Create and manage test data with factory patterns, fixture strategies, data
  anonymization, and synthetic data generation. Covers Fishery (TypeScript),
  FactoryBot (Ruby), Factory Boy (Python), database seeding, cleanup strategies,
  and GDPR-compliant data handling. Use when: "test data," "fixtures," "factories,"
  "seed data," "synthetic data," "test database," "data anonymization."
  Not for: migration/integrity testing of the DB itself — use database-testing;
  environment provisioning and database branching strategy — use test-environments.
  Related: test-environments, database-testing, api-testing, unit-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: infrastructure
---

<objective>
Create, maintain, and clean up test data that is deterministic, isolated, realistic, and safe. Good test data is the foundation of reliable tests -- without it, tests are either flaky (shared mutable state), unrealistic (hardcoded nonsense values), or dangerous (production PII in test environments). This skill delivers factories, fixtures, idempotent seeds, anonymization pipelines, and cleanup strategies that survive parallel execution.
</objective>

---

## Quick Route

| Situation | Go to |
|-----------|-------|
| Need fresh entity data with per-test overrides | Factory Patterns → `references/factories.md` |
| Mocking an API response or golden file | Fixture Strategies → `references/factories.md` |
| Copying production data anywhere non-prod | Data Anonymization |
| Populating a test DB / reference data idempotently | Database Seeding → `references/seeding-and-synthetic.md` |
| Cleaning up after tests / parallel isolation | Cleanup Strategies → `references/seeding-and-synthetic.md` |
| Generating edge cases and boundary values | Synthetic Data → `references/seeding-and-synthetic.md` |

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
Tests should produce the same results regardless of when or where they run. Avoid `Math.random()`, `Date.now()`, or auto-increment IDs in assertions. Use seeded random generators (`faker.seed(n)`), fixed timestamps, factory sequences, and -- when an ID must be a UUID you assert on -- a seeded `faker.string.uuid()` so it stays stable across runs.

### 5. Minimize Data, Maximize Signal
Create only the data each test needs. A test for user search does not need a complete user profile with billing address, payment method, and order history. Over-specified test data obscures the intent of the test and increases maintenance burden.

---

## Factory Patterns

Factories are functions that produce test data with sensible defaults, allowing individual tests to override only what matters for their scenario. **Fishery** (2.4.0) is the default for TypeScript, **FactoryBot** (6.6.0) for Ruby, **factory-boy** (3.3.3) for Python; all pair with **faker** (v10.4.0) for realistic field values.

See `references/factories.md` for the full Fishery (with associations and deterministic UUIDs), FactoryBot (User + Product `out_of_stock`/`discounted` traits), Factory Boy (`class Params` + `Trait`), and Playwright fixture implementations. The shape every factory follows:

- **Defaults + overrides** — `Factory.define` produces sensible defaults; tests pass overrides for the one field they care about (`userFactory.build({ role: 'admin' })`).
- **Sequences for unique fields** — `sequence` (Fishery), `sequence(:email)` (FactoryBot), `factory.Sequence` (Factory Boy) — never hardcode IDs or emails.
- **Traits for variants** — name common states (`:admin`, `:inactive`, `out_of_stock`, `discounted`) instead of spawning a fixture file per combination.
- **Associations** — one factory builds another (an order builds its user), keeping referential structure without manual wiring.

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

Three fixture shapes, all in `references/factories.md`:

- **Static fixtures (JSON/YAML)** — best for API response mocks (`page.route` + `route.fulfill`), config data, and golden file comparisons.
- **Dynamic fixtures (Playwright)** — `test.extend` creates data via API before the test and deletes it after `await use(...)`. The standard per-test setup/teardown.
- **Fixture composition** — combine factory-built data (`userFactory.build()`, `orderFactory.buildList(3)`) inside a single `test.extend` that seeds and cleans up in one step.

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

The anonymization pipeline -- seeded Faker for determinism, an in-memory lookup table, parent-records-first ordering, and a wrapping transaction -- is in `references/seeding-and-synthetic.md` (Anonymization with Faker.js, Referential Integrity During Anonymization). Anonymizing a user's email must also update that email everywhere it is referenced (orders, comments, audit logs); process parents first, children second, using the same lookup, all inside one transaction.

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

Seed scripts must be safe to run multiple times without duplicating data. Use upsert -- `INSERT ... ON CONFLICT (natural_key) DO UPDATE SET ...` -- keyed on a stable natural key, not the primary key. A `DELETE`-then-`INSERT` "reset" is **not** idempotent: it breaks foreign keys and reassigns serial IDs. See `references/seeding-and-synthetic.md` (Idempotent Seed Scripts) for the full `INSERT ... ON CONFLICT (code) DO UPDATE` countries/currencies example and the reasoning.

### Database Branching (DB-as-a-Service)

If your prod DB lives on **Neon**, **Supabase**, or **PlanetScale**, branching can give a PR its own database instead of seeding from scratch -- but the providers differ on whether the branch carries data:

- **Neon Branching** — copy-on-write Postgres branches in seconds, **with data**; ideal for ephemeral preview envs. The strongest "PR gets a real DB copy" story.
- **Supabase Branching** — `supabase branches create pr-123` clones schema and (optionally, from a backup) data; preview env points at the branch URL.
- **PlanetScale Branching** — MySQL branches are **schema-only by default (no data)**, so you still seed the branch. Note: PlanetScale removed its free Hobby tier (April 2024); MySQL now starts at ~$39/mo, Postgres ~$5/mo.

Pair with the Preview Environments pattern in `test-environments`.

> **Avoid: Snaplet (hosted)** — shut down 31 Aug 2024; the team joined Supabase. `@snaplet/seed`
> lives on as `supabase-community/seed` (community-maintained, last meaningful release v0.98.0,
> July 2024, no feature work since). For new projects, prefer the DB-branching providers above
> plus factory-generated seeds.

### Per-Test vs Per-Suite Data

| Strategy | When to Use | Pros | Cons |
|----------|------------|------|------|
| Per-test setup/teardown | Tests that modify data | Full isolation, parallel-safe | Slower, more setup code |
| Per-suite seed | Read-only reference data | Fast, simple | Cannot be modified by tests |
| Per-worker seed | Playwright parallel workers | Balances speed and isolation | Requires worker-scoped fixtures |
| Global seed | Environment bootstrap | Runs once, sets up baseline | Must be idempotent, shared state risk |

For the worker-scoped fixture (`test.extend` with `{ scope: 'worker' }`) that powers per-worker seeding, see `references/factories.md` (Worker-Scoped Seeding).

### Cleanup Strategies

| Strategy | When to use | Speed |
|----------|------------|-------|
| **Transaction rollback** | Unit/integration tests with direct DB access | Fastest |
| **Truncation** (`TRUNCATE ... CASCADE`) | Resetting tables between suites | Medium |
| **API-based cleanup** | E2E tests with no direct DB access | Slowest |

Transaction rollback cannot clean up E2E tests -- the app opens its own DB connections, so a test-side transaction can't undo the app's writes; use API-based cleanup (delete in reverse creation order) there. All three implementations are in `references/seeding-and-synthetic.md` (Cleanup Strategies).

---

## Synthetic Data Generation

Factories should make it easy to generate edge cases and boundary values without hand-writing them per test. The reusable arrays and helpers -- `edgeCaseStrings` (empty, whitespace, very long, XSS, SQL injection, null/control chars, RTL override), `edgeCaseDates`, and `boundaryValues(min, max)` driving a `test.each` -- are in `references/seeding-and-synthetic.md` (Synthetic Data Generation).

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
Using `userId: '1'` in tests. This couples tests to database state and breaks when running in parallel (ID collision) or against a database with existing data. Use factory sequences or seeded UUIDs (see Core Principle 4).

---

## Verification

Prove the data layer is deterministic, isolated, and PII-free, smallest check first:

1. **Seeds are idempotent** — run the seed twice back-to-back and diff the row counts: `psql -c "SELECT count(*) FROM countries" && <seed> && psql -c "SELECT count(*) FROM countries"` returns the same number both times and exits 0. A growing count means a missing `ON CONFLICT`.
2. **No shared mutable state** — run the suite under parallelism *and* randomized order: `npx playwright test --workers=4` (or `pytest -n auto -p randomly`) stays green. A failure that only appears here is an ordering or shared-data dependency.
3. **Determinism holds** — run the same data-generating test twice; with `faker.seed(n)` set, generated names/IDs/UUIDs match across runs. If they drift, an unseeded Faker call or `Date.now()`/`crypto.randomUUID()` leaked in.
4. **No real PII** — `grep -rE '@(gmail|outlook|yahoo)\.com|[0-9]{3}-[0-9]{2}-[0-9]{4}' tests/ fixtures/` returns nothing (real-looking emails and SSNs). Anything it finds is an anonymization gap.
5. **Cleanup returns to baseline** — snapshot row counts before the suite, run it, snapshot again: the test DB is back to baseline with no orphaned records.

---

## Done When

- Every entity type the suite creates has a factory or fixture (no inline ad-hoc object literals in tests for shared entities -- grep the test dir for hand-built fixtures and confirm none remain).
- Test data is isolated per test -- the suite passes with parallelism on (`--workers=N` / `pytest -n auto`) **and** under randomized order (`--shuffle` / `-p randomly`), proving no shared mutable state or ordering dependency.
- Seed scripts are idempotent -- running the seed twice in a row produces the same row count and exits 0; the CI job runs them with no manual intervention.
- No real PII used in test fixtures -- all sensitive data anonymized or synthetic (grep for production domains / real-looking SSNs returns nothing).
- Data cleanup verified -- row counts in the test DB return to baseline after the suite (no orphaned records accumulate across runs).

---

## Reference Files (in `references/`)

- **factories.md** — Full Fishery (associations, deterministic UUIDs), FactoryBot (User + Product traits), Factory Boy (`Params`/`Trait`), static/dynamic/composed Playwright fixtures, and the worker-scoped seeding fixture.
- **seeding-and-synthetic.md** — Idempotent `ON CONFLICT` seed script, Faker.js anonymization + referential-integrity pipeline, cleanup strategies (rollback / truncate / API), and synthetic edge-case + boundary-value generators.

## Related Skills

- **unit-testing** -- Unit tests are the primary consumer of factory-generated data; this skill provides the data layer.
- **api-testing** -- API tests use both factories (for request bodies) and fixtures (for mocked responses).
- **playwright-automation** -- E2E tests need test data seeded via API or fixtures before browser interaction.
- **test-reliability** -- Deterministic test data eliminates a major source of test flakiness.
- **test-environments** -- Owns environment provisioning and database-branching strategy (Neon, Supabase, PlanetScale) for preview envs; this skill owns the data that fills them.
- **database-testing** -- Migration testing, data-integrity assertions, and Testcontainers for the database layer specifically -- go there to test the DB, come here to populate it.
- **ci-cd-integration** -- Database seeding and cleanup must be integrated into CI pipeline stages.
