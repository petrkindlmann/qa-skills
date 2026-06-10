---
name: qa-project-bootstrap
description: >-
  Onboard a new QA engineer to an existing codebase, or audit an existing test
  architecture. Produces a 30-day ramp plan: codebase orientation, framework
  walkthrough, test architecture audit, mentorship pairing, and first-test
  guidance. Use when: "QA onboarding," "new tester," "ramp up," "test architecture
  audit," "first 30 days," "QA mentorship," "joining QA team." Not for: setting up
  QA on a brand-new project from scratch — use `qa-start`.
  Related: qa-start, qa-project-context, shift-left-testing, ai-qa-review.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: process
---

<objective>
A new QA engineer pointed at the README and left to "figure it out" burns two weeks learning bad habits by trial and error, and an unaudited inherited suite hides flaky tests and coverage gaps that only surface in production. This skill reduces time to first merged test and produces three concrete artifacts: a 30-day ramp plan, a five-dimension test architecture audit, and a framework walkthrough doc. Every section serves the same metric — a real test merged to main and green in CI, fast.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. If it exists, it answers most discovery questions and provides the technical context for onboarding. If it does not, creating it is the first action item.
</objective>

## Quick Route

This skill serves three distinct jobs. Identify yours, jump to the section, skip the rest.

| Situation | Jump to | Output |
|-----------|---------|--------|
| Onboarding a **new person** to an existing team | First 30 Days Checklist → Mentorship Patterns | A 30-day ramp plan with owners and dates |
| Inherited an **existing suite** with no onboarding/docs | Test Architecture Audit (scope by `team_maturity`) | A 1-2 page findings doc, five dimensions |
| Need the **reference doc** for anyone writing tests | Framework Walkthrough Template | A project-specific walkthrough.md |

A real onboarding usually needs all three; a quick health check needs only the audit.

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

> **Calibrate to your team maturity** (set `team_maturity` in `.agents/qa-project-context.md`):
> - **startup** — Focus on days 1–10: get one test framework running and one critical path covered. Skip process ceremony until you have a working baseline.
> - **growing** — Full 30-day plan: framework selection, CI integration, coverage baseline, team conventions documented.
> - **established** — 30-day plan plus: audit existing suite for anti-patterns, propose tooling upgrades, establish metrics baseline, schedule recurring quality reviews.

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
- [ ] **Working with the team's AI assistants:** Identify which coding agents the team uses (Claude Code, Codex, Cursor, Gemini CLI, etc.), where their context lives (`.agents/qa-project-context.md`, `CLAUDE.md`, `AGENTS.md`), which prompts/skills are house style, and which tasks the team explicitly does NOT delegate to AI. Produce a short "AI assistants we use, what they're good at, what to never let them do" doc as a Day 4 deliverable. If the team automates Playwright via an agent, note that agent-driven Playwright now has its own `@playwright/cli` (daemon architecture, `playwright-cli` commands, token-efficient) — distinct from the `npx playwright test` runner the framework walkthrough documents.

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

**Scope the audit by `team_maturity`** (from `.agents/qa-project-context.md`) — a one-size-fits-all audit wastes a startup's time and underserves an established team:
- **startup** — Skip the full audit. Confirm one path is covered and one framework runs; spend the saved hours getting a first test merged.
- **growing** — Run all five dimensions once to establish a baseline; defer recurring reviews.
- **established** — Full five-dimension audit plus recurring quality reviews on a schedule (e.g. monthly), with the findings doc tracked over time.

### What to Assess

Assess five dimensions, each with a fill-in worksheet:

- **Coverage and Distribution** — test counts by layer, pyramid shape, code coverage and trend.
- **Reliability** — flaky test rate, top flakiest tests, quarantine count and age.
- **CI Health** — full suite and per-stage duration, parallelism, pass rate, retry rate.
- **Technical Debt** — skipped tests, `waitForTimeout`/`force: true` usage, hardcoded data, assertionless tests, deprecated APIs, stale AI-generated tests, stale feature flags.
- **Conventions** — page objects, fixtures, factories, naming, shared utilities, tagging.

See `references/audit-worksheets.md` for the copy-and-fill worksheets covering all five dimensions.

### Audit Output

Produce a short document (1-2 pages) summarizing findings, categorized as:

- **Strengths:** What the existing suite does well (preserve and learn from these)
- **Gaps:** Missing coverage areas, undertested critical paths
- **Risks:** Flaky tests, stale quarantines, declining coverage
- **Quick Wins:** Improvements achievable in 1-2 sprints (fix flaky tests, add missing happy-path coverage)
- **Strategic Work:** Improvements requiring sustained investment (refactor test architecture, add integration layer)

---

## Framework Walkthrough Template

Create this document for your project. It is the primary reference for anyone writing tests. It has six sections:

1. **Architecture Overview** — framework, language, config location, and the annotated directory tree.
2. **How to Run Tests** — the full set of run commands (all tests, single file, grep, headed, debug, UI mode, per-browser, report).
3. **How to Write a New Test (Step by Step)** — the six-step location/reuse/write/run/PR flow plus the Arrange-Act-Assert test template.
4. **How to Debug Failures** — local vs CI failure playbooks and common failure-pattern decoder.
5. **Common Patterns and Conventions** — project-specific examples for auth fixtures, data factories, assertion specificity, and selector priority.
6. **Where to Find Help** — the routing table for questions about patterns, failures, product behavior, and docs.

See `references/framework-walkthrough.md` for the full template with all code blocks, directory trees, and command lists to copy and adapt.

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

## Verification

Prove the artifacts hold before declaring onboarding complete. Cheapest check first.

1. **The first merged test is stable, not lucky.** Run it repeated to rule out flakiness, then confirm CI is green.
   - `npx playwright test <new-test> --repeat-each=3` exits 0 (3 consecutive passes locally)
   - The PR's CI check is green on the same test
2. **The audit doc is complete, not a stub.** Open the findings doc and confirm all five dimensions (coverage/distribution, reliability, CI health, technical debt, conventions) are filled, and findings are categorized into strengths / gaps / risks / quick wins / strategic work. A startup that scoped out the audit (see `team_maturity`) records that decision instead.
3. **The context file parses and is populated.** `.agents/qa-project-context.md` exists and carries framework, critical paths, team structure, and risk areas — not a high-level placeholder.

## Done When

- At least one working test merged to the repo, passing in CI, and stable across 3 local repeats (`--repeat-each=3` exits 0) — proves the local and pipeline setup end-to-end.
- Test architecture audit doc exists with all five dimensions filled and findings categorized (strengths, gaps, risks, quick wins, strategic work) — or, for a startup `team_maturity`, the doc records the explicit decision to scope it out.
- Every Week-1 Day-1/2 setup item has a recorded owner and a target date; blocking items are filed as tracked tickets.
- `.agents/qa-project-context.md` exists and is populated with framework, critical paths, team structure, and risk areas (not a placeholder).
- Test framework selected with rationale recorded (evaluated alternatives, decision written down) — or marked N/A when inheriting an existing framework.

## Reference Files (in `references/`)

- **framework-walkthrough.md** — The full framework walkthrough template: architecture overview, run commands, new-test step-by-step and template, debug playbooks, conventions, and help routing.
- **audit-worksheets.md** — Copy-and-fill worksheets for the test architecture audit (coverage, reliability, CI health, technical debt, conventions).

## Related Skills

- **qa-project-context** -- The project context file is the foundation for onboarding. Create it if it does not exist; update it as part of onboarding.
- **playwright-automation** -- Framework-specific patterns, page object model, fixtures, and CI integration for Playwright-based projects.
- **shift-left-testing** -- Introduces the new person to the team's shift-left practices: Three Amigos, PR review, Definition of Done.
- **test-strategy** -- Understanding the overall testing strategy gives the new person context for why tests are structured the way they are.
- **test-reliability** -- Understanding flaky test patterns and quarantine management helps the new person avoid creating unreliable tests.