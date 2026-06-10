# Framework-Specific Migration Guides

Runnable before/after code for each supported migration path. The decision prose, key differences summary, and migration-notes checklists live in `SKILL.md`; this file holds the full code examples.

## Selenium to Playwright

**Key differences:**
- Selenium uses the WebDriver protocol; Playwright uses the Chrome DevTools Protocol (CDP) and browser-specific protocols. Playwright is faster because it bypasses the HTTP-based WebDriver layer.
- Selenium requires explicit waits everywhere; Playwright auto-waits on every action and assertion.
- Selenium locators are strings; Playwright locators are objects with built-in filtering and chaining.

```python
# Selenium (Python)
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

driver.get("https://example.com/login")
wait = WebDriverWait(driver, 10)
email_input = wait.until(EC.visibility_of_element_located((By.ID, "email")))
email_input.send_keys("user@example.com")
driver.find_element(By.ID, "password").send_keys("pass123")
driver.find_element(By.CSS_SELECTOR, "button[type='submit']").click()
wait.until(EC.url_contains("/dashboard"))
```

```typescript
// Playwright (TypeScript)
await page.goto('https://example.com/login');
await page.getByLabel('Email').fill('user@example.com');
await page.getByLabel('Password').fill('pass123');
// 'Sign in' is the submit button's accessible name — replace it with the real
// label your app renders. The Selenium source only matched button[type=submit].
await page.getByRole('button', { name: 'Sign in' }).click();
await expect(page).toHaveURL(/dashboard/);
```

**Migration notes:**
- Remove all explicit waits (`WebDriverWait`, `implicitly_wait`). Playwright auto-waits.
- Replace `find_element(By.ID/CSS/XPATH)` with `getByRole`, `getByLabel`, `getByTestId`.
- Replace `send_keys` with `fill` (clears the field first, which is usually what you want).
- Replace `assert` statements with `expect` (auto-retrying web-first assertions).
- Replace WebDriver session management with Playwright's `BrowserContext` (lighter, faster).
- **Auth/session:** `driver.add_cookie(...)` does not carry over. Capture login once in `globalSetup` and persist `storageState`; reuse it per test instead of logging in every spec. See the storageState row in SKILL.md Failure Modes.

## Jest to Vitest

**Target version:** Vitest 4.x (current 4.1.8). Vitest 4 was a major bump — coverage and reporter APIs shifted slightly. The `vitest/config` import path is unchanged. Read https://vitest.dev/guide/migration before starting if your source is Jest 28 or older.

**Key differences:**
- Vitest is API-compatible with Jest for most use cases. Many tests work unchanged.
- Vitest uses `vi` instead of `jest` for mock/spy/timer utilities.
- Vitest uses Vite's transform pipeline (esbuild), which is significantly faster.
- Vitest supports ESM natively without transformation.
- Vitest 4 added `coverage.changed` for changed-files-only coverage — useful CI optimization post-migration.

```typescript
// Jest
import { jest } from '@jest/globals';
jest.mock('./database');
jest.useFakeTimers();
const spy = jest.spyOn(service, 'fetch');
jest.advanceTimersByTime(1000);

// Vitest
import { vi } from 'vitest';
vi.mock('./database');
vi.useFakeTimers();
const spy = vi.spyOn(service, 'fetch');
vi.advanceTimersByTime(1000);
```

**Migration notes:**
- Replace `jest.` with `vi.` in mock/spy/timer calls.
- Update `jest.config.js` to `vitest.config.ts` (Vite-based config).
- Replace `@jest/globals` imports with `vitest` imports.
- Remove Babel/ts-jest transform config — Vitest uses esbuild natively. **Caveat:** projects relying on custom Babel plugins (emotion, styled-components macros, decorators) still need an esbuild/SWC equivalent or a Vite plugin; don't drop the transform blindly.
- `jest.fn()` becomes `vi.fn()`. APIs are otherwise identical.
- `moduleNameMapper` in Jest config becomes `resolve.alias` in Vitest config.
- Speed improvement: expect 2-10x faster test execution.
- **Incremental cutover (Vitest 4.1+):** tag migrated tests (`test('...', { tag: '@migrated' }, ...)`) and gate the new suite with `vitest --tag @migrated` so it runs in parallel with the legacy run instead of moving files around. Drop the tag once a feature area reaches parity.

```typescript
// vitest.config.ts (replacing jest.config.js)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,            // Optional: use describe/it/expect without imports
    environment: 'jsdom',     // Replaces jest-environment-jsdom
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',         // Replaces jest --coverage (istanbul)
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',            // Replaces moduleNameMapper
    },
  },
});
```

## Cypress to Playwright

**Target version:** Playwright ≥ 1.50 (current 1.60.0, May 2026). Source projects may be on Cypress 13, 14, or 15 — Cypress 15.x is current and dropped Node 18 support. Translation tables hold across all three majors; Component Testing config keys differ between 13 and 15. For the mechanical first pass use the official **cy2pw web converter** ([demo.playwright.dev/cy2pw](https://demo.playwright.dev/cy2pw/)) or the community CLI `npx @11joselu/cypress-to-playwright <dir>`, then refine by hand using this guide. See the tooling table in SKILL.md for when to trust each.

> **Avoid:** `npx playwright migrate` — there is no such built-in Playwright CLI command; it will fail at the terminal (verified June 2026). Use cy2pw or the community CLI above.

**Key differences:**
- Cypress uses a command queue (chaining); Playwright uses async/await. This is the biggest mental model shift.
- Cypress runs inside the browser; Playwright runs outside and controls it. This affects how you think about context and scope.
- Cypress `cy.intercept()` becomes `page.route()`. Similar capability, different API.
- Cypress custom commands become Playwright fixtures.

> **Playwright 1.52 breaking changes** to know before migrating intercepts:
> - `page.route()` glob patterns dropped `?` and `[]` — escape these or rewrite as regex.
> - `route.continue()` ignores any Cookie header you pass — it is loaded from the browser cookie store. To set cookies, use `browserContext.addCookies(...)`, **not** a header override.
> - macOS 13 deprecated as a runner.
> Reference: https://playwright.dev/docs/release-notes#version-152

```typescript
// Cypress
cy.visit('/products');
cy.get('[data-testid="search"]').type('widget');
cy.intercept('GET', '/api/products*', { fixture: 'products.json' }).as('search');
cy.wait('@search');
cy.get('.product-card').should('have.length', 3);
cy.get('.product-card').first().find('.price').should('contain', '$29.99');
```

```typescript
// Playwright
await page.route('**/api/products*', route =>
  route.fulfill({ json: { items: [/*...*/] } }),
);
await page.goto('/products');
await page.getByTestId('search').fill('widget');
await expect(page.locator('.product-card')).toHaveCount(3);
await expect(page.locator('.product-card').first().locator('.price')).toContainText('$29.99');
```

**Migration notes:**
- Replace `cy.visit()` with `await page.goto()`.
- Replace `cy.get().type()` with `await locator.fill()` (fill clears first, which is almost always correct).
- Replace `cy.intercept()` + `cy.wait()` with `page.route()` + `page.waitForResponse()`. When the test asserts on a *real* (un-stubbed) network call, pair the action with an explicit wait so you don't race the response:

```typescript
// Wait for the real /api/products response after typing, instead of cy.wait('@search')
const responsePromise = page.waitForResponse(/\/api\/products/);
await page.getByTestId('search').fill('widget');
const response = await responsePromise;
expect(response.status()).toBe(200);
```

- Replace `.should()` chain assertions with `await expect()` auto-retrying assertions.
- Replace custom commands with fixtures (composable, typed, auto-teardown).
- Remove `cy.wrap()`, `cy.then()` patterns -- async/await replaces the command queue.
- **Auth:** `cy.setCookie()` / `cy.session()` map to `browserContext.addCookies()` and `storageState`. Capture login once in `globalSetup`; don't re-implement the login flow in every spec.

## Mocha to Vitest

The shortest migration path of all — Mocha's API maps almost 1:1 to Vitest's, and you get esbuild speed plus first-party TS support.

**Key differences:**
- `describe` / `it` / `before` / `after` / `beforeEach` / `afterEach` are unchanged.
- `chai` assertions (`expect(x).to.equal(y)`) become Vitest's `expect(x).toBe(y)` — the same `expect` name but the matchers are Jest-style. Replace mechanically: `to.equal` → `toBe`, `to.deep.equal` → `toEqual`, `to.contain` → `toContain`.
- `sinon` for spies/stubs becomes `vi.fn()` / `vi.spyOn()`.
- `mocharc` config becomes `vitest.config.ts`.

```typescript
// Mocha + Chai
import { expect } from 'chai';
describe('Calculator', () => {
  it('adds positive numbers', () => {
    expect(add(2, 3)).to.equal(5);
  });
});

// Vitest
import { describe, it, expect } from 'vitest';
describe('Calculator', () => {
  it('adds positive numbers', () => {
    expect(add(2, 3)).toBe(5);            // to.equal -> toBe
    expect(history()).toEqual([2, 3]);    // to.deep.equal -> toEqual
    expect(label()).toContain('sum');     // to.contain -> toContain
  });
});
```

**Migration notes:**
- Run a codemod or sed pass for the assertion-style transforms; validate the test count matches before and after.
- Remove `mocha.opts` / `.mocharc.*`; replace with `vitest.config.ts`.
- Remove `ts-node` / `babel-register` setup; Vitest handles TS natively via esbuild.
- Snapshot, in-source, and browser-mode features are Vitest-only — adopt them after migration if useful.

## Protractor to Playwright

Protractor reached end-of-life in 2023. This migration is urgent if not already completed. Angular CLI no longer scaffolds Protractor; `ng e2e` defaults are now Cypress, Playwright, or WebdriverIO.

**Key differences:**
- Protractor was built for AngularJS with automatic `waitForAngular`. Playwright has no Angular-specific handling (and does not need it with modern Angular).
- Protractor's `element(by.model())`, `element(by.binding())` have no direct equivalent. Use `getByLabel`, `getByRole`, or `getByTestId`.
- Protractor's `browser.get()` becomes `page.goto()`.

```typescript
// Protractor
browser.get('/login');
element(by.model('username')).sendKeys('admin');
element(by.model('password')).sendKeys('secret');
element(by.css('button[type="submit"]')).click();
browser.wait(EC.urlContains('/dashboard'), 10000);
expect(element(by.binding('user.name')).getText()).toEqual('Admin');
```

```typescript
// Playwright
await page.goto('/login');
await page.getByLabel('Username').fill('admin');
await page.getByLabel('Password').fill('secret');
// Replace 'Sign in' with the submit button's real accessible name — the
// Protractor source only matched button[type=submit], which has no label.
await page.getByRole('button', { name: 'Sign in' }).click();
await expect(page).toHaveURL(/dashboard/);
await expect(page.getByText('Admin')).toBeVisible();
```

**Migration notes:**
- Remove all `browser.waitForAngular()` calls (unnecessary with modern frameworks).
- Replace `element(by.model('x'))` with `page.getByLabel('X')` (map model name to its label).
- Replace `element(by.binding('x'))` with `page.getByText()` or `page.getByTestId()`.
- Replace `browser.wait(EC.*)` with Playwright's auto-wait or `expect` assertions.
- Replace Jasmine assertions with Playwright's `expect` (auto-retrying).
- Protractor's `onPrepare` becomes Playwright's `globalSetup` — the right place to capture `storageState` so tests skip the login flow.
