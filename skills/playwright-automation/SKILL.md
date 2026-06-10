---
name: playwright-automation
description: >-
  Write production-grade Playwright tests in TypeScript: Page Object Model,
  fixtures, auto-waiting, user-facing locators, parallel execution, CI
  integration, sharding, and 2025-2026 feature awareness. Includes an explicit
  "do not" list for AI agents.
  Use when: "Playwright," "write E2E test," "page object," "new Playwright suite,"
  "Playwright config."
  Not for: fixing one flaky test at runtime — use test-reliability. Not for: bulk
  regenerating selectors after a UI refactor — use selector-drift-recovery. Not for:
  visual baseline creation/management — use visual-testing. Not for: deep WCAG/axe
  audits — use accessibility-testing.
  Related: visual-testing, ci-cd-integration, api-testing, test-reliability, selector-drift-recovery, accessibility-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
How an expert agent writes stable, maintainable, production-grade Playwright tests in TypeScript. The failure this prevents: AI agents reflexively reach for the three patterns that produce suites which pass once and flake forever — never use `waitForTimeout`, never default to CSS selectors, and avoid the legacy `page.click()` family. This skill encodes the auto-waiting, user-facing-locator, fixture-based discipline that makes a suite survive a refactor.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip any question answered there. Then ask only what's missing:

1. **TypeScript or JavaScript?** TypeScript is strongly recommended — it catches locator and assertion mistakes at compile time, and every example here assumes it.
2. **Which browsers?** Chromium for local dev; add Firefox and WebKit in CI. Mobile viewports are separate Playwright projects, not separate test files — they change the device descriptor.
3. **Existing suite or fresh start?** Migrating from Cypress/Selenium, rewrite the flakiest tests first; never big-bang. Changes the sequencing entirely.
4. **Single site or multi-site?** Multi-site needs shared fixtures and per-site config objects — see `references/multi-site-architecture.md`.

---

## Core Principles

1. **User-facing locators first.** `getByRole` > `getByLabel` > `getByTestId` > CSS (last resort). Locators must reflect what the user sees, not how the DOM is structured. See `references/selector-strategies.md`.
2. **Auto-waiting — NEVER use `waitForTimeout`.** Every Playwright action and web-first assertion auto-waits. If you think you need a timeout, you need a better locator or assertion.
3. **Test isolation.** Each test gets a fresh `BrowserContext`. Tests must never depend on other tests' state or execution order.
4. **Parallel by default, serial only when necessary.** Use `fullyParallel: true`. Reserve `test.describe.serial` for flows that genuinely cannot be isolated (rare).
5. **Fixtures for setup, not hooks.** Fixtures compose, provide type safety, and tear down automatically. Prefer them over `beforeEach`/`afterEach` for anything non-trivial. See `references/fixtures-and-projects.md`.

> **Calibrate to your team maturity** (set `team_maturity` in `.agents/qa-project-context.md`):
> - **startup** — Chromium only, 5–10 critical-path tests, basic CI run on PR. Skip sharding and visual baselines until the suite is stable.
> - **growing** — Chromium + Firefox, POM structure, parallel execution, sharding in CI, HTML report artifacts.
> - **established** — Full browser matrix, auth fixtures, API mocking layer, visual regression baseline, trace-on-failure, flakiness tracking.

---

## Project Structure

```
project-root/
├── playwright.config.ts
├── e2e/
│   ├── fixtures/              # base.fixture.ts, auth.fixture.ts, data.fixture.ts
│   ├── pages/                 # Page objects by feature
│   │   ├── base.page.ts
│   │   ├── dashboard.page.ts
│   │   └── components/        # Reusable component objects (data-table, modal)
│   ├── tests/                 # Test files by feature (auth/, dashboard/, settings/)
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
    ? [['blob'], ['github'], ['json', { outputFile: 'test-results/results.json' }]]
    : [['html', { open: 'on-failure' }]],
  use: {
    baseURL,
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: isCI ? 'on-first-retry' : 'off',
    navigationTimeout: 30_000,
    // Avoid a global actionTimeout — it can mask a genuinely slow auto-waited
    // action. Set per-action only where a known-slow widget needs it.
  },
  projects: [
    { name: 'setup', testMatch: /global-setup\.ts/, teardown: 'teardown' },
    { name: 'teardown', testMatch: /global-teardown\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' }, dependencies: ['setup'] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], storageState: '.auth/user.json' }, dependencies: ['setup'] },
    { name: 'webkit', use: { ...devices['Desktop Safari'], storageState: '.auth/user.json' }, dependencies: ['setup'] },
  ],
  webServer: isCI ? undefined : {
    command: 'npm run dev', url: baseURL, reuseExistingServer: !isCI, timeout: 120_000,
  },
});
```

The `blob` reporter in CI is what makes sharded runs mergeable — see the sharding section. The `setup` project writes `storageState` once before the browser projects depend on it.

### Global setup (storageState)

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

This is the `setup` project pattern: the setup project (or a `globalSetup` file) runs UI login once, and every browser project replays the saved cookies/localStorage via `storageState` in config. For multi-role auth (admin/user/guest) and token seeding, see `references/auth-patterns.md`.

---

## Page Object Model

```typescript
import { type Page, type Locator, expect } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}
  abstract readonly path: string;
  async goto(): Promise<void> {
    await this.page.goto(this.path);
    await this.page.waitForLoadState('domcontentloaded');
  }
}
```

**Component objects** represent reusable UI fragments (modals, tables, nav). They take a root `Locator`, not a `Page`:

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

**Compose, don't inherit deep.** A page holds its components; it does not extend a five-level hierarchy:

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

**Inject page objects via fixtures**, not constructors in test files:

```typescript
export const test = base.extend<{ usersPage: UsersPage }>({
  usersPage: async ({ page }, use) => { await use(new UsersPage(page)); },
});
export { expect } from '@playwright/test';
```

POM methods return state (locators, values); they do not assert. Assertions live in the test so failures point at the test, not the page object.

---

## Test Patterns

### Form interactions with test.step

Wrap logical action groups in `test.step()` for readable trace-viewer output:

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

### API mocking

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

// Simulate an error
await page.route('**/api/products*', (route) => route.fulfill({ status: 500 }));

// WebSocket (v1.48+)
await page.routeWebSocket('**/ws/notifications', (ws) => {
  ws.onMessage(() => ws.send(JSON.stringify({ type: 'alert', title: 'Deployed' })));
});
```

See `references/network-and-mocking.md` for HAR replay and conditional routing.

### Authenticated APIRequestContext fixture

For seeding data or asserting backend state without driving the UI, inject a pre-authenticated `APIRequestContext`. Acquire the token in the fixture; never hardcode it:

```typescript
import { test, request, type APIRequestContext } from '@playwright/test';

// test.extend adds an `api` fixture to the base test object.
export const apiTest = test.extend<{ api: APIRequestContext }>({
  api: async ({ baseURL }, use) => {
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${process.env.API_TOKEN!}` },
    });
    await use(ctx);
    await ctx.dispose();
  },
});
```

### Tags and annotations

```typescript
test('checkout @smoke', async ({ page }) => { /* npx playwright test --grep @smoke */ });
test.slow();                                    // Triples timeout
test.skip(({ browserName }) => browserName === 'webkit', 'WebKit bug');
test.fixme('known issue tracked in JIRA-1234', async ({ page }) => { /* ... */ });
```

---

## Assertions

Always prefer web-first assertions — they auto-retry until the condition holds or the timeout expires:

```typescript
await expect(page.getByRole('alert')).toBeVisible();
await expect(page.getByRole('heading')).toHaveText('Dashboard');
await expect(page).toHaveURL('/dashboard');
await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
await expect(page.getByRole('listitem')).toHaveCount(5);
await expect(page.getByRole('listitem')).toHaveText(['Apple', 'Banana', 'Cherry']);
```

**Soft assertions** collect all failures instead of stopping at the first:

```typescript
await expect.soft(page.getByLabel('Name')).toHaveValue('Jane Doe');
await expect.soft(page.getByLabel('Email')).toHaveValue('jane@example.com');
```

**ARIA snapshots** verify accessibility-tree structure and catch semantic regressions:

```typescript
await expect(page.getByRole('navigation', { name: 'Main' })).toMatchAriaSnapshot(`
  - navigation "Main":
    - link "Home"
    - link "Products"
`);
```

### Visual regression (one-liner; defer the workflow)

Playwright's built-in `toHaveScreenshot` auto-retries and writes a baseline on first run. Mask dynamic regions; do not precede it with `waitForTimeout`:

```typescript
await expect(page.getByTestId('product-card')).toHaveScreenshot('product-card.png', {
  mask: [page.getByTestId('price')],
});
```

For baseline management, thresholds (`maxDiffPixelRatio`, `maskColor`, `stylePath`), and review workflows, use `visual-testing` — that is where visual baselines belong.

### Accessibility scan (axe; deep audits live elsewhere)

ARIA snapshots above check structure, not WCAG rules. For rule-based scanning, add `@axe-core/playwright`:

```typescript
import AxeBuilder from '@axe-core/playwright';

test('dashboard has no a11y violations', async ({ page }) => {
  await page.goto('/dashboard');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

For WCAG levels, rule tuning, and remediation guidance, use `accessibility-testing`.

---

## Parallel Execution & CI

### Sharding across CI nodes

Split the suite across matrix jobs, then merge the shard reports into one HTML report. Sharding earns its place at `growing`+ maturity; a `startup` suite of 5–10 tests should not shard.

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/4
```

Each shard uploads its `blob-report/`; a final job runs `npx playwright merge-reports --reporter=html ./all-blob-reports`. The `blob` reporter (set in the config above) is what makes merge work — `--shard` alone produces fragmented HTML reports. See `references/ci-recipes.md` for the full GitHub Actions workflow, blob upload/download, and artifact patterns.

### Debugging

- **Trace viewer:** `npx playwright show-trace test-results/.../trace.zip` — timeline of actions, network, DOM snapshots, console.
- **UI mode:** `npx playwright test --ui` — live, step-by-step, time-travel.
- **Debug flag:** `npx playwright test my-test.spec.ts --debug` — headed, pauses each action.
- **VS Code extension** `ms-playwright.playwright` — run/debug from gutter, pick locators, watch mode.
- **`page.pause()`** opens the Inspector mid-test. Local only — never commit it.

See `references/debugging-and-triage.md` for flaky-test triage and artifact analysis.

---

## New Features (2025-2026)

Current latest is **Playwright 1.60.0** (May 2026). Pin the same version in `package.json` and your CI Docker image. Recent additions worth knowing:

| Version | Feature | What it does |
|---------|---------|-------------|
| v1.45 | Clock API | `page.clock.install()` / `fastForward()` — control time without monkey-patching `Date` |
| v1.45 | `--fail-on-flaky-tests` | Fail the CI run if any test needed a retry to pass |
| v1.46 | `--only-changed` | Run only tests affected by changed files (git-diff aware) |
| v1.46 | ARIA snapshots | `toMatchAriaSnapshot()` for accessibility-tree assertions |
| v1.48 | `routeWebSocket` | First-class WebSocket interception (replaces CDP hacks) |
| v1.55 | Test Migrator | Automated Cypress→/Selenium→Playwright via `npx playwright migrate` |
| v1.56 | Test Agents | `npx playwright init-agents --loop=claude\|vscode\|opencode` — planner/generator/healer agents inside the coding agent's loop |
| v1.57 | Chrome for Testing default | Headed uses `chrome`, headless uses `chrome-headless-shell` instead of bundled Chromium. Caveat: a high-memory regression was reported (microsoft/playwright #38489) — pin a known-good image tag for CI. |
| v1.57 | `toHaveScreenshot` options | `maskColor`, `stylePath`, `pathTemplate` for masking color, custom stylesheet, and output path control |
| v1.59 | Screencast API | `page.screencast.start()` / `.stop()` for mid-test video with start/stop control — an alternative to `recordVideo`, not a replacement. Adds action annotations, chapter markers, custom HTML overlays, and `screencast.showOverlays()` / `hideOverlays()`. Useful for agent self-verification: a coding agent can hand off a reviewable video receipt. |
| v1.59 | `--debug=cli` | Pause-and-attach so an agent can step through a test |
| v1.60 | `locator.drop()` | Simulate an external file/clipboard drag-and-drop onto an element |
| v1.60 | `tracing.startHar()` | HAR recording as a first-class tracing API |

### AI-augmented authoring (Test Agents vs MCP)

Two integration paths — pick based on whether the agent runs *inside* your editor loop or *drives* a real browser remotely.

**Path A — Test Agents (`npx playwright init-agents --loop=claude`)**: scaffolds planner/generator/healer agents the coding agent loads during its loop. Token-efficient — no MCP server, no inter-process traffic. Best for "Claude/VS Code/opencode writes Playwright tests for me."

**Path B — `@playwright/mcp`**: an MCP server exposing browser actions to any MCP-aware agent. Higher overhead (process boundary, JSON marshalling) but the right choice when the agent must *drive* a live browser interactively rather than author tests offline. Config: `{ "mcpServers": { "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] } } }` in `.mcp.json`.

For test-failure repair, see `test-reliability`. For first-time generation from PRDs/specs, see `ai-test-generation`.

---

## Anti-Patterns

Design-time mistakes that quietly rot a suite. The code-level "never do X" list lives in `references/anti-patterns.md` with BAD/GOOD pairs — load it when writing test bodies.

### 1. The God Page Object
One class for the whole app turns into a 2000-line file every test imports and nothing can refactor safely. Split by page/feature and compose component objects.

### 2. POM methods that assert
A page object whose methods call `expect` hides the assertion from the test. When it fails, the stack points at the page object, not the failing scenario. Return locators/state; assert in the test.

### 3. Asserting on implementation detail
Tests keyed to CSS classes, DOM nesting, or internal IDs break on every refactor without a real behavior change. Assert what the user perceives — visible text, roles, URLs.

### 4. Fixtures that depend on test order
A fixture that mutates shared module state, or assumes another test ran first, fails the moment tests parallelize or run in isolation. Each fixture must stand alone.

### 5. `data-testid` where `getByRole` would work
Sprinkling test ids onto buttons and headings that already have an accessible name skips the cheapest accessibility signal you get for free. Reserve `getByTestId` for elements with no stable role/label.

The most damaging *runtime* mistake — synchronizing with `waitForTimeout` instead of an auto-waiting locator:

```typescript
// BAD — slow on fast machines, flaky on slow ones, hides the real condition
await page.waitForTimeout(2000);
await page.click('#submit');

// GOOD — the action auto-waits for actionability
await page.getByRole('button', { name: 'Submit' }).click();
```

The other nine code-level offenders (CSS over roles, `page.*` over locators, `force: true`, shared state, per-test login, `locator.all()` without a stability check, `allTextContents()` over `toHaveText()`, hitting real third-party services, committed `test.only`) are in `references/anti-patterns.md`.

---

## Verification

Run these against the generated artifact, smallest first:

```bash
npx playwright test --list                 # tests are discovered and parse
grep -rn 'waitForTimeout\|page.pause' e2e/  # must print nothing
npx tsc --noEmit                            # locator/assertion types compile
```

Enforce the "never do X" rules in CI with `eslint-plugin-playwright` — rules `no-wait-for-timeout`, `no-force-option`, `no-element-handle`, `no-page-pause` turn this skill's prose bans into a failing lint.

---

## Done When

- `playwright.config.ts` exists with `projects` for at least Chromium (Firefox + WebKit added when targeting CI), and `forbidOnly: !!process.env.CI`.
- Page Object Model files live in `e2e/pages/` (or equivalent), with component objects composed via a root `Locator` and no `expect` inside POM methods.
- `grep -rn 'waitForTimeout' e2e/` returns nothing, and `eslint-plugin-playwright`'s `no-wait-for-timeout` is enabled.
- Every locator uses `getByRole` / `getByLabel` / `getByTestId` — `grep -rn 'page.locator(\|xpath=\|css=' e2e/` returns nothing (or only justified, commented exceptions).
- CI runs the suite on PR; at `growing`+ maturity it shards across matrix jobs with the `blob` reporter and a `merge-reports` step, uploading the HTML report as an artifact on failure.

## Related Skills

- **visual-testing** — screenshot baseline creation, threshold tuning, and review/approval workflows. Go here for anything beyond a single inline `toHaveScreenshot` check.
- **accessibility-testing** — WCAG levels, axe rule tuning, and remediation. This skill only shows a minimal axe scan.
- **api-testing** — backend API validation, schema/contract testing, and the full `APIRequestContext` patterns.
- **ci-cd-integration** — pipeline config, parallelization, and reporting beyond Playwright's own.
- **test-reliability** — runtime healing of a single flaky test (quarantine, retry strategy).
- **selector-drift-recovery** — offline bulk regeneration of selectors after a UI refactor breaks many tests.

### Reference files (in `references/`)

| File | Purpose |
|------|---------|
| `anti-patterns.md` | BAD vs GOOD code pairs for every code-level mistake |
| `fixtures-and-projects.md` | Auth fixtures, data fixtures, multi-env projects, composition |
| `selector-strategies.md` | Locator decision tree, `getByRole` examples, stability scoring |
| `auth-patterns.md` | storageState, multi-role, token seeding, session expiry |
| `multi-site-architecture.md` | Shared fixtures, per-site config, monorepo patterns |
| `network-and-mocking.md` | `page.route`, `route.fetch`, HAR, WebSocket, conditional routing |
| `debugging-and-triage.md` | Trace viewer, flaky-test triage, retries, artifacts |
| `ci-recipes.md` | Reporters, sharding + merge, `--only-changed`, browser caching, Docker |
