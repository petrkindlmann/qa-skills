---
name: test-planning
description: >-
  Create sprint and release test plans. Covers feature decomposition into testable
  scenarios, requirements-to-test coverage mapping, effort estimation by test type,
  prioritization matrices (risk × effort), resource allocation, and scheduling with
  buffers. Use when: "test plan," "sprint testing," "release plan," "what to test,"
  "test estimation," "coverage mapping."
  Related: test-strategy, risk-based-testing, release-readiness.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: strategy
---

<objective>
Create actionable test plans for sprints and releases. A test plan answers four questions: what to test, how deeply, who does it, and when it must be done. The output is a living document that tracks progress, not a bureaucratic artifact filed and forgotten.
</objective>

---

## Discovery Questions

Before writing a test plan, gather context. Check `.agents/qa-project-context.md` first -- if it exists, use it as the foundation and skip questions already answered there.

### Scope

- What is the scope? (single sprint, release, hotfix, feature)
- Which features are new vs. changed vs. unchanged?
- Which features are being released for the first time?
- Are there infrastructure or dependency changes (database migrations, API version bumps, third-party provider switches)?
- Is there a requirements document, PRD, or set of user stories to map against?

### Time and Resources

- What is the testing window? (days, hours available)
- Who is available for testing? (SDETs, manual testers, developers)
- Are there shared resources that could bottleneck? (staging environments, test accounts, devices)
- Is there a hard deadline that cannot move, or is the release date flexible?

### Risk Context

- Which areas changed the most in this cycle?
- What broke in the last release or sprint?
- Are there known fragile areas or tech debt that increase risk?
- For risk-based prioritization methodology, see `risk-based-testing`.

### Existing Coverage

- What automated tests already exist for the in-scope features?
- What is the current pass rate of the automated suite?
- Are there known gaps in automation that require manual testing?
- When was the last exploratory testing session on these features?

---

## Core Principles

### 1. Coverage-Driven: Map Every Requirement to at Least One Test

A test plan without traceability to requirements is a guess. Every user story, acceptance criterion, or requirement must map to at least one test case. Gaps in this mapping are untested requirements -- the most dangerous kind of risk.

### 2. Time-Boxed: Plan Fits the Available Window

Testing expands to fill available time if unbounded. Set a time box for each activity and stick to it. When the window is too short, the prioritization matrix determines what gets cut -- not gut feeling.

### 3. Prioritized: Not Everything Gets Equal Depth

A payment flow change and a tooltip fix do not deserve equal effort. Use the risk x effort matrix to allocate depth: some features get full regression, others a smoke test, some nothing if low-risk and unchanged.

### 4. Buffered: Leave Room for the Unexpected

Plans that schedule 100% of available time fail when bugs are found. Reserve 20-30% of the testing window for bug verification, re-testing, and unplanned investigation.

### 5. Visible: The Plan Is a Communication Tool

Developers need to know what gets tested to write testable code. Product managers need coverage visibility to make release decisions. Publish the plan where the team can see it.

---

## Workflow

### Step 1: Feature Analysis and Decomposition

Break each in-scope feature into testable units. A "testable unit" is a specific behavior that can be verified with a clear pass/fail outcome.

**Decomposition template:**

```
Feature: [Feature Name]
Source: [User story / PRD / Ticket ID]

Testable Scenarios:
  1. [User action] → [Expected outcome]
  2. [User action with edge case input] → [Expected outcome]
  3. [Error condition] → [Expected error handling]
  4. [Integration point] → [Expected behavior across boundary]
  5. [Performance expectation] → [Response time / throughput target]
```

**Example -- User profile edit:**

```
Feature: User Profile Edit
Source: PROJ-1234

Testable Scenarios:
  1. User updates display name → Name appears updated across all pages
  2. User updates email → Verification email sent, old email works until verified
  3. User uploads avatar > 5MB → Error message shown, upload rejected
  4. User uploads avatar in unsupported format → Error message with supported formats listed
  5. User clears required field and saves → Validation error, field highlighted
  6. Two users edit same profile simultaneously → Last write wins, no data corruption
  7. Profile edit with slow connection → Loading state shown, no duplicate submissions
```

### Step 2: Requirements-to-Test Coverage Mapping

Create a traceability matrix that maps every requirement to its test cases.

**Coverage matrix template:**

```
| Req ID   | Requirement Description          | Test Type  | Test ID(s)     | Status     |
|----------|----------------------------------|------------|----------------|------------|
| REQ-101  | User can update display name     | Automated  | TC-201, TC-202 | Covered    |
| REQ-102  | Email change requires verification| Automated  | TC-210         | Covered    |
| REQ-103  | Avatar upload size limit 5MB     | Manual     | TC-215         | Planned    |
| REQ-104  | Profile changes audit logged     | None       | --             | GAP        |
```

Rules for the coverage matrix:
- Every requirement must appear in the matrix
- "GAP" status triggers a decision: write a test, accept the risk, or defer
- Automated tests get test IDs that link to the actual test file/function
- Manual tests reference the test case document or charter

### Step 3: Effort Estimation

Estimate effort for each test type using historical data. If no historical data exists, use the reference estimates below and calibrate after the first sprint.

**Estimation reference (per test case):**

| Test Type | Write Time | Execute Time | Maintenance (per quarter) |
|-----------|-----------|-------------|--------------------------|
| Unit test | 15-30 min | < 1 sec | 5 min |
| Integration test | 30-60 min | 5-30 sec | 15 min |
| E2E test (Playwright/Cypress) | 1-3 hours | 30s-2 min | 30 min |
| Manual test case (write) | 15-30 min | 5-15 min per execution | 10 min |
| Exploratory session (charter) | 15 min | 45-90 min per session | N/A |
| Visual regression test | 30-60 min | 10-30 sec | 20 min (baseline updates) |
| Performance test (k6 script) | 2-4 hours | 5-30 min per run | 30 min |

**Sprint estimation worksheet:**

```
Sprint Test Plan Estimation:

New automated tests to write:
  Unit:        ___ tests × 0.5 hrs = ___ hrs
  Integration: ___ tests × 1.0 hrs = ___ hrs
  E2E:         ___ tests × 2.0 hrs = ___ hrs

Manual testing:
  Test cases to execute: ___ × 0.25 hrs = ___ hrs
  Exploratory sessions:  ___ × 1.5 hrs  = ___ hrs

Bug verification buffer (20%):     ___ hrs
Re-test after fixes buffer (10%):  ___ hrs

Total estimated effort:            ___ hrs
Available tester hours this sprint: ___ hrs
Capacity utilization:              ___%  (target: 70-80%)
```

### Step 4: Prioritization Matrix (Risk x Effort)

When the estimated effort exceeds available capacity (it usually does), use this matrix to decide what to cut.

```
                    EFFORT
                    Low             Medium          High
                   (< 1 hr)        (1-4 hrs)       (> 4 hrs)
                 +---------------+---------------+---------------+
  High           | DO FIRST      | DO SECOND     | DO THIRD      |
  (CRIT/HIGH     | Quick wins    | Core coverage | Invest if     |
   risk score)   | on critical   | for critical  | time allows   |
                 | features      | features      |               |
R                +---------------+---------------+---------------+
I Medium         | DO SECOND     | DO THIRD      | DEFER         |
S (MED risk      | Quick wins    | If capacity   | Move to next  |
K score)         | on moderate   | allows        | sprint        |
                 | features      |               |               |
                 +---------------+---------------+---------------+
  Low            | DO IF TIME    | DEFER         | SKIP          |
  (LOW risk      | Minimal       | Not worth     | Automate      |
   score)        | effort, why   | the effort    | later or      |
                 | not           | this sprint   | never         |
                 +---------------+---------------+---------------+
```

For each test case, plot it on the matrix using the risk score from `risk-based-testing` and the effort estimate from Step 3. Work through the matrix in priority order until capacity is consumed.

### Step 5: Resource Allocation

Assign testing work based on skill match and availability.

**Allocation principles:**
- Automated test writing goes to SDETs or developers with framework experience
- Exploratory testing goes to the person who understands the feature best (often the developer or product manager, not just QA)
- New feature testing benefits from fresh eyes -- assign someone who did not build it
- Critical path testing should not have a single point of failure -- two people should be able to cover it

**Allocation table:**

```
| Tester    | Available Hours | Assigned Work                    | Hours | Utilization |
|-----------|----------------|----------------------------------|-------|-------------|
| Alice     | 20             | E2E: checkout flow (8h)          | 16    | 80%         |
|           |                | Exploratory: payment (4h)        |       |             |
|           |                | Bug verification buffer (4h)     |       |             |
| Bob       | 16             | Unit: discount calc (4h)         | 12    | 75%         |
|           |                | Integration: payment API (6h)    |       |             |
|           |                | Buffer (2h)                      |       |             |
| Carol     | 12             | Manual: accessibility (4h)       | 10    | 83%         |
|           |                | Exploratory: profile edit (4h)   |       |             |
|           |                | Buffer (2h)                      |       |             |
```

### Step 6: Schedule with Buffers

Map testing activities to the sprint timeline. Testing should not be back-loaded to the last two days.

**Schedule template (2-week sprint):**

```
Week 1:
  Day 1-2: Test plan finalized, test data prepared, environments verified
  Day 3-4: Automated tests written for features delivered early
  Day 5:   First round of manual/exploratory testing on available features

Week 2:
  Day 1-2: Remaining automated tests written, first round regression
  Day 3:   Full regression run, bug verification
  Day 4:   Re-test fixes, exploratory testing on integrated features
  Day 5:   Final regression, sign-off, release readiness assessment

Buffer allocation:
  20% of total hours reserved for unplanned work (bugs, re-tests, blockers)
  Bug triage happens daily at standup -- do not wait until Day 5
```

**Key scheduling rules:**
- Testing starts as soon as features are code-complete, not at sprint end
- Environment setup and test data preparation happen on Day 1, not Day 3
- Bug verification is continuous, not batched
- The last day is for confirmation, not for starting new testing

---

## Templates

### Sprint Test Plan (1-Page)

```markdown
# Sprint [N] Test Plan
**Sprint dates:** [start] - [end]
**Features in scope:** [list with ticket IDs]
**Test lead:** [name]
**Last updated:** [date]

## Scope
| Feature | Risk | Test Types | Owner | Status |
|---------|------|-----------|-------|--------|
| [name]  | HIGH | E2E, Unit, Exploratory | [name] | Not Started |
| [name]  | MED  | Unit, Manual | [name] | In Progress |

## Coverage Summary
- Requirements mapped: __ / __ (target: 100%)
- Automated coverage: __ / __ test cases
- Manual coverage: __ / __ test cases
- Gaps identified: __ (with justification)

## Effort Budget
- Total available: __ hours
- Allocated: __ hours (target: 70-80% utilization)
- Buffer: __ hours (20-30%)

## Environment & Data
- Staging URL: [url]
- Test accounts: [location/reference]
- Test data setup: [script/manual steps]

## Entry Criteria
- [ ] Features code-complete and deployed to staging
- [ ] Test data seeded
- [ ] Automated suite passing (existing tests)

## Exit Criteria
- [ ] All HIGH-risk features tested
- [ ] No open P0/P1 defects
- [ ] Coverage matrix shows no unaccepted gaps
- [ ] Regression suite green

## Risks to the Plan
| Risk | Mitigation |
|------|-----------|
| Feature X not code-complete by Day 3 | Test Feature Y first, shift X to Week 2 |
| Staging environment unstable | Run E2E locally against dev server |
```

### Release Test Plan

A release test plan aggregates sprint test plans and adds release-specific concerns.

```markdown
# Release [version] Test Plan
**Release date:** [date]
**Release manager:** [name]
**QA lead:** [name]

## Release Contents
| Sprint | Features | Test Status |
|--------|----------|------------|
| Sprint N | [features] | Complete |
| Sprint N+1 | [features] | In Progress |

## Release-Specific Testing
| Activity | Owner | Schedule | Status |
|----------|-------|----------|--------|
| Full regression on release candidate | [name] | Day -3 | Planned |
| Cross-browser verification (Chrome, Firefox, Safari) | [name] | Day -2 | Planned |
| Performance benchmark vs. previous release | [name] | Day -2 | Planned |
| Security scan on release branch | CI | Day -1 | Planned |
| Smoke test on production after deploy | [name] | Day 0 | Planned |

## Go/No-Go Criteria
See `release-readiness` for the full checklist.

- [ ] All sprint exit criteria met
- [ ] No P0/P1 defects open
- [ ] Performance within 10% of previous release
- [ ] Security scan clean
- [ ] Rollback plan tested
```

### Feature Coverage Matrix

```markdown
# Coverage Matrix: [Feature Name]

| ID | Scenario | Priority | Test Type | Test Location | Status |
|----|----------|----------|-----------|---------------|--------|
| S1 | Happy path: user completes flow | P0 | E2E | e2e/tests/feature/happy.spec.ts | Automated |
| S2 | Validation: required fields empty | P0 | Unit | src/feature/__tests__/validate.test.ts | Automated |
| S3 | Error: server returns 500 | P1 | E2E | e2e/tests/feature/errors.spec.ts | Automated |
| S4 | Edge: unicode in text fields | P2 | Manual | -- | Planned |
| S5 | Perf: page loads under 2s | P1 | Perf | perf/feature-load.js | Automated |
| S6 | A11y: keyboard navigation | P1 | Manual | -- | GAP |
```

### Test Estimation Worksheet

```markdown
# Estimation: [Feature/Sprint Name]

## New Test Development
| Test | Type | Complexity | Estimate | Actual | Notes |
|------|------|-----------|----------|--------|-------|
| Checkout E2E | E2E | High | 3h | -- | Multi-step form |
| Discount calc | Unit | Medium | 1h | -- | 8 combinations |
| Payment API | Integration | High | 2h | -- | Mock gateway |

## Existing Test Execution
| Suite | Count | Est. Duration | Flaky? |
|-------|-------|--------------|--------|
| Unit suite | 342 | 45s | No |
| Integration suite | 87 | 3m | 2 flaky |
| E2E regression | 54 | 12m | 5 flaky |

## Manual Testing
| Activity | Sessions | Duration Each | Total |
|----------|----------|--------------|-------|
| Exploratory: new feature | 2 | 60 min | 2h |
| Cross-browser check | 1 | 45 min | 45m |
| Accessibility review | 1 | 30 min | 30m |

## Summary
| Category | Hours |
|----------|-------|
| New test development | __ |
| Manual testing | __ |
| Bug verification (20% buffer) | __ |
| **Total** | **__** |
| Available capacity | __ |
| **Delta** | **__** |
```

---

## Tracking Progress During the Sprint

A test plan is useless if nobody checks it after Day 1. Track progress daily.

### Daily Test Status Format

```
Test Status - [Date]

Completed today:
  ✓ E2E: checkout happy path (TC-201)
  ✓ Unit: discount stacking (TC-305, TC-306)

Blocked:
  ✗ Integration: payment API -- staging env down since 2pm
    Action: DevOps notified, ETA unknown

Found today:
  BUG-789: Discount applies twice on retry (P1, assigned to Dev)
  BUG-790: Avatar upload spinner never stops on timeout (P2, backlog)

Tomorrow:
  - E2E: checkout error paths (TC-202, TC-203)
  - Exploratory: payment flow edge cases (1h session)

Coverage: 14/22 scenarios complete (64%)
Blockers: 1 (staging environment)
Buffer consumed: 2h of 8h (25%)
```

### Sprint Retrospective Inputs

After each sprint, feed these data points back into future planning:

```
Estimation accuracy: Estimated 40h | Actual 46h | Variance +15%
  Cause: Bug verification took 6h more than buffered

Coverage: Planned 22 scenarios | Tested 20 | Skipped 2 (low risk, time pressure)
  Gap: accessibility review deferred

Bugs: Total 7 | P0: 0 | P1: 2 | P2: 3 | P3: 2 | Escaped: 0

Lessons:
  - Buffer was too low for this complexity (increase to 30%)
  - E2E estimation accurate; unit test estimation too low
  - Start testing Day 2 instead of Day 3
```

---

## Anti-Patterns

### Planning Without Risk Assessment

Treating every feature with equal depth wastes effort on low-risk areas and under-tests critical paths. Always run the prioritization matrix (Step 4) before allocating effort. For the full risk methodology, see `risk-based-testing`.

### No Buffer for Bug Discovery

Scheduling 100% of available hours for planned activities leaves no time for verification when bugs are found. Reserve 20-30% as buffer and track consumption daily.

### Back-Loading Testing to Sprint End

Leaving all testing for the last two days rushes coverage and surfaces bugs too late to fix. Start testing as features become available; continuous testing beats batch testing at sprint end.

### Test Plan as Compliance Artifact

A 30-page plan filed and forgotten helps nobody. The plan should be one page for a sprint, actively tracked, and updated daily. If the plan is not changing, nobody is using it.

### Estimating Without Historical Data

Effort estimates pulled from thin air are unreliable. Track actual time spent and use that data for future estimates. After 2-3 sprints, estimates become reliable.

### Ignoring Environment and Data Setup

Environment setup, test data creation, and mock configuration can consume 20-40% of testing effort. Include preparation in the estimate or the plan will always run over.

### Single-Person Coverage on Critical Path

A single tester covering all critical-path work is a failure point. Ensure at least two people can cover critical-path testing.

---

## Done When

- A sprint or release test plan document exists (using the 1-page sprint template or release template) with scope, coverage summary, effort budget, and entry/exit criteria filled in
- Every in-scope feature is decomposed into specific testable scenarios with pass/fail criteria
- Each scenario is estimated and plotted on the risk x effort prioritization matrix, with deferred items explicitly noted
- A requirements-to-test coverage matrix exists with no unexplained GAP entries
- Test data requirements, environment details, and resource allocation are documented in the plan

## Related Skills

- **test-strategy** -- The broader QA strategy that test plans execute against; strategy defines the approach, plans implement it per sprint.
- **risk-based-testing** -- Deep methodology for risk assessment that feeds into the prioritization matrix in Step 4.
- **release-readiness** -- The go/no-go checklist that the release test plan's exit criteria feed into.
- **qa-metrics** -- Metrics like defect escape rate and estimation accuracy that improve future test plans.
- **exploratory-testing** -- Structured exploratory sessions referenced in the manual testing sections of the plan.
- **qa-project-context** -- The project context file that provides baseline answers to discovery questions.