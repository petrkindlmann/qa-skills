# CI integration — MSW, WireMock, and Testcontainers in GitHub Actions

## MSW in CI (zero infrastructure)

MSW needs no extra services — it intercepts in-process. No Docker, no ports, no health checks. The
only CI-specific rule: `onUnhandledRequest` must be `"error"` (see `references/msw.md`), so a real
call escaping the stubs fails the run.

```yaml
- name: Run tests with MSW stubs
  run: npm run test:integration   # onUnhandledRequest:"error" in CI; "warn" locally
```

## WireMock + Testcontainers in CI

Two **incompatible port models** live here — pick one per suite:

- **docker-compose model** — services publish **fixed** ports (`5432`, `8080`), so tests can use a
  hardcoded `DATABASE_URL=postgres://test:test@localhost:5432/testdb`.
- **Testcontainers model** — ports are **random**, read at runtime via `getMappedPort()`. The URL
  is injected into `process.env` by global setup (see `references/testcontainers.md`).

The snippet below uses the docker-compose (fixed-port) model. Do not pair its hardcoded
`localhost:5432` with the Testcontainers helper — they describe different worlds.

```yaml
# GitHub Actions — docker-compose (fixed-port) model
- name: Start test infrastructure
  run: docker compose -f docker-compose.test.yml up -d --wait --wait-timeout 120

- name: Run integration tests
  env:
    WIREMOCK_URL: http://localhost:8080
    DATABASE_URL: postgres://test:test@localhost:5432/testdb
  run: npm run test:integration

- name: Teardown
  if: always()   # tear down even when tests fail
  run: docker compose -f docker-compose.test.yml down -v
```

`--wait --wait-timeout 120` blocks until every service reports healthy (define `healthcheck:` in
the compose file). `if: always()` guarantees teardown on failure so containers don't leak across
runs.

## Choosing the right tool for CI

| Constraint | Recommended tool |
|-----------|-----------------|
| No Docker in CI runners | MSW (in-process) |
| Multi-language services | WireMock (language-agnostic) |
| Need real database behavior | Testcontainers or GitHub Actions services |
| Testing network failures | Toxiproxy + real/containerized services |
| Browser-based API mocking | MSW (browser mode with Service Worker) |
