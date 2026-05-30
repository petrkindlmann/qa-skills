# Schema Validation — Zod, AJV, Contract

Runnable schema-validation code. The decision prose (when to validate schema, Zod 3 vs 4 caveat, the schema-as-contract idea) lives in `SKILL.md`; this file holds the implementations.

## Zod

> **Zod 4 vs Zod 3.** Zod 4 shipped major API changes — `.parse` / `.safeParse` are unchanged, but `z.coerce` syntax changed and the error format is different. If your codebase is mixed (some packages on Zod 3, others on Zod 4), error-format consumers will silently break. Pin the version per package. For OpenAPI → Zod codegen, both **`orval`** and **`openapi-zod-client`** are now more popular than `json-schema-to-zod` for the round-trip path.

```typescript
import { z } from 'zod';
import { test, expect } from '@playwright/test';

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string().datetime(),
});

const UsersListSchema = z.object({
  users: z.array(UserSchema),
  total: z.number().int().nonneg(),
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

Both API and tests import the same schema file. If the response shape changes, consumer tests fail immediately. With an OpenAPI spec, auto-generate via `json-schema-to-zod`.

```typescript
// shared/schemas/user.schema.ts  (imported by both API and tests)
import { z } from 'zod';
export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['admin', 'member', 'viewer']),
  createdAt: z.string().datetime(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;
```
