# Schema Validation — Zod, AJV, Contract

Runnable schema-validation code. The decision prose (when to validate schema, the schema-as-contract idea) lives in `SKILL.md`; this file holds the implementations.

## Zod (Zod 4 native form)

> **Zod 4 vs Zod 3.** Zod 4 shipped major API changes. Three to know: (1) **String formats moved to top-level functions** — `z.email()`, `z.uuid()`, `z.iso.datetime()` replace the chained `z.string().email()`, `z.string().uuid()`, `z.string().datetime()`. The chained forms still work but emit deprecation warnings and are slated for removal in the next major; write the new form. (2) `z.coerce` syntax changed and the error format is different — if your codebase mixes Zod 3 and 4 packages, error-format consumers silently break, so pin the version per package. (3) `z.uuid()` is now strict per RFC 9562/4122; use `z.guid()` for a permissive "UUID-like" check. For OpenAPI → Zod codegen, **`orval`** and **`openapi-zod-client`** are the maintained round-trip tools.

```typescript
import { z } from 'zod';
import { test, expect } from '@playwright/test';

const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'member', 'viewer']),
  createdAt: z.iso.datetime(),
});

const UsersListSchema = z.object({
  users: z.array(UserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

test('GET /api/users matches schema', async ({ request }) => {
  const response = await request.get('/api/users');
  const result = UsersListSchema.safeParse(await response.json());
  if (!result.success) console.error('Schema errors:', result.error.issues);
  expect(result.success).toBe(true);
});
```

## AJV with JSON Schema

```typescript
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const userSchema = {
  type: 'object',
  required: ['id', 'email', 'name', 'role'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string', minLength: 1 },
    role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
  },
  additionalProperties: false,
};

test('GET /api/users/:id conforms to JSON Schema', async ({ request }) => {
  const body = await (await request.get('/api/users/some-valid-id')).json();
  expect(ajv.compile(userSchema)(body)).toBe(true);
});
```

## Schema-as-Contract Pattern

Both API and tests import the same schema file. If the response shape changes, consumer tests fail immediately. With an OpenAPI spec, auto-generate the schema with `orval` or `openapi-zod-client` (the maintained round-trip tools) so the contract stays in sync with the spec.

```typescript
// shared/schemas/user.schema.ts  (imported by both API and tests)
import { z } from 'zod';
export const UserResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(['admin', 'member', 'viewer']),
  createdAt: z.iso.datetime(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;
```

## Spec-Driven & Property-Based Validation

When you have an OpenAPI spec, you can go further than hand-written schemas. **Schemathesis** (Python, built on Hypothesis) generates thousands of test cases from the spec and catches 500s on edge-case input, undocumented response shapes, and validation bypasses — zero per-endpoint maintenance. Point it at the live API and the spec:

```bash
schemathesis run http://localhost:3000/openapi.json --checks all
```

Run it as a CI job for spec-first teams; it complements (does not replace) the targeted happy/error-path tests in `test-patterns.md`.
