---
name: test-environments
description: >-
  Design environment strategy for testing across dev, CI, preview, staging, and production —
  Docker Compose test infrastructure, multi-stage Dockerfiles, seed-data lifecycle, per-PR
  preview environments, production parity, and external-dependency stubbing at the HTTP boundary.
  Use when: "set up test environment," "docker-compose for tests," "per-PR preview environment,"
  "staging parity," "spin up test infra," "environment tiers."
  Not for: choosing mock-vs-stub-vs-fake per dependency — use service-virtualization; factory and
  fixture data patterns — use test-data-management; pipeline/Actions config — use ci-cd-integration.
  Related: test-data-management, ci-cd-integration, contract-testing, service-virtualization.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: infrastructure
---

<objective>
Staging on SQLite passes tests that break on prod Postgres; a shared staging box becomes a
queue where one broken deploy blocks the whole team; an unmocked Stripe call flakes CI at
random. This skill prevents those by designing environment tiers that mirror production where
it matters, isolate per-PR, and stub external dependencies at the HTTP boundary. It delivers a
working `docker compose up` local/CI stack, a parity checklist, and a stubbing strategy keyed
to dependency type.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already
answered there. Then:

1. **How many environments exist today?** Local dev, CI, staging, preview, production? Map what you have before designing what you need.
2. **Is the app containerized?** Check for `Dockerfile`, `docker-compose.yml`, or `compose.yaml`. If yes, multi-stage targets and compose come for free; if not, that is the first deliverable.
3. **How is test data seeded?** Manual SQL, migration-based, factory libraries, or production snapshots? This decides whether seed scripts are a quick win or a rewrite.
4. **How close is staging to production?** Same DB engine, queue, cache, auth provider, orchestration? Each mismatch is a class of bugs staging can never catch.
5. **External dependencies:** How many third-party APIs does the system call, and are they stubbed in non-prod? Unstubbed third parties are the top source of CI flake.

---

## Core Principles

**1. Staging must mirror production where bugs hide.** If staging uses SQLite and production
uses PostgreSQL, staging tests prove nothing about prod behavior. Match the database engine
*and version*, the queue system, the cache layer, and the auth provider — those are where
environment-specific bugs live.

**2. Ephemeral environments beat long-lived ones.** A shared staging environment becomes a
bottleneck where one broken deploy blocks the entire team. Per-PR preview environments give
isolation and parallel testing; keep staging only for final pre-release validation.

**3. Deterministic seed data, not production copies.** Production snapshots carry PII, stale
references, and non-reproducible state. Build seed data from factories that generate
consistent, valid, minimal datasets. (For factory patterns, see `test-data-management`.)

**4. Stub external dependencies at the boundary, not deep inside.** Third-party APIs are
unreliable, rate-limited, and expensive. Stub them at the HTTP boundary with MSW or WireMock —
never by mocking internal service classes, which hides integration bugs between your own code.

**5. Environment config is code.** Every environment difference (URLs, flags, credentials,
resource limits) must be version-controlled and reviewable. No manual setup that cannot be
reproduced from the repo.

---

## Environment Strategy

### Environment Tiers

| Environment | Purpose | Data | External Deps | Lifecycle |
|-------------|---------|------|---------------|-----------|
| **Local dev** | Fast inner loop | Seeded fixtures, minimal | Stubbed (MSW/WireMock) | Developer-managed |
| **CI** | Automated validation | Seeded per-run, ephemeral | Stubbed or containerized | Created/destroyed per pipeline |
| **Preview** | PR-level review & E2E | Seeded from factories | Stubbed or sandbox | Created on PR, destroyed on close |
| **Staging** | Pre-production validation | Anonymized production-like | Real integrations (sandbox accounts) | Long-lived, regularly reset |
| **Production** | Live users | Real | Real | Permanent |

### Local Development

Fast feedback, zero shared state. Developers must be able to run the full stack locally in
under two minutes:

```bash
docker compose -f docker-compose.test.yml up -d
npm run db:seed
npm run dev
```

Use Docker Compose for infrastructure deps (database, cache, queue) but run the application
natively for fast reload. External APIs are stubbed with MSW handlers loaded in dev mode.

### CI Environment

Fully containerized, created fresh per pipeline run, destroyed after. The block below is the
**`services:` fragment** of a job — nest it under `jobs.<id>.services` alongside `runs-on`
and `steps`; on its own it is not a valid workflow file.

```yaml
# .github/workflows/test.yml — fragment: nest under jobs.test.services
services:
  postgres:
    image: postgres:18-alpine
    env:
      POSTGRES_DB: testdb
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports: ['5432:5432']
    options: >-
      --health-cmd="pg_isready -U test"
      --health-interval=5s
      --health-timeout=3s
      --health-retries=5
  redis:
    image: redis:8-alpine
    ports: ['6379:6379']
    options: >-
      --health-cmd="redis-cli ping"
      --health-interval=5s
      --health-timeout=3s
      --health-retries=5
```

### Docker Compose vs Testcontainers

Two ways to give tests real infrastructure. Pick by where the lifecycle should live:

- **Docker Compose** — declarative stack you bring up before the suite (`docker compose up
  --wait`) and tear down after, usually via a `trap`-guarded script. Best for local dev, a
  shared CI stack, and E2E where many tests share one set of services.
- **Testcontainers** (Node / JVM / Python / Go) — containers spun up *from test code* and
  auto-torn-down per suite or per test, with no compose file or `trap` to maintain. Best for
  integration tests that need isolated, programmatic infra (a throwaway Postgres per test
  class). The 2026 default for "ephemeral infra owned by the test," and a strong alternative
  to hand-rolled compose + trap scripts.

Reach for Compose when humans and many tests share the stack; reach for Testcontainers when
each test (or suite) wants its own disposable copy.

### Preview Environments (Per-PR)

Each pull request gets its own isolated environment; reviewers click a link and test the exact
changes without interfering with other PRs.

Hosting options (2026), pick by stack:

- **Vercel** preview deployments — Next.js / static / serverless; per-PR URL automatically.
- **Cloudflare Pages** preview — git-integrated, generous free tier.
- **Render** / **Railway** preview environments — full-stack including databases.
- **Northflank**, **Qovery**, **Bunnyshell**, **Uffizzi** — full ephemeral-environment
  platforms (Kubernetes-backed) when previews need the whole stack, not just a frontend.

For each preview, pair the env lifecycle with a **database branch** (Neon, Supabase,
PlanetScale-style): create a branch on PR open, drop it on close. That gives every preview a
cheap, instant, isolated DB copy instead of a shared staging DB. (See `test-data-management`.)

For local-dev parity with CI:

- **Devcontainers** (`.devcontainer/devcontainer.json`) — VS Code, Codespaces, JetBrains. The
  standard for "everyone gets the same Docker-backed dev env."
- **Tilt** (`Tiltfile`) — Kubernetes-first local dev with hot reload and multi-service
  orchestration. Pick when staging itself is K8s.

A frontend preview with E2E against the generated URL is a few lines:

```yaml
- name: Run E2E against preview
  env:
    BASE_URL: ${{ steps.deploy.outputs.preview-url }}
  run: npx playwright test --project=chromium
```

A custom Docker preview keyed to a per-PR namespace, auto-torn-down on close:

```yaml
- name: Deploy preview
  run: |
    NAMESPACE="pr-${{ github.event.number }}"
    docker compose -f docker-compose.preview.yml -p "$NAMESPACE" up -d
    echo "preview-url=https://${NAMESPACE}.preview.example.com" >> "$GITHUB_OUTPUT"

- name: Teardown preview
  if: github.event.action == 'closed'
  run: |
    NAMESPACE="pr-${{ github.event.number }}"
    docker compose -p "$NAMESPACE" down -v
```

### Staging

Long-lived environment that mirrors production infrastructure. Reset weekly or on-demand to
prevent drift:

```bash
#!/bin/bash
# scripts/reset-staging.sh
set -euo pipefail

echo "Resetting staging database..."
psql "$STAGING_DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Running migrations..."   # migrations MUST recreate extensions + grants (see caveat below)
npm run db:migrate -- --env staging

echo "Seeding anonymized data..."
npm run db:seed -- --env staging --dataset production-anonymized

echo "Verifying staging health..."
curl -sf https://staging.example.com/health || exit 1
echo "Staging reset complete."
```

**Caveat:** `DROP SCHEMA public CASCADE` also drops the schema's default privileges and any
installed extensions (`uuid-ossp`, `pgcrypto`, …). Your migration pipeline must recreate them
(`CREATE EXTENSION IF NOT EXISTS …`, re-grant defaults) or the migrate step fails. Don't assume
a bare `CREATE SCHEMA public` restores the prior grants — it does not.

---

## Docker Compose for Testing

A production-quality `docker-compose.test.yml` spins up the full stack (app, Postgres, Redis,
a one-shot seed container, Mailpit) for integration and E2E tests. Two details that matter:

- **Health checks gate `depends_on`.** Without a `healthcheck` + `condition: service_healthy`,
  `depends_on` only waits for the container to *start*, not for the service to accept
  connections — tests then race the database and fail with connection errors.
- **Seed is a one-shot container, not a long-running service.** It uses `depends_on:
  condition: service_completed_successfully`, so the app starts only after seeding *exits 0*.
  Teams that model seed as a long-running service get a race where the app boots mid-seed.

See `references/docker-compose.md` for the full `docker-compose.test.yml`, the
`trap`-guarded integration test runner, the multi-stage Dockerfile (with the `production`
target), and the MinIO block.

### Multi-Stage Dockerfile

One `base` layer installs deps once; `development`, `test`, and `seed` stages reuse it; and a
slim `production` stage runs prod deps only (`npm ci --omit=dev`) with build artifacts copied
from the `test` stage. The split keeps test dependencies and source out of the shipped image
while giving each environment its own entrypoint. Use `npm ci --include=dev` in `base` — the
modern flag; `--production=false` is legacy `--omit`/`--include` syntax. Full Dockerfile in
`references/docker-compose.md`.

---

## External Dependency Management

### Stubbing Strategy by Dependency Type

| Dependency Type | Local/CI Strategy | Staging Strategy |
|----------------|-------------------|------------------|
| Payment (Stripe) | MSW handler returning mock responses | Stripe test mode with `sk_test_` keys |
| Email (SendGrid) | **Mailpit** capturing SMTP (web UI on :8025, SMTP on :1025) | SendGrid sandbox mode |
| Auth (Auth0) | Local JWT issuer with test keys | Auth0 dev tenant |
| Storage (S3) | MinIO container (S3-compatible) | Dedicated test bucket with lifecycle policy |
| Search (Elasticsearch) | Testcontainers Elasticsearch | Dedicated test index with reset script |
| SMS (Twilio) | MSW handler | Twilio test credentials |

**Avoid: MailHog** — unmaintained, last release 2020. Use Mailpit (`axllent/mailpit`); it is a
drop-in on the same ports (1025 SMTP / 8025 UI).

### MSW for HTTP Stubs

Stub external APIs at the HTTP boundary with MSW 2.x: `http` + `HttpResponse` from `msw`,
`setupServer` from `msw/node`, lifecycle wired through `beforeAll`/`afterEach`/`afterAll`. Set
`onUnhandledRequest: "error"` so an unmocked external call fails the test loudly instead of
leaking a real network request. See `references/stubbing.md` for the Stripe/SendGrid/geocoding
handlers and the server lifecycle.

### MinIO as an S3 Substitute

Run S3-compatible storage in a container instead of hitting real AWS in local/CI tests. Point
the AWS SDK `S3Client` at it with `endpoint`, env-var credentials, and `forcePathStyle: true`
(required for MinIO). Compose service + client config in `references/docker-compose.md`.

### Contract Testing as Stub Validation

Stubs drift from reality. Pair every stub with a contract test that verifies the stub matches
the real API shape. For details, see `contract-testing`.

---

## Environment Parity Checklist

Run this when setting up or auditing a non-production environment.

| Dimension | Question | Red Flag |
|-----------|----------|----------|
| **Database engine** | Same engine and version as production? | SQLite in test, PostgreSQL in prod |
| **Database schema** | Same migration pipeline applied? | Manual schema changes in staging |
| **Data shape** | Seed data covers all entity states? | Only "happy path" records, no edge cases |
| **Infrastructure** | Same container orchestration? | Docker Compose in CI, Kubernetes in prod |
| **Network** | Same internal service topology? | Monolith in test, microservices in prod |
| **Config** | Env vars documented and version-controlled? | Undocumented env vars, manual setup |
| **Auth** | Same auth provider/flow? | Bypassed auth in test with hardcoded tokens |
| **Feature flags** | Same flag evaluation engine? | Hardcoded flags in test, LaunchDarkly in prod |
| **TLS/HTTPS** | Same certificate handling? | HTTP in staging, HTTPS in prod |
| **Timeouts/Limits** | Same rate limits, pools, timeouts? | Infinite timeouts in test hide perf issues |

For factory-based seed data patterns, see `test-data-management`.

---

## Anti-Patterns

**Shared staging as the only test environment.** One developer's broken deploy blocks everyone.
Use ephemeral per-PR environments for isolation and keep staging for final pre-release
validation only.

**Production database copies for test data.** PII risk, non-reproducible state, massive
datasets that slow tests. Build minimal seed data from factories with deterministic values.

**Environment-specific code paths.** `if (process.env.NODE_ENV === "test") { skipAuth(); }`
means you are not testing the real auth flow. Swap implementations via dependency injection or
config, not environment conditionals.

**Manual environment setup.** If setup needs a 15-step wiki page, it will be wrong within a
week. Script everything: `docker compose up -d && npm run db:seed` should be the only steps.

**Stubbing internal services instead of external ones.** Stub at the HTTP boundary where your
system talks to the outside world. Stubbing internal modules hides integration bugs between
your own services.

**No health checks in Docker Compose.** `depends_on` without a healthcheck waits only for the
container to start, not for the service to be ready — tests race the database and fail with
connection errors.

**Long-lived preview environments.** Previews that persist after merge waste resources and
accumulate stale state. Automate teardown on PR close (`if: github.event.action == 'closed'`).

---

## Verification

Run these against the artifacts you produce, smallest check first:

1. **Compose file is valid** — `docker compose -f docker-compose.test.yml config -q` exits 0
   (catches YAML and schema errors before you ever pull an image).
2. **Stack comes up healthy** — `docker compose -f docker-compose.test.yml up -d --wait
   --wait-timeout 60` exits 0; a non-zero exit means a healthcheck never went green.
3. **Database accepts connections** — `docker compose exec postgres pg_isready -U test -d
   testdb` reports `accepting connections`.
4. **Dockerfile builds the production target** — `docker build --target production -t app:prod
   .` succeeds, and `docker run --rm app:prod npm ls --omit=dev --depth=0` shows no dev deps.
5. **Stubs fail loud** — run the suite with `onUnhandledRequest: "error"`; any real outbound
   call should error the test, not pass silently.

---

## Done When

- Environment inventory documented (dev, CI, preview, staging, production) with characteristics and access notes per tier.
- `docker compose -f docker-compose.test.yml config -q` exits 0 and `docker compose up -d --wait` brings every service to a passing healthcheck (exit 0).
- Multi-stage Dockerfile builds the `production` target with `--omit=dev` (no dev dependencies in the shipped image).
- Seed scripts are idempotent (running twice exits 0, no duplicate-key errors) and checked into the repository.
- External dependencies are stubbed at the HTTP boundary with `onUnhandledRequest: "error"`; no real third-party credentials in non-prod.
- Environment parity gaps documented (e.g. SQLite in CI vs PostgreSQL in prod) with mitigations in place or tracked as issues.
- Preview environments auto-created for PRs and auto-torn-down on close (`if: github.event.action == 'closed'`).

---

## Reference Files (in `references/`)

- **docker-compose.md** — full `docker-compose.test.yml` (Postgres 18, Redis 8, one-shot seed, Mailpit), the `trap`-guarded integration test runner, the multi-stage Dockerfile (base/development/test/seed/production), and the MinIO service + S3 client config.
- **stubbing.md** — MSW 2.x handlers for Stripe/SendGrid/geocoding and the `setupServer` lifecycle with `onUnhandledRequest: "error"`.

---

## Related Skills

- **service-virtualization** — Decision framework for choosing mock vs stub vs fake vs real per dependency, and WireMock/MSW depth. Go there to *decide* the stubbing approach; this skill wires the chosen stub into the environment.
- **test-data-management** — Factory patterns, synthetic data, database seeding, and DB branching (Neon/Supabase/PlanetScale) for per-PR DB copies.
- **ci-cd-integration** — Pipeline config, GitHub Actions services, artifact management, sharding, and self-hosted runners. Go there for the surrounding workflow; this skill defines the services it runs against.
- **contract-testing** — Consumer-driven contracts that verify your stubs match real APIs.
