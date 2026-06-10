# Schema-First Contract Testing — Code

Code for the schema-first (OpenAPI) approach and spec-driven property testing with Schemathesis. The trade-offs and when-to-use guidance live in `SKILL.md`; this file holds the implementations.

## Schema-First (OpenAPI + Validation)

Provider publishes an OpenAPI spec. Consumers validate their usage against the spec.

> **OpenAPI 3.0 is NOT plain JSON Schema.** It uses `nullable: true` and other keywords that vanilla Ajv (which defaults to draft 2020-12) does not understand — the validator will throw or silently mis-validate real 3.0 specs. Configure Ajv for the OpenAPI dialect and add `ajv-formats` for `date-time`, `email`, `uri`, etc. For OpenAPI 3.1 specs (which are valid JSON Schema 2020-12) plain Ajv plus `ajv-formats` is enough. The cleanest path for 3.0 is a purpose-built validator like `openapi-response-validator`; the snippet below shows the Ajv route with the necessary config.

```typescript
// Schema-first: validate a response against an OpenAPI 3.0 operation schema
import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { OpenAPIV3 } from "openapi-types";

// strict:false tolerates OpenAPI's nullable/discriminator extensions on the 3.0 dialect
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

// Walk paths to find the operation by operationId. Replace with your spec's shape
// if you index operations differently (e.g. by path+method).
function findOperation(spec: OpenAPIV3.Document, operationId: string): OpenAPIV3.OperationObject {
  for (const pathItem of Object.values(spec.paths)) {
    for (const op of Object.values(pathItem ?? {})) {
      if (op && typeof op === "object" && "operationId" in op && op.operationId === operationId) {
        return op as OpenAPIV3.OperationObject;
      }
    }
  }
  throw new Error(`No operation with operationId "${operationId}" in spec`);
}

async function validateAgainstSpec(response: unknown, operationId: string) {
  const spec = (await SwaggerParser.dereference("./openapi.yaml")) as OpenAPIV3.Document;
  const operation = findOperation(spec, operationId);
  const ok = operation.responses["200"] as OpenAPIV3.ResponseObject;
  const schema = ok.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`No 200 application/json schema for ${operationId}`);

  const validate = ajv.compile(schema);
  if (!validate(response)) {
    throw new Error(`Response violates API spec: ${JSON.stringify(validate.errors)}`);
  }
}
```

## Schemathesis (Property-Based, Spec-Driven)

For OpenAPI-first projects, **Schemathesis** runs property-based tests against a live API directly from the spec — generating thousands of valid+invalid requests and checking response conformance. Catches a different class of bugs than Pact (encoding, edge-case payloads, status-code drift).

Schemathesis is **v4.x** (4.x, released 2025-06). v4 made the schema the positional argument and supplies the base URL via `--url`:

```bash
# v4 form: schema is the positional arg, --url supplies the base URL
schemathesis run ./openapi.yaml --url https://api.example.com/v1 --checks all
```

> **Avoid: `schemathesis run --base-url ... --hypothesis-deadline=2000` (Schemathesis ≤ v3, dead as of v4.0, 2025-06).** v4 removed `--hypothesis-deadline` entirely and renamed `--base-url` to `--url`. The old command fails on any installed Schemathesis ≥ 4.0. `--checks all` is still valid in v4.

In CI, prefer the maintained Action over a raw shell line — it pins the version and sidesteps flag drift:

```yaml
# .github/workflows/schemathesis.yml
- uses: schemathesis/action@v3
  with:
    schema: ./openapi.yaml
    base-url: https://staging.example.com/v1
    args: "--checks all"
```

Pair Schemathesis with Pact: Pact for consumer-driven *interactions*, Schemathesis for spec-driven *coverage*. They overlap a little but solve different problems.
