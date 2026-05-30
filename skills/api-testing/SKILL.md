---
name: api-testing
description: >-
  Test REST and GraphQL APIs with Playwright APIRequestContext, Supertest, or standalone
  HTTP clients. Covers schema validation with Zod/AJV, contract testing patterns,
  auth flow testing, CRUD lifecycle tests, error response validation, and performance
  assertions. Use when: "API test," "endpoint test," "REST test," "GraphQL test,"
  "schema validation," "Postman replacement."
  Related: contract-testing, test-data-management, ci-cd-integration, playwright-automation.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Test REST and GraphQL APIs with schema validation, auth flow testing, CRUD lifecycle coverage, and performance assertions. Use this skill instead of playwright-automation when the test target is an HTTP endpoint rather than a browser UI.
</objective>

## Discovery Questions

1. **REST, GraphQL, or both?** REST-only suites use standard HTTP assertions. GraphQL needs query/mutation builders.
2. **Auth mechanism?** JWT, API key, OAuth 2.0, or session cookies -- each needs a different fixture strategy.
3. **OpenAPI/Swagger spec available?** If yes, auto-generate schemas as contracts.
4. **Check `.agents/qa-project-context.md` first.** Respect existing conventions.

---

## Core Principles

1. **Test contracts, not implementations.** Assert on response shape, status codes, and headers -- not on internal logic or database state.
2. **Schema validation catches drift before it breaks consumers.** A failing schema test means you caught a breaking change before your frontend did.
3. **Auth flows are tests too -- don't just hardcode tokens.** Test login, refresh, expiration, and permission boundaries.
4. **Response time is a testable assertion.** Performance regressions caught in CI are cheaper than production incidents.

---

## Exploratory vs Automated: Tooling

API exploration (debugging, manual probing, OpenAPI playground) and automated API testing are different jobs. Use the right tool for each:

| Tool | Best for | Why |
|------|----------|-----|
| **Bruno** (3.3.0+) | File-based collections, git-reviewable workflows, FOSS Postman replacement | Filesystem-first, no cloud sync required, ~43k stars, gRPC + OAuth 1.0 + GraphQL query builder |
| **Hurl** (6.x) | Plain-text HTTP testing, CI smoke checks | One file = many requests + assertions; runs anywhere curl runs |
| **Hoppscotch** | Web-based Postman-style exploration | Open source, runs in browser, good for quick checks |
| **Playwright `APIRequestContext`** | Automated tests in your test runner | This skill's focus — covered below |
| **Supertest** (Node) / **httpx** (Python) | In-process API tests against your own app | Fastest feedback when you control both sides |

Skip Postman/Insomnia for new projects unless your team already has investment there — file-based tools (Bruno, Hurl) are easier to review in PRs and survive when collections drift.

## Playwright API Testing

`APIRequestContext` supports standalone API tests without launching a browser and shares cookie/storage state with browser contexts. Use it for:

- **Standalone API tests** — `request.get/post/...` with status, header, and body assertions.
- **Combined browser + API tests** — seed data via API, assert it appears in the UI, then clean up via API.
- **Authenticated fixtures** — log in once in a fixture, hand a pre-authenticated `APIRequestContext` to tests, and dispose it on teardown. Never hardcode tokens.

See `references/playwright-setup.md` for the `playwright.config.ts`, standalone tests, combined browser+API test, and the authenticated API fixture.

---

## Schema Validation

Validate response shape against a schema rather than spot-checking individual fields with `toHaveProperty`. Two common approaches:

- **Zod** — define a schema, `safeParse` the response, and assert `result.success`. Log `result.error.issues` on failure for a precise diff. Mind the Zod 3 vs 4 split (see the caveat in the reference).
- **AJV with JSON Schema** — when you already have JSON Schema (e.g. from an OpenAPI spec), compile and validate with `ajv` + `ajv-formats`.

**Schema-as-contract:** have both the API and the tests import the same schema file. If the response shape changes, consumer tests fail immediately. With an OpenAPI spec, auto-generate the schema (`orval`, `openapi-zod-client`, or `json-schema-to-zod`).

See `references/schema-validation.md` for the Zod, AJV, and schema-as-contract implementations.

---

## Test Patterns

Cover each endpoint with a happy-path test plus at least one error-path test. The common patterns:

- **CRUD lifecycle** — a `describe.serial` block that creates, reads, updates, deletes, then verifies the 404. Carries the resource id across steps.
- **Auth flows** — login success, invalid credentials (401), expired token (401), token refresh, and permission boundary (403). Treat auth as its own describe block.
- **Error responses** — 400 (malformed body), 422 (validation with field details), 429 (rate limit + `retry-after`). Don't ship happy-path-only suites.
- **Pagination** — first-page metadata, out-of-bounds empty page, and rejection of invalid page size.
- **File upload/download** — multipart upload and `content-disposition` header verification.
- **GraphQL** — a small `gql` helper, then query / mutation / invalid-query (errors array) cases.
- **Webhooks** — spin up a throwaway HTTP server, register a webhook, trigger the event, and assert delivery.

See `references/test-patterns.md` for the full runnable implementations of every pattern above plus performance assertions.

---

## Performance Assertions

Response time and payload size are testable assertions — assert that a hot endpoint responds within a budget (e.g. 500ms), that payloads stay under a size ceiling, and that the API survives a burst of concurrent requests without 5xx. See `references/test-patterns.md` (Performance Assertions section) for the code.

---

## Anti-Patterns

### 1. Hardcoded auth tokens
Tokens expire, rotate, and differ across environments. Use a login fixture that acquires tokens dynamically.

### 2. Testing against production
API tests create, modify, and delete data. Run against a dedicated test environment or local instance.

### 3. Not validating error responses
Happy-path-only suites miss the most common production issues. Test 400, 401, 403, 404, and 500 responses for every endpoint.

### 4. Ignoring response headers
Headers carry cache directives, rate limit info, content type, and CORS policy. If your API sets them, assert on them.

### 5. No cleanup after test data creation
Tests that create resources without deleting them pollute the database. Use `afterEach`/`afterAll` hooks or fixture teardown.

### 6. Treating API tests as unit tests
Don't mock the database -- API tests verify the contract from the consumer's perspective.

### 7. Ignoring idempotency
PUT and DELETE should be idempotent. Test that calling them twice produces the same result.

---

## Done When

- Every target endpoint has at least a happy-path test and at least one error-path test (4xx or 5xx response validated)
- Auth flow tested as its own describe block: successful login, invalid credentials, expired token, and permission boundary (403)
- Schema validation assertions on response shape using Zod or AJV — not just `toHaveProperty` spot-checks
- Contract tests in place for any endpoint consumed by a different team or service (shared schema file or Pact)
- Test suite runs cleanly in CI without any external service dependencies — all third-party calls mocked or virtualized

## Reference Files (in `references/`)

- **playwright-setup.md** — `playwright.config.ts`, standalone API tests, combined browser+API tests, and the authenticated `APIRequestContext` fixture.
- **schema-validation.md** — Zod and AJV/JSON-Schema response validation plus the schema-as-contract pattern.
- **test-patterns.md** — Runnable CRUD lifecycle, auth flows, error responses, pagination, file upload/download, GraphQL, webhook, and performance tests.

## Related Skills

- **playwright-automation** -- Browser-based E2E testing, Page Object Model, and combined browser + API patterns.
- **ci-cd-integration** -- Running API test suites in CI pipelines, parallelization, and environment management.
- **test-strategy** -- Deciding what to test at the API layer vs. unit vs. E2E.
- **test-reliability** -- Reducing maintenance burden when API contracts evolve.
