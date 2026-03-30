---
name: test-strategy
description: >-
  Create a comprehensive QA strategy document. Covers scope definition, risk-based
  prioritization, test levels (unit/integration/E2E), test pyramid analysis, entry/exit
  criteria, quality KPIs, tool selection rationale, and timeline planning. Produces
  an actionable strategy document, not a shelf document. Use when: "test strategy,"
  "QA plan," "quality strategy," "testing approach," "QA roadmap."
  Related: risk-based-testing, qa-metrics, release-readiness, test-planning.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: strategy
---

<objective>
Generate a comprehensive, actionable QA strategy document tailored to the product, team, and risk profile. The output should be a living document that drives daily testing decisions, not a compliance artifact that collects dust.
</objective>

---

## Discovery Questions

Before writing a single line of strategy, gather context. Check `.agents/qa-project-context.md` first -- if it exists, use it as the foundation and skip questions already answered there.

### Product & Business Context
- What is the product? (SaaS, e-commerce, API platform, mobile app, content site)
- Who are the users? (consumers, enterprise, internal, developers)
- What are the business-critical flows? (signup, checkout, payment, data export, etc.)
- What is the release cadence? (continuous, weekly, bi-weekly, quarterly)
- What regulatory or compliance requirements exist? (SOC2, HIPAA, PCI-DSS, GDPR)

### Current Testing State
- What test levels exist today? (unit, integration, E2E, manual, none)
- What is the current test count at each level?
- What frameworks and tools are in use?
- What is the current code coverage percentage?
- What is the target coverage, if any?
- How long does the CI pipeline take end-to-end?
- What is the current flakiness rate?

### Pain Points & Goals
- What are the biggest quality pain points? (regressions, slow feedback, flaky tests, gaps)
- What broke in the last 3 releases? What escaped to production?
- What does "good enough quality" look like for this team?
- What is the team's appetite for investment in test infrastructure?

### Team & Constraints
- Team size and composition (devs, QA, SDET, manual testers)
- Skill levels with automation tools
- Budget constraints for tooling
- Timeline pressure -- is there a deadline driving this strategy?

---

> **Calibrate to your team maturity** (set `team_maturity` in `.agents/qa-project-context.md`):
> - **startup** — Focus on a minimal test pyramid: unit tests + a handful of critical E2E paths. Skip contract testing and formal metrics until you have CI running reliably.
> - **growing** — Full pyramid with defined coverage targets, flakiness thresholds, and CI quality gates. Add risk-based prioritization.
> - **established** — Comprehensive strategy with SLA-backed quality gates, multi-environment coverage, advanced tooling (contract testing, chaos, observability), and formal review cadence.

---

## Core Principles

Every strategy produced by this skill adheres to these five principles:

### 1. Risk-Based Prioritization Over Exhaustive Coverage
Not all code is equal. A payment processing bug costs 1000x more than a tooltip typo. Allocate testing effort proportional to business risk, not code volume. The risk assessment matrix (below) drives where to invest.

### 2. Test Pyramid Health
A healthy test suite follows the pyramid shape: many fast unit tests, fewer integration tests, fewest E2E tests. When the shape inverts (ice cream cone), feedback is slow, maintenance is high, and confidence is paradoxically low. Diagnose the current shape and prescribe corrections.

### 3. Shift-Left: Catch Defects Earlier
Every defect found later costs exponentially more. Strategy should push validation earlier: static analysis before tests, unit tests before integration, contract tests before E2E. Design reviews catch architecture bugs that no test can find.

### 4. Measurable: Every Strategy Element Has a KPI
If you cannot measure it, you cannot improve it. Every section of the strategy must define what success looks like in numbers: coverage targets, flakiness thresholds, defect escape rate goals, MTTR limits.

### 5. Living Document: Strategy Evolves With the Product
The strategy is reviewed quarterly at minimum. It includes a revision history, owners for each section, and triggers for re-evaluation (new product area, team change, major incident).

---

## Strategy Document Template

Walk through each section below to produce the final strategy document. Tailor depth to the product's complexity -- a 5-person startup needs 5 pages, not 50.

---

### 1. Scope & Objectives

Define the boundaries clearly. Ambiguity here causes gaps and wasted effort downstream.

**In Scope:**
- List every product area, service, and integration that this strategy covers
- Include both functional and non-functional testing types
- Specify platforms and browsers/devices

**Out of Scope:**
- Explicitly state what is NOT covered and why
- Third-party services tested only at the contract level
- Legacy systems scheduled for deprecation

**Objectives:**
- State 3-5 measurable objectives with timelines
- Example: "Reduce defect escape rate from 12% to under 5% within two quarters"
- Example: "Achieve 80% unit test coverage on all services launched after Q1 2026"

---

### 2. Test Levels & Types

Define each test level, what it covers, who owns it, and the expected volume.

| Level | What It Validates | Owner | Framework | Target Count | Run Frequency |
|-------|-------------------|-------|-----------|-------------|---------------|
| **Unit** | Individual functions, business logic, edge cases | Developers | Jest/Vitest/pytest | 70-80% of all tests | Every commit |
| **Integration** | Service interactions, database queries, API contracts | Developers + QA | Supertest/pytest | 15-20% of all tests | Every PR |
| **E2E** | Critical user journeys through the full stack | QA/SDET | Playwright/Cypress | 5-10% of all tests | Pre-deploy + nightly |
| **API** | Contract compliance, response schemas, error handling | Developers | Postman/REST-assured | Per endpoint | Every PR |
| **Visual** | UI regression, layout shifts, responsive design | QA | Playwright/Percy | Key pages | Nightly |
| **Performance** | Response times, throughput, resource usage | DevOps/QA | k6/Artillery | Critical paths | Weekly + pre-release |
| **Security** | OWASP Top 10, dependency vulnerabilities, auth flows | Security/DevOps | OWASP ZAP/Snyk | Per release | Pre-release + scheduled |
| **Accessibility** | WCAG 2.1 AA compliance, screen reader compat | QA/Frontend | axe-core/pa11y | Key flows | Every PR |

Adjust this table based on what the product actually needs. Not every product needs visual regression testing. Every product needs unit and integration tests.

---

### 3. Test Pyramid Analysis

Diagnose the current shape of the test suite and define the target state.

#### Shapes and What They Mean

```
HEALTHY PYRAMID         ICE CREAM CONE         DIAMOND              HOURGLASS

    /  E2E  \           +-----------+                                 /  E2E  \
   /  ~5-10% \          | E2E ~60%  |            / Int \             / ~30%    \
  /           \         |           |           / ~50%  \           +----------+
 / Integration \        +-----------+          /         \          | Int ~10% |
/   ~15-20%     \       | Int ~20%  |         +-----------+         +----------+
+---------------+       +-----------+         | Unit ~30% |        /  Unit     \
|   Unit ~70%   |       | Unit ~20% |         +-----------+       /   ~60%      \
+---------------+       +-----------+                             +--------------+

Fast feedback,          Slow, brittle,        Heavy on mocks,      Missing middle
high confidence,        expensive to run,     integration gaps      layer, gaps in
cheap to maintain       hard to maintain      still possible        service boundaries
```

#### Current State Assessment Worksheet

Fill in these values from the codebase:

```
Current Test Distribution:
  Unit tests:        _____ count  →  _____ %
  Integration tests: _____ count  →  _____ %
  E2E tests:         _____ count  →  _____ %
  Manual test cases:  _____ count  (not in pyramid, but track)

Current Shape: [ ] Pyramid  [ ] Ice Cream Cone  [ ] Diamond  [ ] Hourglass  [ ] No Shape

CI Pipeline Duration: _____ minutes
Flaky Test Rate:      _____ %
Test Suite Pass Rate: _____ %
```

#### Target State

Define the target ratios and the timeline to get there:

```
Target Test Distribution:
  Unit:        70-80%  → target count: _____
  Integration: 15-20%  → target count: _____
  E2E:          5-10%  → target count: _____

Target CI Duration: < _____ minutes
Target Flaky Rate:  < _____ %
```

#### Action Plan to Shift Toward Healthy Pyramid

If ice cream cone or diamond:
1. **Freeze E2E growth** -- no new E2E tests unless covering a net-new critical path
2. **Decompose existing E2E tests** -- identify E2E tests that validate logic testable at unit level, rewrite them
3. **Add unit test requirements to PR checklist** -- every PR touching business logic must include unit tests
4. **Set CI gates** -- fail PRs where unit:E2E ratio drops below threshold

If hourglass:
1. **Invest in integration test infrastructure** -- database fixtures, service stubs, contract tests
2. **Identify service boundaries** -- each boundary needs integration tests for happy path + error cases
3. **Use contract testing** (Pact or similar) for inter-service communication

---

### 4. Risk Assessment Matrix

Map features to risk levels. This directly determines testing depth.

#### 5x5 Risk Matrix

```
LIKELIHOOD →     Rare      Unlikely    Possible    Likely    Almost Certain
IMPACT ↓          1           2           3          4            5

Catastrophic (5)  5-MED      10-HIGH    15-CRIT    20-CRIT      25-CRIT
Major (4)         4-LOW       8-MED     12-HIGH    16-CRIT      20-CRIT
Moderate (3)      3-LOW       6-MED      9-MED     12-HIGH      15-CRIT
Minor (2)         2-LOW       4-LOW      6-MED      8-MED       10-HIGH
Negligible (1)    1-LOW       2-LOW      3-LOW      4-LOW        5-MED
```

#### Risk-to-Testing Action Map

| Risk Level | Testing Action | Automation | Monitoring |
|------------|---------------|------------|------------|
| **CRITICAL (15-25)** | Full automation + manual exploratory + load test | Mandatory, runs on every commit | Real-time alerts, synthetic monitoring |
| **HIGH (10-14)** | Full automation + periodic manual review | Mandatory, runs on every PR | Dashboard + daily checks |
| **MEDIUM (5-9)** | Automation for happy path + key error cases | Recommended | Weekly review |
| **LOW (1-4)** | Manual testing or skip | Optional | None required |

#### Example Risk Assessment

| Feature Area | Impact | Likelihood | Risk Score | Testing Approach |
|-------------|--------|------------|------------|-----------------|
| Payment processing | 5 - Catastrophic | 3 - Possible | 15 - CRIT | Automated E2E + unit + contract + monitoring |
| User authentication | 5 - Catastrophic | 2 - Unlikely | 10 - HIGH | Automated E2E + security scan + unit |
| Dashboard rendering | 2 - Minor | 3 - Possible | 6 - MED | Unit + visual regression |
| Email preferences | 1 - Negligible | 2 - Unlikely | 2 - LOW | Manual verification |

---

### 5. Environment Strategy

Define which environments exist and what testing happens in each.

| Environment | Purpose | Test Types | Data | Deploy Trigger |
|------------|---------|------------|------|---------------|
| **Local** | Developer feedback | Unit, integration | Mocked/seeded | On save |
| **CI** | Automated validation | Unit, integration, lint, SAST | Ephemeral | On push/PR |
| **Staging** | Pre-production validation | E2E, visual, performance, security | Production-like (anonymized) | On merge to main |
| **Production** | Monitoring & smoke | Smoke tests, synthetic monitoring | Live | On deploy |

Key decisions to document:
- How is test data managed in each environment?
- Are environments ephemeral (preview deployments) or long-lived?
- Who has access to each environment?
- How are environment-specific configurations managed?

---

### 6. Tool Selection Rationale

Do not pick tools first. Understand needs first, then select tools that fit.

#### Decision Matrix Template

| Criteria (weight) | Tool A | Tool B | Tool C |
|-------------------|--------|--------|--------|
| **Fits tech stack** (25%) | | | |
| **Team familiarity** (20%) | | | |
| **Community & docs** (15%) | | | |
| **CI integration** (15%) | | | |
| **Maintenance cost** (10%) | | | |
| **Speed of execution** (10%) | | | |
| **License cost** (5%) | | | |
| **Weighted total** | | | |

Score each 1-5, multiply by weight, sum for weighted total.

#### Total Cost of Ownership

Beyond license fees, account for:
- **Setup time:** How long to configure CI, write first tests, train team
- **Writing time:** How long to write a typical test (measure this -- time 5 tests)
- **Maintenance time:** How often do tests break due to framework updates
- **Debug time:** When a test fails, how long to diagnose (good error messages matter)
- **Infrastructure cost:** Browser farms, parallel execution, cloud runners

#### Common Stack Recommendations

| Product Type | Unit | Integration | E2E | API | Visual |
|-------------|------|-------------|-----|-----|--------|
| React SaaS | Vitest | Testing Library + MSW | Playwright | Supertest | Playwright screenshots |
| Next.js | Vitest | Testing Library + MSW | Playwright | Supertest | Playwright screenshots |
| Python API | pytest | pytest + testcontainers | pytest + requests | pytest | N/A |
| Mobile (RN) | Jest | Detox | Detox/Appium | Supertest | Appium screenshots |
| Vue SaaS | Vitest | Testing Library + MSW | Playwright | Supertest | Playwright screenshots |

These are starting points, not mandates. Document why you chose or deviated.

---

### 7. Entry/Exit Criteria

Define what must be true before testing starts (entry) and what must be true before testing is considered done (exit) at each level.

#### Unit Testing
- **Entry:** Code compiles, function has a clear contract (inputs/outputs documented)
- **Exit:** All branches covered, edge cases tested, no skipped tests, coverage target met

#### Integration Testing
- **Entry:** Unit tests pass, dependent services available (or stubbed), test data seeded
- **Exit:** All service boundaries tested, error paths validated, no flaky tests

#### E2E Testing
- **Entry:** Integration tests pass, staging deployed, test accounts provisioned
- **Exit:** All critical user journeys pass, no P0/P1 defects open, performance within SLA

#### Release
- **Entry:** All test levels pass, no CRITICAL/HIGH defects open, release notes drafted
- **Exit:** Smoke tests pass in production, monitoring shows no anomalies for 30 min, rollback plan verified

---

### 8. Quality Gates & Definition of Done

Define automated gates that prevent bad code from moving forward.

#### PR Gate (runs on every pull request)
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Code coverage does not decrease (or meets minimum threshold)
- [ ] No new linting errors
- [ ] SAST scan passes (no new high/critical findings)
- [ ] Bundle size does not increase beyond threshold
- [ ] At least one approval from code reviewer

#### Merge Gate (runs on merge to main)
- [ ] All PR gate checks pass
- [ ] E2E smoke suite passes against preview deployment
- [ ] No merge conflicts
- [ ] Branch is up to date with main

#### Deploy Gate (runs before production deployment)
- [ ] Full E2E suite passes on staging
- [ ] Performance benchmarks within acceptable range
- [ ] Security scan passes
- [ ] Feature flags configured correctly
- [ ] Rollback plan documented and tested

#### Nightly Gate (runs on schedule)
- [ ] Full E2E suite including edge cases
- [ ] Visual regression tests
- [ ] Performance/load tests
- [ ] Accessibility scan
- [ ] Dependency vulnerability scan
- Results reviewed by QA lead next morning

---

### 9. Metrics & KPIs

Track these metrics to know if the strategy is working.

| Metric | Definition | Target | Tracking Cadence |
|--------|-----------|--------|-----------------|
| **Code Coverage** | Lines/branches covered by unit + integration tests | >80% for critical services, >60% overall | Per PR (automated) |
| **Test Pyramid Ratio** | Unit:Integration:E2E percentage split | 70:20:10 (within 10% tolerance) | Monthly |
| **Flakiness Rate** | % of test runs with non-deterministic failures | <2% | Weekly |
| **Defect Escape Rate** | % of defects found in production vs. total defects | <5% | Per release |
| **Mean Time to Recovery (MTTR)** | Average time from defect detection to fix deployed | <4 hours for P0, <24h for P1 | Per incident |
| **CI Pipeline Duration** | Time from push to green/red signal | <15 minutes for PR, <30 min for full | Weekly |
| **Test Velocity** | New tests written per sprint | Positive trend, no target number | Per sprint |
| **Defect Density** | Defects per 1000 lines of code | Decreasing trend | Monthly |
| **Automation Rate** | % of test cases automated vs. total | >80% for regression suite | Quarterly |
| **False Positive Rate** | % of test failures that are not real bugs | <5% | Weekly |

#### How to Use These Metrics

- **Do not** use metrics to punish teams. Use them to identify systemic issues.
- **Do** track trends over time, not absolute numbers. A team going from 30% to 60% coverage is doing great.
- **Do** set realistic targets based on current state. Jumping from 20% to 90% coverage in one quarter is not a plan, it is a fantasy.
- **Do** review metrics quarterly with engineering leadership. Celebrate improvements.
- **Do** investigate spikes. A sudden increase in flakiness signals an infrastructure problem, not a laziness problem.

---

### 10. Timeline & Milestones

Roll out the strategy in phases. Trying to do everything at once guarantees nothing gets done well.

#### Phase 1: Foundation (Weeks 1-4)
- [ ] Complete risk assessment for all product areas
- [ ] Set up CI pipeline with unit test gate
- [ ] Establish baseline metrics (current coverage, flakiness, pipeline time)
- [ ] Write unit tests for top 5 highest-risk areas
- [ ] Select and configure E2E framework
- **Exit criteria:** CI runs unit tests on every PR, baseline metrics documented

#### Phase 2: Coverage Expansion (Weeks 5-10)
- [ ] Add integration tests for all service boundaries
- [ ] Write E2E tests for top 10 critical user journeys
- [ ] Implement visual regression testing for key pages
- [ ] Set up test data management
- [ ] Configure nightly test runs
- **Exit criteria:** All critical paths have E2E coverage, integration tests cover all APIs

#### Phase 3: Quality Gates (Weeks 11-14)
- [ ] Enable coverage gates on PRs (no decrease allowed)
- [ ] Add performance benchmarks to CI
- [ ] Implement security scanning in pipeline
- [ ] Set up monitoring dashboards for all KPIs
- **Exit criteria:** All four gates (PR, merge, deploy, nightly) are active and enforced

#### Phase 4: Optimization (Weeks 15-20)
- [ ] Identify and fix or quarantine flaky tests
- [ ] Optimize CI pipeline for speed (parallelization, caching)
- [ ] Implement test impact analysis (run only affected tests)
- [ ] Set up synthetic monitoring in production
- [ ] First quarterly strategy review
- **Exit criteria:** CI under 15 min, flakiness under 2%, first strategy revision published

#### Ongoing
- Quarterly strategy review and revision
- Monthly metrics review with team
- Continuous test maintenance (refactor, de-flake, retire)

---

## Anti-Patterns

Watch for these common failures. If you spot them, call them out explicitly in the strategy document.

### 100% Coverage Targets
Diminishing returns kick in hard past 80%. The last 20% requires testing getters, setters, and trivial code while ignoring the integration gaps where real bugs live. Set coverage targets per module based on risk, not a blanket number.

### Ice Cream Cone (Inverted Pyramid)
Too many E2E tests, too few unit tests. Symptoms: CI takes 45+ minutes, tests break constantly due to UI changes, nobody trusts the test suite. Fix by freezing E2E growth and decomposing existing E2E tests into lower levels.

### Strategy as One-Time Document
A strategy written once and never updated is worse than no strategy, because it gives false confidence. Build in review triggers: quarterly calendar review, post-incident review, new product area launch, team composition change.

### Tool-First Thinking
"We should use Playwright" is not a strategy. It is a tool choice masquerading as a plan. Start with what you need to validate, then pick tools that fit. The strategy document should justify tool choices, not lead with them.

### No Metrics = No Accountability
A strategy without measurable targets is a wish list. Every section should connect to a KPI. If you cannot define what success looks like for a strategy element, question whether it belongs in the strategy.

### Testing in Isolation
QA strategy that lives only in the QA team's wiki is invisible to developers. The strategy must be integrated into the development workflow: PR templates, CI gates, Definition of Done. If developers do not see it daily, it does not exist.

### Copy-Paste Strategy
Taking another company's strategy verbatim ignores your product's unique risk profile, team skills, and constraints. Use templates as starting points, but every section must be tailored to your specific context.

### Automating Everything Immediately
Manual exploratory testing has enormous value, especially early in a product's life. Automate regression, keep exploration manual. The strategy should specify what stays manual and why.

---

## Output Format

The final strategy document should follow this structure:

```markdown
# QA Strategy: [Product Name]
## Version [X.Y] | Last Updated: [Date] | Owner: [Name]

### 1. Executive Summary (1 paragraph)
### 2. Scope & Objectives
### 3. Test Levels & Types (table)
### 4. Test Pyramid Analysis (current → target)
### 5. Risk Assessment (matrix + feature mapping)
### 6. Environment Strategy (table)
### 7. Tool Selection (decisions + rationale)
### 8. Entry/Exit Criteria (per level)
### 9. Quality Gates (per stage)
### 10. Metrics & KPIs (table with targets)
### 11. Timeline & Milestones (phased)
### 12. Risks to the Strategy Itself
### 13. Revision History
```

---

## Done When

- A strategy document exists at an agreed location with all 13 sections populated (Executive Summary through Revision History)
- Test pyramid target ratios are defined with concrete counts and a timeline to reach them
- Entry and exit criteria are written for each test level (unit, integration, E2E, release)
- Tool selection decisions are documented with a scored rationale matrix, not just tool names
- Quality gates are defined for all four stages (PR, merge, deploy, nightly) with specific pass/fail thresholds

## Related Skills

- **risk-based-testing** -- deep dive into risk assessment methodology
- **qa-metrics** -- detailed KPI definitions, dashboards, and trend analysis
- **release-readiness** -- go/no-go checklists and release confidence scoring
- **test-planning** -- sprint-level test planning and estimation
- **ci-cd-integration** -- pipeline configuration and gate implementation
- **shift-left-testing** -- techniques for moving validation earlier
