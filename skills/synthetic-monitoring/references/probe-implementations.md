# Probe Implementations

Runnable probe code for synthetic monitoring. The probe-design decision table, non-destructive patterns, and test-account requirements live in `SKILL.md`.

## Playwright login-flow probe

```typescript
// probes/login-flow.ts
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PRODUCTION_URL!;
const SYNTH_EMAIL = process.env.SYNTHETIC_USER_EMAIL!;
const SYNTH_PASS = process.env.SYNTHETIC_USER_PASSWORD!;

test.describe('Synthetic: Login Flow', () => {
  test.describe.configure({ timeout: 15_000, retries: 0 });

  test('user can authenticate and reach dashboard', async ({ page }) => {
    // Step 1: Load login page
    const loginResponse = await page.goto(`${PROD_URL}/login`);
    expect(loginResponse?.status()).toBeLessThan(400);

    // Step 2: Authenticate
    await page.getByLabel('Email').fill(SYNTH_EMAIL);
    await page.getByLabel('Password').fill(SYNTH_PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Step 3: Verify dashboard loads with data
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});
```

## API health-check probe

Validates database connection and cache connection without mutating data — the `/health` endpoint reports dependency status, and the probe asserts each is `connected`.

```typescript
// probes/api-health.ts
import { test, expect } from '@playwright/test';

const API_URL = process.env.API_BASE_URL!;
const API_KEY = process.env.SYNTHETIC_API_KEY!;

test.describe('Synthetic: API Health', () => {
  test.describe.configure({ timeout: 5_000, retries: 0 });

  test('health endpoint returns healthy status', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.database).toBe('connected');
    expect(body.cache).toBe('connected');
  });

  test('authenticated API returns valid response', async ({ request }) => {
    const response = await request.get(`${API_URL}/v1/me`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.email).toContain('synthetic');
  });

  test('core endpoint responds within latency budget', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${API_URL}/v1/items?limit=10`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const duration = Date.now() - start;
    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(2000); // 2 second latency budget
  });
});
```

## Search probe (fill query, submit, assert on results + latency budget)

A search probe must type a query, submit it, and assert on returned results — not just status. Status-only search probes pass while search returns zero results.

```typescript
// probes/search.ts
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PRODUCTION_URL!;

test.describe('Synthetic: Search', () => {
  test.describe.configure({ timeout: 15_000, retries: 0 });

  test('search returns relevant results within latency budget', async ({ page }) => {
    await page.goto(`${PROD_URL}/search`);
    const start = Date.now();

    await page.getByRole('searchbox').fill('invoice');
    await page.getByRole('button', { name: 'Search' }).click();

    // Assert on results, not just on a 200 — a search page that returns
    // zero results still returns 200.
    const results = page.getByRole('listitem', { name: /result/i });
    await expect(results.first()).toBeVisible({ timeout: 5_000 });
    expect(await results.count()).toBeGreaterThan(0);

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000); // 2 second search latency budget
  });
});
```

## Environment-aware probe config

Probes should adapt to the environment they run against without code changes — `getProbeConfig()` returns a different baseUrl, credentials per environment, and thresholds (staging thresholds are looser than production) keyed off `PROBE_ENVIRONMENT`.

```typescript
// probes/config.ts
interface ProbeConfig {
  baseUrl: string;
  credentials: { email: string; password: string };
  thresholds: { pageLoad: number; apiResponse: number };
}

function getProbeConfig(): ProbeConfig {
  const env = process.env.PROBE_ENVIRONMENT ?? 'production';

  const configs: Record<string, ProbeConfig> = {
    staging: {
      baseUrl: 'https://staging.example.com',
      credentials: { email: 'synthetic@staging.example.com', password: process.env.STAGING_PASS! },
      thresholds: { pageLoad: 5000, apiResponse: 3000 },
    },
    production: {
      baseUrl: 'https://www.example.com',
      credentials: { email: 'synthetic@example.com', password: process.env.PROD_PASS! },
      thresholds: { pageLoad: 3000, apiResponse: 1000 },
    },
  };

  return configs[env];
}
```
