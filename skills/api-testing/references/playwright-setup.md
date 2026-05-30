# Playwright API Testing — Setup & Fixtures

`APIRequestContext` supports standalone API tests without launching a browser and shares cookie/storage state with browser contexts. The `Exploratory vs Automated` tooling table and the decision prose live in `SKILL.md`; this file holds the runnable config, standalone tests, combined browser+API tests, and the authenticated fixture.

## Configuration and Standalone Tests

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

## Combined Browser + API Tests

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

## Authenticated API Fixture

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
