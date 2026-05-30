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

Install `@pact-foundation/pact` as a dev dependency on both the consumer and provider sides. The workflow has two halves:

- **Consumer test:** the consumer declares what it needs from the provider (request shape + expected response). Running the test generates `pacts/<consumer>-<provider>.json` — the contract file. Use `Matchers` (`like`, `eachLike`, `integer`, `string`, `regex`) so contracts assert types and formats, not brittle exact values.
- **Provider verification:** the provider runs the consumer's pact against its **real** implementation (not mocks), using `stateHandlers` to set up the data each `given(...)` state expects, and publishes the verification result back to the broker.

> **Pact-JS v16 (Oct 2025) renamed `PactV4` → `Pact` and `MatchersV3` → `Matchers`.** The old names were removed in v16. If you copy from older blog posts/examples, update the imports. The API behavior is unchanged.

See `references/pact-js-setup.md` for the full install commands, the consumer test (single user, 404, paginated list), and the provider verification spec with state handlers.

---

## Pact Broker

The Pact Broker is the central registry where pact files are published and provider verification results are recorded. It enables the `can-i-deploy` workflow. Run it locally with Docker Compose backed by Postgres; consumer CI publishes pacts to it tagged with a commit SHA and branch.

See `references/pact-js-setup.md` for the `docker-compose.pact-broker.yml` and the `pact-broker publish` command.

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

Both pipelines run contract tests, publish results to the broker, and gate deployment on `can-i-deploy`. The provider pipeline also listens for a `repository_dispatch` event so a new pact triggers verification automatically.

See `references/ci-pipelines.md` for the consumer CI workflow, the provider CI workflow (with Postgres service + migrations), and the standalone `can-i-deploy` / `record-deployment` commands.

### Pact Broker Webhooks

Configure webhooks in the Pact Broker to trigger provider verification via `repository_dispatch` when a new pact is published. The webhook sends a `POST` to `https://api.github.com/repos/myorg/user-service/dispatches` with event type `pact-changed`, which the provider pipeline listens for (see the `repository_dispatch` trigger in `references/ci-pipelines.md`).

---

## Schema-First vs Consumer-First

### Consumer-First (Pact)

Consumers define what they need. Contracts emerge from real usage patterns.

**Best for:** Teams where consumers have specific needs that differ across clients (mobile needs fewer fields than web), APIs that evolve organically, microservice ecosystems.

### Schema-First (OpenAPI + Validation)

Provider publishes an OpenAPI spec. Consumers validate their usage against the spec.

**Best for:** Public APIs with many consumers, APIs designed upfront before implementation, teams with strong API design governance.

See `references/schema-first.md` for the OpenAPI-against-Ajv validation helper.

### Hybrid Approach

Use OpenAPI as the design artifact and Pact as the enforcement mechanism.

1. Design API with OpenAPI spec (provider team leads design).
2. Generate Pact consumer tests from OpenAPI spec as a baseline.
3. Consumers add specific interactions beyond the baseline.
4. Provider verifies against Pact contracts (which are a subset of the OpenAPI spec).

### Bi-Directional Contracts (Pactflow)

Pactflow's bi-directional contract testing decouples consumer pacts from provider verification — the provider supplies an OpenAPI spec, the consumer supplies a pact, and Pactflow checks compatibility without requiring the provider to run pact verification. Useful when:

- The provider team can't or won't run a Pact verifier in their CI.
- The provider already publishes an OpenAPI spec as the source of truth.
- You want contract coverage without a tight coupling between consumer and provider repos.

Trade-off: bi-directional checks are coarser than full pact verification — they validate spec/contract overlap, not exact runtime behaviour. Use it as the on-ramp; promote to full verification once both teams are bought in.

### Schemathesis (Property-Based, Spec-Driven)

For OpenAPI-first projects, **Schemathesis** runs property-based tests against a live API directly from the spec — generating thousands of valid+invalid requests and checking response conformance. Catches a different class of bugs than Pact (encoding, edge-case payloads, status-code drift). Pair Schemathesis with Pact: Pact for consumer-driven *interactions*, Schemathesis for spec-driven *coverage*.

See `references/schema-first.md` for the `schemathesis run` command.

---

## can-i-deploy

The `can-i-deploy` command is the deployment gate. It checks the Pact Broker matrix to determine if a version is safe to deploy — it answers "given everything the broker knows, is this exact version compatible with what is already in the target environment?" After a successful deploy, record it with `record-deployment` so the matrix stays accurate.

**Never deploy without a passing `can-i-deploy` check.** This is the entire point of contract testing.

See `references/ci-pipelines.md` for the `can-i-deploy` and `record-deployment` commands with annotated output.

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

## Reference Files (in `references/`)

- **pact-js-setup.md** — Install commands, consumer pact test (user/404/pagination), provider verification with state handlers, and Pact Broker Docker Compose + publish command.
- **ci-pipelines.md** — Consumer and provider GitHub Actions workflows plus the standalone `can-i-deploy` / `record-deployment` commands.
- **schema-first.md** — OpenAPI-against-Ajv response validation helper and the Schemathesis spec-driven property-testing command.

## Related Skills

- **api-testing** -- REST/GraphQL testing patterns, schema validation, auth flow testing.
- **ci-cd-integration** -- Pipeline templates for running contract tests as CI gates.
- **test-environments** -- Environment strategy, including where contract tests fit in the pipeline.
- **service-virtualization** -- When to use stubs vs contracts vs real services.
