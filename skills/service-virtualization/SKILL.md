---
name: service-virtualization
description: >-
  Decision framework for isolating every external dependency in a test suite: when to use
  in-process mocks, HTTP stubs (MSW, WireMock), record-replay, fault injection (Toxiproxy), or
  ephemeral real services (Testcontainers), and how to enforce that no real calls escape in CI.
  Use when: "mock service," "stub API," "fake service," "WireMock," "MSW," "Toxiproxy,"
  "test isolation," "dependency management," "stub an external API in CI."
  Not for: consumer-driven contract verification (Pact, broker) — use contract-testing; standing
  up a full Docker Compose env or seed data — use test-environments; broad resilience/game-day
  fault campaigns — use chaos-engineering.
  Related: contract-testing, test-environments, api-testing, test-data-management, chaos-engineering.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: infrastructure
---

<objective>
Mock Stripe at the SDK layer and your tests pass green while production 500s the moment Stripe
changes a response field — because the stub was never tied to a contract. This skill picks the
right isolation strategy per dependency (in-process mock, HTTP stub, record-replay, fault
injection, or ephemeral real service), stubs at the HTTP layer so tests survive SDK upgrades, and
makes the CI run fail when any real call escapes the stubs.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Node/browser test hitting an external HTTP API | MSW → `references/msw.md` |
| Polyglot CI, complex matching, or you need a standalone stub server | WireMock → `references/wiremock.md` |
| Dependency is a DB / cache / queue | Testcontainers → `references/testcontainers.md` |
| Testing timeouts, latency, connection resets | Toxiproxy → `references/toxiproxy.md` |
| Bootstrapping stubs from a real API, or a multi-step baseline | Record-replay → `references/record-replay.md` |
| Wiring any of these into GitHub Actions | `references/ci.md` |
| Not sure which to reach for | Decision Tree (below) |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it, respect existing mocking
conventions, and skip anything answered there. Then:

- **How many external dependencies does the system call, and which are painful in tests?**
  Rate-limited, slow, flaky, or paid dependencies are the highest-priority virtualization
  candidates; list payment, email, auth, and third-party data sources.
- **What testing levels need isolation?** Unit tests want fast in-process mocks; integration tests
  want HTTP-level stubs; E2E wants real or containerized services — the level sets the strategy.
- **Does the provider offer an official test mode or sandbox?** Stripe test mode, Twilio test
  creds, etc. beat any home-grown stub for fidelity — prefer them where they exist.
- **Do you have contracts with these dependencies?** If yes, contract tests keep stubs in sync;
  see `contract-testing`. If no, mocking what you don't own is a known risk (Core Principle 3).
- **Docker available in CI?** No Docker steers you to MSW (in-process); Docker unlocks WireMock,
  Testcontainers, and Toxiproxy.

---

## Core Principles

**1. Match the isolation level to the confidence you need.** Unit tests can mock aggressively —
they test internal logic. Integration tests should use realistic stubs or real services because
they test boundaries. E2E should run the closest thing to production that is still reliable.

**2. Real services beat fakes when they're fast, free, and reliable.** A local PostgreSQL
container gives more confidence than a fake and costs little — prefer it. Reserve fakes for
dependencies that are slow, unreliable, or paid.

**3. Never mock what you don't own without a contract — and prefer the provider's test mode.** If
you stub Stripe and Stripe changes its response shape, your tests stay green while production
breaks. In order of preference: use the provider's official test mode/sandbox (Stripe test mode,
Twilio test creds) → an HTTP stub validated by a contract test for drift → a bare stub only when
nothing better exists. See `contract-testing`.

**4. Stubs must fail realistically.** A stub that always returns 200 never exercises error
handling. Every stub needs error variants: 429 rate limits, 500s, timeouts, malformed bodies.

**5. One abstraction layer between test and tool.** Wrap MSW handlers, WireMock stubs, and
Testcontainers setup behind a consistent interface so switching tools doesn't mean rewriting tests.

---

## Decision Framework

### When to use each isolation strategy

| Strategy | Speed | Fidelity | Complexity | Best for |
|----------|-------|----------|------------|----------|
| **In-process mock** | Fastest | Lowest | Trivial | Unit tests, isolating internal modules |
| **HTTP stub (MSW)** | Fast | Medium | Low | Frontend/Node tests hitting external APIs |
| **HTTP stub (WireMock)** | Fast | Medium-High | Medium | Language-agnostic, complex matching rules |
| **Record-replay** | Fast after first run | High initially, decays | Medium | Bootstrapping stubs from real APIs quickly |
| **Service fake** | Medium | High | High | Stateful dependencies (in-memory DB, fake auth) |
| **Ephemeral real (Testcontainers)** | Slower | Highest | Medium | Databases, message queues, caches |
| **Shared real service** | Slow | Production-level | Low (to set up) | Staging validation, final pre-deploy check |

### Decision tree

```
Is the dependency internal to your codebase?
├─ Yes → In-process mock (vi.mock / jest.mock / monkeypatch)
└─ No → Is it a database, cache, or message queue?
         ├─ Yes → Testcontainers (ephemeral real instance)
         └─ No → Is it a third-party HTTP API?
                  ├─ Yes → Does the provider offer a test/sandbox mode?
                  │        ├─ Yes → Use sandbox in staging, MSW/WireMock in CI
                  │        └─ No → MSW or WireMock + contract test for drift detection
                  └─ No → Is it an internal microservice?
                           ├─ Yes → Contract test (Pact) + stub for consumer tests
                           └─ No → Evaluate case by case
```

---

## Tools

Pick **MSW** as the default for in-process Node/browser tests; **WireMock** for cross-language CI
or standalone stub servers; **Prism** when the OpenAPI spec is the contract; **Mockoon** for
dev-time exploratory mocking. Heavy code for each lives in `references/` — pointers below.

### MSW (Mock Service Worker)

MSW 2.x intercepts HTTP at the network layer (Service Worker in the browser, request interception
in Node). The default for JS/TS projects. Stub at the HTTP layer (`POST /v1/payment_intents`),
never at the SDK method — that decouples the test from the SDK version.

The strongest enforcement seam this skill offers: `setupServer(...).listen({ onUnhandledRequest })`.
Set it to `"error"` in CI so any escaped real call fails the run; `"warn"` is fine locally while
iterating.

See `references/msw.md` for centralized stateful handlers (payments), the Vitest setup with the
CI/local `onUnhandledRequest` switch, per-test timeout/retry overrides, and a full stateful auth
flow (create / verify / refresh / **revoke via `http.delete`**) keyed on a `Bearer` token.

### WireMock

Language-agnostic HTTP stub server (current stable **3.13.2** — 4.0 is beta-only as of mid-2026,
stay on 3.x for CI). Runs standalone or as a Docker container. Best for polyglot environments or
complex matching rules.

Use **priority-based mappings** for error scenarios: a `priority: 1` mapping that matches an
opt-in header (`X-Test-Scenario: rate-limit`) and returns 429 shadows the default happy-path
mapping only when the test asks for it. WireMock also exposes an admin API for programmatic stub
creation (`POST /__admin/mappings`), verification (`POST /__admin/requests/count`), and reset
(`POST /__admin/mappings/reset`).

See `references/wiremock.md` for the Docker setup, a response-templated paginated mapping, the
priority error mapping JSON, and the drift-detection seam to `contract-testing` (replay a Pact or
validate the stub against the OpenAPI spec via Prism).

### Other HTTP mock servers

| Tool | Strengths | When to use |
|------|-----------|-------------|
| **Mockoon** | Desktop UI + CLI; OpenAPI import; rule-based responses; lightweight | Dev-time mocking and quick CLI mocks in CI |
| **Hoverfly** | Capture-replay (record real traffic, replay deterministically); capture/simulate/modify/synthesize modes | Migrating from a real dependency to a mock — record once, replay forever |
| **Prism** | OpenAPI-driven mock server (Stoplight); validates requests + generates responses from spec | OpenAPI-first projects with a published spec |
| **MockServer** | Java-based; rich expectation matching; multi-protocol | JVM teams already on MockServer |

### Testcontainers

Spin up **real** services in Docker for integration tests — containers start before the suite and
are destroyed after. Use `@testcontainers/postgresql` 11.x and friends. Ports are **random**;
always read them via `getMappedPort()` / `getConnectionUri()`, never hardcode 5432/6379.

See `references/testcontainers.md` for parallel PostgreSQL + Redis + Elasticsearch startup with
wait strategies, the Vitest `globalSetup` wiring (`process.env.DATABASE_URL`, `testTimeout: 30_000`),
and the note on refreshing aging image tags (`elasticsearch:8.12.0` is behind Elastic 9.x).

### Toxiproxy (fault injection)

`ghcr.io/shopify/toxiproxy:2.12.0` sits between your app and a dependency as a TCP proxy and
injects latency, bandwidth limits, and connection resets. Point your app at the **proxy** port,
not the real service. Always remove toxics in `afterEach` — they leak across tests otherwise.

See `references/toxiproxy.md` for the compose port mapping, the `createProxy(name, listen,
upstream)` wiring (including how the compose `15432`/`16379` proxy ports map to the real upstream),
the helpers with `response.ok` checks on every call, and a latency + connection-reset usage example.
For broad resilience/game-day work, go to `chaos-engineering` instead.

---

## Record-Replay

Record-replay captures real API responses once and replays them deterministically — good for
bootstrapping stubs and for a regression baseline of a multi-step interaction. Implement it with a
record-replay library (**Hoverfly**, **Polly.JS**, or **VCR**-style cassettes), not a hand-rolled
recorder.

It breaks on dynamic data (timestamps, UUIDs), stateful sequences, and age — recordings go stale
within weeks. Always stamp a `recordedAt` and **fail the test when a recording is older than 30
days**, forcing a re-record.

See `references/record-replay.md` for the cassette format, the `assertFresh()` 30-day expiry check,
and a replay harness driving a multi-step flow (create order → add items → apply coupon → checkout).

---

## CI Integration

MSW needs zero infrastructure — it intercepts in-process, so CI runs exactly like local; the only
rule is to set `onUnhandledRequest: error` in CI (quoted `"error"` in JS) so an escaped real call
hard-fails the run. WireMock and Testcontainers need Docker.

Two **incompatible port models** coexist and must not be mixed in one suite: the docker-compose
model publishes **fixed** ports (a hardcoded `DATABASE_URL=...localhost:5432...` works), while the
Testcontainers model uses **random** ports read via `getMappedPort()` and injected into
`process.env`. Pick one per suite.

See `references/ci.md` for the MSW step, the docker-compose GitHub Actions job (`up -d --wait
--wait-timeout 120`, `if: always()` teardown), and the tool-by-constraint table.

---

## Anti-Patterns

### 1. Mocking everything
If every dependency is mocked, your tests verify that your mocks work, not that your system works.
Use real services for databases and caches (via Testcontainers); only stub external HTTP APIs.

### 2. Inconsistent mock behavior across tests
One test stubs Stripe as `{ id: "pi_123" }`, another as `{ paymentIntentId: "pi_123" }` — now you
have two conflicting versions of reality. Centralize handlers and reuse one response shape across
the whole suite (see the shared shape in `references/msw.md`).

### 3. Not updating stubs when the API changes
Your mapping says Stripe returns `{ amount: 1000 }` but the real API now returns
`{ amount: 1000, currency: "usd" }`. Tests pass, production fails. Use contract tests to detect
drift — see `contract-testing` and the drift seam in `references/wiremock.md`.

### 4. Stubbing the wrong layer
Mocking `stripe.paymentIntents.create` (the SDK method) couples the test to the SDK version. Stub
at the HTTP layer (`POST /v1/payment_intents`) so the test works regardless of HTTP client or SDK
version.

### 5. No error-scenario coverage
Stubs that always return 200 never exercise retry logic, timeout handling, rate-limit backoff, or
error parsing. Every stub needs a corresponding error variant.

### 6. Shared, long-lived mock servers
A shared WireMock instance that multiple CI jobs hit introduces coupling and state leakage. Each
test run starts its own isolated stub server.

### 7. Record-replay without expiration
Recordings from six months ago reflect an API that no longer exists. Stamp `recordedAt` and fail
the test when recordings exceed 30 days, forcing a re-record (see `references/record-replay.md`).

---

## Verification

Prove no real call escaped, smallest check first:

```bash
# 1. MSW: any unhandled request must hard-fail the suite in CI
CI=1 npm run test:integration            # onUnhandledRequest:"error" → exit 0 means nothing escaped

# 2. WireMock/Testcontainers: confirm containers are reachable, then teardown leaves nothing
docker compose -f docker-compose.test.yml up -d --wait --wait-timeout 120 && echo OK
docker compose -f docker-compose.test.yml down -v

# 3. Grep CI logs for outbound calls to the real provider's host (should print nothing)
grep -iE "api\.stripe\.com|api\.twilio\.com" ci-run.log && echo "LEAK" || echo "clean"
```

A green run under `CI=1` with `onUnhandledRequest:"error"` plus an empty grep for the real host is
the proof that the suite ran fully virtualized.

---

## Done When

- A dependency isolation strategy is decided and documented for each external dependency (which get
  MSW/WireMock stubs, which use Testcontainers, which use the provider's sandbox mode).
- Stubs cover all critical external dependencies with at least one error path each (4xx/5xx,
  timeout, or rate limit).
- Stubs and mapping files are versioned alongside test code in the same repository.
- The suite runs green in CI with `onUnhandledRequest: "error"` (or the WireMock equivalent), and a
  grep of CI logs for the real provider host returns nothing.
- Any record-replay baseline carries a `recordedAt` stamp and a 30-day expiry check that fails the
  test when stale.

## Reference Files (in `references/`)

- **msw.md** — centralized stateful handlers, Vitest setup with the CI/local `onUnhandledRequest`
  switch, per-test timeout/retry overrides, and the full create/verify/refresh/revoke auth flow.
- **wiremock.md** — Docker setup, response-templated and paginated mappings, the priority-based
  error mapping, the admin API, and the contract-drift seam (Pact/Prism).
- **testcontainers.md** — parallel PostgreSQL/Redis/Elasticsearch startup, `globalSetup` wiring,
  and the image-tag refresh note.
- **toxiproxy.md** — compose ports, `createProxy` upstream wiring, helpers with `response.ok`
  checks, and a latency + reset usage example.
- **record-replay.md** — tooling choices, the cassette format, the 30-day `assertFresh` check, and
  a multi-step replay harness.
- **ci.md** — MSW (zero-infra), the docker-compose GitHub Actions job, the two port models, and the
  tool-by-constraint table.

## Related Skills

- **contract-testing** — Consumer-driven contract verification with Pact/broker; go there to prove
  a stub matches a real provider, not just to detect drift against a shared schema.
- **test-environments** — Full Docker Compose env strategy, preview environments, and seed data; go
  there for standing up the environment, not for isolating a single dependency.
- **chaos-engineering** — Broad fault-injection campaigns, game days, and blast-radius limits; go
  there when resilience itself is the goal rather than making one dependency misbehave in a test.
- **api-testing** — REST/GraphQL testing patterns, schema validation, and auth flow testing.
- **test-data-management** — Factory patterns and data seeding for stub state setup.
