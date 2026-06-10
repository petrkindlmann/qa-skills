---
name: qa-metrics
description: >-
  Define, track, and act on QA metrics: test coverage percentage, flakiness rate, defect
  escape rate, MTTR, test execution time trends, automation ROI, quality gates, and SLAs
  for test suites. Includes metric formulas, realistic targets by company stage, and the
  action to take when each metric goes red.
  Use when: "QA metrics," "test metrics," "quality KPIs," "test health," "flakiness rate,"
  "defect escape rate."
  Not for: building the dashboard UI (Allure/Grafana) — use qa-dashboard; measuring coverage
  gaps and mutation score — use coverage-analysis.
  Related: qa-dashboard, coverage-analysis, ci-cd-integration, release-readiness, quality-postmortem.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: metrics
---

<objective>
A suite with 4,000 tests where 800 are disabled and 200 are flaky looks healthy on a slide and lies in production. This skill defines the metrics that actually change behavior — each one with a formula, a target, an owner, and a concrete action when it goes red — so the dashboard becomes a feedback loop instead of decoration.
</objective>

## Quick Route

| Your situation | Metric to reach for | Section / reference |
|---|---|---|
| No metrics yet, where to start | code coverage, flakiness, defect escape | Core Principles + `references/rollout.md` |
| Bugs escaping despite high coverage | defect escape rate + mutation score | Coverage Metrics, Defect Metrics |
| Tests flaky, devs ignore CI | flakiness rate, pass rate | Test Health Metrics |
| Slow pipeline, stale feedback | suite duration, parallelism efficiency | Execution Metrics |
| Justifying automation spend | automation ROI | Process Metrics |
| Picking targets for our stage | company-stage table | Setting Realistic Targets |
| Leadership wants delivery + quality | DORA + escape rate | Engineering Quality Metrics (DORA) |
| Building the dashboard view | (go to `qa-dashboard`) | — |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it as the foundation and skip anything already answered there. Then:

### Current State
- What metrics are you tracking today? (Even "we glance at CI pass rate sometimes" counts.)
- Where does your test data live? (CI system, coverage reports, bug tracker, spreadsheets, nowhere)
- Do you have any dashboards already? Who looks at them, and how often?
- What tooling runs your CI pipeline? (GitHub Actions, GitLab CI, Jenkins, CircleCI)

### Stakeholders
- Who are the stakeholders for quality metrics? (engineering, product, leadership, customers)
- What does each care about? Engineers want flakiness; leadership wants escape trends; product wants release confidence.
- Who will own each metric? If nobody owns it, nobody acts on it.

### Quality Problems
- What quality problems need visibility? (regressions, slow pipelines, flaky tests, coverage gaps, incidents)
- What broke in production recently? Would a metric have caught it earlier?
- What decisions are you making without data today?

### Goals
- What does "healthy test suite" mean for your team?
- Any compliance or contractual quality requirements? (SLAs, SOC2, ISO)
- Quick wins vs. full observability — what is the appetite for metrics infrastructure?

---

## Core Principles

### 1. Metrics Should Drive Action, Not Just Dashboards
A metric without an action plan is decoration. For every metric, define: what threshold triggers action, what the action is, and who takes it. If flakiness crosses 5%, the on-call engineer investigates the top 3 flaky tests that week. No ambiguity.

### 2. Leading vs Lagging — Track Both, Act on Leading
Defect escape rate and MTTR are **lagging**: you learn after users were hurt. Flakiness, coverage delta, and skipped-test count are **leading**: they predict escapes before they happen. Lagging metrics tell leadership whether quality is moving; leading metrics are where engineers spend their daily attention because they can still change the outcome.

### 3. Trend Over Snapshot
A single number is nearly useless. Coverage at 72% means nothing; coverage trending 68% → 72% over three sprints tells a story. Display metrics as time series and evaluate direction, not absolute position.

### 4. Every Metric Needs a Target and an Owner
A target makes a metric actionable; an owner makes it accountable. Without both it becomes background noise. Set targets from your team's maturity (see the targets table) and assign owners who can actually move the number.

### 5. Vanity Metrics Waste Everyone's Time
"We have 4,000 tests" sounds impressive until 800 are disabled and 200 flaky. Count what matters: tests that run, pass reliably, and catch real bugs. The ultimate metric is whether users hit bugs that hurt the business — work backward from there. Defect escape rate connects directly to user experience; lines of test code connects to nothing.

---

## Essential QA Metrics

Each metric: definition, formula, recommended target, why it matters, and the action when it goes red.

### Test Coverage Metrics
*How much of our system is verified by automated tests?* (leading)

#### Code Coverage Percentage
The percentage of code exercised by automated tests (line, branch, or statement level).

```
Line coverage   = (lines executed by tests / total executable lines) × 100
Branch coverage = (branches executed by tests / total branches) × 100
```

**Targets:** Line: 70-85% for app code. Branch: 60-75%. Critical paths (payments, auth): 90%+.

**Why it matters:** Coverage identifies blind spots — code never exercised by tests is where bugs hide undetected.

**When it goes red:** Coverage drops on PR: block merge or flag. Low in critical module: create targeted tasks. Plateaus: check for dead code vs. genuinely untested logic.

**Warning:** Coverage measures execution, not assertion quality. Pair it with mutation testing (StrykerJS v9.6+, mutmut) for a truer picture. Stryker's Vitest runner tracks recent Vitest releases — check the runner's peer-dependency before pinning a Vitest version. Use `incremental: true` in monorepo CI to keep mutation runs cheap. For deep coverage/mutation analysis, see `coverage-analysis`.

#### Requirement Coverage Percentage
```
Requirement coverage = (features with at least one test / total features) × 100
```
**Targets:** 100% for P0/P1 features, 80%+ for P2.

**Why it matters:** A feature can have zero tests even if surrounding code is well-covered. Use test tags (`@feature:checkout`, `@story:PROJ-1234`) for traceability.

#### Risk Coverage Percentage
```
Risk coverage = (high-risk areas with automated tests / total high-risk areas) × 100
```
**Targets:** 95%+ for high-risk areas. Maintain a risk register and cross-reference against coverage data per module.

---

### Test Health Metrics
*Can we trust our test suite?* (leading)

#### Flakiness Rate
The percentage of test runs producing inconsistent results without code changes.

```
Flakiness rate = (test runs with flaky results / total test runs) × 100
```

**Targets:** Acceptable: <2%. Warning: 2-5%. Critical: >5%.

**Why it matters:** Flaky tests erode trust. Once developers think "probably just flaky," they stop paying attention to results at all. Flakiness is the single biggest threat to a suite's credibility.

**When it goes red:** Quarantine flaky tests immediately. Investigate the top 3 weekly — most flakiness comes from a small number of tests. Common causes: timing/race conditions, shared state, external dependencies, order-dependent tests. Tests flaky for 30+ days should be deleted or rewritten.

**Detection:** Buildkite Test Analytics, **Datadog Test Optimization** (formerly Datadog CI Visibility — ships Flaky Test Management, Auto Test Retries, Early Flake Detection, Failed Test Replay, and Test Impact Analysis; its Bits AI Dev Agent can auto-open PRs to fix flaky tests), Trunk Flaky Tests, or a script comparing results across runs on the same commit.

#### Pass Rate Trend (7-Day Rolling)
```
Pass rate = (green CI runs / total CI runs) × 100  [rolling 7 days]
```
**Targets:** Healthy: >95%. Warning: 90-95%. Broken: <90%.

The 7-day rolling average smooths daily noise and reveals the real trend. A consistently red build means developers ignore the pipeline.

#### Disabled and Skipped Test Count
Total tests marked `skip`, `disabled`, `pending`, `xit`, `xdescribe` or equivalent.

**Target:** Trend toward zero. Skipped tests older than 2 sprints: fix or delete. Add a CI step that fails if skipped count exceeds 5% of total tests.

**Why it matters:** Skipped tests are invisible coverage gaps. A suite with 500 passing and 150 skipped tests has a `150 / (500 + 150) = 23%` gap that dashboards hide.

#### Test Suite Duration
Wall-clock time from suite start to completion.

**Targets:** Unit: <5 min. Integration: <10 min. E2E: <15 min. Full pipeline: <30 min (the stage targets are the real budget; <30 min is the sum, not a separate looser bar).

**Why it matters:** Slow tests break the feedback loop. 45-minute results mean developers have already context-switched.

**When it goes red:** Profile slowest tests (10% often account for 50% of runtime). Increase parallelism. Move slow tests post-merge. Check for unnecessary setup/teardown. Plot duration over time and alert on step changes (>20% increase in a week).

---

### Defect Metrics
*Are we catching bugs before users do?* (lagging)

#### Defect Escape Rate
The percentage of defects found in production relative to all defects found.

```
Defect escape rate = (defects found in production / total defects found) × 100
```

**Targets:** Excellent: <5%. Acceptable: 5-10%. Needs work: 10-20%. Critical: >20%.

**Worked example:** A release surfaces 15 total defects, 2 of them in production → `2 / 15 × 100 = 13.3%` escape rate, which lands in "needs work."

**Why it matters:** The single most important quality metric. It directly measures whether testing catches bugs before users do.

**When it goes red:** Classify escaped defects by layer (unit? integration? E2E? review?). Write a retrospective test for each. Identify if escapes cluster in specific areas — those need targeted investment.

**How to track:** Tag production bugs (`escaped-defect` label). Count escaped vs. pre-release defects at sprint retros.

#### Mean Time To Resolution (MTTR)
```
MTTR = sum(resolution_time for each defect) / number of defects
```
**Targets:** P0: <4 hours. P1: <24 hours. P2: <1 sprint. P3: <2 sprints.

High MTTR often signals process bottlenecks (slow review, unclear ownership, complex deploys) rather than technical difficulty. Break into phases (triage, assign, fix, deploy) to find the bottleneck. (This is your QA *defect* resolution time — distinct from the DORA recovery metric below.)

#### Defect Density
```
Defect density = defects found / KLOC  (or per feature shipped)
```
**Targets:** Track your own baseline; industry benchmarks are 1-10 defects per KLOC. If one module has 5x the density of others, it needs refactoring or better coverage.

#### Severity Distribution
Healthy: P0 <5%, P1 10-15%, P2 40-50%, P3 30-40%. Visualize as a stacked bar over time. Heavy P0/P1 concentration means testing misses critical issues.

---

### Execution Metrics
*Is our CI pipeline fast, reliable, and cost-effective?* (leading)

#### CI Pipeline Duration
Total wall-clock time by stage. **Targets:** Lint: <2 min. Unit: <5 min. Integration: <10 min. E2E: <15 min. Full: <30 min (= sum of stages above, reconciled with the suite-duration budget).

**When it goes red:** Optimize the slowest stage first. Split fast checks (every push) from slow checks (PR merge). Profile setup time vs. execution time. Parallelize sequential stages.

#### CI Cost Per Run
```
CI cost per run = (compute minutes × cost per minute) + fixed costs
```
50 builds/day at $0.50 each = $750/month. Optimize by caching dependencies, using spot instances, right-sizing runners, and skipping unchanged suites.

#### Parallelism Efficiency
```
Parallelism efficiency = (total sequential time / (wall-clock time × workers)) × 100
```
**Target:** >80%. Example: 4 workers finishing in 3, 3, 3, and 12 minutes → wall-clock 12, sequential total 21, so efficiency = `21 / (12 × 4) = 44%` — well under target because three workers idled 9 minutes each. Fix by splitting by estimated duration (not file count), breaking up slow test files, and using dynamic splitting (Playwright sharding, Jest `--shard`).

---

### Process Metrics
*Is our QA process improving over time?* (mix of leading and lagging)

#### Automation Rate
```
Automation rate = (automated test cases / total test cases) × 100
```
**Targets:** Regression: 90%+. Smoke: 100%. Exploratory: 0% (by definition). Overall: 70-85%.

Manual testing does not scale. Automation compounds — once written, a test runs thousands of times. Automate the most frequently executed scenarios first.

#### Test Creation Velocity
New automated tests added per sprint (net new, excluding refactors).

**Target:** At least 3-5 automated tests per user story shipped. A sprint with 20 features and 0 new tests signals a growing coverage gap.

#### Automation ROI
```
Manual cost     = (manual time per cycle × cycles per year) × hourly rate
Automation cost = (write time + annual maintenance) × hourly rate
ROI             = (manual cost - automation cost) / automation cost × 100
```
**Example:** Manual regression: 8 hrs/release × 26 releases × $75/hr = $15,600/yr. Automation: 120 hrs to write + 40 hrs/yr maintenance × $75/hr = $12,000 year 1, $3,000/yr after. Year 1 ROI: `(15,600 - 12,000) / 12,000 = 30%`. Year 2 ROI: `(15,600 - 3,000) / 3,000 = 420%`. Use this to justify investment to stakeholders.

---

### Engineering Quality Metrics (DORA)

DORA metrics are the standard vocabulary for leadership delivery dashboards. They pair with defect escape rate — DORA tracks delivery throughput; QA metrics track delivery quality.

| Metric | What it measures | Benchmark (top-15%) |
|--------|------------------|---|
| **Lead Time for Changes** | Commit → production | < 1 day |
| **Deployment Frequency** | How often you ship | Multiple per day |
| **Change Failure Rate** | % of deploys that cause incidents | ~5% (older "high performer" bar was <15%) |
| **Failed Deployment Recovery Time** (formerly MTTR) | Time to restore service after a *change-induced* failure | < 1 hour |
| **Reliability** (added as 5th key) | Availability, latency, error budget | Meets your SLOs |

DORA 2025 retired the named Elite/High/Medium/Low tiers in favor of percentile distributions and team archetypes — read the columns as percentile benchmarks, not a tier you "are." The **Failed Deployment Recovery Time** rename (2023/2024 reports) separates change-induced failures from external outages; it is a delivery metric distinct from your QA defect MTTR above. The **Reliability** key is where QA/escape framing meets SRE — error rate and availability are the user-facing tail of escaped defects.

Source: https://dora.dev/research/. Tools that surface DORA from Git/CI data: Sleuth, Faros, LinearB, Jellyfish, Swarmia.

### Test Impact Analysis (TIA) as a Lever

TIA selects which tests to run based on which code changed (using coverage data). It trades test breadth for CI cost. Track:

- **% of tests skipped per PR via TIA** — higher means cheaper CI; if it climbs without coverage falling, TIA is paying off.
- **Escaped defects from skipped tests** — the safety check. If non-zero, narrow the TIA selection or expand the always-run set.

Hosted: Datadog Test Optimization (TIA), CloudBees Smart Tests, NCrunch (in-IDE). Self-built: derive from coverage data + git diff. See `coverage-analysis`.

---

## Setting Realistic Targets

Targets should match your team's maturity. Chasing enterprise metrics at a seed startup wastes effort.

| Metric | Startup (seed-Series A) | Growth (Series B-C) | Enterprise (public/large) |
|---|---|---|---|
| Unit test coverage | 60% | 75% | 85% |
| Branch coverage | 45% | 60% | 75% |
| E2E coverage (critical paths) | Top 5 flows | Top 15 flows | All P0/P1 flows |
| Flakiness rate | <5% | <3% | <1% |
| Pass rate (7-day) | >90% | >95% | >98% |
| Defect escape rate | <20% | <10% | <5% |
| MTTR (P0) | <8 hours | <4 hours | <2 hours |
| CI pipeline duration | <20 min | <15 min | <10 min |
| Automation rate | 50% | 75% | 90% |
| Metrics tracked | 3-5 core | 8-10 with dashboards | Full suite with alerting |

**Progression path:**
1. Start with 3 metrics: code coverage, flakiness rate, defect escape rate.
2. Add execution metrics when CI cost or speed becomes a pain point.
3. Add process metrics when the team grows beyond 5 engineers.
4. Add the full suite when quality is a product differentiator or compliance requirement.

For the full phased rollout (week-by-week), the three dashboard layouts, and the data-source extraction table, see `references/rollout.md` and `references/dashboards.md`.

---

## Anti-Patterns

- **Treating coverage as quality proof.** Coverage measures execution, not verification. Pair with mutation testing for truth.
- **Metrics without context.** "Coverage is 74%" is meaningless without target (80%), trend (up from 69%), and distribution (92% critical paths, 40% admin). Always present with target, trend, and breakdown.
- **Gaming metrics.** Trivial tests to hit coverage numbers. Counter by pairing coverage with defect escape rate — if coverage is high but defects escape, the tests lack teeth.
- **Too many metrics.** Tracking 25 means acting on none. Start with 3. Only add a metric when you can articulate the action it triggers.
- **Measuring without acting.** A Grafana dashboard nobody opens. If a metric does not trigger action at least once per quarter, retire it (the metric half-life check in `references/rollout.md`).
- **Comparing across teams.** Coverage in a payment service vs. an admin tool is not comparable. Track improvement over time, not cross-team rankings.

---

## Verification

The whole point is a working feedback loop — prove the data actually flows before declaring done:

1. **Coverage emits machine-readable output.** Run your coverage tool and confirm it writes JSON/LCOV (`coverage/coverage-final.json`, `lcov.info`) — not just an HTML report a human reads.
2. **CI history is queryable.** Hit your CI provider's API for the last 7 days of run results and confirm you can compute pass rate and flakiness from it.
3. **Escape labels exist.** Query the issue tracker for the `escaped-defect` (or equivalent) label and confirm at least the tagging convention is in place.
4. **A gate actually blocks.** Open a throwaway PR that drops coverage or adds a `.skip` and confirm CI fails it — a gate that never fires proves nothing.

---

## Done When

- Key metrics are defined with explicit formulas: coverage % (line and branch), flakiness rate, defect escape rate, and MTTR by severity.
- Baseline values are established for each metric from at least 2 weeks of collected data, with targets set per the company-stage table.
- Data collection is automated via CI integrations (coverage from test runner, flakiness from CI run history, defects from issue-tracker labels) — no manual steps.
- Quality gates are configured in CI to block merges or deployments when flakiness exceeds threshold, coverage drops, or critical tests fail (verified by a failing throwaway PR).
- Each metric has a named owner, and a metrics block exists in the recurring retro template (or a standing calendar invite) — a checkable artifact, not just an intention.

## Reference Files (in `references/`)

- **dashboards.md** — the engineering (daily), leadership (monthly), and sprint-health dashboard layouts, plus the release-confidence-score example weighting.
- **rollout.md** — the four-phase week-by-week implementation plan, the data-source extraction table, and the metric half-life retirement practice.

## Related Skills

- **qa-dashboard** — builds the Allure/Grafana/SaaS dashboard UI that surfaces these metrics; go there for the rendering, here for what to measure.
- **coverage-analysis** — coverage gaps and mutation score in depth; the assertion-quality input to the coverage metric here.
- **ci-cd-integration** — configures the CI pipelines that generate the raw data these metrics depend on, including Test Impact Analysis as a cost lever.
- **release-readiness** — consumes quality gates and DORA Change Failure Rate / Failed Deployment Recovery Time for go/no-go decisions.
- **test-reliability** — runtime per-test healing for the flaky tests the flakiness rate flags.
- **quality-postmortem** — action-item-closure-rate pairs with escape rate as the postmortem-side metric.
- **qa-project-context** — feeds targets and baselines into metrics tracking.
