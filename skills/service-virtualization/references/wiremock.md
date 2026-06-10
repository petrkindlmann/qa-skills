# WireMock — Docker setup, mappings, and priority error scenarios

WireMock 3.13.2 is the current stable line (4.0 is beta-only as of mid-2026 — stay on 3.x for
CI). Language-agnostic HTTP stub server; runs standalone or as a Docker container. Best for
polyglot environments or complex matching rules.

> Image tags below are pinned to specific minors that age. Refresh them periodically — see the
> note in `references/testcontainers.md`.

## Docker setup

```yaml
# In docker-compose.test.yml
wiremock:
  image: wiremock/wiremock:3.13.2
  ports:
    - "8080:8080"
  volumes:
    - ./wiremock/mappings:/home/wiremock/mappings
    - ./wiremock/__files:/home/wiremock/__files
  command: ["--verbose", "--global-response-templating"]
```

## Stub mapping with response templating

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

## Paginated endpoint with templating

Extract the `page` query param and template it into the body. Pair it with a priority error
mapping (next section) so tests can opt into failures.

```json
// wiremock/mappings/list-orders.json
{
  "request": {
    "method": "GET",
    "urlPath": "/api/orders",
    "queryParameters": { "page": { "matches": "[0-9]+" } }
  },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "jsonBody": {
      "page": "{{request.query.page}}",
      "items": [
        { "id": "order-{{request.query.page}}-1", "page": "{{request.query.page}}" },
        { "id": "order-{{request.query.page}}-2", "page": "{{request.query.page}}" }
      ]
    },
    "transformers": ["response-template"]
  }
}
```

## Priority-based error scenario

WireMock matches the lowest `priority` number first. Give the error mapping `priority: 1` so it
shadows the happy-path mapping ONLY when the test opts in with `X-Test-Scenario: rate-limit`.
The happy-path mapping has no priority (defaults to 5), so normal requests fall through to it.

```json
// wiremock/mappings/orders-rate-limited.json
{
  "priority": 1,
  "request": {
    "method": "GET",
    "urlPath": "/api/orders",
    "headers": {
      "X-Test-Scenario": { "equalTo": "rate-limit" }
    }
  },
  "response": {
    "status": 429,
    "headers": {
      "Content-Type": "application/json",
      "Retry-After": "1"
    },
    "jsonBody": { "error": "rate_limited", "message": "Too many requests" }
  }
}
```

## Programmatic control via the admin API

Wrap these in helpers for cleaner setup:

- Create a stub: `POST /__admin/mappings`
- Verify a call happened: `POST /__admin/requests/count`
- Reset between tests: `POST /__admin/mappings/reset`

## Drift detection — wire WireMock to a contract

A stub is only as good as the contract it was built from. Two concrete seams to keep stubs honest:

- **Prism against the OpenAPI spec.** If you have a published OpenAPI spec, run the same requests
  against `prism mock openapi.yaml` (which validates request/response against the spec) and against
  WireMock; a divergence means the stub drifted from the spec.
- **Replay a recorded Pact.** Run the consumer's recorded Pact interactions against the WireMock
  mappings; a mismatch is drift. Verification against the real provider belongs in `contract-testing`.
