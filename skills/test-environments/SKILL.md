---
name: test-environments
description: >-
  Design environment strategy for testing across dev, staging, preview, and production.
  Covers Docker Compose for test infrastructure, seed data management, environment
  parity with production, ephemeral preview environments, and external dependency
  stubbing strategies. Use when: "test environment," "staging," "Docker," "test infra,"
  "preview environment," "environment parity."
  Related: test-data-management, ci-cd-integration, contract-testing, service-virtualization.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: infrastructure
---

<objective>
Design and manage test environments that give confidence without slowing teams down.
</objective>

---

## Discovery Questions

1. **How many environments exist today?** Local dev, CI, staging, preview, production? Map what you have before designing what you need.
2. **Is the app containerized?** Docker/Docker Compose in use? Check for `Dockerfile`, `docker-compose.yml`, or `compose.yaml`.
3. **How is test data seeded?** Manual SQL scripts, migration-based, factory libraries, or snapshots from production?
4. **How close is staging to production?** Same infrastructure (K8s, managed DB, CDN)? Same data shape? Same config?
5. **External dependencies:** How many third-party APIs does the system call? Are they stubbed in non-production environments?
6. **Check `.agents/qa-project-context.md` first.** Respect existing infrastructure decisions and constraints.

---

## Core Principles

**1. Staging must mirror production.** If staging uses SQLite and production uses PostgreSQL, staging tests prove nothing. Match the database engine, the queue system, the cache layer, and the auth provider.

**2. Ephemeral environments beat long-lived ones.** A shared staging environment becomes a bottleneck where one broken deploy blocks the entire team. Per-PR preview environments provide isolation and parallel testing.

**3. Deterministic seed data, not production copies.** Production snapshots contain PII, stale references, and non-reproducible state. Build seed data from factories that generate consistent, valid, minimal datasets.

**4. Stub external dependencies at the boundary, not deep inside.** Third-party APIs are unreliable, rate-limited, and expensive. Stub them at the HTTP boundary using WireMock, MSW, or contract-verified fakes -- never by mocking internal service classes.

**5. Environment config is code.** Every environment difference (URLs, feature flags, credentials, resource limits) must be version-controlled and reviewable. No manual configuration that cannot be reproduced.

---

## Environment Strategy

### Environment Tiers

| Environment | Purpose | Data | External Deps | Lifecycle |
|-------------|---------|------|---------------|-----------|
| **Local dev** | Fast inner loop | Seeded fixtures, minimal | Stubbed (MSW/WireMock) | Developer-managed |
| **CI** | Automated validation | Seeded per-run, ephemeral | Stubbed or containerized | Created/destroyed per pipeline |
| **Preview** | PR-level review & E2E | Seeded from factories | Stubbed or sandbox | Created on PR, destroyed on merge |
| **Staging** | Pre-production validation | Anonymized production-like | Real integrations (sandbox accounts) | Long-lived, regularly reset |
| **Production** | Live users | Real | Real | Permanent |

### Local Development

Fast feedback, zero shared state. Developers must be able to run the full stack locally in under 2 minutes.

```bash
# One-command local environment
docker compose -f docker-compose.test.yml up -d
npm run db:seed
npm run dev
```

Local environment uses Docker Compose for infrastructure deps (database, cache, message queue) but runs the application natively for fast reload. External APIs are stubbed with MSW handlers loaded automatically in dev mode.

### CI Environment

Fully containerized, created fresh for every pipeline run, destroyed after. No shared state between runs.

```yaml
# .github/workflows/test.yml
services:
  postgres:
    image: postgres:17-alpine
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

### Preview Environments (Per-PR)

Each pull request gets its own isolated environment. Reviewers can click a link and test the exact changes without interfering with other PRs.

**Vercel/Netlify (frontend):**

```yaml
# Automatic -- just connect the repo. Each PR gets a preview URL.
# Add E2E tests against the preview URL:
- name: Run E2E against preview
  env:
    BASE_URL: ${{ steps.deploy.outputs.preview-url }}
  run: npx playwright test --project=chromium
```

**Custom preview with Docker and unique namespace:**

```yaml
- name: Deploy preview
  run: |
    NAMESPACE="pr-${{ github.event.number }}"
    docker compose -f docker-compose.preview.yml \
      -p "$NAMESPACE" up -d
    echo "preview-url=https://${NAMESPACE}.preview.example.com" >> "$GITHUB_OUTPUT"

- name: Teardown preview
  if: github.event.action == 'closed'
  run: |
    NAMESPACE="pr-${{ github.event.number }}"
    docker compose -p "$NAMESPACE" down -v
```

### Staging

Long-lived environment that mirrors production infrastructure. Reset weekly or on-demand to prevent drift.

```bash
# Weekly staging reset (scheduled CI job)
#!/bin/bash
set -euo pipefail

echo "Resetting staging database..."
psql "$STAGING_DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Running migrations..."
npm run db:migrate -- --env staging

echo "Seeding anonymized data..."
npm run db:seed -- --env staging --dataset production-anonymized

echo "Verifying staging health..."
curl -sf https://staging.example.com/health || exit 1
echo "Staging reset complete."
```

---

## Docker Compose for Testing

A production-quality `docker-compose.test.yml` that spins up the full stack for integration and E2E tests.

```yaml
# docker-compose.test.yml
name: app-test

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: test  # Multi-stage: use the test stage
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: test
      DATABASE_URL: postgres://test:test@postgres:5432/testdb
      REDIS_URL: redis://redis:6379
      STRIPE_API_KEY: sk_test_fake  # Test-mode key, never real
      EMAIL_PROVIDER: stub          # Internal stub, no real emails
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      seed:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 5s
      timeout: 3s
      retries: 10

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: testdb
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    volumes:
      - postgres-test-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test -d testdb"]
      interval: 3s
      timeout: 2s
      retries: 10

  redis:
    image: redis:8-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 2s
      retries: 10

  seed:
    build:
      context: .
      dockerfile: Dockerfile
      target: seed
    environment:
      DATABASE_URL: postgres://test:test@postgres:5432/testdb
    depends_on:
      postgres:
        condition: service_healthy
    command: ["npm", "run", "db:seed"]

  mailhog:
    image: mailhog/mailhog:latest
    ports:
      - "8025:8025"   # Web UI for inspecting sent emails
      - "1025:1025"   # SMTP

volumes:
  postgres-test-data:
```

### Running Tests Against Docker Compose

```bash
#!/bin/bash
# scripts/test-integration.sh
set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"

cleanup() {
  echo "Tearing down test environment..."
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

echo "Starting test infrastructure..."
docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 60

echo "Running integration tests..."
DATABASE_URL="postgres://test:test@localhost:5432/testdb" \
REDIS_URL="redis://localhost:6379" \
  npx vitest run --project=integration

echo "Tests complete."
```

### Multi-Stage Dockerfile for Test Environments

```dockerfile
# Dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --production=false

FROM base AS test
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]

FROM base AS seed
COPY prisma/ ./prisma/
COPY scripts/seed.ts ./scripts/
COPY tsconfig.json ./
CMD ["npx", "tsx", "scripts/seed.ts"]
```

---

## External Dependency Management

### Stubbing Strategy by Dependency Type

| Dependency Type | Local/CI Strategy | Staging Strategy |
|----------------|-------------------|------------------|
| Payment (Stripe) | MSW handler returning mock responses | Stripe test mode with `sk_test_` keys |
| Email (SendGrid) | **Mailpit** (MailHog is unmaintained — last commit Feb 2024) capturing SMTP | SendGrid sandbox mode |
| Auth (Auth0) | Local JWT issuer with test keys | Auth0 dev tenant |
| Storage (S3) | MinIO container (S3-compatible) | Dedicated test bucket with lifecycle policy |
| Search (Elasticsearch) | Testcontainers Elasticsearch | Dedicated test index with reset script |
| SMS (Twilio) | MSW handler | Twilio test credentials |

### MSW Handlers for External APIs

```typescript
// test/mocks/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  // Stripe: create payment intent
  http.post("https://api.stripe.com/v1/payment_intents", async ({ request }) => {
    const body = await request.text();
    const params = new URLSearchParams(body);
    const amount = params.get("amount");

    return HttpResponse.json({
      id: "pi_test_" + Date.now(),
      amount: Number(amount),
      currency: params.get("currency") ?? "usd",
      status: "requires_payment_method",
      client_secret: "pi_test_secret_" + Date.now(),
    });
  }),

  // SendGrid: send email
  http.post("https://api.sendgrid.com/v3/mail/send", () => {
    return HttpResponse.json({ message: "success" }, { status: 202 });
  }),

  // Geocoding API
  http.get("https://maps.googleapis.com/maps/api/geocode/json", ({ request }) => {
    const url = new URL(request.url);
    const address = url.searchParams.get("address");

    return HttpResponse.json({
      results: [{
        formatted_address: address,
        geometry: { location: { lat: 40.7128, lng: -74.006 } },
      }],
      status: "OK",
    });
  }),
];
```

```typescript
// test/mocks/setup.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);

// In vitest.setup.ts or jest.setup.ts:
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Setting `onUnhandledRequest: "error"` ensures tests fail loudly if they hit an unmocked external API -- no silent network calls leaking into test runs.

### MinIO as S3 Substitute

```yaml
# In docker-compose.test.yml
minio:
  image: minio/minio:latest
  ports:
    - "9000:9000"
    - "9001:9001"  # Console
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  command: server /data --console-address ":9001"
  healthcheck:
    test: ["CMD", "mc", "ready", "local"]
    interval: 5s
    timeout: 3s
    retries: 5
```

```typescript
// Configure S3 client to point at MinIO in tests
import { S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  },
  forcePathStyle: true, // Required for MinIO
});
```

### Contract Testing as Stub Validation

Stubs drift from reality. Pair every stub with a contract test that verifies the stub matches the real API. For details, see `contract-testing`.

---

## Environment Parity Checklist

Run this checklist when setting up or auditing a non-production environment.

| Dimension | Question | Red Flag |
|-----------|----------|----------|
| **Database engine** | Same engine and version as production? | SQLite in test, PostgreSQL in prod |
| **Database schema** | Same migration pipeline applied? | Manual schema changes in staging |
| **Data shape** | Seed data covers all entity states? | Only "happy path" records, no edge cases |
| **Infrastructure** | Same container orchestration? | Docker Compose in CI, Kubernetes in prod |
| **Network** | Same internal service topology? | Monolith in test, microservices in prod |
| **Config** | Environment variables documented and version-controlled? | Undocumented env vars, manual setup |
| **Auth** | Same auth provider/flow? | Bypassed auth in test with hardcoded tokens |
| **Feature flags** | Same flag evaluation engine? | Hardcoded flags in test, LaunchDarkly in prod |
| **TLS/HTTPS** | Same certificate handling? | HTTP in staging, HTTPS in prod |
| **Timeouts/Limits** | Same rate limits, connection pools, timeouts? | Infinite timeouts in test hide perf issues |

For factory-based seed data patterns, see `test-data-management`.

---

## Anti-Patterns

**Shared staging as the only test environment.** One developer's broken deploy blocks everyone. Use ephemeral per-PR environments for isolation and keep staging for final pre-production validation only.

**Production database copies for test data.** PII risk, non-reproducible state, massive datasets that slow tests. Build minimal seed data from factories with deterministic values.

**Environment-specific code paths.** `if (process.env.NODE_ENV === "test") { skipAuth(); }` means you are not testing the real auth flow. Use dependency injection or configuration to swap implementations, not environment conditionals.

**Manual environment setup.** If setting up the test environment requires a wiki page with 15 steps, it will be wrong within a week. Script everything: `docker compose up -d && npm run db:seed` should be the only steps.

**Stubbing internal services instead of external ones.** Stub at the HTTP boundary where your system talks to the outside world. Stubbing internal modules hides integration bugs between your own services.

**No health checks in Docker Compose.** Without health checks, `depends_on` only waits for the container to start, not for the service to be ready. Tests start before the database accepts connections and fail with connection errors.

**Long-lived preview environments.** Preview environments that persist after the PR is merged waste resources and accumulate stale state. Automate teardown on PR close.

---

## Done When

- Environment inventory documented (dev, staging, preview, production) with characteristics and access notes for each tier
- Docker Compose config for the local environment verified working with a single `docker compose up` command
- Seed data scripts are idempotent and checked into the repository
- Environment parity gaps documented (e.g., SQLite in CI vs PostgreSQL in prod) with mitigations in place or tracked
- Preview environments auto-created for PRs and auto-torn-down on merge or close

---

## Related Skills

- **test-data-management** -- Factory patterns, synthetic data generation, database seeding strategies.
- **ci-cd-integration** -- Pipeline configuration, GitHub Actions services, artifact management.
- **contract-testing** -- Consumer-driven contracts that validate your stubs match real APIs.
- **service-virtualization** -- Decision framework for choosing mocks, stubs, fakes, or real services.
