---
name: contract-testing
description: >-
  Implement consumer-driven contract testing with Pact.js. Covers consumer test
  writing, provider verification, Pact Broker setup, can-i-deploy as deployment
  gate, webhook-triggered verification, and schema-first vs consumer-first approaches.
  Use when: "contract test," "Pact," "consumer-driven," "API contract," "provider
  verification," "can-i-deploy."
  Related: api-testing, ci-cd-integration, test-environments, service-virtualization.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: infrastructure
---

<objective>
Verify that services can communicate correctly without deploying them together.
</objective>

---

## Discovery Questions

1. **Architecture:** Microservices, monolith with separate consumers (mobile/SPA), or BFF pattern? Contract testing matters most when teams deploy independently.
2. **Who owns the contract?** Consumer-driven (consumers define what they need) or provider-driven (provider publishes a spec)? Most teams benefit from consumer-driven.
3. **API versioning strategy:** URL-based (`/v1/`, `/v2/`), header-based, or none? Contracts must account for version negotiations.
4. **How many consumer-provider pairs?** Start with the highest-traffic or most-fragile integration. Do not try to contract-test everything at once.
5. **Existing API specs:** Is there an OpenAPI/Swagger spec? If yes, consider schema-first contracts as a starting point.
6. **Check `.agents/qa-project-context.md` first.** Respect existing API conventions and testing infrastructure.

---

## Core Principles

**1. Consumers define what they need, providers verify they can deliver.** The consumer writes a test declaring "I will call `GET /users/123` and expect `{ id, name, email }`." The provider runs this test against its real implementation. If the provider cannot satisfy the contract, the build breaks before deployment.

**2. Contracts are the shared source of truth.** Not documentation, not Slack threads, not "just deploy and see." Contracts are executable tests that live in CI and block deployments on violation.

**3. Contract tests replace integration environments, not integration tests.** You still need integration tests for complex multi-step workflows. Contract tests eliminate the need to deploy consumer and provider together just to verify the interface.

**4. Break the build on contract violation.** A contract test that logs a warning but allows deployment provides zero value. Contracts must be deployment gates.

**5. Test the contract, not the business logic.** Consumer tests verify response shape and status codes. Provider verification ensures the contract is satisfiable. Business rules belong in unit and integration tests.

---

## Pact.js Setup

### Install

```bash
# Consumer side
npm i -D @pact-foundation/pact

# Provider side
npm i -D @pact-foundation/pact
```

### Consumer Test

The consumer defines what it needs from the provider. This generates a pact file (JSON contract).

> **Pact-JS v16 (Oct 2025) renamed `PactV4` → `Pact` and `MatchersV3` → `Matchers`.** The old names were removed in v16. If you copy from older blog posts/examples, update the imports. The API behavior is unchanged.

```typescript
// consumer/tests/contract/userApi.pact.spec.ts
// Requires @pact-foundation/pact >= 16
import { Pact, Matchers } from "@pact-foundation/pact";
import path from "path";
import { UserApiClient } from "../../src/userApiClient";

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

### Provider Verification

The provider verifies it can satisfy all consumer contracts. This runs against the real provider implementation (not mocks).

```typescript
// provider/tests/contract/providerVerification.spec.ts
import { Verifier } from "@pact-foundation/pact";
import path from "path";
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

      // Option A: local files; Option B: set pactBrokerUrl/pactBrokerToken/consumerVersionSelectors
      pactUrls: [
        path.resolve(__dirname, "../../../pacts/frontend-app-user-service.json"),
      ],

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

---

## Pact Broker

The Pact Broker is the central registry where pact files are published and provider verification results are recorded. It enables the `can-i-deploy` workflow.

### Setup with Docker

```yaml
# docker-compose.pact-broker.yml
services:
  pact-broker:
    image: pactfoundation/pact-broker:latest
    ports:
      - "9292:9292"
    environment:
      PACT_BROKER_DATABASE_URL: postgres://pact:pact@postgres/pact
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
      POSTGRES_PASSWORD: pact
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

### Publishing Pacts (Consumer CI)

```bash
# After consumer tests generate pact files
npx pact-broker publish ./pacts \
  --consumer-app-version="$GIT_COMMIT" \
  --branch="$GIT_BRANCH" \
  --broker-base-url="https://pact.example.com" \
  --broker-token="$PACT_BROKER_TOKEN"
```

---

## Consumer-Driven Workflow

### The Full Cycle

```
1. Consumer writes contract test
   └── Generates pact JSON file

2. Consumer CI publishes pact to broker
   └── Broker stores pact tagged with consumer version + branch

3. Broker webhook triggers provider verification
   └── Provider CI pulls latest pact, runs verification

4. Provider publishes verification result to broker
   └── Broker records: "provider v2.3.1 satisfies consumer v1.5.0"

5. Before deploy: can-i-deploy check
   └── "Can consumer v1.5.0 be deployed? Yes, provider v2.3.1 is in production and verified."
```

### Consumer CI Pipeline

```yaml
# .github/workflows/consumer-contract.yml
name: Consumer Contract Tests
on: [push]

jobs:
  contract-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci

      - name: Run consumer contract tests
        run: npm run test:contract

      - name: Publish pacts to broker
        if: github.ref == 'refs/heads/main' || github.event_name == 'pull_request'
        env:
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: |
          npx pact-broker publish ./pacts \
            --consumer-app-version="${{ github.sha }}" \
            --branch="${{ github.head_ref || github.ref_name }}"

      - name: Can I deploy?
        if: github.ref == 'refs/heads/main'
        env:
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: |
          npx pact-broker can-i-deploy \
            --pacticipant="frontend-app" \
            --version="${{ github.sha }}" \
            --to-environment=production
```

### Provider CI Pipeline

```yaml
# .github/workflows/provider-contract.yml
name: Provider Contract Verification
on:
  push:
  repository_dispatch:
    types: [pact-changed]  # Triggered by Pact Broker webhook

jobs:
  verify-contracts:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_DB: testdb, POSTGRES_USER: test, POSTGRES_PASSWORD: test }
        ports: ['5432:5432']
        options: >-
          --health-cmd="pg_isready -U test"
          --health-interval=5s
          --health-timeout=3s
          --health-retries=5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run db:migrate

      - name: Verify provider contracts
        env:
          TEST_DATABASE_URL: postgres://test:test@localhost:5432/testdb
          GIT_COMMIT: ${{ github.sha }}
          GIT_BRANCH: ${{ github.head_ref || github.ref_name }}
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: npm run test:contract:provider

      - name: Can I deploy?
        if: github.ref == 'refs/heads/main'
        env:
          PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
          PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
        run: |
          npx pact-broker can-i-deploy \
            --pacticipant="user-service" \
            --version="${{ github.sha }}" \
            --to-environment=production
```

### Pact Broker Webhooks

Configure webhooks in the Pact Broker to trigger provider verification via `repository_dispatch` when a new pact is published. The webhook sends a `POST` to `https://api.github.com/repos/myorg/user-service/dispatches` with event type `pact-changed`, which the provider pipeline listens for (see `repository_dispatch` trigger above).

---

## Schema-First vs Consumer-First

### Consumer-First (Pact)

Consumers define what they need. Contracts emerge from real usage patterns.

**Best for:** Teams where consumers have specific needs that differ across clients (mobile needs fewer fields than web), APIs that evolve organically, microservice ecosystems.

### Schema-First (OpenAPI + Validation)

Provider publishes an OpenAPI spec. Consumers validate their usage against the spec.

**Best for:** Public APIs with many consumers, APIs designed upfront before implementation, teams with strong API design governance.

```typescript
// Schema-first: validate response against OpenAPI spec
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv from "ajv";

const ajv = new Ajv();

async function validateAgainstSpec(response: unknown, operationId: string) {
  const spec = await SwaggerParser.dereference("./openapi.yaml");
  const operation = findOperation(spec, operationId);
  const schema = operation.responses["200"].content["application/json"].schema;

  const validate = ajv.compile(schema);
  const valid = validate(response);

  if (!valid) {
    throw new Error(`Response violates API spec: ${JSON.stringify(validate.errors)}`);
  }
}
```

### Hybrid Approach

Use OpenAPI as the design artifact and Pact as the enforcement mechanism.

1. Design API with OpenAPI spec (provider team leads design).
2. Generate Pact consumer tests from OpenAPI spec as a baseline.
3. Consumers add specific interactions beyond the baseline.
4. Provider verifies against Pact contracts (which are a subset of the OpenAPI spec).

---

## can-i-deploy

The `can-i-deploy` command is the deployment gate. It checks the Pact Broker matrix to determine if a version is safe to deploy.

```bash
# Check if consumer can be deployed to production
npx pact-broker can-i-deploy \
  --pacticipant="frontend-app" \
  --version="abc123" \
  --to-environment=production

# Output:
# CONSUMER        | C.VERSION | PROVIDER     | P.VERSION | SUCCESS?
# frontend-app    | abc123    | user-service | def456    | true
# frontend-app    | abc123    | order-service| ghi789    | true
#
# All required verification results are published and successful.
# Computer says yes \o/

# Record deployment after successful deploy
npx pact-broker record-deployment \
  --pacticipant="frontend-app" \
  --version="abc123" \
  --environment=production
```

**Never deploy without a passing `can-i-deploy` check.** This is the entire point of contract testing.

---

## Anti-Patterns

**Testing business logic in contracts.** Keep contracts thin: status codes, field presence, field types, field format. Business logic belongs in unit and integration tests.

**Provider-driven contracts without consumer input.** If the provider team defines contracts alone, they test what they think consumers need, not what consumers actually use. Consumer-driven contracts catch real integration failures.

**Skipping provider states.** If the consumer expects `given("user 123 exists")` but provider verification runs against an empty database, the verification is meaningless. Provider state handlers must set up the exact scenario.

**Publishing pacts from local machines.** Pacts must be published from CI with a known commit SHA and branch. Local publishes produce untraceable versions that pollute the broker.

**Ignoring `can-i-deploy` failures.** If `can-i-deploy` says no, fix the contract violation or negotiate the change with the consumer team. Deploying anyway breaks production.

**One massive pact covering every endpoint.** Start with critical integration points. Add contracts incrementally as failures justify them. A 500-interaction pact is unmaintainable.

**Not cleaning up old pacts.** Configure Pact Broker to delete pact versions older than 90 days that are not deployed to any environment. Stale pacts slow down verification and confuse the matrix.

---

## Done When

- Consumer pact tests are written and publishing to Pact Broker on every CI run with a commit SHA and branch tag.
- Provider verification job runs in CI on every provider change and on every new pact published (via Pact Broker webhook).
- `can-i-deploy` gate is configured in both consumer and provider pipelines and blocks deployment when a contract is broken.
- Consumer and provider teams have documented and agreed on the contract ownership model (who writes interactions, who reviews changes).
- At least one breaking-change scenario has been tested end-to-end and confirmed caught by the `can-i-deploy` check before reaching production.

## Related Skills

- **api-testing** -- REST/GraphQL testing patterns, schema validation, auth flow testing.
- **ci-cd-integration** -- Pipeline templates for running contract tests as CI gates.
- **test-environments** -- Environment strategy, including where contract tests fit in the pipeline.
- **service-virtualization** -- When to use stubs vs contracts vs real services.
