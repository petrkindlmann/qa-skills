# Pact.js Setup — Code

Runnable Pact.js code: install, consumer test, provider verification, and Pact Broker setup. The decision prose lives in `SKILL.md`; this file holds the implementations.

## Install

```bash
# Consumer side
npm i -D @pact-foundation/pact

# Provider side
npm i -D @pact-foundation/pact
```

## Consumer Test

The consumer defines what it needs from the provider. This generates a pact file (JSON contract).

> **Pact-JS v16 (Oct 2025) renamed `PactV4` → `Pact` and `MatchersV3` → `Matchers`.** The old names were removed in v16. If you copy from older blog posts/examples, update the imports. The API behavior is unchanged.

```typescript
// consumer/tests/contract/userApi.pact.spec.ts
// Requires @pact-foundation/pact >= 16
import { Pact, Matchers } from "@pact-foundation/pact";
import path from "path";
import { UserApiClient } from "../../src/userApiClient";

// Destructure for brevity, or access directly as Matchers.integer / Matchers.string /
// Matchers.regex / Matchers.eachLike — both forms are equivalent.
const { like, eachLike, integer, string, regex } = Matchers;

const provider = new Pact({
  consumer: "frontend-app",
  provider: "user-service",
  dir: path.resolve(__dirname, "../../../pacts"),
  logLevel: "warn",
});

describe("User API Contract", () => {
  it("should return a user by ID", async () => {
    await provider
      .addInteraction()
      .given("user 123 exists")
      .uponReceiving("a request for user 123")
      .withRequest("GET", "/api/users/123", (builder) => {
        builder.headers({ Accept: "application/json" });
      })
      .willRespondWith(200, (builder) => {
        builder
          .headers({ "Content-Type": "application/json" })
          .jsonBody({
            id: integer(123),
            name: string("Alice Johnson"),
            email: regex("alice@example.com", "^[\\w.+-]+@[\\w-]+\\.[\\w.]+$"),
            role: string("member"),
            createdAt: regex("2024-01-15T00:00:00Z", "^\\d{4}-\\d{2}-\\d{2}T.*Z$"),
          });
      })
      .executeTest(async (mockServer) => {
        const client = new UserApiClient(mockServer.url);
        const user = await client.getUser(123);

        expect(user.id).toBe(123);
        expect(user.name).toBeDefined();
        expect(user.email).toContain("@");
      });
  });

  it("should return 404 for non-existent user", async () => {
    await provider
      .addInteraction()
      .given("user 999 does not exist")
      .uponReceiving("a request for non-existent user")
      .withRequest("GET", "/api/users/999")
      .willRespondWith(404, (builder) => {
        builder.jsonBody({
          error: string("Not Found"),
          message: string("User 999 not found"),
        });
      })
      .executeTest(async (mockServer) => {
        const client = new UserApiClient(mockServer.url);
        await expect(client.getUser(999)).rejects.toThrow("User 999 not found");
      });
  });

  it("should return a paginated list of users", async () => {
    await provider
      .addInteraction()
      .given("users exist")
      .uponReceiving("a request for the user list")
      .withRequest("GET", "/api/users", (builder) => {
        builder.query({ page: "1", limit: "10" });
      })
      .willRespondWith(200, (builder) => {
        builder.jsonBody({
          data: eachLike({
            id: integer(1),
            name: string("Alice"),
            email: string("alice@example.com"),
          }),
          pagination: {
            page: integer(1),
            limit: integer(10),
            total: integer(42),
          },
        });
      })
      .executeTest(async (mockServer) => {
        const client = new UserApiClient(mockServer.url);
        const result = await client.listUsers({ page: 1, limit: 10 });

        expect(result.data.length).toBeGreaterThan(0);
        expect(result.pagination.page).toBe(1);
      });
  });
});
```

Running this test generates `pacts/frontend-app-user-service.json` -- the contract file.

## Provider Verification

The provider verifies it can satisfy all consumer contracts. This runs against the real provider implementation (not mocks).

In production, pull pacts from the **broker** (`pactBrokerUrl` + `consumerVersionSelectors`), not local files — the broker is the source of truth and knows which consumer versions are live. The `pactUrls` (local file) form is fine for a first spike but does not reflect what is actually deployed.

```typescript
// provider/tests/contract/providerVerification.spec.ts
import { Verifier } from "@pact-foundation/pact";
import { startApp, stopApp } from "../../src/server";

describe("Provider Verification", () => {
  let serverUrl: string;

  beforeAll(async () => {
    // Start the real provider with a test database
    const server = await startApp({ port: 0, dbUrl: process.env.TEST_DATABASE_URL });
    serverUrl = `http://localhost:${server.port}`;
  });

  afterAll(async () => {
    await stopApp();
  });

  it("should satisfy all consumer contracts", async () => {
    await new Verifier({
      providerBaseUrl: serverUrl,
      provider: "user-service",

      // Broker-driven (production): pull pacts the broker knows are live.
      // For a local spike instead, drop the broker fields and use:
      //   pactUrls: [path.resolve(__dirname, "../../../pacts/frontend-app-user-service.json")]
      pactBrokerUrl: process.env.PACT_BROKER_BASE_URL,
      pactBrokerToken: process.env.PACT_BROKER_TOKEN,
      consumerVersionSelectors: [
        { mainBranch: true },       // latest pact from each consumer's main branch
        { deployedOrReleased: true }, // pacts for versions currently in an environment
      ],

      // Pending pacts: a brand-new consumer interaction can land without breaking
      // the provider build — it is reported but does not fail until the consumer
      // marks it as expected. The standard incremental-adoption safety net.
      enablePending: true,
      includeWipPactsSince: "2024-01-01",

      // Provider states: set up data that matches consumer expectations
      stateHandlers: {
        "user 123 exists": async () => {
          await seedUser({ id: 123, name: "Alice Johnson", email: "alice@example.com" });
        },
        "user 999 does not exist": async () => {
          await clearUsers();
        },
        "users exist": async () => {
          await seedUsers(15); // Seed enough for pagination
        },
      },

      // Publish verification results back to broker
      publishVerificationResult: true,
      providerVersion: process.env.GIT_COMMIT ?? "local",
      providerVersionBranch: process.env.GIT_BRANCH ?? "local",
    }).verifyProvider();
  });
});
```

## Async / Message Contracts

Pact-JS v16's `Pact` class also supports **message pacts** for event-driven systems (Kafka, SNS/SQS, RabbitMQ) — the consumer asserts the shape of a message it expects to receive, and the provider verifies the message its producer emits. The HTTP examples above cover request/response APIs; reach for message pacts when the integration is a queue or topic rather than an endpoint. See the [Pact-JS message docs](https://github.com/pact-foundation/pact-js) for the `MessageConsumerPact` / message provider verifier API.

## Pact Broker Setup with Docker

The Pact Broker is the central registry where pact files are published and provider verification results are recorded. It enables the `can-i-deploy` workflow.

Inject every credential from the environment — including the Postgres password and the broker's DB URL. Hardcoding them in the compose file leaks secrets into version control and is exactly the anti-pattern this skill warns against. Pin the broker image to a released tag (not `:latest`) for reproducible builds.

```yaml
# docker-compose.pact-broker.yml
# Provide DB_PASSWORD and PACT_BROKER_PASSWORD via an untracked .env file.
services:
  pact-broker:
    image: pactfoundation/pact-broker:2.118.0  # pin a release; avoid :latest
    ports:
      - "9292:9292"
    environment:
      PACT_BROKER_DATABASE_URL: postgres://pact:${DB_PASSWORD}@postgres/pact
      PACT_BROKER_BASIC_AUTH_USERNAME: admin
      PACT_BROKER_BASIC_AUTH_PASSWORD: ${PACT_BROKER_PASSWORD}
      PACT_BROKER_ALLOW_PUBLIC_READ: "true"
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: pact
      POSTGRES_USER: pact
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pact-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pact"]
      interval: 3s
      timeout: 2s
      retries: 10

volumes:
  pact-db:
```

## Publishing Pacts (Consumer CI)

```bash
# After consumer tests generate pact files
npx pact-broker publish ./pacts \
  --consumer-app-version="$GIT_COMMIT" \
  --branch="$GIT_BRANCH" \
  --broker-base-url="https://pact.example.com" \
  --broker-token="$PACT_BROKER_TOKEN"
```
