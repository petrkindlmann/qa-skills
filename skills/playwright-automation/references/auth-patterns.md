# Authentication Patterns

Every approach to authentication in Playwright E2E tests, from simple single-user to multi-role, token-seeded, and session-expiry-aware patterns.

---

## Storage State Concept

Playwright's `storageState` saves cookies and localStorage from a browser context to a JSON file. Later tests load that file to start already authenticated -- no login UI required.

```
1. Global setup: Login through UI → save storageState to .auth/user.json
2. Test projects: Load .auth/user.json → tests start authenticated
3. Each test: Gets a fresh BrowserContext with the saved cookies/localStorage
```

The `.auth/` directory must be in `.gitignore`.

---

## Global Setup Login

The simplest pattern: one user, one login, all tests share it.

```typescript
// e2e/global-setup.ts
import { test as setup, expect } from '@playwright/test';

setup('authenticate as default user', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/dashboard/);

  // Save the authenticated state
  await page.context().storageState({ path: '.auth/user.json' });
});
```

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
```

---

## Multi-Role Authenticated Contexts

When your app has admin, regular user, and guest roles that see different UI.

### Separate Setup Files

```typescript
// e2e/auth/admin.setup.ts
import { test as setup, expect } from '@playwright/test';

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/admin/);
  await page.context().storageState({ path: '.auth/admin.json' });
});

// e2e/auth/user.setup.ts
import { test as setup, expect } from '@playwright/test';

setup('authenticate as user', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.USER_EMAIL!);
  await page.getByLabel('Password').fill(process.env.USER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.context().storageState({ path: '.auth/user.json' });
});
```

### Config With Role-Based Projects

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    // Setup projects -- run first, no dependencies
    {
      name: 'admin-setup',
      testMatch: /admin\.setup\.ts/,
    },
    {
      name: 'user-setup',
      testMatch: /user\.setup\.ts/,
    },

    // Admin tests
    {
      name: 'admin-chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/admin.json',
      },
      dependencies: ['admin-setup'],
      testMatch: /.*\.admin\.spec\.ts/,
    },

    // Regular user tests
    {
      name: 'user-chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/user.json',
      },
      dependencies: ['user-setup'],
      testMatch: /.*\.user\.spec\.ts/,
    },

    // Guest/anonymous tests (no storageState)
    {
      name: 'guest-chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /.*\.guest\.spec\.ts/,
    },
  ],
});
```

### File Naming Convention

```
e2e/tests/
├── auth/
│   ├── login.guest.spec.ts         # Runs without auth
│   └── password-reset.guest.spec.ts
├── dashboard/
│   ├── overview.user.spec.ts       # Runs as regular user
│   └── admin-panel.admin.spec.ts   # Runs as admin
├── settings/
│   ├── profile.user.spec.ts
│   └── team-management.admin.spec.ts
```

---

## Role Switching Within a Test

Sometimes a single test needs to verify behavior across roles (e.g., admin creates a resource, user sees it).

```typescript
import { test, expect } from '@playwright/test';

test('admin-created announcement visible to users', async ({ browser }) => {
  // Admin context
  const adminCtx = await browser.newContext({ storageState: '.auth/admin.json' });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/admin/announcements');
  await adminPage.getByRole('button', { name: 'New announcement' }).click();
  await adminPage.getByLabel('Title').fill('Scheduled maintenance');
  await adminPage.getByRole('button', { name: 'Publish' }).click();
  await expect(adminPage.getByRole('alert')).toContainText('Published');
  await adminCtx.close();

  // User context
  const userCtx = await browser.newContext({ storageState: '.auth/user.json' });
  const userPage = await userCtx.newPage();
  await userPage.goto('/dashboard');
  await expect(userPage.getByText('Scheduled maintenance')).toBeVisible();
  await userCtx.close();
});
```

---

## Token Seeding via API

When your app uses JWT or API tokens, you can skip the login UI entirely by setting tokens directly.

### Direct Token Injection

```typescript
// e2e/fixtures/auth.fixture.ts
import { test as base, type BrowserContext } from '@playwright/test';

export const test = base.extend<{ authenticatedContext: BrowserContext }>({
  authenticatedContext: async ({ browser, request }, use) => {
    // Get a token from the auth API
    const resp = await request.post('/api/auth/token', {
      data: {
        email: process.env.TEST_USER_EMAIL,
        password: process.env.TEST_USER_PASSWORD,
      },
    });
    const { accessToken, refreshToken } = await resp.json();

    // Create context with the token set in localStorage
    const ctx = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [
          {
            origin: process.env.BASE_URL ?? 'http://localhost:3000',
            localStorage: [
              { name: 'accessToken', value: accessToken },
              { name: 'refreshToken', value: refreshToken },
            ],
          },
        ],
      },
    });

    await use(ctx);
    await ctx.close();
  },
});
```

### Cookie-Based Token Seeding

```typescript
export const test = base.extend<{}, { authCookies: string }>({
  authCookies: [async ({ browser }, use) => {
    const ctx = await browser.newContext();

    // Get auth cookie from API
    const resp = await ctx.request.post('/api/auth/login', {
      data: { email: 'test@example.com', password: 'password' },
    });
    const setCookie = resp.headers()['set-cookie'];

    // Save the state
    const path = `.auth/cookies-${test.info().parallelIndex}.json`;
    await ctx.storageState({ path });
    await ctx.close();
    await use(path);
  }, { scope: 'worker' }],
});
```

---

## Auth State Per Worker

In parallel test runs, each worker needs its own auth state file to avoid file conflicts.

```typescript
export const test = base.extend<{}, { workerAuth: string }>({
  workerAuth: [async ({ browser }, use, workerInfo) => {
    // Unique file per worker
    const authFile = `.auth/worker-${workerInfo.workerIndex}.json`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
    await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');

    await ctx.storageState({ path: authFile });
    await ctx.close();

    await use(authFile);
  }, { scope: 'worker' }],
});
```

---

## Session Expiry Handling

For long-running test suites, sessions may expire mid-run.

### Re-authentication Fixture

```typescript
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ browser }, use) => {
    const ctx = await browser.newContext({ storageState: '.auth/user.json' });
    const page = await ctx.newPage();

    // Check if session is still valid before proceeding
    const resp = await page.request.get('/api/auth/me');

    if (resp.status() === 401) {
      // Re-authenticate
      await page.goto('/login');
      await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
      await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/dashboard');
      // Save refreshed state for subsequent tests
      await ctx.storageState({ path: '.auth/user.json' });
    }

    await use(page);
    await ctx.close();
  },
});
```

### Automatic Token Refresh via Route Interception

```typescript
test('handles token refresh transparently', async ({ page }) => {
  let refreshCount = 0;

  // Intercept 401s and refresh the token
  await page.route('**/api/**', async (route) => {
    const response = await route.fetch();

    if (response.status() === 401 && refreshCount === 0) {
      refreshCount++;
      // Refresh the token
      const refreshResp = await page.request.post('/api/auth/refresh');
      if (refreshResp.ok()) {
        // Retry the original request
        const retryResponse = await route.fetch();
        await route.fulfill({ response: retryResponse });
        return;
      }
    }

    await route.fulfill({ response });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading')).toHaveText('Dashboard');
});
```

---

## OAuth / SSO Testing Strategies

### Strategy 1: Bypass OAuth (Recommended)

Most OAuth flows involve third-party UI you cannot control. Use an API endpoint that issues a session token directly.

```typescript
setup('authenticate via API', async ({ request }) => {
  // Your test environment exposes a backdoor login endpoint
  const resp = await request.post('/api/test/auth', {
    data: { userId: 'test-user-id', role: 'user' },
  });

  // The response sets a session cookie
  const storageState = {
    cookies: resp.headers()['set-cookie']
      ? [/* parse set-cookie header */]
      : [],
    origins: [],
  };

  await fs.writeFile('.auth/user.json', JSON.stringify(storageState));
});
```

### Strategy 2: Mock the OAuth Callback

```typescript
test('OAuth login flow', async ({ page }) => {
  // Intercept the OAuth redirect and fake a successful callback
  await page.route('**/oauth/authorize*', async (route) => {
    const url = new URL(route.request().url());
    const redirectUri = url.searchParams.get('redirect_uri')!;
    const state = url.searchParams.get('state')!;

    // Redirect back to the app with a mock code
    await route.fulfill({
      status: 302,
      headers: {
        Location: `${redirectUri}?code=mock_auth_code&state=${state}`,
      },
    });
  });

  // Mock the token exchange
  await page.route('**/oauth/token', async (route) => {
    await route.fulfill({
      json: {
        access_token: 'mock_access_token',
        token_type: 'bearer',
        expires_in: 3600,
      },
    });
  });

  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in with Google' }).click();
  await expect(page).toHaveURL(/dashboard/);
});
```

---

## Summary of Auth Patterns

| Scenario | Pattern | Where to look |
|---|---|---|
| Single user, all tests | Global setup + storageState in config | Top of this file |
| Multiple roles | Separate setup files + role-based projects | Multi-Role section |
| Cross-role verification | Multiple browser contexts in one test | Role Switching section |
| API-based apps (JWT) | Token seeding via API, skip login UI | Token Seeding section |
| Parallel workers | Per-worker auth file paths | Auth State Per Worker |
| Long suites | Session validity check + re-auth fixture | Session Expiry section |
| OAuth/SSO | Mock the OAuth flow or use API backdoor | OAuth section |
