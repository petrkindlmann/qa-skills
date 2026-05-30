# Framework Walkthrough Template

Create this document for your project. It is the primary reference for anyone writing tests. The decision prose and rationale live in `SKILL.md`; this file holds the full templates and code blocks to copy and adapt.

## 1. Architecture Overview

```
Test Architecture: [Project Name]
══════════════════════════════════

Framework:     [Playwright 1.x / Cypress / pytest / etc.]
Language:      [TypeScript / JavaScript / Python]
Config:        [path to config file]
Test runner:   [built-in / Jest / Vitest / pytest]

Directory Structure:
  tests/
  ├── e2e/
  │   ├── fixtures/         → Test fixtures (authentication, data setup, page objects)
  │   ├── pages/            → Page objects organized by feature
  │   │   ├── base.page.ts  → Abstract base page (goto, waitForReady)
  │   │   └── [feature]/    → Feature-specific page objects
  │   ├── tests/            → Test files organized by feature
  │   │   └── [feature]/    → One directory per feature area
  │   └── helpers/          → Utilities (API client, test data, assertions)
  ├── unit/                 → Unit tests (co-located or separate)
  └── integration/          → Integration/API tests
```

## 2. How to Run Tests

```bash
# Run all E2E tests
npx playwright test

# Run a specific test file
npx playwright test tests/e2e/tests/checkout/apply-coupon.spec.ts

# Run tests matching a pattern
npx playwright test --grep "checkout"

# Run in headed mode (see the browser)
npx playwright test --headed

# Run in debug mode (step through)
npx playwright test --debug

# Run with UI mode (interactive)
npx playwright test --ui

# Run specific project (browser)
npx playwright test --project=chromium

# View last test report
npx playwright show-report
```

## 3. How to Write a New Test (Step by Step)

```
Step 1: Identify the test location
  └─ tests/e2e/tests/[feature]/[behavior].spec.ts

Step 2: Check for existing page objects
  └─ tests/e2e/pages/[feature].page.ts — reuse if exists

Step 3: Check for existing fixtures
  └─ tests/e2e/fixtures/ — reuse auth, data setup, etc.

Step 4: Write the test
  └─ Follow the template below

Step 5: Run locally (3 times to check for flakiness)
  └─ npx playwright test [your-file] --repeat-each=3

Step 6: Open a PR
  └─ CI will run the test; check results before requesting review
```

**New test template:**

```typescript
import { test, expect } from '../../fixtures/base.fixture';

test.describe('Feature: [feature name]', () => {
  test('should [expected behavior] when [condition]', async ({ page }) => {
    // Arrange — navigate and set up preconditions
    await page.goto('/target-page');

    // Act — perform the user action
    await page.getByRole('button', { name: 'Action' }).click();

    // Assert — verify the expected outcome
    await expect(page.getByRole('alert')).toHaveText('Success');
  });
});
```

## 4. How to Debug Failures

```
Test failed locally:
  1. Run with --debug flag to step through
  2. Check trace file in test-results/ directory
  3. Open trace: npx playwright show-trace test-results/[test]/trace.zip

Test failed in CI but passes locally:
  1. Download CI artifacts (trace, screenshot)
  2. Check for timing issues — CI runners are slower
  3. Check for data dependencies — CI uses fresh state
  4. Check for viewport differences — CI may use different screen size
  5. Run with --repeat-each=20 locally to reproduce intermittent failures

Common failure patterns:
  - TimeoutError: Element not found → wrong selector or element not rendered
  - TimeoutError: Navigation → page did not load, check baseURL and server
  - Strict mode violation → selector matches multiple elements, be more specific
  - Test isolation failure → shared state from another test, check fixtures
```

## 5. Common Patterns and Conventions

Document project-specific patterns. Examples:

```typescript
// Authentication: always use the fixture, never login manually in tests
test('admin can delete users', async ({ adminPage }) => {
  // adminPage fixture provides an authenticated admin session
  await adminPage.goto('/admin/users');
});

// Test data: use factories, never hardcode IDs
const user = await createTestUser({ role: 'editor', plan: 'pro' });
// Factory handles creation and returns cleanup function

// Assertions: use specific assertions, not toBeVisible alone
await expect(page.getByRole('heading')).toHaveText('Dashboard');  // GOOD
await expect(page.getByText('Dashboard')).toBeVisible();          // OK but less specific

// Selectors: priority order for this project
// 1. getByRole (buttons, links, headings, textboxes)
// 2. getByLabel (form inputs)
// 3. getByTestId (custom data-testid attributes)
// 4. getByText (static text elements — last resort)
```

## 6. Where to Find Help

```
Questions about test patterns:    → #qa-engineering channel
Questions about test failures:    → Check CI logs first, then ask in PR comments
Questions about product behavior: → Product spec in [wiki/notion/confluence link]
Framework documentation:          → https://playwright.dev/docs/intro
Project-specific docs:            → .agents/qa-project-context.md
```
