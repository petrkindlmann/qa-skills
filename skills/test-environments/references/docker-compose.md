# Docker Compose for Testing — Full Configs

The decision prose, environment tiers, and the docker-compose-vs-Testcontainers note live
in `SKILL.md`. This file holds the runnable `docker-compose.test.yml`, the integration test
runner script, the multi-stage Dockerfile (with the production target), and the MinIO block.

## `docker-compose.test.yml`

A Compose template that spins up the full stack for integration and E2E tests.
Note `mailpit` (not MailHog — unmaintained, last release 2020) and the `seed` service using
`condition: service_completed_successfully` so the app only starts after seeding *finishes*.
Adapt the build, seed command, and `/health` endpoint to the application. The health check
uses [Node's built-in `fetch`](https://nodejs.org/api/globals.html#fetch), available in the
shown Node 24 image, without installing curl.

For PostgreSQL 18, mount the named volume at `/var/lib/postgresql`; the image's default
`PGDATA` is `/var/lib/postgresql/18/docker`. The older `/var/lib/postgresql/data` mount
belongs to the default layout of PostgreSQL 17 and earlier. See the
[official image documentation](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).

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
      - "127.0.0.1:${TEST_APP_PORT:-3000}:3000"
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
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 5s
      timeout: 3s
      retries: 10

  postgres:
    image: postgres:18-alpine
    ports:
      - "127.0.0.1:${TEST_POSTGRES_PORT:-5432}:5432"
    environment:
      POSTGRES_DB: testdb
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    volumes:
      - postgres-test-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test -d testdb"]
      interval: 3s
      timeout: 2s
      retries: 10

  redis:
    image: redis:8-alpine
    ports:
      - "127.0.0.1:${TEST_REDIS_PORT:-6379}:6379"
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

  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "127.0.0.1:${TEST_MAILPIT_UI_PORT:-8025}:8025"   # Web UI
      - "127.0.0.1:${TEST_MAILPIT_SMTP_PORT:-1025}:1025" # SMTP

volumes:
  postgres-test-data:
```

## Running Tests Against Docker Compose

This host runner assumes a local Docker daemon. It connects through the published
loopback ports; containers use the service names `postgres:5432` and `redis:6379` instead.
Export `TEST_POSTGRES_PORT` and `TEST_REDIS_PORT` when overriding the defaults. The runner
exports their resolved values so Compose interpolation and the host connection URLs agree,
including when a Compose `.env` file contains different defaults.

The default `app-test` project and host ports support one stack at a time on a Docker host.
For parallel jobs, set a unique `COMPOSE_PROJECT_NAME` **and** allocate noncolliding values
for all five `TEST_*_PORT` variables above. Project names isolate containers, networks,
and named volumes; they do not isolate published host ports. Update any host-side app or
Mailpit URLs to those ports too. Each runner must own its project exclusively because
`down -v` removes that project's volumes. See Docker's
[project names](https://docs.docker.com/compose/how-tos/project-name/) and
[port mappings](https://docs.docker.com/reference/compose-file/services/#ports).

The `EXIT` trap attempts cleanup after normal success or failure, preserving the original
startup/test exit status even if teardown fails. Handled `INT` and `TERM` signals exit
through the same cleanup path. This is best effort: `SIGKILL`, host loss, or an unavailable
Docker daemon can leave resources behind. CI should also have an independent cleanup job
or resource expiry policy for those cases.

```bash
#!/bin/bash
# scripts/test-integration.sh
set -euo pipefail

COMPOSE_FILE="docker-compose.test.yml"
export TEST_POSTGRES_PORT="${TEST_POSTGRES_PORT:-5432}"
export TEST_REDIS_PORT="${TEST_REDIS_PORT:-6379}"

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  echo "Tearing down test environment..."
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans ||
    echo "Warning: test environment teardown failed." >&2
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting test infrastructure..."
docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 60

echo "Running integration tests..."
DATABASE_URL="postgres://test:test@127.0.0.1:${TEST_POSTGRES_PORT}/testdb" \
REDIS_URL="redis://127.0.0.1:${TEST_REDIS_PORT}" \
  npx vitest run --project=integration

echo "Tests complete."
```

## Multi-Stage Dockerfile

One `base` layer installs deps once; `development`, `test`, and `seed` reuse it, and
`production` is a slim runtime that excludes dev dependencies. Use `npm ci --include=dev` in
`base` (the modern flag; `--production=false` is legacy `--omit`/`--include` syntax). The
`production` stage is what the prose means by "the dev-deps-excluded image."

```dockerfile
# Dockerfile
FROM node:24-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev

FROM base AS development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

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

# Slim runtime: production deps only, build artifacts copied from `test`.
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=test /app/dist ./dist
EXPOSE 3000
CMD ["npm", "start"]
```

## MinIO as an S3 Substitute

S3-compatible object storage in a container — no real AWS bucket needed for local/CI tests.

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
