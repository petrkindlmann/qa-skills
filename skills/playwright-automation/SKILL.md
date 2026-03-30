---
name: playwright-automation
description: >-
  Production-grade Playwright in TypeScript: Page Object Model, fixtures, auto-waiting,
  user-facing locators, parallel execution, CI integration, visual testing, accessibility.
  Includes explicit "do not" list for AI agents and 2025-2026 feature awareness.
  Use when: "Playwright," "browser testing," "E2E test," "end-to-end," "page object."
  Related: visual-testing, ci-cd-integration, api-testing, test-reliability, accessibility-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
How an expert agent writes stable, maintainable, production-grade Playwright tests in TypeScript.
</objective>

## Discovery Questions

Before generating any code, ask:

1. **TypeScript or JavaScript?** TypeScript is strongly recommended. It catches locator and assertion mistakes at compile time, and every example in this skill assumes TypeScript.
2. **Which browsers?** Chromium for local dev. Add Firefox and WebKit in CI. Mobile viewports are separate Playwright projects, not separate test files.
3. **Existing suite or fresh start?** If migrating from Cypress or Selenium, start by rewriting the flakiest tests first. Do not attempt a big-bang rewrite.
4. **Single site or multi-site?** Multi-site architectures need shared fixtures and per-site config objects. See `references/multi-site-architecture.md`.

---

## Core Principles

1. **User-facing locators first.** `getByRole` > `getByLabel` > `getByTestId` > CSS (last resort). Locators must reflect what the user sees, not how the DOM is structured. See `references/selector-strategies.md`.
2. **Auto-waiting -- NEVER use `waitForTimeout`.** Every Playwright action and web-first assertion auto-waits. If you think you need a timeout, you need a better locator or assertion.
3. **Test isolation.** Each test gets a fresh `BrowserContext`. Tests must never depend on other tests' state or execution order.
4. **Parallel by default, serial only when necessary.** Use `fullyParallel: true` in config. Reserve `test.describe.serial` for flows that genuinely cannot be isolated (rare).
5. **Fixtures for setup, not hooks.** Fixtures compose, provide type safety, and automatically tear down. Prefer them over `beforeEach`/`afterEach` for anything non-trivial. See `references/fixtures-and-projects.md`.

> **Calibrate to your team maturity** (set `team_maturity` in `.agents/qa-project-context.md`):
> - **startup** — Chromium only, 5–10 critical path tests, basic CI run on PR. Skip sharding and visual testing until the suite is stable.
> - **growing** — Multi-browser (Chromium + Firefox), POM structure, parallel execution, CI with sharding, HTML report artifacts.
> - **established** — Full browser matrix, auth fixtures, API mocking layer, visual regression baseline, trace-on-failure, flakiness tracking.

---

## Common AI Agent Mistakes

**Do not generate code that matches any of these patterns.**

### 1. Never use `waitForTimeout()` as synchronization

**Why it is wrong:** Arbitrary waits are slow on fast machines and flaky on slow ones. They hide the real condition you are waiting for.

```typescript
// BAD
await page.waitForTimeout(2000);
await page.click('#submit');

// GOOD
await page.getByRole('button', { name: 'Submit' }).click(); // auto-waits
```

### 2. Never default to CSS/XPath when `getByRole`/`getByLabel`/`getByTestId` work

**Why it is wrong:** CSS selectors encode DOM structure, break on refactors, and do not communicate test intent.

```typescript
// BAD
await page.locator('.btn-primary.submit-form').click();

// GOOD
await page.getByRole('button', { name: 'Submit' }).click();
```

See the full decision tree in `references/selector-strategies.md`.

### 3. Never use discouraged `page.*` APIs when locator APIs exist

**Why it is wrong:** `page.click()`, `page.fill()`, `page.type()` are legacy convenience methods that bypass the locator auto-waiting pipeline and cannot be chained or filtered.

```typescript
// BAD
await page.click('#email');
await page.fill('#email', 'user@example.com');

// GOOD
await page.getByLabel('Email').fill('user@example.com');
```

### 4. Never use `force: true` without documented justification

**Why it is wrong:** `force: true` skips actionability checks (visible, enabled, stable, receives events). Either the wrong element is targeted, or there is an accessibility bug.

```typescript
// BAD
await page.getByRole('button', { name: 'Save' }).click({ force: true });

// GOOD -- dismiss any overlay first
await page.getByRole('button', { name: 'Dismiss' }).click();
await page.getByRole('button', { name: 'Save' }).click();
```

### 5. Never share mutable state between tests

**Why it is wrong:** Tests run in parallel. Shared module-level variables create race conditions and order-dependent failures. Use fixtures instead. See `references/anti-patterns.md`.

### 6. Never put login boilerplate in every test -- use `storageState`

**Why it is wrong:** UI login for every test is slow and fragile. `storageState` logs in once and replays cookies/localStorage for all tests. See `references/auth-patterns.md`.

### 7. Never use `locator.all()` on dynamic collections without a stability check

**Why it is wrong:** `locator.all()` returns a snapshot. If the DOM is still updating, you get a partial or empty array. It does not auto-retry.

```typescript
// BAD
const items = await page.getByRole('listitem').all();
expect(items.length).toBe(5); // may be 0 if DOM is still rendering

// GOOD
await expect(page.getByRole('listitem')).toHaveCount(5);
const items = await page.getByRole('listitem').all(); // then iterate if needed
```

### 8. Never assert with `allTextContents()` when `toHaveText()` gives retryability

**Why it is wrong:** `allTextContents()` is a snapshot that does not retry. `toHaveText()` retries until the condition is met or timeout expires.

```typescript
// BAD
const texts = await page.getByRole('listitem').allTextContents();
expect(texts).toEqual(['Apple', 'Banana', 'Cherry']);

// GOOD
await expect(page.getByRole('listitem')).toHaveText(['Apple', 'Banana', 'Cherry']);
```

### 9. Never test external dependencies you do not control

**Why it is wrong:** Third-party services have their own uptime, rate limits, and UI changes. Tests that hit real external services are flaky by definition.

```typescript
// BAD -- hitting real Stripe checkout
await page.goto('https://checkout.stripe.com/...');

// GOOD -- mock the external integration
await page.route('**/api/create-checkout-session', async (route) => {
  await route.fulfill({ json: { sessionId: 'mock_session', url: '/success' } });
});
```

### 10. Never leave `test.only` in committed code

**Why it is wrong:** A single `test.only` silently skips every other test in the suite. In CI, you run one test and think everything passes.

```typescript
export default defineConfig({ forbidOnly: !!process.env.CI });
```

---

## Project Structure

```
project-root/
├── playwright.config.ts
├── e2e/
│   ├── fixtures/              # base.fixture.ts, auth.fixture.ts, data.fixture.ts
│   ├── pages/                 # Page objects organized by feature
│   │   ├── base.page.ts
│   │   ├── dashboard.page.ts
│   │   └── components/        # Reusable component objects
│   │       ├── data-table.component.ts
│   │       └── modal.component.ts
│   ├── tests/                 # Test files organized by feature
│   │   ├── auth/
│   │   ├── dashboard/
│   │   └── settings/
│   ├── helpers/               # test-data.ts, api-client.ts
│   └── global-setup.ts
├── .auth/                     # Git-ignored storageState files
└── test-results/              # Git-ignored artifacts
```

### playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? '50%' : undefined,
  reporter: isCI
    ? [['html', { open: 'never' }], ['github'], ['json', { outputFile: 'test-results/results.json' }]]
    : [['html', { open: 'on-failure' }]],
  use: {
    baseURL,
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: isCI ? 'on-first-retry' : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'setup', testMatch: /global-setup\.ts/, teardown: 'teardown' },
    { name: 'teardown', testMatch: /global-teardown\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' }, dependencies: ['setup'] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], storageState: '.auth/user.json' }, dependencies: ['setup'] },
    { name: 'webkit', use: { ...devices['Desktop Safari'], storageState: '.auth/user.json' }, dependencies: ['setup'] },
  ],
  webServer: isCI ? undefined : {
    command: 'npm run dev', url: baseURL, reuseExistingServer: true, timeout: 120_000,
  },
});
```

### Global Setup

```typescript
import { test as setup, expect } from '@playwright/test';

setup('authenticate as default user', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/.*dashboard/);
  await page.context().storageState({ path: '.auth/user.json' });
});
```

---

## Page Object Model

### Base Page

```typescript
import { type Page, type Locator, expect } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}
  abstract readonly path: string;

  async goto(): Promise<void> {
    await this.page.goto(this.path);
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
  }
}
```

### Component Objects

Component objects represent reusable UI fragments (modals, data tables, nav bars). They take a root `Locator`, not a `Page`.

```typescript
export class DataTable {
  readonly rows: Locator;
  constructor(private readonly root: Locator) {
    this.rows = root.getByRole('row');
  }
  getRowByText(text: string | RegExp): Locator {
    return this.rows.filter({ hasText: text });
  }
}
```

### Fixture-Based Injection

Inject page objects via fixtures, not constructors in test files.

```typescript
export const test = base.extend<{ dashboardPage: DashboardPage }>({
  dashboardPage: async ({ page }, use) => { await use(new DashboardPage(page)); },
});
export { expect } from '@playwright/test';
```

### Composition Over Inheritance

Compose component objects rather than inherit from deep class hierarchies.

```typescript
export class UsersPage extends BasePage {
  readonly path = '/admin/users';
  readonly table: DataTable;
  constructor(page: Page) {
    super(page);
    this.table = new DataTable(page.getByRole('table', { name: 'Users' }));
  }
}
```

---

## Test Patterns

### Authentication (storageState reuse)

Global setup logs in once and saves `storageState`. All test projects load it via config. For multi-role auth (admin/user/guest), see `references/auth-patterns.md`.

### Form Interactions with test.step

Wrap logical action groups in `test.step()` for better trace viewer output.

```typescript
test('submits a multi-step form', async ({ page }) => {
  await page.goto('/onboarding');
  await test.step('fill personal info', async () => {
    await page.getByLabel('First name').fill('Jane');
    await page.getByRole('button', { name: 'Next' }).click();
  });
  await test.step('submit', async () => {
    await page.getByRole('button', { name: 'Complete setup' }).click();
  });
  await expect(page).toHaveURL('/dashboard');
});
```

### API Mocking

```typescript
// Mock a response
await page.route('**/api/products*', async (route) => {
  await route.fulfill({ json: { items: [{ id: '1', name: 'Widget', price: 29.99 }] } });
});

// Modify a real response
await page.route('**/api/feature-flags', async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  body.flags['new-checkout'] = true;
  await route.fulfill({ response, json: body });
});

// Simulate errors
await page.route('**/api/products*', (route) => route.fulfill({ status: 500 }));

// WebSocket (v1.49+)
await page.routeWebSocket('**/ws/notifications', (ws) => {
  ws.onMessage((msg) => { ws.send(JSON.stringify({ type: 'alert', title: 'Deployed' })); });
});
```

See `references/network-and-mocking.md` for HAR replay, conditional routing, and full patterns.

### Tags and Annotations

```typescript
test('checkout @smoke', async ({ page }) => { /* npx playwright test --grep @smoke */ });
test.slow();                                    // Triples timeout
test.skip(({ browserName }) => browserName === 'webkit', 'WebKit bug');
test.fixme('known issue tracked in JIRA-1234', async ({ page }) => { /* ... */ });
```

---

## Assertions

### Web-First Assertions (auto-retry — always prefer these)

```typescript
await expect(page.getByRole('alert')).toBeVisible();
await expect(page.getByRole('heading')).toHaveText('Dashboard');
await expect(page).toHaveURL('/dashboard');
await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
await expect(page.getByRole('listitem')).toHaveCount(5);
await expect(page.getByRole('listitem')).toHaveText(['Apple', 'Banana', 'Cherry']);
```

### Soft Assertions

Collect all failures instead of stopping at the first; all are reported at the end.

```typescript
await expect.soft(page.getByLabel('Name')).toHaveValue('Jane Doe');
await expect.soft(page.getByLabel('Email')).toHaveValue('jane@example.com');
```

### ARIA Snapshots

Verify accessibility tree structure; catches semantic regressions.

```typescript
await expect(page.getByRole('navigation', { name: 'Main' })).toMatchAriaSnapshot(`
  - navigation "Main":
    - link "Home"
    - link "Products"
`);
```

---

## New Features (2025-2026)

Agents should be aware of these recent Playwright additions:

| Version | Feature | What it does |
|---------|---------|-------------|
| v1.45 | Clock API | `page.clock.install()` / `page.clock.fastForward()` -- control time without monkey-patching `Date` |
| v1.45 | `--fail-on-flaky-tests` | CI flag that fails the run if any test required a retry to pass |
| v1.46 | `--only-changed` | Run only tests affected by changed files (git-diff-aware) |
| v1.46 | Component testing `router` fixture | Mock Next.js/SvelteKit/etc. router in component tests |
| v1.46 | ARIA snapshots | `toMatchAriaSnapshot()` for accessibility tree assertions |
| v1.49 | `routeWebSocket` | First-class WebSocket interception (replaces CDP hacks) |
| v1.51 | `expect.configure` | Per-block timeout/soft configuration |
| v1.57 | Speedboard in HTML reporter | Performance timeline visualization in the built-in report |
| v1.57 | `webServer.wait` regex | Wait for a specific stdout pattern instead of just a URL |

---

## Parallel Execution & CI

### Worker Configuration

```typescript
export default defineConfig({
  fullyParallel: true,
  workers: process.env.CI ? '50%' : undefined,
});
```

### Sharding Across CI Nodes

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/4
```

### Multiple Reporters

```typescript
reporter: [
  ['html', { open: 'never' }],
  ['json', { outputFile: 'results.json' }],
  ['github'],
  ['junit', { outputFile: 'junit.xml' }],
],
```

See `references/ci-recipes.md` for complete GitHub Actions workflows, artifact upload patterns, and sharding with merge.

---

## Debugging

- **Trace viewer:** `npx playwright show-trace test-results/my-test/trace.zip` -- timeline of actions, network, DOM snapshots, console logs.
- **UI mode:** `npx playwright test --ui` -- live browser, step-by-step, time-travel debugging.
- **Debug flag:** `npx playwright test my-test.spec.ts --debug` -- headed browser, pauses at each action.
- **VS Code extension:** `ms-playwright.playwright` -- run/debug from gutter icons, pick locators, watch mode.
- **page.pause():** Opens the Playwright Inspector mid-test. For local debugging only. Never commit to CI code paths.

See `references/debugging-and-triage.md` for flaky test triage workflows and artifact analysis.

---

## Done When

- `playwright.config.ts` exists with `projects` defined for at least one target browser (Chromium minimum; Firefox and WebKit added for CI)
- Page Object Model files live in the designated directory (`e2e/pages/` or equivalent) with component objects composed via root `Locator`
- All locators in test code use `getByRole`, `getByLabel`, or `getByTestId` — no raw CSS selectors or XPath
- CI workflow runs Playwright with `--shard` across matrix jobs and uploads the HTML report as an artifact on failure
- No `waitForTimeout` calls exist anywhere in test code (`grep` or `forbidOnly`-style lint catches any regressions)

## Related Skills and References

### Reference Files (in `references/`)

| File | Purpose |
|------|---------|
| `anti-patterns.md` | BAD vs GOOD code pairs for every common mistake |
| `fixtures-and-projects.md` | Auth fixtures, data fixtures, multi-env projects, composition |
| `selector-strategies.md` | Locator decision tree, getByRole examples, stability scoring |
| `auth-patterns.md` | storageState, multi-role, token seeding, session expiry |
| `multi-site-architecture.md` | Shared fixtures, per-site config, monorepo patterns |
| `network-and-mocking.md` | page.route, route.fetch, HAR, WebSocket, conditional routing |
| `debugging-and-triage.md` | Trace viewer, flaky test triage, retries, artifacts |
| `ci-recipes.md` | Reporters, sharding, --only-changed, browser caching, artifacts |

### Related Skills

- **visual-testing** -- Screenshot comparison, threshold management, baseline workflows.
- **ci-cd-integration** -- Pipeline configuration, parallelization, reporting beyond Playwright.
- **api-testing** -- Backend API validation, contract testing, request/response schemas.
- **test-reliability** -- Flaky test patterns, retry strategies, test stability metrics.
- **accessibility-testing** -- WCAG compliance, axe-core integration, ARIA assertions.