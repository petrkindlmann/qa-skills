---
name: shift-left-testing
description: >-
  Move quality earlier in the development lifecycle. Covers dev/QA pairing patterns,
  Three Amigos sessions, TDD facilitation (Red-Green-Refactor), PR review checklists
  for testability, and Definition of Done with quality gates. Includes shift-left
  maturity model for team assessment. Use when: "shift left," "TDD," "dev-QA pairing,"
  "definition of done," "testability," "quality culture," "QA in sprint planning."
  Related: unit-testing, ai-qa-review, test-strategy.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: process
---

<objective>
Move quality validation earlier in the development lifecycle where defects are cheaper, faster, and simpler to fix. This skill covers the practices, patterns, and cultural shifts that embed quality into every phase -- from story refinement to PR merge.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains team composition, current dev/QA workflow, sprint structure, and quality goals that shape which shift-left practices to introduce first.
</objective>

---

## Discovery Questions

### Current Dev/QA Workflow

1. **When does QA first see a feature?** After PR is raised? After merge to staging? Only when a bug appears? The answer reveals how far right your quality currently sits.

2. **Who writes tests, and when?** Developers only? QA only after dev is "done"? Both but on different timelines? Understanding current ownership is essential before changing it.

3. **How are requirements communicated?** Written specs? Verbal handoffs? Figma links with no acceptance criteria? Ambiguous requirements are the #1 source of defects that shift-left prevents.

4. **Is there interest in TDD?** Has the team tried it before? Did it stick or collapse? Understanding past attempts prevents repeating failed approaches.

5. **What does the PR review process look like?** Who reviews? Is testability a review criterion? Are tests required before merge? PR review is the lowest-friction place to introduce quality checks.

6. **What is the team's Definition of Done?** Written or unwritten? Does it include testing? Is it enforced or aspirational? The DoD is the contractual boundary between "in progress" and "done."

7. **How does QA participate in sprint planning?** Not at all? Consulted on estimates? Actively refining stories? Sprint planning participation determines how early QA thinking enters the cycle.

---

## Core Principles

### 1. Quality Is Everyone's Responsibility

Quality is not a phase performed by the QA team after development. It is a property of the entire workflow: product managers write testable requirements, developers write tests alongside code, code reviewers check for testability, and QA engineers design the strategy and catch what automation misses. When quality belongs to everyone, defects are caught by whoever encounters them first.

### 2. Earlier Detection = Exponentially Cheaper Fixes

The cost of fixing a defect rises exponentially as it moves through the pipeline:

```
Phase Found         Relative Cost
─────────────────────────────────
Requirements              1x
Design                    5x
Development              10x
Testing (QA)             25x
Staging                  50x
Production              100x
```

A missing validation rule caught during story refinement is a 5-minute conversation. The same defect found in production is an incident, a hotfix, a postmortem, and eroded user trust. Shift-left practices target the 1x-10x range.

### 3. QA Is Embedded, Not a Gate

Traditional QA acts as a gate at the end of development: code is "thrown over the wall" for testing. Shift-left embeds QA throughout the process. QA contributes to story refinement, pairs with developers on test design, reviews PRs for testability, and validates early through continuous testing. The gate model creates bottlenecks and adversarial dynamics. The embedded model creates collaboration and shared ownership.

### 4. Testability Is a Design Concern

Code that is hard to test is usually hard to maintain, hard to debug, and likely to contain defects. Testability should be a first-class design constraint alongside performance, security, and usability. When developers ask "how will we test this?" during design -- before writing a single line of code -- the resulting architecture is cleaner, more modular, and more reliable.

### 5. Start Small, Prove Value, Then Expand

Introducing every shift-left practice simultaneously overwhelms teams. Pick one practice (usually PR review checklists or Three Amigos), prove its value with data (fewer bugs escaping, faster PR cycles), then use that success to justify the next practice. Cultural change happens one demonstrated win at a time.

---

## Dev/QA Pairing Patterns

### QA in Sprint Planning

**What it looks like:** QA engineers attend sprint planning and actively participate in story refinement. They ask clarifying questions about edge cases, identify missing acceptance criteria, and flag risk areas before development begins.

**Concrete actions during planning:**

1. **Review each story for testable acceptance criteria.** Every acceptance criterion should be verifiable -- "user can sort the table" is testable; "table is user-friendly" is not.
2. **Identify edge cases and negative scenarios.** What happens with empty data? Max length input? Concurrent users? Network failure mid-operation?
3. **Flag integration risks.** Does this story touch a third-party API? Does it change database schema? Does it affect existing test data?
4. **Estimate QA effort.** Automation time, exploratory testing time, environment setup. Include this in sprint capacity.
5. **Define test approach per story.** Unit tests for business logic, integration tests for API changes, E2E for user-facing flows.

**Template: QA questions for each story**

```
Story: [PROJ-1234] Add coupon code to checkout
───────────────────────────────────────────────
QA questions before development starts:
1. What happens if the coupon is expired?
2. What happens if the coupon is already used (single-use)?
3. Can multiple coupons be stacked?
4. What error message does the user see for invalid codes?
5. Does the discount update the total in real-time or on submit?
6. Is there a rate limit on coupon validation attempts?

Test approach:
- Unit: coupon validation logic, discount calculation, expiry check
- Integration: coupon API endpoint, database state after redemption
- E2E: apply coupon in checkout flow, verify discount on confirmation
- Exploratory: edge cases with currency rounding, max discount limits
```

### Three Amigos Sessions

A structured 15-30 minute conversation between three perspectives before development begins.

**The three perspectives:**
- **Product/Business:** What does the user need? Why does this matter?
- **Development:** How will we build it? What are the technical constraints?
- **QA/Testing:** How will we verify it? What could go wrong?

**Session format (30 minutes max):**

1. Product presents the story (5 min) -- user need, acceptance criteria
2. Development asks clarifying questions (5 min) -- feasibility, dependencies
3. QA asks testing questions (5 min) -- edge cases, error states, testability
4. Group identifies gaps (10 min) -- missing criteria added, assumptions made explicit
5. Agreement and next steps (5 min) -- updated story, risks documented, test approach agreed

**When to use:** Stories with risk score Medium+, anything touching payments/auth/data integrity, stories with ambiguous requirements, cross-team stories.

**When to skip:** Simple bug fixes with clear repro steps, copy/text-only changes, dependency updates with no behavioral change.

### QA Pairing on Test-First Design

QA and developer collaborate on test cases before implementation. This is not full TDD -- it is test thinking applied collaboratively.

**How it works:**
1. Developer and QA sit together (or share screen) for 20-30 minutes
2. QA describes the scenarios they plan to test
3. Developer writes the test signatures (function names, inputs, expected outputs)
4. Together they identify which tests are unit, integration, and E2E
5. Developer implements the feature with these tests as the target

**Example output from a pairing session:**

```typescript
// Agreed test cases for: coupon code feature
// Unit tests (developer writes)
describe('CouponValidator', () => {
  test('accepts valid percentage coupon and returns discount amount');
  test('accepts valid fixed-amount coupon and returns discount amount');
  test('rejects expired coupon with COUPON_EXPIRED error');
  test('rejects already-redeemed single-use coupon with ALREADY_USED error');
  test('rejects coupon below minimum order amount with MIN_ORDER_NOT_MET error');
  test('caps percentage discount at product price (no negative totals)');
  test('handles currency rounding to 2 decimal places');
});

// Integration tests (developer or QA writes)
describe('POST /api/checkout/apply-coupon', () => {
  test('returns 200 with updated total when valid coupon applied');
  test('returns 400 with error code when coupon is expired');
  test('returns 409 when coupon already redeemed by this user');
  test('marks single-use coupon as redeemed after successful checkout');
});

// E2E tests (QA writes)
describe('Checkout coupon flow', () => {
  test('user applies valid coupon and sees discounted total');
  test('user sees clear error message for invalid coupon code');
  test('coupon discount persists through checkout to confirmation page');
});
```

### QA Reviewing PRs

QA engineers review pull requests with a focus on testability and test quality, complementing the code review performed by other developers.

**Getting started for teams new to QA PR reviews:**

1. **Start with one QA reviewer on high-risk PRs only.** Do not try to review every PR on day one.
2. **Time-box reviews to 15 minutes.** QA is checking for test quality, not re-reviewing business logic.
3. **Use the PR Review Checklist below.** It provides concrete, objective criteria -- no subjective judgment required.
4. **Leave comments as suggestions, not demands.** Frame as "Consider adding a test for the empty state" rather than "Missing tests."
5. **Track value.** Note when QA review catches a gap. After 2-4 weeks, share the count with the team to demonstrate ROI.

---

## TDD Facilitation

### Red-Green-Refactor

TDD follows a strict three-step cycle. Each step has a clear purpose and a clear exit condition.

```
┌──────────────────────────────────────────────────────┐
│  RED: Write a failing test                           │
│  - Test describes the desired behavior               │
│  - Test MUST fail (if it passes, it tests nothing)   │
│  - Write the minimum test to specify one behavior    │
│                                                      │
│  GREEN: Make the test pass                           │
│  - Write the minimum code to pass the test           │
│  - No extra features, no premature optimization      │
│  - It is OK if the code is ugly                      │
│                                                      │
│  REFACTOR: Clean up                                  │
│  - Improve code structure without changing behavior  │
│  - All tests still pass after refactoring            │
│  - Remove duplication, improve naming, simplify      │
└──────────────────────────────────────────────────────┘
```

**Example: TDD for a password strength validator**

```typescript
// RED — write the first failing test
test('rejects passwords shorter than 8 characters', () => {
  expect(validatePassword('short')).toEqual({
    valid: false, errors: ['Password must be at least 8 characters'],
  });
});
// Run → FAIL (validatePassword does not exist yet)

// GREEN — write minimum code to pass
function validatePassword(password: string) {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Password must be at least 8 characters');
  return { valid: errors.length === 0, errors };
}
// Run → PASS. Now RED again: add test for uppercase, then GREEN, repeat.

// REFACTOR — after several RED-GREEN cycles, extract pattern
const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, message: 'Password must be at least 8 characters' },
  { test: (p: string) => /[A-Z]/.test(p), message: 'Must contain uppercase letter' },
  { test: (p: string) => /[0-9]/.test(p), message: 'Must contain a number' },
  { test: (p: string) => /[!@#$%^&*]/.test(p), message: 'Must contain special character' },
];

function validatePassword(password: string) {
  const errors = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.message);
  return { valid: errors.length === 0, errors };
}
// Run → ALL PASS (behavior unchanged, structure improved)
```

### When TDD vs. Test-After: Decision Guide

TDD is not always the right choice. Use this guide to decide.

| Scenario | Approach | Why |
|----------|----------|-----|
| Pure business logic (validators, calculators, transformers) | **TDD** | Clear inputs/outputs, fast feedback, tests document behavior |
| Bug fix with known reproduction | **TDD** | Write failing test first = proof the fix works |
| API endpoint with clear contract | **TDD** | Request/response is a natural test boundary |
| Exploratory UI prototyping | **Test-after** | Design is unstable; tests would rewrite constantly |
| Third-party integration | **Test-after** | Need to understand the API behavior first |
| Complex data migration | **Test-after with fixtures** | Write sample data first, then test transformation |
| Performance optimization | **Test-after with benchmarks** | Need baseline before testing improvement |

### TDD for Bugs (The Litmus Test)

Every bug fix should start with a failing test that reproduces the bug. This practice provides three guarantees:

1. **You understand the bug.** If you cannot write a test that fails, you do not understand the bug.
2. **The fix actually works.** The test turns green when the fix is applied.
3. **The bug never returns.** The test stays in the suite as a regression guard.

```typescript
// BUG-4521: Discount rounds incorrectly for JPY (zero-decimal currency)
test('rounds JPY discount to whole number (no decimals)', () => {
  // JPY has no minor units — 1000 JPY is 1000, not 10.00
  const result = calculateDiscount({ amount: 1000, currency: 'JPY', percent: 15 });
  expect(result.discount).toBe(150);   // not 150.00
  expect(result.total).toBe(850);      // not 849.99
});
// RED: fails because current code returns 150.00

// Fix: check currency decimal places
// GREEN: passes after fix
// Commit with message: "fix(checkout): round JPY discounts to whole numbers (BUG-4521)"
```

### Kata Exercises for Teams Learning TDD

Short exercises (30-60 min) to build TDD muscle memory:

| Kata | Difficulty | Key lesson |
|------|-----------|------------|
| FizzBuzz | Beginner | Basic Red-Green-Refactor cycle |
| String Calculator | Beginner | Incremental complexity, edge cases |
| Roman Numerals | Intermediate | Pattern recognition, refactoring |
| Bowling Game | Intermediate | State management, complex rules |
| Gilded Rose | Advanced | Refactoring legacy code under test harness |

**Format:** Pair programming, 45 minutes, switch driver every 5 minutes. Debrief for 15 minutes: what was hard? What felt natural? What would you do differently?

---

## PR Review Checklist: QA Perspective

Use this checklist when reviewing PRs for test quality and testability. Not every item applies to every PR -- use judgment based on the change scope.

### Tests Exist and Are Meaningful

- [ ] **Tests accompany the code change.** New feature? New tests. Bug fix? Regression test. Refactor? Existing tests still pass (and ideally improve). No-test PRs for behavioral changes need explicit justification.
- [ ] **Both happy path and edge cases are covered.** At minimum: valid input, invalid input, empty/null input, boundary values. For user-facing features: error states, loading states, empty states.
- [ ] **Tests describe behavior, not implementation.** Test names read as specifications: `rejects expired coupon with clear error message` not `test coupon validator function line 42`.

### Code Is Testable

- [ ] **Functions have clear inputs and outputs.** Pure functions are trivially testable. Functions with side effects should isolate the side effect (dependency injection, wrapper functions).
- [ ] **Dependencies are injectable.** Database clients, HTTP clients, clocks, and random number generators should be parameters or injected -- not imported directly inside business logic.
- [ ] **No hardcoded magic values.** Constants are named and configurable. Test can override them without modifying production code.

### Test Quality

- [ ] **Selectors use stable strategies.** E2E tests use `data-testid`, `getByRole`, or `getByLabel` -- not CSS classes or XPath. See the selector stability scoring in `test-reliability`.
- [ ] **Assertions are specific.** `expect(result).toEqual({ status: 'expired', code: 'COUPON_EXPIRED' })` not `expect(result).toBeTruthy()`.
- [ ] **Test data is deterministic.** No dependency on current date, random values, or auto-increment IDs without explicit control. Use factories or fixtures.
- [ ] **Tests clean up after themselves.** Created records are deleted. Modified state is restored. No test pollution.
- [ ] **Test names describe the scenario.** A reader unfamiliar with the code should understand what is being tested from the test name alone.
- [ ] **No coverage-only tests.** Tests that execute code without meaningful assertions inflate coverage without providing safety.

---

## Definition of Done Template

The Definition of Done (DoD) is the team's shared agreement on what "done" means. It applies to every story before it moves to "Done" on the board.

### Recommended DoD with Quality Gates

```
Definition of Done
═══════════════════════════════════════════════════════

Code Complete
  [ ] Feature implemented per acceptance criteria
  [ ] Code peer-reviewed and approved
  [ ] No TODO/FIXME comments without a linked ticket

Tested
  [ ] Unit tests written for business logic (coverage not decreased)
  [ ] Integration tests written for API/service changes
  [ ] E2E test added/updated for user-facing changes to critical paths
  [ ] Edge cases and error states tested
  [ ] Manual exploratory testing completed for medium/high risk changes

Quality Gates Pass
  [ ] CI pipeline green (all tests pass)
  [ ] No new linting or type errors
  [ ] No new security vulnerabilities (SAST scan)
  [ ] Code coverage not decreased from baseline

Documentation
  [ ] API changes documented (OpenAPI spec, changelog)
  [ ] Breaking changes noted in PR description
  [ ] Runbook updated if operational behavior changed

Deployment Ready
  [ ] Feature flag configured (if applicable)
  [ ] Database migration tested on staging
  [ ] Monitoring/alerting configured for new endpoints
  [ ] Rollback plan identified
```

### Enforcing the DoD

The DoD is only effective if it is enforced. Three enforcement mechanisms:

1. **Automated gates in CI.** Tests must pass, coverage must not decrease, linting must pass. These cannot be bypassed without a team lead override.
2. **PR template checklist.** Include the DoD as a checklist in the PR template. Reviewers verify items are checked.
3. **Sprint review validation.** During sprint review, stories are accepted only if the DoD is met. "It works but tests are not written yet" means it is not done.

---

## Shift-Left Maturity Model

Assess where your team currently sits and identify the concrete next step to improve.

### Level 1: Reactive

**Symptoms:**
- QA tests only after development is complete
- Bugs found in staging or production
- No automated tests or minimal coverage
- Requirements are ambiguous; QA discovers gaps during testing
- "QA phase" is a distinct block at the end of the sprint

**Next step:** Introduce QA into sprint planning. Start with QA asking clarifying questions on each story before development begins. Measure: count of requirement gaps found in planning vs. found in testing.

### Level 2: Gate

**Symptoms:**
- QA reviews PRs but does not participate in design
- Automated tests exist but are written after features are complete
- Definition of Done exists but testing items are often skipped
- QA is a checkpoint, not a collaborator
- Test-after means bugs are found late; rework is common

**Next step:** Introduce Three Amigos for high-risk stories. QA, dev, and product discuss requirements, edge cases, and test approach before development starts. Measure: reduction in bugs found during QA testing (should decrease as upstream quality improves).

### Level 3: Embedded

**Symptoms:** QA participates in sprint planning and story refinement. Developers write unit and integration tests during development. PR review includes testability checks. QA and dev pair on test case design. DoD enforced with automated quality gates.

**Next step:** Introduce test-first practices for bug fixes (every bug fix starts with a failing test). Extend to TDD for pure business logic. Measure: regression rate (should approach zero).

### Level 4: Collaborative

**Symptoms:** Three Amigos are standard for medium/high risk stories. Developers practice TDD for business logic and bug fixes. QA focuses on exploratory testing, strategy, and risk analysis. Quality metrics tracked and reviewed regularly. Cross-functional ownership of quality.

**Next step:** Introduce shift-left to architecture and design reviews. QA reviews system design documents for testability before implementation begins. Measure: defect escape rate (consistently below 5%).

### Level 5: Preventive

**Symptoms:** Quality is built into every stage. Defect escape rate consistently below 3%. QA engineers focus on strategy, coaching, and systemic improvement. Production issues are rare and trigger root cause analysis. The team cannot imagine working without early quality practices.

**Maintaining this level:** Quarterly maturity assessments. New team members onboarded with quality practices from day one. Retrospectives include quality metrics.

### Self-Assessment Worksheet

```
Shift-Left Maturity Assessment
Date: ___________  Team: ___________

For each practice, check the column that best describes your current state:

Practice                          Never  Sometimes  Usually  Always
──────────────────────────────────────────────────────────────────────
QA in sprint planning               [ ]     [ ]       [ ]     [ ]
Three Amigos before dev              [ ]     [ ]       [ ]     [ ]
QA reviews PRs                       [ ]     [ ]       [ ]     [ ]
Tests written during development     [ ]     [ ]       [ ]     [ ]
Bug fixes start with failing test    [ ]     [ ]       [ ]     [ ]
TDD for business logic               [ ]     [ ]       [ ]     [ ]
DoD enforced with quality gates      [ ]     [ ]       [ ]     [ ]
Quality metrics reviewed regularly   [ ]     [ ]       [ ]     [ ]

Scoring: Never=0, Sometimes=1, Usually=2, Always=3
Total: _____ / 24

 0-6:  Level 1 (Reactive)
 7-11: Level 2 (Gate)
12-16: Level 3 (Embedded)
17-20: Level 4 (Collaborative)
21-24: Level 5 (Preventive)
```

---

## Anti-Patterns

### "Shift Left" as QA Layoff

Rebranding "developers write all the tests" as shift-left to justify eliminating QA roles. Shift-left changes WHEN quality happens, not WHO does it. QA engineers bring a testing mindset, risk analysis skills, and exploratory testing capabilities that developers typically do not develop. Removing QA and telling developers to "just test more" results in blind spots, not savings.

### Ceremony Without Substance

Running Three Amigos meetings as a checkbox exercise where nobody asks hard questions. If the session does not produce at least one changed acceptance criterion or one new edge case, it was not a real discussion. Track "gaps found in Three Amigos" as a metric.

### All TDD, All the Time

Forcing TDD on UI prototyping, exploratory spikes, or experimental features where the design is still fluid. TDD works best when the desired behavior is clear. For uncertain domains, spike first, then write tests around the design that emerges. Use the decision guide above.

### Quality Gates Without Team Buy-In

Imposing strict quality gates (coverage thresholds, mandatory QA review) without explaining why they exist or involving the team in setting the thresholds. Gates perceived as imposed slow the team and get circumvented. Gates set collaboratively are defended by the team.

### Testing Everything at the Wrong Level

Writing E2E tests for business logic that should be validated by unit tests. Writing unit tests for user flows that need E2E validation. Shift-left is not just "test earlier" -- it is "test at the right level, as early as possible." A calculation bug needs a unit test, not a browser test.

### Measuring Activity Instead of Outcomes

Tracking "number of Three Amigos sessions held" instead of "defects found in planning vs. found in production." Activities are inputs; outcomes are outputs. Measure whether shift-left practices actually reduce escaped defects and rework.

---

## Done When

- Definition of Done updated to include test criteria (unit, integration, and E2E gates) and enforced in CI
- PR review checklist includes a test coverage check and QA is reviewing at least high-risk PRs
- At least one Three Amigos session run for an upcoming feature, with gaps documented and acceptance criteria updated
- Dev/QA pairing schedule established and first pairing session completed
- Pre-merge quality gates (test pass, coverage not decreased, linting) active in CI and blocking merge

## Related Skills

- **unit-testing** -- Detailed patterns for writing effective unit tests, the primary artifact of shift-left development practices.
- **ai-qa-review** -- Automated PR review for test quality and testability, scaling the QA review patterns described here.
- **test-strategy** -- The overall testing approach that shift-left practices implement at the daily level.
- **qa-project-context** -- Project-specific context that determines which shift-left practices to introduce first.
- **quality-postmortem** -- When shift-left fails and defects escape, postmortems identify which practice would have caught them.
- **qa-project-bootstrap** -- Onboarding new team members includes introducing them to the team's shift-left practices.