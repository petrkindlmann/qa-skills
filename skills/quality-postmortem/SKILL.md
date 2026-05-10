---
name: quality-postmortem
description: >-
  Analyze escaped defects and test suite health through blameless postmortems.
  Covers bug pattern analysis, test suite health reviews, 5 Whys root cause analysis,
  process improvement cycles, and postmortem meeting templates with action item tracking.
  Use when: "QA retro," "test review," "escaped bugs," "postmortem," "quality incident,"
  "improvement," "defect analysis."
  Related: qa-metrics, test-reliability, test-strategy.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: process
---

<objective>
Analyze escaped defects, test suite health, and quality process gaps through structured, blameless postmortems. Every postmortem produces 1-3 concrete, tracked action items -- not vague commitments to "be more careful." The goal is systemic improvement, not individual blame.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains quality goals, risk areas, and test suite details that provide essential context for any postmortem analysis.
</objective>

---

## Discovery Questions

1. **Do you have a regular retro cadence?** Per-sprint, monthly, or only after incidents? Regular cadence catches slow-burn problems. Incident-only cadence misses patterns until they explode.

2. **What triggered this postmortem?** A production incident? A pattern of escaped bugs? A feeling that the test suite is not catching enough? Test suite degradation? The trigger determines the focus.

3. **What data is available?** Bug tracker with severity and discovery phase? CI history with pass rates? Flaky test reports? Coverage trends? Without data, postmortems devolve into opinion sessions.

4. **What happened with previous postmortem action items?** Were they completed? Tracked? Forgotten? If past action items are abandoned, the team has learned that postmortems do not matter. Fix the follow-through before running another postmortem.

5. **Who should participate?** Engineers who worked on the affected area. QA who tested (or did not test) the affected area. Product owner if the impact was user-facing. Engineering manager if systemic changes are needed. Keep the group to 4-8 people.

6. **What are the current test suite health concerns?** Rising flakiness? Slow execution? Coverage gaps in critical areas? Stale quarantine? Health reviews are proactive postmortems -- they prevent incidents instead of reacting to them.

---

## Core Principles

### 1. Blameless Means Systemic

Blameless does not mean "no one is accountable." It means the analysis focuses on systems, processes, and tools rather than individual performance. "Why did the system allow this defect to escape?" is a blameless question. "Why did the developer not write a test?" is a blame question that stops the analysis too early. The developer did not write a test because: the test framework was hard to use, the PR checklist did not require it, there was no pairing to transfer knowledge, or time pressure made it feel optional. Those are systemic issues with systemic fixes.

### 2. Focus on Patterns, Not Incidents

A single escaped bug is an anecdote. Three escaped bugs in the same feature area over two months is a pattern. Postmortems should aggregate incidents to find recurring themes: same root cause, same team, same test gap, same phase of the pipeline. Patterns are actionable. Individual incidents are just fire-fighting.

### 3. Every Postmortem = 1-3 Concrete Action Items

An action item is concrete when it has: a specific deliverable ("add integration tests for the coupon API"), an owner ("assigned to Alex"), a deadline ("by end of sprint 14"), and a verification method ("PR merged, tests passing in CI"). "Improve testing" is not an action item. "Write 5 integration tests for the payment service edge cases by March 30" is.

### 4. Track to Completion

Action items that are not tracked are not completed. Use the team's existing work tracker (Jira, Linear, GitHub Issues). Tag them (`postmortem-action` or equivalent). Review completion status at the start of the next postmortem. If items are consistently abandoned, either the items are too large (break them down) or they are not prioritized (make them sprint commitments).

### 5. Measure Improvement

After implementing action items, measure whether the problem recurred. If the postmortem identified a gap in payment testing and the action was to add integration tests, track: did another payment bug escape? If yes, the action was insufficient. If no, the postmortem worked. Without measurement, postmortems are rituals, not tools.

Two metrics together — not one alone:
- **Defect escape rate** (did similar bugs reappear?)
- **Action-item-closure rate** (what fraction of action items shipped within their committed window?)

A high closure rate with rising escape rate means the team is doing the work but doing the wrong work. A low closure rate means the postmortems are theater. Modern incident response platforms (incident.io, Rootly, FireHydrant) emit closure-rate as a built-in metric — use what's there before building dashboards.

### 6. AI-Assisted RCA Drafts the Timeline; Humans Own the Judgment

If your team uses AI SRE tooling (Rootly AI SRE, incident.io's AI features), let it draft the incident timeline and propose candidate root causes from logs/traces. Then a human runs the 5 Whys, picks the real root cause, and writes the action items. AI is good at correlation across noisy data; it is bad at deciding what mattered. Treat AI output as a starting deck, not the conclusion.

---

## Bug Pattern Analysis

### Categorizing Escaped Defects

When a bug reaches production, classify it along three dimensions to identify prevention opportunities.

#### Dimension 1: Root Cause Category

| Category | Description | Example |
|----------|-------------|---------|
| **Logic error** | Business logic incorrect or incomplete | Discount not applied for edge case currency |
| **Integration failure** | Two components do not communicate correctly | API returns different format than frontend expects |
| **Data issue** | Unexpected data shape, null values, encoding | User with emoji in name breaks CSV export |
| **Race condition** | Timing-dependent behavior | Two concurrent checkouts oversell last item |
| **Configuration** | Environment-specific settings wrong | Feature flag enabled in staging, disabled in prod |
| **Regression** | Previously working behavior broken | Refactor removed null check, old bug returns |
| **Missing requirement** | Behavior not specified, gap in product spec | No error handling for expired OAuth tokens |
| **Performance** | Functional but too slow under load | Search timeout with 100K+ records |

#### Dimension 2: Which Test Level Should Have Caught It

| Level | What it catches | If it escaped this level |
|-------|----------------|------------------------|
| **Unit** | Logic errors, edge cases, boundary conditions | Tests exist but missing edge case? Or no tests at all? |
| **Integration** | API contracts, data flow, service interactions | Integration tests exist? Do they cover error responses? |
| **E2E** | User journey failures, UI state management | Is this critical path covered? Was the specific scenario tested? |
| **Manual/Exploratory** | Visual issues, usability problems, unusual workflows | Was exploratory testing performed? Was the area in scope? |
| **Monitoring** | Performance degradation, error rate spikes | Are alerts configured? Are thresholds correct? |

#### Dimension 3: Prevention Opportunity

| Opportunity | Action | Example |
|-------------|--------|---------|
| **Add test** | Write a test at the appropriate level | Add unit test for currency rounding edge case |
| **Improve existing test** | Existing test was too narrow | Extend checkout E2E to include coupon + international currency |
| **Add quality gate** | CI check would have caught it | Add schema validation for API responses in CI |
| **Improve requirements** | Spec was ambiguous or incomplete | Add acceptance criteria for error states to story template |
| **Add monitoring** | Detect sooner even if not prevented | Add alert for error rate > 1% on payment endpoint |
| **Training/Process** | Knowledge gap or process gap | Run a session on defensive coding for nullable fields |

### Bug Pattern Analysis Template

```
Escaped Bug Analysis: [BUG-ID] [Title]
═══════════════════════════════════════

Timeline:
  Introduced:    [commit/PR/date]
  Released:      [release version/date]
  Detected:      [date, by whom — user report, monitoring, internal]
  Resolved:      [date]
  Time to detect: [hours/days]
  Time to fix:    [hours]

Classification:
  Root cause:         [logic error / integration / data / race condition / ...]
  Should-catch level: [unit / integration / E2E / monitoring]
  Prevention:         [add test / improve test / add gate / improve spec / ...]

Existing Coverage:
  Were there tests for this area?    [yes / no / partial]
  If yes, why did they miss it?      [edge case not covered / wrong assertion / ...]
  If no, why not?                    [area not identified as risky / time pressure / ...]

Impact:
  Users affected:    [count or estimate]
  Revenue impact:    [none / minor / significant / critical]
  Brand impact:      [none / minor / significant / critical]

Action Items:
  1. [Action] — Owner: [name] — Due: [date]
  2. [Action] — Owner: [name] — Due: [date]
```

### Aggregating Patterns Over Time

After analyzing 10+ escaped bugs, look for patterns:

```
Escaped Bug Summary: [Q1 2026]
═══════════════════════════════

Total escaped bugs: 14

By root cause:
  Logic error:          5  (36%)  ← unit tests needed
  Integration failure:  4  (29%)  ← API contract tests needed
  Data issue:           3  (21%)  ← input validation gaps
  Configuration:        2  (14%)  ← env parity issues

By area:
  Checkout:             6  (43%)  ← highest risk, needs investment
  User management:      4  (29%)
  Reporting:            2  (14%)
  Settings:             2  (14%)

By should-catch level:
  Unit:                 5  (36%)  ← developers not testing edge cases
  Integration:          4  (29%)  ← missing integration test layer
  E2E:                  3  (21%)
  Monitoring:           2  (14%)

Top action themes:
  1. Add integration tests for checkout API (covers 4 of 14 bugs)
  2. Mandate unit tests for all calculation/validation logic (covers 5 of 14)
  3. Add currency and encoding edge cases to test data fixtures (covers 3 of 14)
```

This aggregation reveals where investment has the highest return: fixing one systemic issue (integration tests for checkout) would have prevented 29% of all escaped bugs.

---

## Test Suite Health Review

A proactive postmortem for the test suite itself. Conduct quarterly or when symptoms appear.

### Flaky Test Trends

```
Flaky Test Trend Review
═══════════════════════

Current flaky rate: _____ % (target: <2%)
Trend (last 3 months):
  Month 1: _____ %
  Month 2: _____ %
  Month 3: _____ %
Direction: [ ] Improving  [ ] Stable  [ ] Worsening

Top 5 flakiest tests (by failure count):
  1. _____________________ — _____ failures — root cause: _____
  2. _____________________ — _____ failures — root cause: _____
  3. _____________________ — _____ failures — root cause: _____
  4. _____________________ — _____ failures — root cause: _____
  5. _____________________ — _____ failures — root cause: _____

Quarantine:
  Tests in quarantine:    _____ count
  Oldest quarantine:      _____ days (target: <14)
  Quarantine resolved this month: _____ count
```

### Execution Time Trend

Track current full suite duration, 3-month trend, and the 5 slowest tests. If duration is increasing, check for: tests that can move to nightly, sequential stages that can parallelize, slow test data setup (use API instead of UI), large test files that need splitting for better shard distribution.

### Coverage Gap Review

Track overall coverage (lines/branches), critical paths with insufficient coverage (payments, auth, data export should be 90%+), recently changed code without test updates (cross-reference `git log --since="30 days"` with coverage report), and features shipped without E2E coverage.

### Disabled/Skipped Test Inventory

Audit all skipped/disabled tests by age and reason. Tests skipped < 1 week are likely in progress. Tests skipped 1-4 weeks need a ticket and timeline. Tests skipped 1-3 months are overdue -- fix or delete. Tests skipped > 3 months should be deleted -- they will never be fixed. For each: fix and unskip, delete (obsolete), or move to quarantine with ticket link.

---

## Process Improvement Cycles

### The Improvement Sprint

Dedicate a fixed portion of each sprint (10-15% of capacity) to quality improvement, drawn from postmortem action items and health review findings.

**Structure:**

```
1. IDENTIFY    — Top 3 pain points from latest retro/postmortem
2. ROOT CAUSE  — 5 Whys analysis for the #1 pain point
3. PROPOSE     — Solution with effort estimate (S/M/L)
4. IMPLEMENT   — One improvement per sprint (start small)
5. MEASURE     — Did the metric improve? By how much?
6. ITERATE     — If not improved, dig deeper. If improved, tackle #2.
```

### 5 Whys Root Cause Analysis

The 5 Whys technique peels back surface symptoms to reveal systemic causes. The key discipline: keep asking "why" until you reach a process, system, or structural cause -- not an individual's action.

**Example: Payment bug escaped to production**

```
Problem: Users were charged twice for a single purchase.

Why 1: The payment API was called twice on form submit.
Why 2: The submit button was not disabled after the first click.
Why 3: The frontend developer did not implement button disabling.
Why 4: The acceptance criteria did not mention double-submit prevention.
Why 5: The story refinement process does not include edge case review
       for payment-related stories.

Root cause: Process gap — payment stories are not reviewed for transaction
safety edge cases before development begins.

Action: Add a "Payment Safety Checklist" to the story template for any
story touching payment flows. Checklist includes: idempotency,
double-submit prevention, partial failure handling, timeout behavior.
Owner: [Product Manager] — Due: [Next sprint]
```

**5 Whys guidelines:**
- Stop when you reach something the team can change (process, tool, structure). Asking "why is the budget limited?" goes too far.
- The chain may branch -- one symptom may have multiple contributing causes. Follow the most impactful branch.
- Verify each "why" with evidence, not assumption. "The developer did not write tests" -- is that true? Check the PR. Maybe tests existed but were insufficient.
- If you reach "human error" as a root cause, you have not gone far enough. Humans make errors. The system should make errors difficult or detectable.

### Proposing Solutions with Effort Estimates

For each root cause, propose 1-3 solutions at different effort levels:

```
Root Cause: Payment stories not reviewed for edge cases

Solution A (Small — 1 day):
  Add payment safety checklist to story template.
  + Quick to implement, low maintenance
  − Relies on manual adherence, may be skipped under pressure

Solution B (Medium — 1 sprint):
  Add payment safety checklist + automated linting rule that
  flags PRs touching payment code without corresponding tests.
  + Automated enforcement, catches gaps in CI
  − Requires CI config change, may have false positives

Solution C (Large — 2 sprints):
  Solution B + add integration test suite for all payment
  edge cases (idempotency, timeout, partial failure).
  + Comprehensive protection, catches regressions automatically
  − Significant effort, needs test data and mock infrastructure

Recommendation: Start with A immediately, implement B this sprint,
plan C for next quarter as strategic work.
```

---

## Postmortem Template for Quality Incidents

Use this template when a significant quality incident occurs (P0/P1 production bug, data loss, security issue, extended outage caused by code change).

```markdown
# Quality Incident Postmortem: [INCIDENT-ID]

## Summary
[One paragraph: what happened, who was affected, how it was resolved]

## Severity and Impact
- **Severity:** [P0 / P1 / P2]
- **Users affected:** [count or percentage]
- **Duration:** [from detection to resolution]
- **Business impact:** [revenue, reputation, compliance]

## Timeline (all times in UTC)
| Time | Event |
|------|-------|
| HH:MM | [Code change deployed / feature flag enabled] |
| HH:MM | [First user report / monitoring alert] |
| HH:MM | [Incident acknowledged by on-call] |
| HH:MM | [Root cause identified] |
| HH:MM | [Fix deployed / rollback completed] |
| HH:MM | [Incident resolved, monitoring confirms recovery] |

## Root Cause
[Technical description of what went wrong]

## 5 Whys
1. Why did [symptom]? Because [cause 1].
2. Why [cause 1]? Because [cause 2].
3. Why [cause 2]? Because [cause 3].
4. Why [cause 3]? Because [cause 4].
5. Why [cause 4]? Because [root cause].

## What Tests Existed
- [List relevant existing tests and why they did not catch this]

## What Tests Were Missing
- [Specific test scenarios that would have prevented this]

## Detection
- **How was it detected?** [User report / monitoring / internal testing]
- **Could it have been detected earlier?** [Yes/No — how?]
- **Time from deploy to detection:** [duration]

## Prevention Measures

### Immediate (this sprint)
| Action | Owner | Due | Status |
|--------|-------|-----|--------|
| [Write regression test for this specific scenario] | [name] | [date] | [ ] |
| [Add monitoring alert for this error pattern] | [name] | [date] | [ ] |

### Short-term (next 2 sprints)
| Action | Owner | Due | Status |
|--------|-------|-----|--------|
| [Add integration tests for related edge cases] | [name] | [date] | [ ] |
| [Update deployment checklist] | [name] | [date] | [ ] |

### Long-term (this quarter)
| Action | Owner | Due | Status |
|--------|-------|-----|--------|
| [Improve test coverage for entire area] | [name] | [date] | [ ] |
| [Process change to prevent similar gaps] | [name] | [date] | [ ] |

## Lessons Learned
- [What went well in detection and response]
- [What could have been better]
- [What systemic issue does this reveal]
```

---

## Retro Meeting Template

Use this format for regular quality retrospectives (as opposed to incident-specific postmortems). Conduct per-sprint or monthly.

### Agenda (30-60 minutes)

```
Quality Retro: Sprint [N] / [Month Year]
═════════════════════════════════════════

1. Previous Action Items Review (5 min)
   - Review status of action items from last retro
   - Mark completed, carry forward incomplete, escalate blocked

2. Data Review (10 min)
   Present metrics since last retro:
   - Escaped bug count and classification
   - Flaky test rate trend
   - CI pass rate trend
   - Coverage change
   - Test suite duration change
   - Quarantine inventory

3. What Went Well (5 min)
   - Quality wins: bugs caught early, smooth releases, good test coverage
   - Process improvements that paid off

4. What Needs Improvement (10 min)
   - Quality pain points: escaped bugs, flaky tests, slow pipeline, gaps
   - Process friction: review bottlenecks, unclear ownership, tooling issues

5. Root Cause Discussion (10-15 min)
   - Pick the top 1-2 issues from "Needs Improvement"
   - Run 5 Whys or group brainstorming
   - Identify systemic causes

6. Action Items (5-10 min)
   - Define 1-3 specific, assigned, time-bound action items
   - Each item: what, who, when, how to verify
   - Add to team's work tracker with "retro-action" tag

7. Close (2 min)
   - Confirm next retro date
   - Thank participants
```

### Facilitator Notes

- **Prepare data in advance.** Do not spend meeting time pulling up dashboards. Have metrics ready in a shared doc.
- **Timebox strictly.** Quality retros expand to fill available time. 30 minutes is sufficient for a sprint retro. 60 minutes for monthly or incident-triggered.
- **Rotate facilitation.** Different facilitators bring different perspectives. Rotate among QA engineers, developers, and tech leads.
- **Follow up within 24 hours.** Send a summary with action items to the team channel. Link to tracker tickets. This signals that the retro was real work, not a talking exercise.
- **Review action items at the START of the next retro.** This is the accountability mechanism. If items are consistently incomplete, reduce the number of items or reduce their scope.

---

## Anti-Patterns

### Blame-Driven Postmortems

Focusing on who made the mistake rather than what system allowed the mistake to reach production. Blame creates fear. Fear creates hiding. Hiding creates bigger incidents. When the question is "who wrote this bug?" people learn to avoid visibility. When the question is "what process gap allowed this?" people learn to improve the process.

### Postmortems Without Action Items

A cathartic discussion that produces understanding but no change. If the meeting ends without specific, assigned action items, the same problem will recur. Worse, the team learns that postmortems are therapy sessions, not improvement tools.

### Action Items Without Follow-Through

Generating action items that go into a backlog and are never prioritized. This is worse than no action items because it creates the illusion of improvement. If postmortem actions are not completed within 2 sprints, escalate. If they are consistently deprioritized, either the items are too ambitious or the team does not value them — both need addressing.

Action items die for predictable reasons. Audit your closure rate against this checklist before blaming "we forgot":

- **No owner.** Items assigned to a team rather than a person become nobody's job.
- **No due date.** "Soon" is not a date. A specific date is the difference between a commitment and a wish.
- **Scope too big.** "Refactor the test framework" cannot land in a sprint. Break it into items that each fit a single PR.
- **No review at the start of the next retro.** Without a forced check-in, items vanish silently. Open the next retro with a closed-loop review of the previous action items.
- **No metric attached.** If completing the item doesn't move a number you can name, you can't tell whether it worked.

Counter-pattern: open every retro with a 5-minute "previous action items" review. Mark each as Done / In Progress (with current ETA) / Dropped (with reason). Items dropped silently teach the team that retros are theater.

### Postmortems Only After Incidents

Waiting for a production fire to conduct a quality review. Proactive health reviews (test suite health, coverage trends, flaky test inventory) prevent incidents. Conduct proactive reviews monthly. Reactive postmortems for incidents only supplements the proactive cadence.

### Root Cause Analysis That Stops Too Early

"The developer did not write a test" is not a root cause. It is a symptom. Why did they not write a test? Was the framework hard to use? Was there no time? Was there no requirement? Was there no pairing or review? Stopping at the individual level prevents systemic improvement.

### Vague Action Items

"Improve test coverage" and "be more careful with deployments" are not action items. They cannot be tracked, measured, or verified. Compare: "Add integration tests for payment webhook handling, covering success, failure, and timeout scenarios. Owner: Alex. Due: Sprint 14. Verification: PR merged with 3 new integration tests passing in CI."

### Data-Free Retros

Running quality retrospectives based on feelings and opinions rather than data. "It feels like we have more bugs lately" might be true or might be recency bias. Check the data: is the escaped bug count actually increasing? Where are the bugs concentrated? Without data, the team solves the loudest problem, not the most important one.

---

## Done When

- Escaped defect timeline reconstructed (introduced, released, detected, resolved) with supporting evidence from commit history and bug tracker
- 5 Whys root cause analysis completed and stopped at a systemic cause, not at "developer didn't write a test"
- Test gap identified and mapped to a specific coverage hole (missing test type, missing scenario, or missing area)
- Action items assigned with named owners and due dates, added to the team's work tracker with a postmortem tag
- Findings shared with the team in a written summary — not siloed in QA or lost in a private document
- Action-item-closure-rate tracked alongside escaped-defect rate (both metrics, not one) — modern incident platforms (incident.io, Rootly, FireHydrant) emit closure rate natively
- If AI SRE tooling is in use, AI-drafted timeline and candidate root causes are documented as input but the human-authored 5 Whys + action items are the conclusion

## Related Skills

- **qa-metrics** -- Provides the data (defect escape rate, flakiness rate, coverage trends) that postmortems analyze and act upon.
- **test-reliability** -- Flaky test classification and quarantine management, which feeds into test suite health reviews.
- **test-strategy** -- When postmortems reveal systemic gaps, the test strategy is the document that gets updated.
- **shift-left-testing** -- Many postmortem action items are shift-left practices: earlier testing, better requirements, dev/QA pairing.
- **release-readiness** -- Quality gates and release criteria should be updated based on postmortem findings.
