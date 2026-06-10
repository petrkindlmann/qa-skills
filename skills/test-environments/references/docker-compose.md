# Docker Compose for Testing — Full Configs

The decision prose, environment tiers, and the docker-compose-vs-Testcontainers note live
in `SKILL.md`. This file holds the runnable `docker-compose.test.yml`, the integration test
runner script, the multi-stage Dockerfile (with the production target), and the MinIO block.

## `docker-compose.test.yml`

A production-quality compose file that spins up the full stack for integration and E2E tests.
Note `mailpit` (not MailHog — unmaintained, last release 2020) and the `seed` service using
`condition: service_completed_successfully` so the app only starts after seeding *finishes*.

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
    image: postgres:18-alpine
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

  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "8025:8025"   # Web UI for inspecting sent emails
      - "1025:1025"   # SMTP

volumes:
  postgres-test-data:
```

## Running Tests Against Docker Compose

A `trap`-guarded runner: it tears the environment down on *any* exit (success, failure, or
Ctrl-C), so a crashed test never leaves dangling containers or volumes behind.

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
