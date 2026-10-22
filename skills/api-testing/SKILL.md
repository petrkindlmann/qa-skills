---
name: api-testing
description: >-
  Test REST and GraphQL APIs with Playwright APIRequestContext, Supertest, or standalone
  HTTP clients. Covers schema validation with Zod 4/AJV, auth flow testing, CRUD lifecycle
  tests, error and header validation, pagination, and performance assertions. Use when:
  "API test," "endpoint test," "REST test," "GraphQL test," "schema validation," "Postman replacement."
  Not for: consumer-driven contract verification (Pact, broker) — use contract-testing; browser UI flows — use playwright-automation.
  Related: contract-testing, test-data-management, ci-cd-integration, playwright-automation.
license: MIT
metadata:
  author: kindlmann
  version: "2.1"
  category: automation
---

<objective>
A response that adds a nullable field or quietly drops one slips past `toHaveProperty` spot-checks and silently breaks the frontend in production. Schema-as-contract tests catch that drift in CI, not prod. This skill produces REST and GraphQL API tests that assert response shape, status codes, headers, auth boundaries, and timing — against a real test environment, not a mocked stand-in.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there. Then:

1. **REST, GraphQL, or both?** REST-only suites use standard HTTP assertions. GraphQL needs query/mutation builders and benefits from an introspection-diff snapshot.
2. **Auth mechanism?** JWT, API key, OAuth 2.0, or session cookies — each needs a different fixture strategy.
3. **OpenAPI/Swagger spec available?** If yes, auto-generate Zod schemas as contracts (`orval`, `openapi-zod-client`) and consider spec-driven fuzzing with Schemathesis.

---

## Core Principles

1. **Test contracts, not implementations.** Assert on response shape, status codes, and headers — not on internal logic or database state.
2. **Schema validation catches drift before it breaks consumers.** A failing schema test means you caught a breaking change before your frontend did.
3. **Auth flows are tests too.** Test the application's login, logout, expiry and permission contracts. Exercise refresh only when supported. A cleared client cookie does not prove the server revoked the session.
4. **Response time is a testable assertion.** Performance regressions caught in CI are cheaper than production incidents.

---

## Exploratory vs Automated: Tooling

API exploration (debugging, manual probing, OpenAPI playground) and automated API testing are different jobs. Use the right tool for each:

| Tool | Best for | Why |
|------|----------|-----|
| **Bruno** (v3.4+) | File-based collections, git-reviewable workflows, FOSS Postman replacement | Filesystem-first, no cloud sync required; gRPC + OAuth + GraphQL query builder |
| **Hurl** (8.x) | Plain-text HTTP testing, CI smoke checks | One file = many requests + assertions; runs anywhere curl runs; certificate + JSONPath (RFC 9535) queries |
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

- **Zod 4** — define a schema, `safeParse` the response, and assert `result.success`. Log `result.error.issues` on failure for a precise diff. Use the Zod 4 native string formats: `z.email()`, `z.uuid()`, `z.iso.datetime()` — the chained `z.string().email()` forms are deprecated and slated for removal.
- **AJV with JSON Schema** — when you already have JSON Schema (e.g. from an OpenAPI spec), compile and validate with `ajv` + `ajv-formats`.
- **Neither installed, and the task forbids new dependencies** — check the shape by hand rather than skip it: assert the exact key set (`expect(Object.keys(body).sort()).toEqual([...])`) and the type of every field, in one helper reused by every test. That still fails on an added, missing or retyped field. Say in the report that a schema library was unavailable.

**Schema-as-contract:** have both the API and the tests import the same schema file. If the response shape changes, consumer tests fail immediately. With an OpenAPI spec, auto-generate the schema (`orval` or `openapi-zod-client`). For spec-first teams, add **Schemathesis** as a CI job to fuzz the live API against the spec and catch undocumented shapes and edge-case 500s.

See `references/schema-validation.md` for the Zod 4, AJV, schema-as-contract, and Schemathesis implementations.

---

## Test Patterns

Cover each endpoint with a happy-path test plus at least one error-path test. The common patterns:

- **CRUD lifecycle** — a `describe.serial` block that creates, reads, updates, deletes, then verifies the 404. Carries the resource id across steps.
- **Auth flows** — login success, invalid credentials, expiry, logout/revocation and permission boundaries. Assert the documented status and body: a resource may deliberately return indistinguishable 404s for foreign and unknown IDs. Test token refresh when the application implements it.
- **Error responses** — 400 (malformed body), 422 (validation with field details), 429 (rate limit + `retry-after`). Don't ship happy-path-only suites.
- **Response headers** — assert `content-type`, `cache-control`, and rate-limit headers directly (not behind a conditional that may never fire). See the pattern below.
- **Pagination** — first-page metadata, out-of-bounds empty page, and rejection of invalid page size.
- **File upload/download** — multipart upload and `content-disposition` header verification.
- **GraphQL** — a small `gql` helper, then query / mutation / invalid-query (errors array) cases, plus an introspection-diff snapshot to catch silently-removed fields.
- **Webhooks** — spin up a throwaway HTTP server, register a webhook, trigger the event, and assert delivery.

See `references/test-patterns.md` for the full runnable implementations of every pattern above plus performance assertions.

### Response Headers

Headers carry the contract: cache directives, rate-limit info, content type, CORS policy. Assert them with `response.headers()` and index by lowercase name; don't gate the assertion behind an `if (rateLimited)` that may not fire.

```typescript
test('GET /api/users sets expected response headers', async ({ request }) => {
  const response = await request.get('/api/users');
  const headers = response.headers();

  expect(headers).toBeDefined();
  expect(headers['content-type']).toContain('application/json');
  expect(headers['cache-control']).toBeDefined();   // "no-store" | "max-age=60" | ...
});
```

For the rate-limit and `retry-after` variants, see `references/test-patterns.md` (Response Header Validation).

---

## Performance Assertions

Response time and payload size are testable assertions — assert that a hot endpoint responds within a budget (e.g. 500ms), that payloads stay under a size ceiling, and that the API survives a burst of concurrent requests without 5xx. See `references/test-patterns.md` (Performance Assertions section) for the code.

---

## Workflow Evidence

An HTTP success or a final happy state can miss an incorrect intermediate transition.
Choose observations that distinguish the promised effect from a plausible broken one:

- **Revocation:** capture a valid session before logout, log out through the normal client,
  then replay the old credential from an independent context. Assert the protected request
  is denied. Keep captured credentials out of reports and source control.
- **Persistence:** read or restart immediately after the operation being tested, before a
  later write can save its state on its behalf. Check rollback before retry, and successful
  recovery afterward. Use real application/database state with explicit test support when needed.
- **Calculated values:** use independently known unit values and more than one composition.
  One correct aggregate can hide two compensating mistakes. Test accepted boundary values
  as well as values outside the allowed range.
- **Raw-body signatures:** sign the exact bytes sent. Include a valid noncanonical JSON
  representation, such as extra whitespace, plus a byte-tampered rejection case. Parsing and
  reserializing before verification must not silently redefine the signed message.
- **Idempotency:** assert one durable business effect after concurrent duplicates and after
  restart. Check a changed payload with the same key. Idempotent state does not require the
  same status on every request; repeated DELETE may return 204 then 404 if that is the contract.

Keep a healthy control and a deliberately broken control for each critical assertion when
evaluating test quality. Report a missed control as a coverage gap, not a product failure.

---

## Anti-Patterns

### 1. Hardcoded auth tokens
Tokens expire, rotate, and differ across environments. Use a login fixture that acquires tokens dynamically.

### 2. Testing against production
API tests create, modify, and delete data. Run against a dedicated test environment or local instance.

### 3. Not validating error responses
Happy-path-only suites miss rejection behavior. Exercise each endpoint's documented error paths and assert no forbidden side effect; do not require every HTTP status from every endpoint.

### 4. Asserting headers only conditionally
Headers carry cache directives, rate limit info, content type, and CORS policy. Assert them directly on every relevant response — a check buried inside `if (rateLimited)` may never run and proves nothing.

### 5. No cleanup after test data creation
Tests that create resources without deleting them pollute the database. Use `afterEach`/`afterAll` hooks or fixture teardown.

### 6. Treating API tests as unit tests
Don't mock the database — API tests verify the contract from the consumer's perspective. Mock only genuine third parties you don't own (payment gateways, external SaaS).

### 7. Ignoring idempotency
PUT and DELETE should preserve the intended state when repeated. Check state and side effects, using the endpoint's documented response contract for each attempt.

---

## Done When

- Every target endpoint has at least a happy-path test and at least one error-path test (4xx or 5xx response validated).
- Every clause the API contract states has a test or an explicit "not covered" line in the report, including the ones no loaded skill is about: access rules on admin, debug and test-only routes, stated latency budgets, and health endpoints. A suite shaped by the skills you loaded otherwise skips the clauses between them.
- Supported auth flows exercised: successful login, invalid credentials, expiry, logout/revocation and the documented permission boundary; include refresh when implemented.
- Schema validation assertions on response shape using Zod 4 or AJV (or, where neither may be installed, an exact key-set and field-type check) — not just `toHaveProperty` spot-checks.
- Header assertions exist for at least `content-type` and any cache/rate-limit headers the API sets, asserted unconditionally.
- Contract tests in place for any endpoint consumed by a different team or service (shared schema file; for consumer-driven verification use `contract-testing`).
- Genuine third-party calls (payment gateways, external SaaS) are mocked or virtualized; the API and its database run for real.
- CI job for the suite exits 0 (green) against the test environment.

## Reference Files (in `references/`)

- **playwright-setup.md** — `playwright.config.ts`, standalone API tests, combined browser+API tests, and the authenticated `APIRequestContext` fixture.
- **schema-validation.md** — Zod 4 and AJV/JSON-Schema response validation, the schema-as-contract pattern, and Schemathesis spec-driven fuzzing.
- **test-patterns.md** — Runnable CRUD lifecycle, auth flows, error responses, response headers, pagination, file upload/download, GraphQL (+ introspection diff), webhook, and performance tests.

## Related Skills

- **contract-testing** — Consumer-driven contract verification with Pact/broker; go there when a separate team consumes your API and you need guaranteed compatibility, not just a shared schema.
- **playwright-automation** — Browser-based E2E testing, Page Object Model, and combined browser + API patterns.
- **ci-cd-integration** — Running API test suites in CI pipelines, parallelization, and environment management.
- **test-strategy** — Deciding what to test at the API layer vs. unit vs. E2E.
