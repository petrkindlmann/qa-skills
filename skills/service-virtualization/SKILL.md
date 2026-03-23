---
name: service-virtualization
description: >-
  Decision framework for dependency isolation in tests. When to use mocks, stubs,
  fakes, record-replay, or ephemeral real services. Covers WireMock, MSW (Mock
  Service Worker), toxiproxy, and test containers. Helps choose the right isolation
  strategy for each testing scenario. Use when: "mock service," "stub API," "fake
  service," "WireMock," "MSW," "test isolation," "dependency management."
  Related: contract-testing, test-environments, api-testing, test-data-management.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: infrastructure
---

# Service Virtualization

Choose the right isolation strategy for every dependency in your test suite.

---

## Discovery Questions

1. **How many external dependencies does your system call?** List them: payment APIs, email services, auth providers, third-party data sources. Each needs a strategy.
2. **Which dependencies are unreliable in tests?** Rate-limited, slow, flaky, or expensive? These are the highest-priority candidates for virtualization.
3. **What testing levels need isolation?** Unit tests need fast in-process mocks. Integration tests may need HTTP-level stubs. E2E tests might use real or containerized services.
4. **Do you have contracts with your dependencies?** If yes, contract tests can validate that your stubs stay in sync with reality. See `contract-testing`.
5. **What is the team's experience level?** Simple MSW handlers are easier to maintain than a full WireMock deployment.
6. **Check `.agents/qa-project-context.md` first.** Respect existing mocking conventions and infrastructure.

---

## Core Principles

**1. Match the isolation level to the confidence you need.** Unit tests can mock aggressively because they test internal logic. Integration tests should use realistic stubs or real services because they test boundaries. E2E tests should use the closest thing to production that is still reliable.

**2. Real services give more confidence than fakes.** When a real dependency is fast, reliable, and free to use in tests (e.g., a local PostgreSQL container), prefer it over a fake. Reserve fakes for dependencies that are slow, unreliable, or expensive.

**3. Never mock what you do not own without a contract.** If you mock Stripe's API and Stripe changes their response format, your tests still pass but production breaks. Either use contract tests to validate your mocks, or use Stripe's official test mode.

**4. Stubs must fail realistically.** If your stub always returns 200 OK, you never test error handling. Include failure scenarios: 429 rate limits, 500 errors, timeouts, malformed responses.

**5. One abstraction layer between test and virtualization tool.** Wrap MSW handlers, WireMock stubs, and Testcontainers setup behind a consistent interface. Switching tools should not require rewriting tests.

---

## Decision Framework

### When to Use Each Isolation Strategy

| Strategy | Speed | Fidelity | Complexity | Best For |
|----------|-------|----------|------------|----------|
| **In-process mock** | Fastest | Lowest | Trivial | Unit tests, isolating internal modules |
| **HTTP stub (MSW)** | Fast | Medium | Low | Frontend/Node tests hitting external APIs |
| **HTTP stub (WireMock)** | Fast | Medium-High | Medium | Language-agnostic, complex matching rules |
| **Record-replay** | Fast after first run | High initially, decays | Medium | Bootstrapping stubs from real APIs quickly |
| **Service fake** | Medium | High | High | Stateful dependencies (in-memory DB, fake auth) |
| **Ephemeral real (Testcontainers)** | Slower | Highest | Medium | Databases, message queues, caches |
| **Shared real service** | Slow | Production-level | Low (to set up) | Staging validation, final pre-deploy check |

### Decision Tree

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

### MSW (Mock Service Worker)

Intercepts HTTP requests at the network level. Works in both browser (Service Worker) and Node.js (request interception). The best choice for JavaScript/TypeScript projects.

**Setup:**

```bash
npm i -D msw
```

**Handlers with realistic behavior:**

```typescript
// test/mocks/handlers.ts
import { http, HttpResponse, delay } from "msw";

// Stateful handler: maintains state across requests within a test
function createPaymentHandlers() {
  const payments = new Map<string, { id: string; status: string; amount: number }>();

  return [
    // Create payment
    http.post("https://api.stripe.com/v1/payment_intents", async ({ request }) => {
      const body = await request.text();
      const params = new URLSearchParams(body);

      const id = `pi_test_${Date.now()}`;
      const payment = {
        id,
        status: "requires_confirmation",
        amount: Number(params.get("amount")),
      };
      payments.set(id, payment);

      return HttpResponse.json(payment, { status: 201 });
    }),

    // Confirm payment
    http.post<{ id: string }>(
      "https://api.stripe.com/v1/payment_intents/:id/confirm",
      async ({ params }) => {
        const payment = payments.get(params.id);
        if (!payment) {
          return HttpResponse.json(
            { error: { type: "invalid_request_error", message: "No such payment intent" } },
            { status: 404 }
          );
        }
        payment.status = "succeeded";
        return HttpResponse.json(payment);
      }
    ),

    // Retrieve payment
    http.get<{ id: string }>(
      "https://api.stripe.com/v1/payment_intents/:id",
      async ({ params }) => {
        const payment = payments.get(params.id);
        if (!payment) {
          return HttpResponse.json(
            { error: { type: "invalid_request_error", message: "No such payment intent" } },
            { status: 404 }
          );
        }
        return HttpResponse.json(payment);
      }
    ),
  ];
}

// Error simulation handlers
const errorHandlers = [
  // Rate limiting
  http.all("https://api.stripe.com/*", async ({ request }) => {
    // Only activate when the test sets this header
    if (request.headers.get("x-test-scenario") === "rate-limit") {
      await delay(100);
      return HttpResponse.json(
        { error: { type: "rate_limit_error", message: "Too many requests" } },
        { status: 429, headers: { "Retry-After": "1" } }
      );
    }
    // Fall through to other handlers
    return undefined;
  }),
];

export const handlers = [...createPaymentHandlers(), ...errorHandlers];
```

**Test setup (Vitest):**

```typescript
// vitest.setup.ts
import { setupServer } from "msw/node";
import { handlers } from "./mocks/handlers";

export const server = setupServer(...handlers);

beforeAll(() =>
  server.listen({
    onUnhandledRequest: "error", // Fail if any request hits a real API
  })
);

afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Per-test overrides:**

```typescript
import { http, HttpResponse } from "msw";
import { server } from "../vitest.setup";

it("should handle payment API timeout", async () => {
  // Override the default handler for this test only
  server.use(
    http.post("https://api.stripe.com/v1/payment_intents", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000)); // Simulate timeout
      return HttpResponse.json({});
    })
  );

  await expect(paymentService.createPayment(5000)).rejects.toThrow("Payment service timeout");
});

it("should retry on 503", async () => {
  let callCount = 0;
  server.use(
    http.post("https://api.stripe.com/v1/payment_intents", async () => {
      callCount++;
      if (callCount < 3) {
        return HttpResponse.json({ error: "Service unavailable" }, { status: 503 });
      }
      return HttpResponse.json({ id: "pi_success", status: "created" }, { status: 201 });
    })
  );

  const result = await paymentService.createPayment(5000);
  expect(result.id).toBe("pi_success");
  expect(callCount).toBe(3);
});
```

### WireMock

Language-agnostic HTTP stub server. Runs as a standalone process or Docker container. Best for polyglot environments or complex matching rules.

**Docker setup:**

```yaml
# In docker-compose.test.yml
wiremock:
  image: wiremock/wiremock:3.9.1
  ports:
    - "8080:8080"
  volumes:
    - ./wiremock/mappings:/home/wiremock/mappings
    - ./wiremock/__files:/home/wiremock/__files
  command: ["--verbose", "--global-response-templating"]
```

**Stub mapping files:**

```json
// wiremock/mappings/get-user.json
{
  "request": {
    "method": "GET",
    "urlPathPattern": "/api/users/[0-9]+",
    "headers": {
      "Authorization": { "matches": "Bearer .+" }
    }
  },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "jsonBody": {
      "id": "{{request.pathSegments.[2]}}",
      "name": "Test User",
      "email": "user-{{request.pathSegments.[2]}}@example.com"
    },
    "transformers": ["response-template"]
  }
}
```

Use priority-based mappings for error scenarios (e.g., a priority-1 mapping that matches `X-Test-Scenario: rate-limit` header and returns 429 with `Retry-After` header). Tests opt-in to error scenarios by setting the header.

WireMock also supports programmatic stub creation via its admin API (`POST /__admin/mappings`), verification (`POST /__admin/requests/count`), and reset (`POST /__admin/mappings/reset`). Wrap these in helper functions for cleaner test setup.

### Testcontainers

Spin up real services in Docker containers for integration tests. Containers start before the test suite and are destroyed after.

```bash
npm i -D testcontainers
```

```typescript
// test/helpers/containers.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let elasticsearch: StartedTestContainer;

export async function startContainers() {
  // Start all containers in parallel
  [postgres, redis, elasticsearch] = await Promise.all([
    new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("testdb")
      .withUsername("test")
      .withPassword("test")
      .start(),

    new RedisContainer("redis:7-alpine").start(),

    new GenericContainer("elasticsearch:8.12.0")
      .withEnvironment({
        "discovery.type": "single-node",
        "xpack.security.enabled": "false",
      })
      .withExposedPorts(9200)
      .withWaitStrategy(Wait.forHttp("/", 9200).forStatusCode(200))
      .start(),
  ]);

  return {
    databaseUrl: postgres.getConnectionUri(),
    redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    elasticsearchUrl: `http://${elasticsearch.getHost()}:${elasticsearch.getMappedPort(9200)}`,
  };
}

export async function stopContainers() {
  await Promise.all([
    postgres?.stop(),
    redis?.stop(),
    elasticsearch?.stop(),
  ]);
}
```

Wire into Vitest via `globalSetup` that calls `startContainers()` in `setup()` and `stopContainers()` in `teardown()`, setting `process.env.DATABASE_URL` etc. Set `testTimeout: 30_000` to account for container startup.

### Toxiproxy (Fault Injection)

Simulate network failures, latency, and bandwidth constraints. Sits between your app and its dependencies as a TCP proxy.

```yaml
# In docker-compose.test.yml
toxiproxy:
  image: ghcr.io/shopify/toxiproxy:2.9.0
  ports:
    - "8474:8474"   # API
    - "15432:15432"  # Proxied PostgreSQL
    - "16379:16379"  # Proxied Redis
```

```typescript
// test/helpers/toxiproxy.ts
const TOXIPROXY_API = "http://localhost:8474";

export async function createProxy(name: string, listen: string, upstream: string) {
  await fetch(`${TOXIPROXY_API}/proxies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, listen, upstream }),
  });
}

export async function addLatency(proxyName: string, latencyMs: number) {
  await fetch(`${TOXIPROXY_API}/proxies/${proxyName}/toxics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "latency",
      type: "latency",
      attributes: { latency: latencyMs, jitter: Math.floor(latencyMs * 0.1) },
    }),
  });
}

export async function severeConnection(proxyName: string) {
  await fetch(`${TOXIPROXY_API}/proxies/${proxyName}/toxics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "reset_peer",
      type: "reset_peer",
      attributes: { timeout: 0 },
    }),
  });
}

export async function removeToxics(proxyName: string) {
  const res = await fetch(`${TOXIPROXY_API}/proxies/${proxyName}/toxics`);
  const toxics = await res.json();
  for (const toxic of toxics) {
    await fetch(`${TOXIPROXY_API}/proxies/${proxyName}/toxics/${toxic.name}`, {
      method: "DELETE",
    });
  }
}
```

Use the helper functions in tests to inject latency (`addLatency("postgres", 5000)`) before asserting that the service handles timeouts, or sever connections (`severeConnection("postgres")`) to verify reconnection behavior. Always call `removeToxics` in `afterEach`.

---

## CI Integration

### MSW in CI (Zero Infrastructure)

MSW requires no additional services -- it intercepts requests in-process. No Docker, no ports, no health checks.

```yaml
# GitHub Actions -- MSW tests run exactly like local
- name: Run tests with MSW stubs
  run: npm run test:integration
```

### WireMock + Testcontainers in CI

```yaml
# GitHub Actions with Docker Compose for test infrastructure
- name: Start test infrastructure
  run: docker compose -f docker-compose.test.yml up -d --wait --wait-timeout 120

- name: Run integration tests
  env:
    WIREMOCK_URL: http://localhost:8080
    DATABASE_URL: postgres://test:test@localhost:5432/testdb
  run: npm run test:integration

- name: Teardown
  if: always()
  run: docker compose -f docker-compose.test.yml down -v
```

### Choosing the Right Tool for CI

| Constraint | Recommended Tool |
|-----------|-----------------|
| No Docker in CI runners | MSW (in-process) |
| Multi-language services | WireMock (language-agnostic) |
| Need real database behavior | Testcontainers or GitHub Actions services |
| Testing network failures | Toxiproxy + real/containerized services |
| Browser-based API mocking | MSW (browser mode with Service Worker) |

---

## Record-Replay

Record-replay captures real API responses and replays them in tests. Useful for bootstrapping stubs quickly when integrating a new third-party API.

**When it works:** Bootstrapping initial stubs, creating regression baselines for API responses.

**When it does not work:** APIs with dynamic data (timestamps, UUIDs), APIs that require stateful sequences, long-term maintenance (recordings go stale within weeks). Always add a `recordedAt` timestamp and fail tests when recordings are older than 30 days.

---

## Anti-Patterns

**Mocking everything.** If every dependency is mocked, your tests verify that your mocks work, not that your system works. Use real services for databases and caches (via Testcontainers), and only stub external HTTP APIs.

**Inconsistent mock behavior across tests.** If one test stubs Stripe to return `{ id: "pi_123" }` and another stubs it to return `{ paymentIntentId: "pi_123" }`, you have two conflicting versions of reality. Centralize handlers and share them across the test suite.

**Not updating stubs when APIs change.** Your WireMock mapping says Stripe returns `{ amount: 1000 }` but the real API now returns `{ amount: 1000, currency: "usd" }`. Your code works in tests but fails in production. Use contract tests to detect drift. See `contract-testing`.

**Stubbing the wrong layer.** Mocking `stripe.paymentIntents.create` (the SDK method) couples your test to the SDK version. Stub at the HTTP layer (`POST /v1/payment_intents`) so your test works regardless of which HTTP client or SDK version you use.

**No error scenario coverage.** If your stubs always return 200, you never test retry logic, timeout handling, rate limit backoff, or error parsing. Every stub should have a corresponding error variant.

**Using shared, long-lived mock servers.** A shared WireMock instance that multiple CI jobs hit introduces coupling and state leakage. Each test run should start its own isolated stub server.

**Record-replay without expiration.** Recordings from 6 months ago reflect an API that no longer exists. Add a `recordedAt` timestamp and fail tests when recordings are older than 30 days, forcing a re-record.

---

## Related Skills

- **contract-testing** -- Consumer-driven contracts with Pact.js that validate stubs match real APIs.
- **test-environments** -- Docker Compose infrastructure, environment strategy, and seed data management.
- **api-testing** -- REST/GraphQL testing patterns, schema validation, and auth flow testing.
- **test-data-management** -- Factory patterns and data seeding for stub state setup.
