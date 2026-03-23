# Fixtures and Projects

Fixtures are Playwright's mechanism for test setup, teardown, and dependency injection. They replace `beforeEach`/`afterEach` hooks with composable, typed, automatically-cleaned-up building blocks.

---

## Test-Scoped vs Worker-Scoped Fixtures

| Scope | Created | Destroyed | Use case |
|-------|---------|-----------|----------|
| `test` (default) | Before each test | After each test | Page objects, test-specific data |
| `worker` | Once per worker process | When worker exits | Auth sessions, DB connections, shared server |

```typescript
import { test as base } from '@playwright/test';

type TestFixtures = {
  dashboardPage: DashboardPage;   // fresh per test
};

type WorkerFixtures = {
  authState: string;              // shared across tests in a worker
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Test-scoped (default)
  dashboardPage: async ({ page }, use) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await use(dashboard);
    // Automatic teardown: page is closed by Playwright after test
  },

  // Worker-scoped (explicit)
  authState: [async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
    await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    const path = `.auth/user-${test.info().parallelIndex}.json`;
    await ctx.storageState({ path });
    await ctx.close();
    await use(path);
  }, { scope: 'worker' }],
});
```

---

## Auth Fixtures (storageState Per Role)

```typescript
// e2e/fixtures/auth.fixture.ts
import { test as base, type BrowserContext } from '@playwright/test';

type AuthFixtures = {
  adminContext: BrowserContext;
  adminPage: Page;
  userContext: BrowserContext;
  userPage: Page;
};

type AuthWorkerFixtures = {
  adminStorageState: string;
  userStorageState: string;
};

export const test = base.extend<AuthFixtures, AuthWorkerFixtures>({
  // Worker-scoped: login once per worker
  adminStorageState: [async ({ browser }, use) => {
    const path = `.auth/admin-${test.info().parallelIndex}.json`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.ADMIN_EMAIL!);
    await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin/**');
    await ctx.storageState({ path });
    await ctx.close();
    await use(path);
  }, { scope: 'worker' }],

  userStorageState: [async ({ browser }, use) => {
    const path = `.auth/user-${test.info().parallelIndex}.json`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.USER_EMAIL!);
    await page.getByLabel('Password').fill(process.env.USER_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    await ctx.storageState({ path });
    await ctx.close();
    await use(path);
  }, { scope: 'worker' }],

  // Test-scoped: create fresh context with saved auth
  adminContext: async ({ browser, adminStorageState }, use) => {
    const ctx = await browser.newContext({ storageState: adminStorageState });
    await use(ctx);
    await ctx.close();
  },

  adminPage: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await use(page);
  },

  userContext: async ({ browser, userStorageState }, use) => {
    const ctx = await browser.newContext({ storageState: userStorageState });
    await use(ctx);
    await ctx.close();
  },

  userPage: async ({ userContext }, use) => {
    const page = await userContext.newPage();
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

Usage in tests:

```typescript
import { test, expect } from '../fixtures/auth.fixture';

test('admin can see user management', async ({ adminPage }) => {
  await adminPage.goto('/admin/users');
  await expect(adminPage.getByRole('heading')).toHaveText('User Management');
});

test('regular user cannot access admin panel', async ({ userPage }) => {
  await userPage.goto('/admin/users');
  await expect(userPage).toHaveURL('/unauthorized');
});
```

---

## Seeded Data Fixtures (API-Created Test Data)

Create test data via API before the test, clean it up after. This is faster and more reliable than creating data through the UI.

```typescript
// e2e/fixtures/data.fixture.ts
import { test as base, type APIRequestContext } from '@playwright/test';

type DataFixtures = {
  testProject: { id: string; name: string; slug: string };
  testUsers: Array<{ id: string; email: string }>;
};

export const test = base.extend<DataFixtures>({
  testProject: async ({ request }, use) => {
    // Setup: create via API
    const resp = await request.post('/api/projects', {
      data: {
        name: `e2e-project-${Date.now()}`,
        description: 'Created by E2E test fixture',
      },
    });
    const project = await resp.json();

    await use(project);

    // Teardown: clean up via API
    await request.delete(`/api/projects/${project.id}`);
  },

  testUsers: async ({ request }, use) => {
    const users: Array<{ id: string; email: string }> = [];

    // Create 3 test users
    for (let i = 0; i < 3; i++) {
      const resp = await request.post('/api/users', {
        data: {
          email: `e2e-user-${Date.now()}-${i}@test.local`,
          name: `Test User ${i}`,
          role: 'viewer',
        },
      });
      users.push(await resp.json());
    }

    await use(users);

    // Teardown
    await Promise.all(
      users.map((u) => request.delete(`/api/users/${u.id}`))
    );
  },
});
```

---

## API Client Fixture

Wrap a typed API client for cleaner test data management:

```typescript
// e2e/helpers/api-client.ts
import { type APIRequestContext } from '@playwright/test';

export class TestApiClient {
  constructor(private readonly request: APIRequestContext) {}

  async createUser(data: { email: string; name: string; role: string }) {
    const resp = await this.request.post('/api/users', { data });
    if (!resp.ok()) throw new Error(`Failed to create user: ${resp.status()}`);
    return resp.json() as Promise<{ id: string; email: string; name: string }>;
  }

  async deleteUser(id: string) {
    await this.request.delete(`/api/users/${id}`);
  }

  async createProject(data: { name: string; ownerId: string }) {
    const resp = await this.request.post('/api/projects', { data });
    if (!resp.ok()) throw new Error(`Failed to create project: ${resp.status()}`);
    return resp.json() as Promise<{ id: string; name: string; slug: string }>;
  }

  async deleteProject(id: string) {
    await this.request.delete(`/api/projects/${id}`);
  }
}

// e2e/fixtures/api.fixture.ts
import { test as base } from '@playwright/test';
import { TestApiClient } from '../helpers/api-client';

export const test = base.extend<{ api: TestApiClient }>({
  api: async ({ request }, use) => {
    await use(new TestApiClient(request));
  },
});
```

---

## Multi-Environment Projects (dev/staging/prod)

```typescript
// playwright.config.ts
const envConfigs = {
  dev: {
    baseURL: 'http://localhost:3000',
    testUserEmail: 'dev-user@test.local',
  },
  staging: {
    baseURL: 'https://staging.example.com',
    testUserEmail: 'staging-user@test.local',
  },
  production: {
    baseURL: 'https://app.example.com',
    testUserEmail: 'smoke-user@test.local',
  },
} as const;

const env = (process.env.TEST_ENV ?? 'dev') as keyof typeof envConfigs;
const config = envConfigs[env];

export default defineConfig({
  use: {
    baseURL: config.baseURL,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: `chromium-${env}`,
      use: {
        ...devices['Desktop Chrome'],
        storageState: `.auth/${env}-user.json`,
      },
      dependencies: ['setup'],
    },
  ],
});
```

Run with environment selection:

```bash
TEST_ENV=staging npx playwright test
TEST_ENV=production npx playwright test --grep @smoke  # only smoke tests in prod
```

---

## Browser and Device Matrices

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    // Desktop browsers
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },

    // Mobile viewports (still uses desktop browser engines)
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },

    // Tablet
    { name: 'tablet', use: { ...devices['iPad Pro 11'] } },

    // High-DPI
    {
      name: 'retina',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
    },
  ],
});
```

Run a specific project:

```bash
npx playwright test --project=chromium
npx playwright test --project=mobile-safari
```

---

## Custom Fixture Composition

Compose multiple fixture files into a single test export. Each fixture file adds its own concerns.

```typescript
// e2e/fixtures/auth.fixture.ts
import { test as base } from '@playwright/test';

export const test = base.extend<{}, { authState: string }>({
  authState: [async ({ browser }, use) => {
    // ... login logic
    await use(path);
  }, { scope: 'worker' }],
});

// e2e/fixtures/data.fixture.ts
import { test as authTest } from './auth.fixture';
import { TestApiClient } from '../helpers/api-client';

export const test = authTest.extend<{
  api: TestApiClient;
  testProject: { id: string; name: string };
}>({
  api: async ({ request }, use) => {
    await use(new TestApiClient(request));
  },
  testProject: async ({ api }, use) => {
    const project = await api.createProject({ name: `e2e-${Date.now()}`, ownerId: 'system' });
    await use(project);
    await api.deleteProject(project.id);
  },
});

// e2e/fixtures/pages.fixture.ts
import { test as dataTest } from './data.fixture';
import { DashboardPage } from '../pages/dashboard.page';
import { SettingsPage } from '../pages/settings.page';

export const test = dataTest.extend<{
  dashboardPage: DashboardPage;
  settingsPage: SettingsPage;
}>({
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
});

// Final export used by all tests
export { expect } from '@playwright/test';
```

```typescript
// e2e/tests/dashboard/overview.spec.ts
import { test, expect } from '../../fixtures/pages.fixture';

// This test has access to: page, dashboardPage, settingsPage, api, testProject, authState
test('shows project on dashboard', async ({ dashboardPage, testProject }) => {
  await dashboardPage.goto();
  await expect(
    dashboardPage.projectCards.filter({ hasText: testProject.name })
  ).toBeVisible();
});
```

---

## Fixture Options Pattern

Allow tests to customize fixture behavior through options:

```typescript
type TableOptions = {
  initialRows: number;
};

export const test = base.extend<TableOptions & { tableData: any[] }>({
  // Default option value
  initialRows: [10, { option: true }],

  // Fixture that reads the option
  tableData: async ({ request, initialRows }, use) => {
    const rows = [];
    for (let i = 0; i < initialRows; i++) {
      const resp = await request.post('/api/rows', {
        data: { value: `row-${i}` },
      });
      rows.push(await resp.json());
    }
    await use(rows);
    await Promise.all(rows.map((r) => request.delete(`/api/rows/${r.id}`)));
  },
});
```

Override the option in specific tests:

```typescript
test.describe('empty table', () => {
  test.use({ initialRows: 0 });

  test('shows empty state', async ({ page }) => {
    await page.goto('/data-table');
    await expect(page.getByText('No data available')).toBeVisible();
  });
});

test.describe('paginated table', () => {
  test.use({ initialRows: 50 });

  test('shows pagination controls', async ({ page }) => {
    await page.goto('/data-table');
    await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
  });
});
```

---

## Automatic Fixture (No Explicit Usage Required)

For fixtures that should always run (like seeding analytics, resetting feature flags):

```typescript
export const test = base.extend<{ resetFeatureFlags: void }>({
  resetFeatureFlags: [async ({ request }, use) => {
    // Reset flags before test
    await request.post('/api/test/reset-feature-flags');
    await use();
    // Optionally reset after test too
  }, { auto: true }], // Runs for every test, no need to reference in test params
});
```
