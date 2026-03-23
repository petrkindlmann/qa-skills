---
name: qa-project-bootstrap
description: >-
  Bootstrap QA for a new project or onboard new QA engineers. Covers first-30-days
  checklist, test architecture audit, framework walkthrough templates, codebase
  orientation guides, and mentorship patterns. Use when: "QA onboarding," "new tester,"
  "ramp up," "getting started," "new project QA," "test architecture audit,"
  "QA bootstrap," "first test."
  Related: qa-project-context, playwright-automation, shift-left-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: process
---

# QA Project Bootstrap

Get a new QA engineer productive or bootstrap QA for a new project. The goal is clear: reduce time to first merged test. Everything in this skill serves that objective -- environment setup, codebase orientation, framework walkthrough, and mentorship patterns that build confidence through progressive complexity.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. If it exists, it already answers most discovery questions and provides the technical context needed for onboarding. If it does not exist, creating it is the first action item.

---

## Discovery Questions

### Who Is Being Onboarded?

1. **New QA engineer or developer contributing to tests?** QA engineers need test strategy context and codebase orientation. Developers contributing tests need framework patterns and conventions. The ramp-up path differs significantly.

2. **Experience level with the test framework?** First time with Playwright/Cypress/pytest? Experienced but new to this codebase? Advanced and just needs conventions? This determines how much framework walkthrough to include.

3. **Solo QA or joining an existing QA team?** Solo QA needs to establish conventions from scratch. Joining a team means learning existing patterns and contributing within established norms.

### Project State

4. **Is there an existing test framework?** If yes: how healthy is it? If no: framework selection is step one (see `test-strategy` skill).

5. **Does the project have a `.agents/qa-project-context.md`?** If not, creating one is a high-priority onboarding task -- it forces the new person to document what they learn, which benefits the entire team.

6. **Is local environment setup documented?** Can a new person run the full stack and execute tests within the first day? If setup takes more than 2 hours, the process needs fixing before onboarding.

### Access and Tooling

7. **Are all required accounts and permissions set up?** Repository access, CI dashboard, staging environment, test data accounts, bug tracker, communication channels. Missing access on day one wastes time and creates frustration.

---

## Core Principles

### 1. Time to First Merged Test Is the Success Metric

The single most important measure of onboarding success is how quickly the new person gets a real test merged into the main branch. Not a tutorial exercise, not a local-only experiment -- a real test that runs in CI and validates real product behavior. Target: within the first two weeks.

### 2. Progressive Complexity

Start simple, increase difficulty gradually. First test: a smoke test or page-load verification. Second test: a form interaction. Third test: a multi-step user flow. By week three, the new person is writing tests for sprint stories. Throwing someone into the deep end with a complex multi-service flow on day one creates anxiety and bad habits.

### 3. Document Tribal Knowledge

Every time a new person asks a question that is not answered in documentation, that is tribal knowledge escaping. The onboarding process should capture these answers in permanent form -- ideally in `.agents/qa-project-context.md`, the framework walkthrough doc, or code comments. The new person is the best person to write this documentation because they know exactly what was missing.

### 4. Pair First, Solo Second

The first 3 tests should be written in a pair -- the new person driving, an experienced team member navigating. Pairing transfers tacit knowledge (why we do things this way, not just how) and builds confidence faster than reading documentation alone.

### 5. Make the Easy Path the Right Path

If the correct way to write a test is harder than the wrong way, people will write tests the wrong way. Ensure that test utilities, fixtures, page objects, and data factories make the recommended patterns the path of least resistance. If a new person has to fight the framework to follow conventions, fix the framework.

---

## First 30 Days Checklist

### Week 1: Environment, Access, and Orientation

**Day 1-2: Setup**
- [ ] Repository cloned and building locally
- [ ] All environment variables configured (`.env.local`, test credentials)
- [ ] Application running locally (frontend + backend + database)
- [ ] Test suite runs locally and passes (or known failures are documented)
- [ ] IDE configured with recommended extensions (test runner plugin, linter, formatter)
- [ ] Access granted: CI dashboard, staging environment, bug tracker, team channels

**Day 3-4: Orientation**
- [ ] Read `.agents/qa-project-context.md` (or create it if it does not exist)
- [ ] Walk through the test directory structure with a team member
- [ ] Understand the test pyramid: how many unit, integration, and E2E tests exist
- [ ] Review the CI pipeline: what runs on PR, what runs nightly, what blocks merge
- [ ] Identify the top 5 critical user flows (these will be the first testing targets)
- [ ] Attend one Three Amigos or sprint planning session as an observer

**Day 5: First Small Win**
- [ ] Run a single test in debug/headed mode and understand what it does
- [ ] Modify one assertion in an existing test, verify it fails as expected, revert
- [ ] Read 3 existing tests and annotate what each section does (setup, action, assertion)

### Week 2: First Real Test

- [ ] Identify a simple, low-risk test to write (page loads, element visibility, basic navigation)
- [ ] Write the test using existing page objects and fixtures (pair with a team member)
- [ ] Run the test locally, ensure it passes reliably (3 consecutive runs)
- [ ] Open a PR, receive feedback, iterate
- [ ] Test passes in CI
- [ ] **First test merged**

### Week 3: Sprint Contribution

- [ ] Pick up a sprint story's QA work (with mentorship)
- [ ] Write tests covering the story's acceptance criteria
- [ ] Identify at least one edge case not covered by acceptance criteria
- [ ] Participate actively in Three Amigos or story refinement (ask questions)
- [ ] Review one existing PR for test quality (using the PR review checklist from `shift-left-testing`)

### Week 4: Independence Milestones

- [ ] Write and merge a multi-step E2E test without pairing
- [ ] Participate in bug triage and articulate testing gaps
- [ ] Contribute to `.agents/qa-project-context.md` with new learnings
- [ ] Present test results/findings at sprint review or team standup
- [ ] Self-assess: which test patterns feel comfortable? Which need more practice?

---

## Test Architecture Audit

When joining an existing project, assess the health of the test suite before writing new tests. This audit takes 2-4 hours and produces a clear picture of the current state.

### What to Assess

#### Coverage and Distribution

```
Audit Worksheet: Test Suite Health
═══════════════════════════════════

Test Counts:
  Unit tests:         _____ passing / _____ total (_____ skipped)
  Integration tests:  _____ passing / _____ total (_____ skipped)
  E2E tests:          _____ passing / _____ total (_____ skipped)

Pyramid Shape: [ ] Healthy  [ ] Ice cream cone  [ ] Diamond  [ ] Hourglass
  (See test-strategy skill for shape definitions)

Code Coverage: _____ % lines / _____ % branches
  Critical paths coverage: _____ %
  Coverage trend (last 3 months): [ ] Increasing  [ ] Stable  [ ] Declining
```

#### Reliability

```
Flakiness:
  Flaky test rate (last 30 days): _____ %
  Top 3 flakiest tests:
    1. _____________________
    2. _____________________
    3. _____________________
  Quarantined tests: _____ count
  Quarantine age (oldest): _____ days
```

#### CI Health

```
CI Pipeline:
  Full suite duration: _____ minutes
  Unit test stage:     _____ minutes
  E2E test stage:      _____ minutes
  Parallelism:         _____ workers/shards
  Pass rate (7-day):   _____ %
  Flaky retries needed: _____ % of runs
```

#### Technical Debt

```
Tech Debt Inventory:
  Skipped/disabled tests:          _____ count (review each — fix or delete)
  Tests with waitForTimeout:       _____ count (replace with proper waits)
  Tests with force: true:          _____ count (investigate why)
  Hardcoded test data:             _____ count (move to fixtures/factories)
  Tests without assertions:        _____ count (add assertions or delete)
  Deprecated API usage:            _____ count (update to current API)
  Tests older than 12 months
    with no modifications:         _____ count (review for relevance)
```

#### Conventions

```
Patterns in Use:
  Page objects:          [ ] Yes  [ ] Partial  [ ] No
  Fixture-based setup:   [ ] Yes  [ ] Partial  [ ] No
  Data factories:        [ ] Yes  [ ] Partial  [ ] No
  Consistent naming:     [ ] Yes  [ ] Partial  [ ] No
  Shared utilities:      [ ] Yes  [ ] Partial  [ ] No
  Test tagging/grouping: [ ] Yes  [ ] Partial  [ ] No
```

### Audit Output

Produce a short document (1-2 pages) summarizing findings, categorized as:

- **Strengths:** What the existing suite does well (preserve and learn from these)
- **Gaps:** Missing coverage areas, undertested critical paths
- **Risks:** Flaky tests, stale quarantines, declining coverage
- **Quick Wins:** Improvements achievable in 1-2 sprints (fix flaky tests, add missing happy-path coverage)
- **Strategic Work:** Improvements requiring sustained investment (refactor test architecture, add integration layer)

---

## Framework Walkthrough Template

Create this document for your project. It is the primary reference for anyone writing tests.

### 1. Architecture Overview

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

### 2. How to Run Tests

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

### 3. How to Write a New Test (Step by Step)

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

### 4. How to Debug Failures

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

### 5. Common Patterns and Conventions

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

### 6. Where to Find Help

```
Questions about test patterns:    → #qa-engineering channel
Questions about test failures:    → Check CI logs first, then ask in PR comments
Questions about product behavior: → Product spec in [wiki/notion/confluence link]
Framework documentation:          → https://playwright.dev/docs/intro
Project-specific docs:            → .agents/qa-project-context.md
```

---

## Codebase Orientation Guide

Walk through these areas with the new person in a 60-90 minute session.

### Test Directory Structure Tour

Walk through the actual directory tree, explaining:
- Why tests are organized this way (by feature, not by type)
- Where to find page objects for each product area
- Where shared utilities live and what they do
- Where test data and fixtures are defined
- Where CI configuration lives

### Shared Utilities Inventory

| Utility | Location | Purpose | Example |
|---------|----------|---------|---------|
| Auth fixture | `fixtures/auth.fixture.ts` | Provides authenticated sessions | `{ adminPage, userPage }` |
| Data factory | `helpers/factories.ts` | Creates test data via API | `createTestUser({ role: 'editor' })` |
| API client | `helpers/api-client.ts` | Direct API calls for setup/teardown | `apiClient.delete('/users/' + id)` |
| Accessibility helper | `helpers/a11y.ts` | axe-core wrapper | `checkAccessibility(page, testInfo)` |
| Assertions | `helpers/assertions.ts` | Custom matchers | `toHaveToast('Saved')` |

### Page Objects Walk-Through

Show the existing page objects and explain:
- Base page class and its contract (abstract `path`, `waitForReady`)
- How component objects compose with page objects
- Naming conventions (file name matches route: `checkout.page.ts` for `/checkout`)
- How to add a new page object (copy-modify pattern from the simplest existing one)

### CI Pipeline Walk-Through

Open the CI configuration and trace through:
- What triggers the pipeline (push, PR, schedule)
- What stages run and in what order
- Where test artifacts go (reports, traces, screenshots)
- How to find and interpret a failed test in CI
- How to re-run a failed job

---

## Mentorship Patterns

### Pair on First 3 Tests

The experienced team member sits with the new person for their first three tests:

1. **Test 1: Navigator/Driver.** Experienced person explains the approach and makes key decisions. New person types and asks "why?" at each step. Goal: understand the workflow.
2. **Test 2: Co-pilots.** Both contribute equally. New person makes more decisions, experienced person fills gaps. Goal: build confidence.
3. **Test 3: Observer.** New person drives entirely. Experienced person observes and gives feedback only when asked or when the approach would cause problems. Goal: independence.

### Review All PRs for First 2 Weeks

Every PR from the new person gets a thorough, supportive review for the first two weeks. Not just "LGTM" -- specific feedback on:
- Pattern adherence (are they using page objects correctly?)
- Selector strategy (are they using stable locators?)
- Assertion quality (are assertions specific enough?)
- Test isolation (any shared state risks?)
- Naming (does the test name describe behavior?)

After two weeks, reduce to standard review depth.

### Testing Buddy System

Assign a testing buddy -- a specific person the new team member can ask any question without hesitation. The buddy:
- Checks in daily for the first week ("What are you stuck on?")
- Is available for ad-hoc questions without scheduling
- Reviews all PRs with educational comments (explain the "why")
- Introduces the new person to team norms and unwritten rules

### Progressive Responsibility Ramp

```
Week 1-2:  Write tests for existing, well-understood features (smoke, basic flows)
Week 3-4:  Write tests for current sprint stories (with pairing available)
Week 5-6:  Write tests independently, review others' PRs
Week 7-8:  Contribute to test architecture (new fixtures, utilities, page objects)
Month 3+:  Lead test planning for a feature area, mentor the next new person
```

---

## Anti-Patterns

### Sink or Swim Onboarding

Giving a new person repository access, pointing them at the README, and expecting them to figure it out. This produces weeks of wasted time, bad habits learned from trial and error, and early attrition. Structured onboarding with pairing pays for itself in the first sprint.

### Tutorial-Only Onboarding

Spending two weeks on framework tutorials and toy exercises before touching the real codebase. Tutorials teach syntax; they do not teach project conventions, domain knowledge, or team workflow. Minimize tutorials (1-2 hours max) and move to real tests quickly.

### No Documentation, All Tribal Knowledge

When the answer to every question is "ask Sarah," the team has a bus factor of one and onboarding depends entirely on Sarah's availability. Document conventions in `.agents/qa-project-context.md` and the framework walkthrough. If something is important enough to explain verbally, it is important enough to write down.

### Perfectionism Paralysis

Expecting the new person's first test to be perfect. The first test should be functional and following basic conventions. Code quality improves with each PR review cycle. Blocking a first PR on style nits or advanced patterns destroys confidence and delays the first win.

### Ignoring the Onboarding Experience

Not soliciting feedback from the person being onboarded. They experienced the process firsthand and know exactly what was missing, confusing, or wasted time. Conduct a 15-minute feedback session at the end of week 2 and week 4. Use their feedback to improve onboarding for the next person.

### Copy-Paste Without Understanding

The new person copies an existing test, changes the locators and URL, and calls it done. The test works but they do not understand why. Pairing and code review should focus on the "why" behind each pattern. If someone cannot explain why a fixture is structured a certain way, they will misuse it when the context differs.

---

## Related Skills

- **qa-project-context** -- The project context file is the foundation for onboarding. Create it if it does not exist; update it as part of onboarding.
- **playwright-automation** -- Framework-specific patterns, page object model, fixtures, and CI integration for Playwright-based projects.
- **shift-left-testing** -- Introduces the new person to the team's shift-left practices: Three Amigos, PR review, Definition of Done.
- **test-strategy** -- Understanding the overall testing strategy gives the new person context for why tests are structured the way they are.
- **test-reliability** -- Understanding flaky test patterns and quarantine management helps the new person avoid creating unreliable tests.
