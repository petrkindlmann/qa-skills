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

## Playwright API Testing

`APIRequestContext` supports standalone API tests without launching a browser and shares cookie/storage state with browser contexts.

### Configuration and Standalone Tests

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './api-tests',
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { 'Accept': 'application/json' },
  },
});
```

```typescript
import { test, expect } from '@playwright/test';

test.describe('Users API', () => {
  test('GET /api/users returns a list', async ({ request }) => {
    const response = await request.get('/api/users');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const body = await response.json();
    expect(body.users).toBeInstanceOf(Array);
    expect(body.users[0]).toHaveProperty('id');
    expect(body.users[0]).toHaveProperty('email');
  });

  test('GET /api/users/:id returns 404 for missing user', async ({ request }) => {
    const response = await request.get('/api/users/non-existent-id');
    expect(response.status()).toBe(404);
  });
});
```

### Combined Browser + API Tests

```typescript
test('project created via API appears in dashboard', async ({ request, page }) => {
  const createRes = await request.post('/api/projects', {
    data: { name: 'API-Created Project', description: 'Seeded via API' },
  });
  expect(createRes.ok()).toBeTruthy();
  const project = await createRes.json();

  await page.goto('/dashboard');
  await expect(page.getByText('API-Created Project')).toBeVisible();

  await request.delete(`/api/projects/${project.id}`); // cleanup
});
```

### Authenticated API Fixture

```typescript
// fixtures/api.fixture.ts
import { test as base, expect, APIRequestContext } from '@playwright/test';

export const test = base.extend<{ authedApi: APIRequestContext }>({
  authedApi: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({
      baseURL: process.env.API_BASE_URL ?? 'http://localhost:3000',
      extraHTTPHeaders: { 'Accept': 'application/json' },
    });
    const loginRes = await api.post('/api/auth/login', {
      data: { email: process.env.TEST_USER_EMAIL!, password: process.env.TEST_USER_PASSWORD! },
    });
    expect(loginRes.ok()).toBeTruthy();
    await use(api);
    await api.dispose();
  },
});
export { expect };
```

---

## Schema Validation

### Zod

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

### AJV with JSON Schema

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

### Schema-as-Contract Pattern

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

---

## Test Patterns

### CRUD Lifecycle Test

```typescript
import { test, expect } from '../fixtures/api.fixture';

test.describe.serial('Projects CRUD lifecycle', () => {
  let projectId: string;

  test('CREATE', async ({ authedApi }) => {
    const res = await authedApi.post('/api/projects', {
      data: { name: 'Lifecycle Project', description: 'CRUD test' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    projectId = body.id;
  });

  test('READ', async ({ authedApi }) => {
    const res = await authedApi.get(`/api/projects/${projectId}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe('Lifecycle Project');
  });

  test('UPDATE', async ({ authedApi }) => {
    const res = await authedApi.patch(`/api/projects/${projectId}`, {
      data: { name: 'Updated Name' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe('Updated Name');
  });

  test('DELETE', async ({ authedApi }) => {
    expect((await authedApi.delete(`/api/projects/${projectId}`)).status()).toBe(204);
  });

  test('VERIFY DELETED', async ({ authedApi }) => {
    expect((await authedApi.get(`/api/projects/${projectId}`)).status()).toBe(404);
  });
});
```

### Auth Flow Testing

```typescript
test.describe('Authentication flows', () => {
  test('successful login returns tokens', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'user@example.com', password: 'correct-password' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('accessToken');
    expect(body).toHaveProperty('refreshToken');
  });

  test('invalid credentials return 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'user@example.com', password: 'wrong' },
    });
    expect(res.status()).toBe(401);
  });

  test('expired token returns 401', async ({ request }) => {
    const res = await request.get('/api/users/me', {
      headers: { Authorization: 'Bearer expired-token-here' },
    });
    expect(res.status()).toBe(401);
  });

  test('token refresh provides new access token', async ({ request }) => {
    const { refreshToken } = await (await request.post('/api/auth/login', {
      data: { email: 'user@example.com', password: 'correct-password' },
    })).json();
    const refreshRes = await request.post('/api/auth/refresh', { data: { refreshToken } });
    expect(refreshRes.status()).toBe(200);
    expect((await refreshRes.json())).toHaveProperty('accessToken');
  });

  test('insufficient permissions return 403', async ({ request }) => {
    const { accessToken } = await (await request.post('/api/auth/login', {
      data: { email: 'viewer@example.com', password: 'viewer-password' },
    })).json();
    const res = await request.delete('/api/admin/users/some-id', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status()).toBe(403);
  });
});
```

### Error Response Validation

```typescript
test.describe('Error responses', () => {
  test('400 - malformed request body', async ({ request }) => {
    const res = await request.post('/api/projects', { data: { name: '' } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'name' })]),
    );
  });

  test('422 - validation error with field details', async ({ request }) => {
    const res = await request.post('/api/users', { data: { email: 'not-an-email', name: 'Test' } });
    expect(res.status()).toBe(422);
    expect((await res.json()).details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
    );
  });

  test('429 - rate limiting returns retry-after header', async ({ request }) => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => request.get('/api/status')),
    );
    const rateLimited = responses.find(r => r.status() === 429);
    if (rateLimited) {
      expect(rateLimited.headers()['retry-after']).toBeDefined();
    }
  });
});
```

### Pagination Testing

```typescript
test('first page returns correct metadata', async ({ request }) => {
  const body = await (await request.get('/api/projects?page=1&pageSize=10')).json();
  expect(body.page).toBe(1);
  expect(body.items.length).toBeLessThanOrEqual(10);
  expect(body.total).toBeGreaterThanOrEqual(body.items.length);
});

test('out of bounds page returns empty items', async ({ request }) => {
  const body = await (await request.get('/api/projects?page=99999&pageSize=10')).json();
  expect(body.items).toHaveLength(0);
});

test('invalid page size is rejected', async ({ request }) => {
  expect((await request.get('/api/projects?page=1&pageSize=0')).status()).toBe(400);
});
```

### File Upload/Download via API

```typescript
test('upload via multipart form', async ({ request }) => {
  const res = await request.post('/api/files/upload', {
    multipart: {
      file: { name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from('id,name\n1,Test') },
    },
  });
  expect(res.status()).toBe(201);
  expect((await res.json()).fileName).toBe('sample.csv');
});

test('download and verify headers', async ({ request }) => {
  const res = await request.get('/api/files/some-file-id/download');
  expect(res.headers()['content-disposition']).toContain('attachment');
});
```

### GraphQL Testing

```typescript
test.describe('GraphQL API', () => {
  const gql = (request: any, query: string, variables?: Record<string, unknown>) =>
    request.post('/graphql', { data: { query, variables } });

  test('query - fetches user by ID', async ({ request }) => {
    const body = await (await gql(request, `
      query GetUser($id: ID!) { user(id: $id) { id email name } }
    `, { id: 'user-1' })).json();

    expect(body.errors).toBeUndefined();
    expect(body.data.user).toMatchObject({ id: 'user-1', email: expect.any(String) });
  });

  test('mutation - creates a project', async ({ request }) => {
    const body = await (await gql(request, `
      mutation CreateProject($input: CreateProjectInput!) {
        createProject(input: $input) { id name }
      }
    `, { input: { name: 'GQL Project' } })).json();

    expect(body.errors).toBeUndefined();
    expect(body.data.createProject.name).toBe('GQL Project');
  });

  test('invalid query returns errors array', async ({ request }) => {
    const body = await (await gql(request, `query { nonExistentField }`)).json();
    expect(body.errors).toBeDefined();
    expect(body.errors[0]).toHaveProperty('message');
  });

});
```

### Webhook Testing

```typescript
import http from 'http';

test.describe('Webhook delivery', () => {
  let server: http.Server;
  let payloads: any[] = [];
  let webhookUrl: string;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { payloads.push(JSON.parse(body)); res.writeHead(200).end(); });
    });
    await new Promise<void>((r) => server.listen(0, r));
    webhookUrl = `http://localhost:${(server.address() as any).port}`;
  });
  test.afterAll(() => server?.close());

  test('receives event on project creation', async ({ request }) => {
    const { id: hookId } = await (await request.post('/api/webhooks', {
      data: { url: webhookUrl, events: ['project.created'] },
    })).json();
    await request.post('/api/projects', { data: { name: 'Webhook Project' } });
    await new Promise((r) => setTimeout(r, 2000));
    expect(payloads.at(-1).event).toBe('project.created');
    await request.delete(`/api/webhooks/${hookId}`);
  });
});
```

---

## Performance Assertions

```typescript
test('GET /api/users responds within 500ms', async ({ request }) => {
  const start = Date.now();
  const res = await request.get('/api/users');
  expect(res.ok()).toBeTruthy();
  expect(Date.now() - start).toBeLessThan(500);
});

test('response payload stays under 1MB', async ({ request }) => {
  const body = await (await request.get('/api/users')).body();
  expect(body.length / 1024).toBeLessThan(1024);
});

test('handles 50 concurrent requests without errors', async ({ request }) => {
  const results = await Promise.all(
    Array.from({ length: 50 }, () => request.get('/api/status').then(r => r.status())),
  );
  expect(results.every(s => s >= 200 && s < 500)).toBe(true);
});
```

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

## Related Skills

- **playwright-automation** -- Browser-based E2E testing, Page Object Model, and combined browser + API patterns.
- **ci-cd-integration** -- Running API test suites in CI pipelines, parallelization, and environment management.
- **test-strategy** -- Deciding what to test at the API layer vs. unit vs. E2E.
- **self-healing-tests** -- Reducing maintenance burden when API contracts evolve.
