# Multi-Site Architecture

Patterns for testing multiple websites or applications from a single Playwright test suite. Common in monorepos, multi-brand apps, and platform teams.

---

## When You Need Multi-Site

- **Monorepo:** Multiple apps (marketing site, dashboard, admin panel) in one repo
- **Multi-brand:** Same product with different branding (whitelabel)
- **Platform:** A platform with customer-facing and internal-facing apps
- **Microservices:** Testing across service boundaries (e.g., auth service + main app)

---

## Project Layout for Monorepo

```
monorepo/
├── apps/
│   ├── marketing/        # Public website
│   ├── dashboard/        # User-facing app
│   └── admin/            # Admin panel
├── packages/
│   └── e2e/              # Shared test infrastructure
│       ├── playwright.config.ts
│       ├── fixtures/
│       │   ├── base.fixture.ts
│       │   └── sites.fixture.ts
│       ├── pages/
│       │   ├── shared/          # Shared page objects
│       │   │   ├── login.page.ts
│       │   │   └── navigation.page.ts
│       │   ├── marketing/       # Site-specific page objects
│       │   │   └── landing.page.ts
│       │   ├── dashboard/
│       │   │   └── overview.page.ts
│       │   └── admin/
│       │       └── users.page.ts
│       └── tests/
│           ├── marketing/
│           ├── dashboard/
│           └── admin/
```

---

## Per-Site Config Objects

Define site-specific configuration in a central place.

```typescript
// packages/e2e/config/sites.ts

export interface SiteConfig {
  name: string;
  baseURL: string;
  loginPath: string;
  dashboardPath: string;
  credentials: {
    email: string;
    password: string;
  };
}

const envConfigs = {
  dev: {
    marketing: {
      name: 'marketing',
      baseURL: 'http://localhost:3000',
      loginPath: '/login',
      dashboardPath: '/',
      credentials: {
        email: process.env.MARKETING_TEST_EMAIL ?? 'marketing@test.local',
        password: process.env.MARKETING_TEST_PASSWORD ?? 'test-password',
      },
    },
    dashboard: {
      name: 'dashboard',
      baseURL: 'http://localhost:3001',
      loginPath: '/auth/login',
      dashboardPath: '/overview',
      credentials: {
        email: process.env.DASHBOARD_TEST_EMAIL ?? 'user@test.local',
        password: process.env.DASHBOARD_TEST_PASSWORD ?? 'test-password',
      },
    },
    admin: {
      name: 'admin',
      baseURL: 'http://localhost:3002',
      loginPath: '/admin/login',
      dashboardPath: '/admin/dashboard',
      credentials: {
        email: process.env.ADMIN_TEST_EMAIL ?? 'admin@test.local',
        password: process.env.ADMIN_TEST_PASSWORD ?? 'admin-password',
      },
    },
  },
  staging: {
    marketing: {
      name: 'marketing',
      baseURL: 'https://staging.example.com',
      loginPath: '/login',
      dashboardPath: '/',
      credentials: {
        email: process.env.MARKETING_TEST_EMAIL!,
        password: process.env.MARKETING_TEST_PASSWORD!,
      },
    },
    dashboard: {
      name: 'dashboard',
      baseURL: 'https://app.staging.example.com',
      loginPath: '/auth/login',
      dashboardPath: '/overview',
      credentials: {
        email: process.env.DASHBOARD_TEST_EMAIL!,
        password: process.env.DASHBOARD_TEST_PASSWORD!,
      },
    },
    admin: {
      name: 'admin',
      baseURL: 'https://admin.staging.example.com',
      loginPath: '/admin/login',
      dashboardPath: '/admin/dashboard',
      credentials: {
        email: process.env.ADMIN_TEST_EMAIL!,
        password: process.env.ADMIN_TEST_PASSWORD!,
      },
    },
  },
} as const;

type Environment = keyof typeof envConfigs;
type SiteName = keyof typeof envConfigs.dev;

const env = (process.env.TEST_ENV ?? 'dev') as Environment;

export function getSiteConfig(site: SiteName): SiteConfig {
  return envConfigs[env][site];
}

export function getAllSiteConfigs(): Record<SiteName, SiteConfig> {
  return envConfigs[env];
}
```

---

## Multi-Site Playwright Config

```typescript
// packages/e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
import { getAllSiteConfigs } from './config/sites';

const sites = getAllSiteConfigs();
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['html', { open: 'never' }], ['github']]
    : [['html', { open: 'on-failure' }]],

  projects: [
    // Setup projects (one per site)
    {
      name: 'marketing-setup',
      testMatch: /marketing\.setup\.ts/,
      use: { baseURL: sites.marketing.baseURL },
    },
    {
      name: 'dashboard-setup',
      testMatch: /dashboard\.setup\.ts/,
      use: { baseURL: sites.dashboard.baseURL },
    },
    {
      name: 'admin-setup',
      testMatch: /admin\.setup\.ts/,
      use: { baseURL: sites.admin.baseURL },
    },

    // Test projects (one per site per browser)
    {
      name: 'marketing-chromium',
      testDir: './tests/marketing',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: sites.marketing.baseURL,
        storageState: '.auth/marketing.json',
      },
      dependencies: ['marketing-setup'],
    },
    {
      name: 'dashboard-chromium',
      testDir: './tests/dashboard',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: sites.dashboard.baseURL,
        storageState: '.auth/dashboard.json',
      },
      dependencies: ['dashboard-setup'],
    },
    {
      name: 'admin-chromium',
      testDir: './tests/admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: sites.admin.baseURL,
        storageState: '.auth/admin.json',
      },
      dependencies: ['admin-setup'],
    },
  ],

  webServer: isCI
    ? undefined
    : [
        {
          command: 'npm run dev --workspace=apps/marketing',
          url: sites.marketing.baseURL,
          reuseExistingServer: true,
        },
        {
          command: 'npm run dev --workspace=apps/dashboard',
          url: sites.dashboard.baseURL,
          reuseExistingServer: true,
        },
        {
          command: 'npm run dev --workspace=apps/admin',
          url: sites.admin.baseURL,
          reuseExistingServer: true,
        },
      ],
});
```

---

## Shared Fixtures Across Sites

Create site-aware fixtures that adapt behavior based on which site is under test.

```typescript
// packages/e2e/fixtures/sites.fixture.ts
import { test as base, type Page } from '@playwright/test';
import { type SiteConfig, getSiteConfig } from '../config/sites';

type SiteFixtures = {
  siteConfig: SiteConfig;
  authenticatedPage: Page;
};

export const test = base.extend<SiteFixtures>({
  // Determine the current site from the project name
  siteConfig: async ({}, use, testInfo) => {
    const projectName = testInfo.project.name;
    // Extract site name: "dashboard-chromium" → "dashboard"
    const siteName = projectName.split('-')[0] as 'marketing' | 'dashboard' | 'admin';
    await use(getSiteConfig(siteName));
  },

  authenticatedPage: async ({ browser, siteConfig }, use) => {
    const ctx = await browser.newContext({
      storageState: `.auth/${siteConfig.name}.json`,
    });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
```

---

## Adapter Pattern for Site-Specific Behavior

When the same user action works differently across sites (e.g., different login forms), use an adapter interface.

```typescript
// packages/e2e/pages/adapters/login.adapter.ts
import { type Page, expect } from '@playwright/test';

export interface LoginAdapter {
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  expectLoggedIn(): Promise<void>;
}

// Dashboard uses a standard email/password form
export class DashboardLoginAdapter implements LoginAdapter {
  constructor(private readonly page: Page) {}

  async login(email: string, password: string) {
    await this.page.goto('/auth/login');
    await this.page.getByLabel('Email').fill(email);
    await this.page.getByLabel('Password').fill(password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
    await expect(this.page).toHaveURL(/overview/);
  }

  async logout() {
    await this.page.getByRole('button', { name: 'User menu' }).click();
    await this.page.getByRole('menuitem', { name: 'Sign out' }).click();
  }

  async expectLoggedIn() {
    await expect(this.page.getByRole('button', { name: 'User menu' })).toBeVisible();
  }
}

// Admin uses a different login flow (e.g., SSO or two-factor)
export class AdminLoginAdapter implements LoginAdapter {
  constructor(private readonly page: Page) {}

  async login(email: string, password: string) {
    await this.page.goto('/admin/login');
    await this.page.getByLabel('Admin email').fill(email);
    await this.page.getByLabel('Admin password').fill(password);
    await this.page.getByRole('button', { name: 'Access admin panel' }).click();
    await expect(this.page).toHaveURL(/admin\/dashboard/);
  }

  async logout() {
    await this.page.getByRole('link', { name: 'Logout' }).click();
  }

  async expectLoggedIn() {
    await expect(this.page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();
  }
}
```

### Fixture That Injects the Right Adapter

```typescript
// packages/e2e/fixtures/login.fixture.ts
import { test as siteTest } from './sites.fixture';
import {
  type LoginAdapter,
  DashboardLoginAdapter,
  AdminLoginAdapter,
} from '../pages/adapters/login.adapter';

export const test = siteTest.extend<{ loginAdapter: LoginAdapter }>({
  loginAdapter: async ({ page, siteConfig }, use) => {
    const adapters: Record<string, () => LoginAdapter> = {
      dashboard: () => new DashboardLoginAdapter(page),
      admin: () => new AdminLoginAdapter(page),
    };

    const adapter = adapters[siteConfig.name]?.() ?? new DashboardLoginAdapter(page);
    await use(adapter);
  },
});
```

---

## Shared Page Objects with Site Overrides

Base page objects define the common interface. Site-specific subclasses override only what differs.

```typescript
// packages/e2e/pages/shared/navigation.page.ts
import { type Page, type Locator, expect } from '@playwright/test';

export class NavigationPage {
  readonly mainNav: Locator;
  readonly userMenu: Locator;

  constructor(protected readonly page: Page) {
    this.mainNav = page.getByRole('navigation', { name: 'Main' });
    this.userMenu = page.getByRole('button', { name: /user|account|profile/i });
  }

  async navigateTo(linkName: string): Promise<void> {
    await this.mainNav.getByRole('link', { name: linkName }).click();
  }

  async expectActiveLink(linkName: string): Promise<void> {
    await expect(
      this.mainNav.getByRole('link', { name: linkName })
    ).toHaveAttribute('aria-current', 'page');
  }
}

// packages/e2e/pages/admin/navigation.page.ts
import { type Page, type Locator } from '@playwright/test';
import { NavigationPage } from '../shared/navigation.page';

export class AdminNavigationPage extends NavigationPage {
  readonly sidebarNav: Locator;

  constructor(page: Page) {
    super(page);
    // Admin has a sidebar instead of top nav
    this.sidebarNav = page.getByRole('navigation', { name: 'Admin sidebar' });
  }

  override async navigateTo(linkName: string): Promise<void> {
    await this.sidebarNav.getByRole('link', { name: linkName }).click();
  }
}
```

---

## Cross-Site Tests

Tests that verify behavior across multiple sites (e.g., content created in admin appears on the public site).

```typescript
import { test, expect } from '@playwright/test';
import { getSiteConfig } from '../config/sites';

test('blog post published in admin appears on marketing site', async ({ browser }) => {
  const adminConfig = getSiteConfig('admin');
  const marketingConfig = getSiteConfig('marketing');

  // Create the post in admin
  const adminCtx = await browser.newContext({
    baseURL: adminConfig.baseURL,
    storageState: '.auth/admin.json',
  });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/admin/blog/new');
  await adminPage.getByLabel('Title').fill('E2E Test Post');
  await adminPage.getByLabel('Content').fill('This is automated test content.');
  await adminPage.getByRole('button', { name: 'Publish' }).click();
  await expect(adminPage.getByRole('alert')).toContainText('Published');
  await adminCtx.close();

  // Verify it appears on the marketing site
  const marketingCtx = await browser.newContext({
    baseURL: marketingConfig.baseURL,
  });
  const marketingPage = await marketingCtx.newPage();
  await marketingPage.goto('/blog');
  await expect(marketingPage.getByRole('link', { name: 'E2E Test Post' })).toBeVisible();
  await marketingCtx.close();
});
```

---

## Environment-Aware Base URLs

For flexible environment targeting:

```bash
# Run against local
npx playwright test

# Run against staging
TEST_ENV=staging npx playwright test

# Run a specific site
npx playwright test --project=dashboard-chromium

# Run smoke tests on all sites
npx playwright test --grep @smoke
```

---

## CI Considerations for Multi-Site

```yaml
# GitHub Actions -- run sites in parallel
jobs:
  e2e:
    strategy:
      fail-fast: false
      matrix:
        site: [marketing, dashboard, admin]
    steps:
      - run: npx playwright test --project=${{ matrix.site }}-chromium
        env:
          TEST_ENV: staging
```
