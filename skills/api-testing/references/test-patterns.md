# API Test Patterns & Performance Assertions

Runnable test implementations for the common API testing patterns. The decision prose, anti-patterns, and "done when" criteria live in `SKILL.md`; this file holds the code.

## CRUD Lifecycle Test

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

## Auth Flow Testing

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

## Error Response Validation

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

## Pagination Testing

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

## File Upload/Download via API

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

## GraphQL Testing

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

## Webhook Testing

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
