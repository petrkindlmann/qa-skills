---
name: test-planning
description: >-
  Build a single sprint or release test plan. Covers feature decomposition into
  testable scenarios, requirements-to-test coverage mapping, effort estimation by
  test type, prioritization matrices (risk × effort), resource allocation, and
  scheduling with buffers. Use when: "sprint test plan," "release test plan,"
  "what to test this sprint," "test estimation," "coverage mapping." Not for:
  multi-quarter strategy — use `test-strategy`. Not for: ranking areas by risk —
  use `risk-based-testing`.
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

The six workflow steps each have a fill-in-the-blank scaffold. The decision prose stays here; the copy-paste templates (decomposition, coverage matrix, estimation worksheet, prioritization matrix, allocation table, schedule) live in `references/workflow-templates.md`.

### Step 1: Feature Analysis and Decomposition

Break each in-scope feature into testable units. A "testable unit" is a specific behavior that can be verified with a clear pass/fail outcome.

See `references/workflow-templates.md` for the decomposition template and a worked "User Profile Edit" example.

### Step 2: Requirements-to-Test Coverage Mapping

Create a traceability matrix that maps every requirement to its test cases. See `references/workflow-templates.md` for the coverage matrix template.

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
| Prompt regression / LLM eval | 30-60 min per case | 30 sec - 2 min (with API cost) | 20 min |

> **AI-assisted authoring note.** When using an agent to author tests (Claude Code, Codex, Cursor), reduce *Write Time* by ~40-60% but add a corresponding *Review Time* line per case. The "AI Productivity Paradox" (Bolton, 2026): the apparent speed-up evaporates when the agent generates plausible-but-broken tests that pass review casually but fail in CI. Plan for review at least as carefully as authoring. See `ai-test-generation` Step 7 for the review checklist and `ai-qa-review` for AI-generated test smells.

> **Test smells review.** CTAL-AT v2.0 (ISTQB, May 2026) formalizes "Test Smells" as a planning concern. Add a recurring 30-min "test-smells review" to each sprint plan — reviewers walk a sample of recent tests against the smell taxonomy in `ai-qa-review`. Cheap, finds maintenance debt before it compounds.

Use the sprint estimation worksheet in `references/workflow-templates.md` to roll per-case estimates up to a capacity-utilization figure (target: 70-80%).

### Step 4: Prioritization Matrix (Risk x Effort)

When the estimated effort exceeds available capacity (it usually does), use the risk x effort matrix to decide what to cut. See `references/workflow-templates.md` for the full matrix grid.

For each test case, plot it on the matrix using the risk score from `risk-based-testing` and the effort estimate from Step 3. Work through the matrix in priority order (DO FIRST → DO SECOND → DO THIRD → DEFER → SKIP) until capacity is consumed.

### Step 5: Resource Allocation

Assign testing work based on skill match and availability.

**Allocation principles:**
- Automated test writing goes to SDETs or developers with framework experience
- Exploratory testing goes to the person who understands the feature best (often the developer or product manager, not just QA)
- New feature testing benefits from fresh eyes -- assign someone who did not build it
- Critical path testing should not have a single point of failure -- two people should be able to cover it

See `references/workflow-templates.md` for the allocation table format.

### Step 6: Schedule with Buffers

Map testing activities to the sprint timeline. Testing should not be back-loaded to the last two days. See `references/workflow-templates.md` for the 2-week sprint schedule template.

**Key scheduling rules:**
- Testing starts as soon as features are code-complete, not at sprint end
- Environment setup and test data preparation happen on Day 1, not Day 3
- Bug verification is continuous, not batched
- The last day is for confirmation, not for starting new testing

---

## Templates

Full copy-paste plan documents live in `references/plan-documents.md`:

- **Sprint Test Plan (1-Page)** — scope, coverage summary, effort budget, entry/exit criteria, plan risks. Keep a sprint plan to one page.
- **Release Test Plan** — aggregates sprint plans and adds release-specific concerns (full regression, cross-browser, perf benchmark, security scan, smoke test) plus go/no-go criteria. For the full go/no-go checklist, see `release-readiness`.
- **Feature Coverage Matrix** — per-feature scenario list with priority, test type, location, and status.
- **Test Estimation Worksheet** — new-test development, existing-suite execution, manual testing, and a summary delta vs. available capacity.

---

## Tracking Progress During the Sprint

A test plan is useless if nobody checks it after Day 1. Track progress daily, and feed the results back into future planning at sprint end.

- **Daily test status** — completed, blocked, bugs found, tomorrow's plan, coverage percentage, and buffer consumed. See the format in `references/tracking-formats.md`.
- **Sprint retrospective inputs** — estimation accuracy, coverage delta, bug counts by severity, and lessons. See the format in `references/tracking-formats.md`; feed these data points into the next sprint's estimates.

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

## Reference Files (in `references/`)

- **workflow-templates.md** — Fill-in scaffolds for the six workflow steps: decomposition template + example, coverage matrix, sprint estimation worksheet, risk×effort matrix grid, allocation table, and 2-week schedule.
- **plan-documents.md** — Full copy-paste documents: 1-page sprint test plan, release test plan, feature coverage matrix, and estimation worksheet.
- **tracking-formats.md** — Daily test status format and sprint retrospective inputs format.

## Related Skills

- **test-strategy** -- The broader QA strategy that test plans execute against; strategy defines the approach, plans implement it per sprint.
- **risk-based-testing** -- Deep methodology for risk assessment that feeds into the prioritization matrix in Step 4.
- **release-readiness** -- The go/no-go checklist that the release test plan's exit criteria feed into.
- **qa-metrics** -- Metrics like defect escape rate and estimation accuracy that improve future test plans.
- **exploratory-testing** -- Structured exploratory sessions referenced in the manual testing sections of the plan.
- **qa-project-context** -- The project context file that provides baseline answers to discovery questions.
