# Schema-First Contract Testing — Code

Code for the schema-first (OpenAPI) approach and spec-driven property testing with Schemathesis. The trade-offs and when-to-use guidance live in `SKILL.md`; this file holds the implementations.

## Schema-First (OpenAPI + Validation)

Provider publishes an OpenAPI spec. Consumers validate their usage against the spec.

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

## Schemathesis (Property-Based, Spec-Driven)

For OpenAPI-first projects, **Schemathesis** runs property-based tests against a live API directly from the spec — generating thousands of valid+invalid requests and checking response conformance. Catches a different class of bugs than Pact (encoding, edge-case payloads, status-code drift):

```bash
schemathesis run --base-url https://api.example.com/v1 ./openapi.yaml \
  --checks all --hypothesis-deadline=2000
```

Pair Schemathesis with Pact: Pact for consumer-driven *interactions*, Schemathesis for spec-driven *coverage*. They overlap a little but solve different problems.
