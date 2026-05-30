---
name: test-migration
description: >-
  Migrate test suites between frameworks incrementally. Covers Selenium→Playwright,
  Cypress→Playwright, Jest→Vitest, Mocha→Jest, and Protractor→Playwright migrations
  with parallel running, locator translation, and incremental adoption strategies.
  Use when: "migrate tests," "switch framework," "Selenium to Playwright," "Jest to
  Vitest," "framework migration," "test modernization."
  Related: playwright-automation, cypress-automation, unit-testing, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: knowledge
---

<objective>
Migrating a test suite between frameworks is a high-risk, high-reward operation. Done well, it modernizes your testing infrastructure and improves reliability. Done poorly, it loses coverage, introduces flakiness, and burns months of effort. This skill covers how to migrate incrementally with zero coverage loss.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there.

**Current state:**
- What framework are you migrating from? (Selenium, Cypress, Protractor, Jest, Mocha, Jasmine)
- What framework are you migrating to? (Playwright, Vitest, Jest)
- How many tests exist? (10, 100, 500, 1000+)
- What is the current flakiness rate? (Migrating flaky tests reproduces flakiness)
- What percentage of tests are disabled or skipped?

**Test infrastructure:**
- What supporting infrastructure exists? (Page objects, utility libraries, custom commands, fixtures, data factories)
- How are test accounts and test data managed?
- What CI pipeline runs the tests? How long does it take?
- Are there custom reporters, plugins, or integrations that need migration?

**Parallel running:**
- Can both test frameworks run in CI simultaneously?
- Is there budget for running both suites during migration? (Double CI cost temporarily)
- What is the timeline pressure? (Urgent: framework EOL, or comfortable: modernization project)

**Team:**
- How many engineers write and maintain tests?
- What is the team's familiarity with the target framework?
- Is there training budget or time for learning the new framework?

---

## Core Principles

### 1. Incremental over big bang

A big-bang migration -- rewriting all tests at once -- is the highest-risk approach. It stops all test development for weeks, introduces a large batch of unproven tests, and removes the proven safety net of the existing suite. Always migrate incrementally: one test at a time, one module at a time.

### 2. Parallel run until parity

Run both the old and new test suites in CI until the new suite provides at least the same coverage as the old one. The old suite is your safety net. Do not decommission it until the new suite has proven itself over multiple sprints.

### 3. Migrate highest-value tests first

Start with tests that are most valuable: critical user journeys, frequently failing tests (which benefit most from a better framework), and tests covering high-risk areas. Save low-value tests for last -- some may not be worth migrating at all.

### 4. Modernize patterns during migration, don't just translate

Translating a bad Selenium test into a bad Playwright test wastes the migration opportunity. When migrating each test, ask: "How would I write this test from scratch in the target framework?" Use modern patterns, user-facing locators, auto-waiting, and fixtures.

---

## Migration Workflow

### Phase 1: Audit existing suite (Week 1)

Before migrating a single test, understand what you have.

```
Audit checklist:
  [ ] Total test count: ___
  [ ] Tests by category: unit ___, integration ___, E2E ___
  [ ] Disabled/skipped tests: ___ (percentage: ___%)
  [ ] Flaky tests: ___ (percentage: ___%)
  [ ] Code coverage: ___% (if measured)
  [ ] Test runtime: ___
  [ ] Page objects / utilities: ___ files
  [ ] Custom plugins / commands: ___ (list)
  [ ] CI pipeline stages: ___

Priority categorization:
  Critical (migrate first): Tests covering revenue-impacting flows
  High: Tests covering core user journeys
  Medium: Tests covering secondary features
  Low: Tests covering admin, edge cases, rarely-used features
  Skip: Disabled tests, duplicate tests, obsolete feature tests
```

### Phase 2: Set up target framework (Week 1-2)

Install and configure the new framework alongside the old one.

```
Setup checklist:
  [ ] Install target framework and dependencies
  [ ] Create configuration file (playwright.config.ts, vitest.config.ts)
  [ ] Configure test directory structure (separate from old tests)
  [ ] Set up CI pipeline stage for new framework (non-blocking)
  [ ] Create a single smoke test to verify the setup works
  [ ] Configure reporters to match existing reporting format
  [ ] Set up shared environment variables and secrets
```

### Phase 3: Migrate shared infrastructure (Week 2-3)

Migrate page objects, utilities, data factories, and helper functions before migrating tests. Tests depend on infrastructure.

```
Infrastructure migration order:
  1. Base page object / test base class
  2. Authentication helpers (login, session management)
  3. API client helpers (data setup, cleanup)
  4. Common page objects (navigation, header, footer)
  5. Data factories (user creation, test data generation)
  6. Custom assertions / matchers
  7. Feature-specific page objects (migrate with their tests)
```

### Phase 4: Migrate tests by priority (Week 3-8+)

Migrate tests in priority order. Each migrated test follows the same pattern.

```
Per-test migration pattern:
  1. Read the old test — understand what it actually verifies
  2. Write the new test from scratch using modern patterns
     (do not line-by-line translate)
  3. Run the new test locally — verify it passes
  4. Run the new test in CI — verify it passes in CI
  5. Mark the old test as "migrated" (tag, not delete)
  6. After 1 sprint of parallel passing, delete the old test
```

### Phase 5: Parallel run in CI (Throughout)

Both suites run in every CI pipeline during the migration. The legacy suite stays non-blocking (`continue-on-error: true`) until the new suite reaches parity; then you flip blocking on the new suite and eventually remove the old job. See `references/parallel-ci.md` for the full GitHub Actions parallel-suite workflow.

### Phase 6: Decommission old framework (Final)

Only after the new suite has reached parity and proven stability.

```
Decommission checklist:
  [ ] All critical and high-priority tests migrated
  [ ] New suite has been green in CI for 2+ consecutive sprints
  [ ] New suite flakiness rate is at or below old suite
  [ ] Coverage comparison shows no regression
  [ ] Team has been writing new tests in the new framework for 2+ sprints
  [ ] Old framework dependencies removed from package.json
  [ ] Old test files deleted (not just disabled)
  [ ] CI pipeline updated to run only the new suite
  [ ] Documentation updated to reference new framework
```

---

## Translation Patterns

### Locator mapping

| Old Pattern | New Pattern (Playwright) | Notes |
|-------------|--------------------------|-------|
| `By.id('submit-btn')` | `page.getByRole('button', { name: 'Submit' })` | Prefer role-based |
| `By.css('.nav-item.active')` | `page.getByRole('link', { name: 'Dashboard' })` | Use user-visible text |
| `By.xpath('//div[@class="modal"]')` | `page.getByRole('dialog')` | ARIA roles are more stable |
| `By.css('[data-testid="user-menu"]')` | `page.getByTestId('user-menu')` | testid as fallback |
| `cy.get('.product-card').first()` | `page.getByRole('article').first()` | Semantic elements preferred |
| `cy.contains('Add to cart')` | `page.getByRole('button', { name: 'Add to cart' })` | Specific role is better |
| `element(by.model('username'))` | `page.getByLabel('Username')` | Angular model → label |

### Wait strategy mapping

| Old Pattern | New Pattern (Playwright) | Notes |
|-------------|--------------------------|-------|
| `Thread.sleep(3000)` | *(remove entirely)* | Playwright auto-waits |
| `WebDriverWait(driver, 10).until(visible)` | *(remove entirely)* | Auto-wait on actions |
| `cy.wait(2000)` | *(remove entirely)* | Auto-wait on assertions |
| `cy.wait('@apiCall')` | `page.waitForResponse('**/api/data')` | Explicit network wait |
| `browser.wait(EC.presenceOf(...))` | `await expect(locator).toBeVisible()` | Web-first assertion |
| `implicitlyWait(10, SECONDS)` | *(remove entirely — configure in config)* | Use `actionTimeout` in config |
| `FluentWait` with polling | `await expect(locator).toHaveText('Done')` | Web-first assertions retry |

### Assertion mapping

| Old Pattern | New Pattern (Playwright) | Notes |
|-------------|--------------------------|-------|
| `assert element.is_displayed()` | `await expect(locator).toBeVisible()` | Auto-retrying |
| `cy.get('.msg').should('have.text', 'Done')` | `await expect(locator).toHaveText('Done')` | Auto-retrying |
| `expect(element.getText()).toBe('Done')` | `await expect(locator).toHaveText('Done')` | Auto-retrying |
| `cy.url().should('include', '/dashboard')` | `await expect(page).toHaveURL(/dashboard/)` | Auto-retrying |
| `assert len(elements) == 5` | `await expect(locator).toHaveCount(5)` | Auto-retrying |

### Config mapping

| Old (Cypress) | New (Playwright) |
|---------------|-------------------|
| `baseUrl` in cypress.config.ts | `use.baseURL` in playwright.config.ts |
| `defaultCommandTimeout: 10000` | `use.actionTimeout: 10000` |
| `pageLoadTimeout: 30000` | `use.navigationTimeout: 30000` |
| `retries: { runMode: 2 }` | `retries: 2` |
| `video: true` | `use.video: 'on'` |
| `screenshotOnRunFailure: true` | `use.screenshot: 'only-on-failure'` |

---

## Specific Migration Guides

Each path has its own key differences, before/after code, and migration-notes checklist. The full runnable examples live in `references/framework-guides.md`. Quick orientation:

- **Selenium → Playwright:** Drop all explicit waits (Playwright auto-waits), swap string locators for `getByRole`/`getByLabel`/`getByTestId`, and replace WebDriver sessions with `BrowserContext`.
- **Jest → Vitest** (target Vitest 4.x): Mostly API-compatible — replace `jest.` with `vi.`, convert `jest.config.js` to `vitest.config.ts`, and drop Babel/ts-jest transforms. Expect 2-10x faster runs.
- **Cypress → Playwright** (target PW ≥ 1.50): The big shift is command queue → async/await. `cy.intercept()`+`cy.wait()` becomes `page.route()`+`page.waitForResponse()`; custom commands become fixtures. Run `npx playwright migrate` (1.55+) as a first pass, then refine. Mind the 1.52 `page.route()` glob/Cookie-header breaking changes.
- **Mocha → Vitest:** Near 1:1. `describe`/`it`/hooks are unchanged; convert chai matchers (`to.equal` → `toBe`, `to.deep.equal` → `toEqual`) and `sinon` → `vi.fn()`/`vi.spyOn()`.
- **Protractor → Playwright:** EOL since 2023 — urgent. Remove `waitForAngular`, map `by.model`/`by.binding` to `getByLabel`/`getByText`/`getByTestId`, and `onPrepare` becomes `globalSetup`.

See `references/framework-guides.md` for the complete code for all five paths.

---

## Parallel Running Strategy

### Coverage comparison during migration

Track coverage parity between old and new suites to ensure nothing is lost.

```
Coverage tracking spreadsheet:

Feature Area     | Old Suite Tests | New Suite Tests | Parity | Notes
Login/Auth       | 8               | 8               | 100%   | Complete
Dashboard        | 12              | 7               | 58%    | In progress
Search           | 6               | 0               | 0%     | Not started
Checkout         | 15              | 15              | 100%   | Complete
User Settings    | 4               | 4               | 100%   | Complete
Admin Panel      | 20              | 0               | 0%     | Low priority
---              | ---             | ---             | ---    |
Total            | 65              | 34              | 52%    | On track for Q2
```

### Gradual cutover timeline

For a 200-test suite, plan 10 sprints: setup + infrastructure (Sprint 1-2), critical path migration (Sprint 3-5, ~50 tests), bulk migration (Sprint 6-8), cleanup and decommission (Sprint 9-10). The old suite starts as blocking and becomes non-blocking as parity approaches. New tests are written exclusively in the new framework from Sprint 3 onward.

### When to delete old tests

Tag old tests as "migrated" rather than deleting immediately. Delete only after the new equivalent has been passing in CI for 2+ weeks and a manual review confirms no unique assertions are lost. If the old test catches a regression the new test misses, enhance the new test first.

---

## Anti-Patterns

### AI-assisted codemods (use as a first pass, never as the final answer)

Cursor, Aider, Continue, and Claude Code all gained codemod-style migration workflows in 2025–2026, and Playwright's `npx playwright migrate` (1.55+) is essentially a built-in AI-assisted migrator. Community tools like `cypress-to-playwright` npm packages exist but quality varies.

**How to use them well:**
- Treat AI output as a *first translation pass*, not a finished test. Quality is uneven and the "translate, don't modernize" anti-pattern below applies tenfold to AI output.
- Run the AI on one file. Diff the result against the source. If it modernized correctly, batch the rest. If it just translated, write your own first example and feed it back as a few-shot reference.
- After every AI pass, run the original test suite against the new code (parallel run pattern). If results diverge, the AI got it wrong — investigate before promoting.

### Big bang migration

Stopping all development for 3 months to rewrite every test at once. The team cannot ship new tests during the rewrite, coverage freezes, and the new suite is untested in CI until it lands all at once.

**Fix:** Incremental migration with parallel running. Migrate one module per sprint. Both suites run in CI throughout. New tests are written in the new framework from day one.

### Translating without modernizing

Line-by-line translation of Selenium tests into Playwright tests, preserving explicit waits, CSS selectors, and fragile patterns. The tests are in a new framework but have all the old problems.

**Fix:** Rewrite each test using the target framework's best practices. Replace CSS selectors with `getByRole`. Remove explicit waits. Use fixtures instead of `beforeEach`. The migration is an opportunity to improve every test.

### No parallel running

Decommissioning the old suite before the new suite is proven. A regression slips through because the new suite was missing a test that existed in the old suite.

**Fix:** Run both suites in CI for at least 2 sprints after reaching coverage parity. The old suite is cheap insurance. Only decommission when the new suite has proven it catches regressions on its own.

### Losing coverage during migration

Twenty tests in the old suite become fifteen in the new suite because "some were redundant." But nobody verified whether the deleted tests were truly redundant or covered unique scenarios.

**Fix:** Map each old test to its new equivalent explicitly. Track coverage parity in a spreadsheet. If an old test is intentionally not migrated, document why and verify that its coverage is provided by other tests.

### Migrating flaky tests as-is

A test that is flaky in Selenium will be flaky in Playwright if the root cause is in the test design (shared state, timing assumptions, non-deterministic data). Migrating it faithfully reproduces the flakiness.

**Fix:** When migrating a flaky test, diagnose the flakiness first. Fix the root cause, then write the new test with the fix incorporated. The migration is the best time to fix flakiness because you are rewriting the test anyway.

### No team training

Migrating to Playwright while the team has never used Playwright means the migration champions write everything, and the rest of the team cannot maintain the new tests.

**Fix:** Run a 2-hour workshop before starting the migration. Pair-program on the first 10 migrated tests (migration champion + team member). Create a team-specific style guide for the new framework. Require at least 2 team members to review each migrated test.

---

## Done When

- Migration scope is defined: which tests move first (critical paths), which move last (low priority), and which are intentionally not migrated (with documented rationale)
- Coverage parity is verified before decommissioning the old framework, with an explicit feature-area comparison showing no regression in test count or critical scenario coverage
- Parallel run period is completed with both frameworks passing in CI for at least 2 consecutive sprints
- Migration retrospective has been conducted with lessons captured (flakiness root causes, pattern improvements, team training gaps)
- Old framework is fully removed: dependencies deleted from package.json, old test files deleted (not just disabled), and CI config updated to run only the new suite

## Reference Files (in `references/`)

- **framework-guides.md** — Full before/after code and migration-notes checklists for all five paths: Selenium→Playwright, Jest→Vitest, Cypress→Playwright, Mocha→Vitest, Protractor→Playwright.
- **parallel-ci.md** — GitHub Actions parallel-suite workflow for running the old and new frameworks side by side during migration.

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `playwright-automation` | Target framework best practices for Selenium/Cypress/Protractor migrations |
| `unit-testing` | Jest-to-Vitest migration patterns and best practices |
| `ci-cd-integration` | Parallel CI configuration for running both suites during migration |
| `test-reliability` | Fix flaky tests during migration rather than translating flakiness |
| `qa-metrics` | Track migration progress: test count parity, flakiness comparison, coverage delta |
| `test-strategy` | Migration decisions should align with the overall test strategy |
