---
name: contract-testing
description: >-
  Implement consumer-driven contract testing with Pact-JS (v16). Covers consumer test
  writing, broker-driven provider verification, Pact Broker setup, can-i-deploy as a
  deployment gate, webhook-triggered verification, pending pacts, and schema-first vs
  consumer-first approaches (OpenAPI/Ajv, Schemathesis).
  Use when: "contract test," "Pact," "consumer-driven," "API contract," "provider
  verification," "can-i-deploy."
  Not for: stubbing or mocking a dependency to isolate a test — use service-virtualization;
  general REST/GraphQL endpoint assertions against your own API — use api-testing.
  Related: api-testing, service-virtualization, ci-cd-integration, test-environments.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: infrastructure
---

<objective>
A provider renames a response field. Both services pass their own unit tests, and the
mismatch only surfaces in production when the consumer's frontend breaks. Contract testing
catches that in CI: the consumer declares exactly what it needs, the provider verifies it
can deliver, and `can-i-deploy` blocks the deploy until the broker confirms both sides are
compatible. This skill produces Pact consumer tests, broker-driven provider verification,
and the deployment gate that ties them together — so services can be deployed independently
without a shared integration environment.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there. Then:

1. **Architecture:** Microservices, monolith with separate consumers (mobile/SPA), or BFF pattern? Contract testing matters most when teams deploy independently.
2. **Who owns the contract?** Consumer-driven (consumers define what they need) or provider-driven (provider publishes a spec)? Most teams benefit from consumer-driven.
3. **API versioning strategy:** URL-based (`/v1/`, `/v2/`), header-based, or none? Contracts must account for version negotiation.
4. **How many consumer-provider pairs?** Start with the highest-traffic or most-fragile integration. Do not try to contract-test everything at once.
5. **Existing API specs:** Is there an OpenAPI/Swagger spec? If yes, consider schema-first contracts (or Schemathesis) as a starting point.
6. **HTTP or async?** Request/response APIs use the HTTP examples here; queue/topic integrations (Kafka, SNS/SQS) use Pact message contracts (see Pact-JS Setup).

## Core Principles

**1. Consumers define what they need, providers verify they can deliver.** The consumer writes a test declaring "I will call `GET /users/123` and expect `{ id, name, email }`." The provider runs this test against its real implementation. If the provider cannot satisfy the contract, the build breaks before deployment.

**2. The broker is the shared source of truth.** Not documentation, not Slack threads, not "just deploy and see." Pacts and verification results live in the Pact Broker; provider verification pulls pacts from the broker (`pactBrokerUrl` + `consumerVersionSelectors`), not from local files, because the broker knows which consumer versions are actually live.

**3. Contract tests replace integration environments, not integration tests.** You still need integration tests for complex multi-step workflows. Contract tests eliminate the need to deploy consumer and provider together just to verify the interface.

**4. Break the build on contract violation.** A contract test that logs a warning but allows deployment provides zero value. Contracts must be deployment gates.

**5. Test the contract, not the business logic.** Consumer tests verify response shape and status codes. Provider verification ensures the contract is satisfiable. Business rules belong in unit and integration tests.

## Pact-JS Setup

Install `@pact-foundation/pact` as a dev dependency on both the consumer and provider sides. The workflow has two halves:

- **Consumer test:** the consumer declares what it needs from the provider (request shape + expected response). Running the test generates `pacts/<consumer>-<provider>.json` — the contract file. Use `Matchers` (`Matchers.like`, `Matchers.eachLike`, `Matchers.integer`, `Matchers.string`, `Matchers.regex`) so contracts assert types and formats, not brittle exact values.
- **Provider verification:** the provider runs the consumer's pact against its **real** implementation (not mocks), using `stateHandlers` to set up the data each `given(...)` state expects, and publishes the verification result back to the broker.

> **Pact-JS v16 (current as of June 2026) renamed `PactV4` → `Pact` and `MatchersV3` → `Matchers`.** The old names were removed in v16. If you copy from older blog posts/examples, update the imports. The API behavior is unchanged.

For event-driven systems, the same `Pact` class supports **message pacts** (Kafka, SNS/SQS, RabbitMQ) — the consumer asserts the shape of a message it expects and the provider verifies what its producer emits.

See `references/pact-js-setup.md` for the install commands, the consumer test (single user, 404, paginated list), the broker-driven provider verification spec with state handlers and pending pacts, the Pact Broker Docker Compose, and the message-contract pointer.

## Pact Broker

The Pact Broker is the central registry where pact files are published and provider verification results are recorded. It enables the `can-i-deploy` workflow. Run it locally with Docker Compose backed by Postgres; consumer CI publishes pacts to it tagged with a commit SHA and branch.

**Inject every credential from the environment** — Postgres password, broker DB URL, and basic-auth password. Hardcoding any of them in the compose file leaks secrets into version control. Pin the broker image to a released tag, not `:latest`.

See `references/pact-js-setup.md` for the `docker-compose.pact-broker.yml` and the `pact-broker publish` command.

## Consumer-Driven Workflow

The full cycle:

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

### Pending Pacts (Incremental Adoption)

Set `enablePending: true` (plus `includeWipPactsSince`) on the provider `Verifier` so a brand-new consumer interaction can land without breaking the provider build — it is reported but does not fail until the consumer marks it expected. This is the standard safety net when adding contracts incrementally.

## Schema-First vs Consumer-First

### Consumer-First (Pact)

Consumers define what they need; contracts emerge from real usage patterns.

**Best for:** Teams where consumers have specific needs that differ across clients (mobile needs fewer fields than web), APIs that evolve organically, microservice ecosystems.

### Schema-First (OpenAPI + Validation)

Provider publishes an OpenAPI spec; consumers validate their usage against the spec.

**Best for:** Public APIs with many consumers, APIs designed upfront before implementation, teams with strong API design governance.

> OpenAPI 3.0 is not plain JSON Schema (`nullable: true` etc.) — vanilla Ajv defaults to draft 2020-12 and mis-validates real 3.0 specs. Configure Ajv for the OpenAPI dialect with `ajv-formats`, or use an OpenAPI-aware validator. See the caveat in `references/schema-first.md` for the Ajv config and the OpenAPI-against-spec validation helper.

### Hybrid Approach

Use OpenAPI as the design artifact and Pact as the enforcement mechanism.

1. Design API with OpenAPI spec (provider team leads design).
2. Generate Pact consumer tests from the OpenAPI spec as a baseline.
3. Consumers add specific interactions beyond the baseline.
4. Provider verifies against Pact contracts (a subset of the OpenAPI spec).

### Bi-Directional Contracts (PactFlow / SmartBear)

PactFlow (by SmartBear) offers bi-directional contract testing that decouples consumer pacts from provider verification — the provider supplies an OpenAPI spec, the consumer supplies a pact, and PactFlow checks compatibility without requiring the provider to run pact verification. It is a paid PactFlow/SmartBear feature, not part of Pact OSS. Useful when:

- The provider team can't or won't run a Pact verifier in their CI.
- The provider already publishes an OpenAPI spec as the source of truth.
- You want contract coverage without tight coupling between consumer and provider repos.

Trade-off: bi-directional checks are coarser than full pact verification — they validate spec/contract overlap, not exact runtime behaviour. Use it as the on-ramp; promote to full verification once both teams are bought in.

### Schemathesis (Property-Based, Spec-Driven)

For OpenAPI-first projects, **Schemathesis (v4.x)** runs property-based tests against a live API directly from the spec — generating thousands of valid+invalid requests and checking response conformance. Catches a different class of bugs than Pact (encoding, edge-case payloads, status-code drift). Pair them: Pact for consumer-driven *interactions*, Schemathesis for spec-driven *coverage*. In CI, prefer the `schemathesis/action@v3` Action over a raw shell line.

> **Avoid: `schemathesis run --base-url ... --hypothesis-deadline=2000` (Schemathesis ≤ v3, dead as of v4.0, 2025-06).** v4 removed `--hypothesis-deadline` and renamed `--base-url` to `--url`; the schema is now the positional arg. Current form: `schemathesis run ./openapi.yaml --url <base> --checks all`. See `references/schema-first.md`.

## can-i-deploy

The `can-i-deploy` command is the deployment gate. It checks the Pact Broker matrix to answer "given everything the broker knows, is this exact version compatible with what is already in the target environment?" After a successful deploy, record it with `record-deployment` so the matrix stays accurate.

Always pass `--retry-while-unknown <n> --retry-interval <s>`. This fixes the single most common real-world failure: the consumer just published a pact and the provider hasn't finished verifying it yet, so without retries the gate hard-fails on a race instead of waiting for the result to land.

**Never deploy without a passing `can-i-deploy` check, and never skip it on `main`.** `main` is what reaches production — a skipped gate there ships a version the broker has not confirmed compatible, which is the exact break contract testing exists to prevent.

See `references/ci-pipelines.md` for the `can-i-deploy` and `record-deployment` commands with annotated output and the retry flags.

## Anti-Patterns

**Testing business logic in contracts.** Keep contracts thin: status codes, field presence, field types, field format. Business logic belongs in unit and integration tests.

**Provider-driven contracts without consumer input.** If the provider team defines contracts alone, they test what they think consumers need, not what consumers actually use. Consumer-driven contracts catch real integration failures.

**Skipping provider states.** If the consumer expects `given("user 123 exists")` but provider verification runs against an empty database, the verification is meaningless. Provider state handlers must set up the exact scenario.

**Verifying from local pact files in production CI.** Local `pactUrls` verification only sees the pacts on disk, not what is deployed. Pull from the broker with `pactBrokerUrl` + `consumerVersionSelectors` so verification reflects live consumer versions.

**Publishing pacts from local machines.** Pacts must be published from CI with a known commit SHA and branch. Local publishes produce untraceable versions that pollute the broker.

**Ignoring `can-i-deploy` failures.** If `can-i-deploy` says no, fix the contract violation or negotiate the change with the consumer team. Deploying anyway breaks production.

**One massive pact covering every endpoint.** Start with critical integration points. Add contracts incrementally (use pending pacts) as failures justify them. A 500-interaction pact is unmaintainable.

**Not cleaning up old pacts.** Configure the Pact Broker to delete pact versions older than 90 days that are not deployed to any environment. Stale pacts slow verification and confuse the matrix.

## Verification

Prove the artifacts work, smallest check first:

1. **Consumer test emits a pact.** Run `npm run test:contract` and confirm `pacts/<consumer>-<provider>.json` is written and contains the interactions you declared. No file = no contract.
2. **Provider verification passes against the real service.** Run `npm run test:contract:provider` with the test database up; every consumer interaction should verify green against the running provider, not a mock.
3. **Broker round-trip.** Publish with `pact-broker publish ./pacts --consumer-app-version=$GIT_COMMIT --branch=$GIT_BRANCH` and confirm the pact appears in the broker UI with the verification result recorded.
4. **Deployment gate.** Run `pact-broker can-i-deploy --pacticipant=<name> --version=<sha> --to-environment=production --dry-run` and confirm it returns a definite yes/no (not "unknown") for a known-good version.

## Done When

- Consumer pact tests run in CI and a `pacts/*.json` file is generated and published to the broker on every run, tagged with the commit SHA and branch.
- Provider verification job runs in CI on every provider change and on every new pact published (via the Pact Broker `repository_dispatch` webhook), pulling pacts from the broker — not local files.
- `can-i-deploy` (with `--retry-while-unknown`) gates deployment in both consumer and provider pipelines on `main` and fails the job when a contract is broken.
- A `CONTRACTS.md` (or `CODEOWNERS` entry) exists naming the owner/reviewer for each consumer-provider interaction.
- At least one breaking-change scenario has been run end-to-end and confirmed caught by the `can-i-deploy` check before reaching production.

## Reference Files (in `references/`)

- **pact-js-setup.md** — Install commands, consumer pact test (user/404/pagination), broker-driven provider verification with state handlers and pending pacts, message-contract pointer, and Pact Broker Docker Compose + publish command.
- **ci-pipelines.md** — Consumer and provider GitHub Actions workflows plus the standalone `can-i-deploy` (with retry flags) / `record-deployment` commands.
- **schema-first.md** — OpenAPI-against-Ajv response validation helper (with the 3.0 dialect caveat) and the Schemathesis v4 command + Action.

## Related Skills

- **api-testing** — Asserting your own REST/GraphQL endpoints (shape, status, auth, headers). Go there for general endpoint testing; come here when a separate team consumes your API and you need guaranteed compatibility, not just a shared schema.
- **service-virtualization** — Stubbing or mocking a dependency to isolate a test. Go there to replace a service with a fake; come here to prove two real services agree on the interface — contracts verify compatibility, virtualization fakes it.
- **ci-cd-integration** — Pipeline mechanics: running these contract jobs as CI gates, secrets, and parallelization. Go there for the pipeline plumbing this skill's deployment gate plugs into.
- **test-environments** — Environment strategy. Go there to decide where contract verification runs and how the broker is provisioned across staging/production.
