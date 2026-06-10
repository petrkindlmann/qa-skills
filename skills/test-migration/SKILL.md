---
name: test-migration
description: >-
  Migrate a test suite from one framework to another, incrementally and without losing coverage.
  Covers Selenium→Playwright, Cypress→Playwright, Jest→Vitest, Mocha→Vitest, and Protractor→Playwright,
  with parallel CI running, locator/assertion translation, and a coverage-parity track.
  Use when: "migrate tests," "switch framework," "Selenium to Playwright," "Jest to Vitest," "framework migration."
  Not for: bulk selector regeneration after a UI refactor on the SAME framework — use selector-drift-recovery.
  Not for: healing one flaky test at runtime — use test-reliability. Not for: modernizing patterns without changing framework — use ai-qa-review.
  Related: playwright-automation, cypress-automation, unit-testing, ci-cd-integration, test-reliability.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: knowledge
---

<objective>
A framework migration is where coverage quietly leaks: twenty old tests become fifteen new ones, a flaky Selenium test is faithfully reproduced as a flaky Playwright test, and the old safety-net suite gets deleted a sprint too early. This skill migrates incrementally with both suites running in CI until parity is proven — so the new suite earns the decommission, you don't just assert it.
</objective>

---

## Quick Route

| You're going from → to | Jump to | First-pass tooling |
|------------------------|---------|--------------------|
| Selenium → Playwright | Translation Patterns + `references/framework-guides.md` | hand-write; no codemod worth trusting |
| Cypress → Playwright | Translation Patterns + `references/framework-guides.md` | cy2pw web converter / community CLI (see tooling table) |
| Protractor → Playwright | `references/framework-guides.md` (urgent — EOL 2023) | hand-write; map `by.model`/`by.binding` |
| Jest → Vitest | `references/framework-guides.md` | `jest.`→`vi.` sed pass, then verify |
| Mocha → Vitest | `references/framework-guides.md` | chai-matcher codemod, then verify |
| Any path, 100+ tests | Migration Workflow + Parallel Running Strategy | always parallel-run in CI |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there.

**Current state:**
- What framework are you migrating from and to? (drives the translation tables and which guide section applies)
- How many tests exist, and what is the current flakiness/skip rate? (migrating a flaky test reproduces the flakiness; skipped tests may not be worth migrating)
- Is there a coverage number today? (baseline for the parity track)

**Test infrastructure:**
- What supporting infrastructure exists? (page objects, custom commands, fixtures, data factories — these migrate *before* tests)
- How is auth/session handled? (login flows are the most common silent-breakage point — see Failure Modes)
- What CI pipeline runs the tests, and can both frameworks run simultaneously? (parallel-run is non-negotiable)

**Constraints:**
- Timeline pressure? (urgent = framework EOL like Protractor; comfortable = modernization)
- Budget to run both suites during migration? (double CI cost, temporarily)
- Team's familiarity with the target framework? (training gap drives the workshop/pairing plan)

---

## Core Principles

### 1. Incremental over big bang

A big-bang rewrite — all tests at once — is the highest-risk approach. It freezes test development for weeks, lands a large batch of unproven tests in one drop, and removes the proven safety net before the replacement exists. Always migrate one test, one module at a time.

### 2. Parallel run until parity

Run both suites in CI until the new one provides at least the coverage of the old one. The old suite is your safety net; keep it non-blocking but present. Do not decommission until the new suite has caught real regressions over multiple sprints.

### 3. Migrate highest-value tests first

Start with critical user journeys, frequently-failing tests (which benefit most from a better framework), and high-risk areas. Save low-value tests for last — some are not worth migrating at all, and that's a valid, documented decision.

### 4. Modernize patterns during migration, don't just translate

Translating a bad Selenium test into a bad Playwright test wastes the opportunity. For each test ask "how would I write this from scratch in the target framework?" — user-facing locators, auto-waiting, fixtures. This applies tenfold to AI-codemod output (see Anti-Patterns).

---

## Migration Workflow

Six phases for a typical multi-sprint migration. Use the checklists inline; heavy code lives in references.

**Phase 1 — Audit existing suite (Week 1).** Count tests by category, skipped/flaky percentage, coverage if measured, runtime, page-object/utility files, custom plugins, CI stages. Then categorize each test: *Critical* (revenue flows) → *High* (core journeys) → *Medium* (secondary) → *Low* (admin/edge) → *Skip* (disabled, duplicate, obsolete). This priority order drives everything downstream.

**Phase 2 — Set up target framework (Week 1-2).** Install alongside the old one. Create the config (`playwright.config.ts` / `vitest.config.ts`), a separate test directory, a non-blocking CI stage, one smoke test to prove the setup, reporters matching the existing format, shared env/secrets.

**Phase 3 — Migrate shared infrastructure (Week 2-3).** Infrastructure before tests, in this order: base page object/test base → auth helpers → API client helpers → common page objects (nav/header/footer) → data factories → custom assertions → feature-specific page objects (with their tests). **Capture `storageState` here** so migrated tests skip the login flow.

**Phase 4 — Migrate tests by priority (Week 3-8+).** Per test: read the old one and understand what it *actually* verifies → write the new one from scratch with modern patterns (do not line-by-line translate) → run locally green → run in CI green → tag the old one "migrated" (don't delete) → after one sprint of parallel passing, delete the old one.

**Phase 5 — Parallel run in CI (throughout).** Both suites run every pipeline. The legacy suite stays non-blocking (`continue-on-error: true`) until the new suite reaches parity; then flip blocking onto the new suite and remove the old job. See `references/parallel-ci.md` for the full GitHub Actions workflow.

**Phase 6 — Decommission old framework (final).** Only after parity + stability: all critical/high tests migrated, new suite green in CI for 2+ consecutive sprints, new-suite flakiness ≤ old, coverage comparison shows no regression, team writing new tests in the new framework for 2+ sprints. Then remove old deps from `package.json`, delete old test files (not just disable), update CI to run only the new suite, update docs.

---

## Automated Migration Tooling

There is no AI magic button. Pick the right first-pass tool by path, then refine by hand using `references/framework-guides.md`.

| Tool | Use when | Don't trust for |
|------|----------|-----------------|
| **cy2pw web converter** ([demo.playwright.dev/cy2pw](https://demo.playwright.dev/cy2pw/)) | Cypress→Playwright, straightforward specs; official, deterministic, browser UI | custom commands, POM conventions, fixture setup |
| **`@11joselu/cypress-to-playwright`** (community CLI, `npx @11joselu/cypress-to-playwright <dir>`) | Cypress→Playwright bulk first pass over a directory | anything timing-dependent — review every file |
| **AI agents** (Claude Code, Cursor) | custom-command and fixture translation, the parts converters can't do | a finished test — treat output as a first pass only |
| **Playwright 1.59+ agentic CLI** (`npx playwright trace`, `--debug=cli`, AI-optimized a11y snapshots) | *post*-migration triage of a failing migrated test | the migration itself — these are debug tools, not converters |

> **Avoid:** `npx playwright migrate` — there is no such built-in Playwright CLI command; the instruction fails at the terminal (verified June 2026). Use cy2pw or the community CLI above.

**Golden-reference recipe.** Before letting any AI or codemod batch the suite, hand-migrate ONE representative test end to end. Commit it as the team's canonical pattern (e.g. `e2e/_golden/login.spec.ts`). Feed it back to the AI as a few-shot reference and point human reviewers at it. Every later migration anchors to this file — it's the single highest-leverage tactic for keeping AI output and reviewers consistent.

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

Role/label names above are illustrative — replace them with the accessible name your app actually renders.

### Wait strategy mapping

| Old Pattern | New Pattern (Playwright) | Notes |
|-------------|--------------------------|-------|
| `Thread.sleep(3000)` | *(remove entirely)* | Playwright auto-waits |
| `WebDriverWait(driver, 10).until(visible)` | *(remove entirely)* | Auto-wait on actions |
| `cy.wait(2000)` | *(remove entirely)* | Auto-wait on assertions |
| `cy.wait('@apiCall')` | `page.waitForResponse(/\/api\/data/)` | Explicit network wait (start the promise before the action) |
| `browser.wait(EC.presenceOf(...))` | `await expect(locator).toBeVisible()` | Web-first assertion |
| `implicitlyWait(10, SECONDS)` | *(remove — configure in config)* | Use `actionTimeout` in config |
| `FluentWait` with polling | `await expect(locator).toHaveText('Done')` | Web-first assertions retry |

### Assertion mapping

| Old Pattern | New Pattern (Playwright) | Notes |
|-------------|--------------------------|-------|
| `assert element.is_displayed()` | `await expect(locator).toBeVisible()` | Auto-retrying |
| `cy.get('.msg').should('have.text', 'Done')` | `await expect(locator).toHaveText('Done')` | Auto-retrying |
| `expect(element.getText()).toBe('Done')` | `await expect(locator).toHaveText('Done')` | Auto-retrying |
| `cy.url().should('include', '/dashboard')` | `await expect(page).toHaveURL(/dashboard/)` | Auto-retrying |
| `assert len(elements) == 5` | `await expect(locator).toHaveCount(5)` | Auto-retrying |

### Config mapping (Cypress → Playwright)

| Old (Cypress) | New (Playwright) |
|---------------|-------------------|
| `baseUrl` | `use.baseURL` |
| `defaultCommandTimeout: 10000` | `use.actionTimeout: 10000` |
| `pageLoadTimeout: 30000` | `use.navigationTimeout: 30000` |
| `retries: { runMode: 2 }` | `retries: 2` |
| `video: true` | `use.video: 'on'` |
| `screenshotOnRunFailure: true` | `use.screenshot: 'only-on-failure'` |

---

## Specific Migration Guides

Each path has its own key differences, before/after code, and migration-notes checklist in `references/framework-guides.md`. Quick orientation:

- **Selenium → Playwright:** Drop all explicit waits (Playwright auto-waits), swap string locators for `getByRole`/`getByLabel`/`getByTestId`, replace WebDriver sessions with `BrowserContext`. Capture `storageState` instead of re-implementing login.
- **Jest → Vitest** (target Vitest 4.x): Mostly API-compatible — replace `jest.` with `vi.`, convert `jest.config.js` to `vitest.config.ts`, drop Babel/ts-jest transforms (but keep an esbuild/SWC equivalent if you use custom Babel plugins like emotion/styled-components macros). Expect 2-10x faster runs. Use Vitest 4.1 test `tags` for incremental cutover.
- **Cypress → Playwright** (target PW ≥ 1.50): The big shift is command queue → async/await. `cy.intercept()`+`cy.wait()` becomes `page.route()`+`page.waitForResponse()`; custom commands become fixtures. Mind the 1.52 `page.route()` glob and Cookie-header breaking changes (set cookies via `browserContext.addCookies()`, not a header override).
- **Mocha → Vitest:** Near 1:1. `describe`/`it`/hooks are unchanged; convert chai matchers (`to.equal`→`toBe`, `to.deep.equal`→`toEqual`, `to.contain`→`toContain`) and `sinon`→`vi.fn()`/`vi.spyOn()`.
- **Protractor → Playwright:** EOL since 2023 — urgent. Remove `waitForAngular`, map `by.model`/`by.binding` to `getByLabel`/`getByText`/`getByTestId`, and `onPrepare` becomes `globalSetup`.

---

## Parallel Running Strategy

### Coverage comparison during migration

Track parity between old and new suites in a spreadsheet so nothing leaks. This artifact is the objective check at decommission time.

```
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

For a 200-test suite, plan ~10 sprints: setup + infrastructure (Sprint 1-2), critical-path migration (Sprint 3-5, ~50 tests), bulk migration (Sprint 6-8), cleanup + decommission (Sprint 9-10). The old suite starts blocking and becomes non-blocking as parity approaches. New tests are written exclusively in the new framework from Sprint 3 onward.

### When to delete old tests

Tag old tests "migrated" rather than deleting immediately. Delete only after the new equivalent has passed in CI for 2+ weeks and a manual review confirms no unique assertions are lost. If the old test catches a regression the new one misses, enhance the new test first.

---

## Anti-Patterns

### Big bang migration

Stopping all development for 3 months to rewrite every test at once. The team cannot ship new tests during the rewrite, coverage freezes, and the new suite is untested in CI until it lands all at once.

**Fix:** Incremental migration with parallel running. Migrate one module per sprint. Both suites run in CI throughout. New tests are written in the new framework from day one.

### Translating without modernizing

Line-by-line translation of Selenium tests into Playwright tests, preserving explicit waits, CSS selectors, and fragile patterns. The tests are in a new framework but have all the old problems.

**Fix:** Rewrite each test using the target framework's best practices — `getByRole` instead of CSS, no explicit waits, fixtures instead of `beforeEach`. The migration is an opportunity to improve every test.

### Trusting AI codemods as the final answer

Cursor, Aider, Continue, Claude Code, and the cy2pw/community converters all do mechanical translation, but quality is uneven and the "translate, don't modernize" trap applies tenfold to their output.

**Fix:** Run the tool on ONE file, diff against the source. If it modernized correctly, batch the rest. If it just translated, write your own golden-reference file and feed it back as a few-shot. After every pass, parallel-run against the original suite — if results diverge, the tool got it wrong; investigate before promoting.

### No parallel running

Decommissioning the old suite before the new suite is proven. A regression slips through because the new suite was missing a test that existed in the old one.

**Fix:** Run both suites in CI for at least 2 sprints after reaching parity. The old suite is cheap insurance. Only decommission once the new suite has caught regressions on its own.

### Losing coverage during migration

Twenty old tests become fifteen new ones because "some were redundant" — but nobody verified whether the deleted tests covered unique scenarios.

**Fix:** Map each old test to its new equivalent explicitly in the coverage spreadsheet. If an old test is intentionally not migrated, document why and verify its coverage is provided elsewhere.

### Migrating flaky tests as-is

A test flaky in Selenium will be flaky in Playwright if the root cause is test design (shared state, timing assumptions, non-deterministic data). Faithful migration reproduces the flakiness.

**Fix:** Diagnose the flakiness first, fix the root cause, then write the new test with the fix baked in. Migration is the best time to fix flakiness because you're rewriting the test anyway. For runtime per-test triage, see `test-reliability`.

### No team training

Migrating to Playwright while the team has never used it means the champions write everything and the rest of the team can't maintain it.

**Fix:** Run a 2-hour workshop before starting. Pair-program the first 10 migrated tests (champion + team member). Write a team style guide for the new framework. Require 2+ reviewers per migrated test.

---

## Failure Modes

| Symptom | Likely cause | Fix or check |
|---------|--------------|--------------|
| Migrated test logs in fresh every run / session lost mid-test | No `storageState` — login flow wasn't carried over | Capture `storageState` in `globalSetup`; reuse per test. `cy.setCookie`/`driver.add_cookie` → `browserContext.addCookies()` |
| `npx playwright migrate` errors "unknown command" | No such built-in CLI exists | Use cy2pw web converter or `@11joselu/cypress-to-playwright` |
| Migrated intercept never matches | 1.52 glob change dropped `?`/`[]` | Escape the chars or rewrite the route as a regex |
| Cookies set on `route.continue()` are ignored | Cookie header on `route.continue()` is loaded from the cookie store, not your override | Set cookies via `browserContext.addCookies()` |
| New test passes locally, flakes in CI | Old timing assumption translated literally | Replace `waitForTimeout`/explicit waits with web-first `expect(...)` assertions |
| Test count dropped after a codemod pass | Codemod silently skipped unsupported syntax | Diff test counts per feature area against the parity sheet before promoting |

---

## Verification

Prove the migrated artifacts work — smallest check first:

- **The migrated test passes:** `npx playwright test <migrated-file>` (or `npx vitest run <migrated-file>`) exits 0. A green run is the floor, not the finish.
- **No count leaked:** diff the new vs old test count per feature area against the coverage spreadsheet. Numbers in the "New Suite Tests" column match what actually ran (`npx playwright test --list | wc -l` per area).
- **Both suites run in CI:** the parallel-run workflow shows the legacy job as `continue-on-error: true` and the new job blocking; both appear in the pipeline run.
- **No regression introduced:** the new suite stays green across 2+ consecutive sprint CI runs before any old test is deleted.

---

## Done When

- Migration scope is defined: which tests move first (critical paths), last (low priority), and which are intentionally not migrated (each with documented rationale in the coverage spreadsheet).
- The coverage-parity spreadsheet shows 100% for every critical/high feature area, with no drop in test count versus the mapped old tests.
- Both frameworks have run in CI in parallel for at least 2 consecutive sprints with the new suite green.
- A migration retrospective document exists capturing flakiness root causes, pattern improvements, and team-training gaps.
- Old framework is fully removed: dependencies deleted from `package.json`, old test files deleted (not just disabled), and CI config updated to run only the new suite.

---

## Reference Files (in `references/`)

- **framework-guides.md** — Full before/after code and migration-notes checklists for all five paths: Selenium→Playwright, Jest→Vitest, Cypress→Playwright, Mocha→Vitest, Protractor→Playwright.
- **parallel-ci.md** — GitHub Actions parallel-suite workflow for running the old and new frameworks side by side during migration.

## Related Skills

- **playwright-automation** — target-framework best practices for Selenium/Cypress/Protractor migrations; go there to write idiomatic Playwright once translated.
- **cypress-automation** — if you're migrating *to* Cypress, or need source-side Cypress detail.
- **unit-testing** — Jest→Vitest patterns, mocks, and coverage config in depth.
- **test-reliability** — heal one flaky test at runtime; use it when migration surfaces flakiness you must triage rather than rewrite.
- **selector-drift-recovery** — bulk selector regeneration after a UI refactor on the SAME framework; not a framework change.
- **ci-cd-integration** — parallel-CI configuration for running both suites during migration.
- **qa-metrics** — track migration progress: test-count parity, flakiness comparison, coverage delta.
- **test-strategy** — migration decisions should align with the overall multi-quarter test strategy.
