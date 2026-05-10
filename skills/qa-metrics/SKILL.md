---
name: qa-metrics
description: >-
  Define, track, and act on QA metrics. Covers test coverage percentage, flakiness rate,
  defect escape rate, MTTR, test execution time trends, automation ROI, quality gates,
  and SLAs for test suites. Includes metric formulas, dashboard recommendations, and
  realistic targets by company stage. No other skills repo covers QA metrics comprehensively.
  Use when: "QA metrics," "test metrics," "quality KPIs," "test health," "flakiness rate,"
  "defect escape rate," "test dashboard."
  Related: qa-dashboard, coverage-analysis, ci-cd-integration, qa-retrospective.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: metrics
---

<objective>
Define, collect, and act on the metrics that actually improve software quality. The goal is not a pretty dashboard -- it is a feedback loop that changes behavior. Every metric in this skill has a formula, a target, an owner, and a concrete action to take when the metric goes red.
</objective>

---

## Discovery Questions

Before defining metrics, understand what already exists and what problems need visibility. Check `.agents/qa-project-context.md` first -- if it exists, use it as the foundation and skip questions already answered there.

### Current State

- What metrics are you tracking today? (Even informally -- "we glance at CI pass rate sometimes" counts.)
- Where does your test data live? (CI system, coverage reports, bug tracker, spreadsheets, nowhere)
- Do you have any dashboards or reports already? Who looks at them, and how often?
- What tooling runs your CI pipeline? (GitHub Actions, GitLab CI, Jenkins, CircleCI, etc.)

### Stakeholders

- Who are the stakeholders for quality metrics? (engineering, product, leadership, customers)
- What does each stakeholder care about? (Engineers want flakiness data. Leadership wants defect escape trends. Product wants release confidence.)
- Who will own each metric? (If nobody owns it, nobody acts on it.)

### Quality Problems

- What quality problems need visibility? (Regressions, slow pipelines, flaky tests, gaps in coverage, production incidents)
- What broke in production recently? Would a metric have caught it earlier?
- What decisions are you making without data today?

### Goals

- What does "healthy test suite" mean for your team?
- Are there compliance or contractual quality requirements? (SLAs, SOC2, ISO)
- What is the appetite for investing in metrics infrastructure? (Quick wins vs. full observability)

---

## Core Principles

### 1. Metrics Should Drive Action, Not Just Dashboards

A metric without an action plan is decoration. For every metric you track, define: what threshold triggers action, what the action is, and who takes it. If flakiness crosses 5%, the on-call engineer investigates the top 3 flaky tests that week. No ambiguity.

### 2. Trend Over Snapshot

A single number in isolation is nearly useless. Coverage at 72% means nothing without context. Coverage trending from 68% to 72% over three sprints tells a story. Always display metrics as time series, and evaluate direction rather than absolute position.

### 3. Every Metric Needs a Target and an Owner

A target makes a metric actionable. An owner makes it accountable. Without both, the metric becomes background noise. Assign targets based on your team's maturity (see the targets table below), and assign owners who can actually influence the number.

### 4. Vanity Metrics Waste Everyone's Time

Metrics that make you feel good but do not drive decisions are vanity metrics. "We have 4,000 tests" sounds impressive until you realize 800 are disabled and 200 are flaky. Count what matters: tests that run, pass reliably, and catch real bugs.

### 5. Measure What Matters to the Business

The ultimate quality metric is: did users hit bugs that hurt the business? Work backward from there. Defect escape rate connects directly to user experience. Test coverage connects indirectly. Lines of test code connects to almost nothing. Prioritize metrics closer to business outcomes.

---

## Essential QA Metrics

Organized by category. Each metric includes its definition, formula, recommended target, why it matters, and what to do when it goes off track.

---

### Test Coverage Metrics

Coverage metrics answer the question: how much of our system is verified by automated tests?

#### Code Coverage Percentage

The percentage of code exercised by automated tests (line, branch, or statement level).

```
Line coverage   = (lines executed by tests / total executable lines) × 100
Branch coverage = (branches executed by tests / total branches) × 100
```

**Targets:** Line: 70-85% for app code. Branch: 60-75%. Critical paths (payments, auth): 90%+.

**Why it matters:** Coverage identifies blind spots -- code never exercised by tests is where bugs hide undetected.

**When it goes red:** Coverage drops on PR: block merge or flag. Low in critical module: create targeted tasks. Plateaus: check for dead code vs. genuinely untested logic.

**Warning:** Coverage measures execution, not assertion quality. Pair with mutation testing (Stryker JS v9.6+, mutmut) for a truer picture. Stryker JS v9 requires Vitest 4.1+ for the runner; use `incremental: true` in monorepo CI to keep mutation runs cheap.

#### Requirement Coverage Percentage

The percentage of user stories that have at least one associated test.

```
Requirement coverage = (features with at least one test / total features) × 100
```

**Targets:** 100% for P0/P1 features, 80%+ for P2.

**Why it matters:** A feature can have zero tests even if surrounding code is well-covered. Use test tags (`@feature:checkout`, `@story:PROJ-1234`) to maintain traceability.

#### Risk Coverage Percentage

The percentage of identified high-risk areas with automated test coverage.

```
Risk coverage = (high-risk areas with automated tests / total high-risk areas) × 100
```

**Targets:** 95%+ for high-risk areas. Maintain a risk register and cross-reference against coverage data per module.

---

### Test Health Metrics

Health metrics answer the question: can we trust our test suite?

#### Flakiness Rate

The percentage of test runs producing inconsistent results without code changes.

```
Flakiness rate = (test runs with flaky results / total test runs) × 100
```

**Targets:** Acceptable: <2%. Warning: 2-5%. Critical: >5%.

**Why it matters:** Flaky tests erode trust. When developers think "probably just a flaky test," they stop paying attention to results entirely. Flakiness is the single biggest threat to a test suite's credibility.

**When it goes red:** Quarantine flaky tests immediately. Investigate the top 3 weekly -- most flakiness comes from a small number of tests. Common causes: timing/race conditions, shared state, external dependencies, order-dependent tests. Tests flaky for 30+ days should be deleted or rewritten.

**Detection:** Buildkite Test Analytics, **Datadog Test Optimization** (formerly "Datadog CI Visibility" — now ships explicit Flaky Test Management with Auto Test Retries, Early Flake Detection, and Failed Test Replay, plus Test Impact Analysis to skip unaffected tests on PR), Trunk Flaky Tests, or a script comparing results across runs on the same commit.

#### Pass Rate Trend (7-Day Rolling)

```
Pass rate = (green CI runs / total CI runs) × 100  [rolling 7 days]
```

**Targets:** Healthy: >95%. Warning: 90-95%. Broken: <90%.

**Why it matters:** The 7-day rolling average smooths daily noise and reveals the real trend. A consistently red build means developers ignore the pipeline.

#### Disabled and Skipped Test Count

Total tests marked `skip`, `disabled`, `pending`, `xit`, `xdescribe` or equivalent.

**Target:** Trend toward zero. Skipped tests older than 2 sprints: fix or delete. Add a CI step that fails if skipped count exceeds 5% of total tests.

**Why it matters:** Skipped tests are invisible coverage gaps. A suite with 500 passing and 150 skipped tests has a 23% gap that dashboards hide.

#### Test Suite Duration

Wall-clock time from suite start to completion.

**Targets:** Unit: <5 min. Integration: <10 min. E2E: <15 min. Full pipeline: <30 min.

**Why it matters:** Slow tests break the feedback loop. 45-minute results mean developers have already context-switched.

**When it goes red:** Profile slowest tests (10% often account for 50% of runtime). Increase parallelism. Move slow tests post-merge. Check for unnecessary setup/teardown. Plot duration over time and alert on step changes (>20% increase in a week).

---

### Defect Metrics

Defect metrics answer the question: are we catching bugs before users do?

#### Defect Escape Rate

The percentage of defects found in production relative to all defects found.

```
Defect escape rate = (defects found in production / total defects found) × 100
```

**Targets:** Excellent: <5%. Acceptable: 5-10%. Needs work: 10-20%. Critical: >20%.

**Why it matters:** The single most important quality metric. It directly measures whether testing catches bugs before users do.

**When it goes red:** Classify escaped defects by layer (unit? integration? E2E? review?). Write a retrospective test for each. Check if escapes cluster in specific areas -- those need targeted investment.

**How to track:** Tag production bugs (`escaped-defect` label). Count escaped vs. pre-release defects at sprint retros.

#### Mean Time To Resolution (MTTR)

```
MTTR = sum(resolution_time for each defect) / number of defects
```

**Targets:** P0: <4 hours. P1: <24 hours. P2: <1 sprint. P3: <2 sprints.

**Why it matters:** High MTTR often signals process bottlenecks (slow review, unclear ownership, complex deploys) rather than technical difficulty. Break into phases (triage, assign, fix, deploy) to find the bottleneck.

#### Defect Density

```
Defect density = defects found / KLOC  (or per feature shipped)
```

**Targets:** Track your own baseline; industry benchmarks are 1-10 defects per KLOC. If one module has 5x the density of others, it needs refactoring or better coverage.

#### Severity Distribution

Breakdown of defects by severity. Healthy distribution: P0 <5%, P1 10-15%, P2 40-50%, P3 30-40%. Visualize as a pie chart or stacked bar over time. Heavy P0/P1 concentration means testing misses critical issues.

---

### Execution Metrics

Execution metrics answer the question: is our CI pipeline fast, reliable, and cost-effective?

#### CI Pipeline Duration

Total wall-clock time by stage. **Targets:** Lint: <2 min. Unit: <5 min. Integration: <10 min. E2E: <15 min. Full: <30 min.

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

**Target:** >80%. If 4 workers finish in 3, 3, 3, and 12 minutes, three workers wasted 9 minutes each. Fix by splitting by estimated duration (not file count), breaking up slow test files, and using dynamic splitting (Playwright sharding, Jest `--shard`).

---

### Process Metrics

Process metrics answer the question: is our QA process improving over time?

#### Automation Rate

```
Automation rate = (automated test cases / total test cases) × 100
```

**Targets:** Regression: 90%+. Smoke: 100%. Exploratory: 0% (by definition). Overall: 70-85%.

**Why it matters:** Manual testing does not scale. Automation compounds -- once written, a test runs thousands of times. Prioritize automating the most frequently executed scenarios first.

#### Test Creation Velocity

New automated tests added per sprint (net new, excluding refactors).

**Target:** At least 3-5 automated tests per user story shipped. A sprint with 20 features and 0 new tests signals a growing coverage gap.

#### Automation ROI

```
Manual cost     = (manual time per cycle × cycles per year) × hourly rate
Automation cost = (write time + annual maintenance) × hourly rate
ROI             = (manual cost - automation cost) / automation cost × 100
```

**Example:** Manual regression: 8 hrs/release × 26 releases × $75/hr = $15,600/yr. Automation: 120 hrs to write + 40 hrs/yr maintenance × $75/hr = $12,000 year 1, $3,000/yr after. Year 1 ROI: 30%. Year 2 ROI: 420%. Use this to justify investment to stakeholders.

---

## Setting Realistic Targets

Targets should match your team's maturity. Chasing enterprise-grade metrics at a seed-stage startup wastes effort. The table below provides recommended targets by company stage.

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
1. Start with 3 metrics: code coverage, flakiness rate, defect escape rate
2. Add execution metrics when CI costs or speed become pain points
3. Add process metrics when the team grows beyond 5 engineers
4. Add full suite when quality is a product differentiator or compliance requirement

---

## Quality Dashboards

Different stakeholders need different views of the same underlying data.

### Engineering Dashboard (Daily View)

This dashboard lives where engineers already look -- in CI, Slack, or the team wiki.

**Include:**
- CI pass rate (today and 7-day trend)
- Top 5 flaky tests with failure count
- Test suite duration by stage (unit, integration, E2E)
- Coverage delta on latest PR (increased/decreased)
- Skipped test count
- Number of quarantined tests awaiting fix

**Exclude:** Business-level metrics, ROI calculations, historical trend analysis beyond 30 days.

**Refresh cadence:** Real-time or per-build.

### Leadership Dashboard (Monthly View)

This dashboard answers: "Is quality improving, stable, or declining?"

**Include:**
- Defect escape rate trend (3-6 month view)
- MTTR by severity (monthly average)
- Quality gate pass rate (% of releases that passed all quality gates)
- Automation ROI (cumulative savings)
- Severity distribution trend
- Release confidence score (composite metric, see below)

**Exclude:** Individual test names, CI runner details, code-level coverage numbers.

**Refresh cadence:** Monthly or per-release.

**Release confidence score formula:**

```
Release confidence = (0.3 × pass_rate) + (0.3 × (100 - defect_escape_rate))
                   + (0.2 × coverage_score) + (0.2 × (100 - flakiness_rate))
```

Where each component is normalized to 0-100. This gives a single number leadership can track.

### Sprint Health Dashboard (Per-Sprint View)

This dashboard supports sprint retrospectives and planning.

**Include:**
- Tests added vs. features shipped (ratio)
- Bugs found in sprint vs. bugs escaped to production
- Flakiness rate change during the sprint
- Coverage change during the sprint
- Test debt items created vs. resolved

**Refresh cadence:** Updated at sprint boundaries.

---

## Implementing Metrics

### Phase 1: Foundation (Week 1-2)

1. **Pick 3 metrics.** Start with code coverage, flakiness rate, and defect escape rate. These three give the most signal with the least setup.
2. **Automate collection.** Coverage comes from your test runner (Istanbul, c8, coverage.py). Flakiness comes from CI run history. Defect escapes come from tagging production bugs.
3. **Set initial targets.** Use the table above based on your company stage. Adjust after 2-4 weeks of baseline data.
4. **Assign owners.** One engineer owns coverage. One owns flakiness. Engineering manager owns defect escape rate.

### Phase 2: Visibility (Week 3-4)

1. **Create the engineering dashboard.** Use Grafana, Datadog, or even a shared Google Sheet. The tool matters less than the habit of looking at it.
2. **Add CI annotations.** Surface coverage deltas and flakiness warnings directly in PR comments (many CI tools support this natively).
3. **Set up alerts.** Flakiness >5%: Slack alert to the team. Coverage drops >2% on a PR: block merge or flag for review.
4. **Establish a review cadence.** Review metrics in weekly team standup (5 minutes, not 30).

### Phase 3: Quality Gates (Month 2)

1. **Define quality gates for releases.** Example gates:
   - All P0 tests pass
   - Coverage has not decreased
   - No new P0/P1 bugs unresolved
   - Flakiness rate below threshold
   - E2E smoke suite green
2. **Automate gate enforcement.** Use CI pipeline stages, branch protection rules, or deployment gates.
3. **Track gate pass rate.** If gates are consistently overridden, the gates are either too strict or the team does not trust them. Adjust.

### Phase 4: Advanced Metrics (Month 3+)

1. **Add process metrics** (automation rate, test velocity, ROI).
2. **Build the leadership dashboard.**
3. **Implement trend alerting** (not just threshold alerts, but "coverage has been declining for 3 consecutive sprints" alerts).
4. **Connect metrics to retros.** Use data to drive sprint retrospective discussions, not opinions.

### Data Sources and Integration

| Data source | Metrics it feeds | How to extract |
|---|---|---|
| CI system (GitHub Actions, GitLab CI) | Pass rate, duration, flakiness | API or built-in analytics |
| Coverage tool (Istanbul, c8, coverage.py) | Code coverage % | Coverage report JSON output |
| Issue tracker (Jira, Linear, GitHub Issues) | Defect escape rate, MTTR, severity distribution | API queries with label/tag filters |
| Test runner (Playwright, Jest, pytest) | Test count, skip count, duration per test | JUnit XML or JSON reporter output |
| Source control (Git) | Test creation velocity, churn | Git log analysis |

---

## Anti-Patterns

- **Treating coverage as quality proof.** Coverage measures execution, not verification. Pair with mutation testing for truth.
- **Metrics without context.** "Coverage is 74%" is meaningless without target (80%), trend (up from 69%), and distribution (92% critical paths, 40% admin). Always present with target, trend, and breakdown.
- **Gaming metrics.** Trivial tests to hit coverage numbers. Counter by pairing coverage with defect escape rate -- if coverage is high but defects escape, the tests lack teeth.
- **Too many metrics.** Tracking 25 means acting on none. Start with 3. Only add a metric when you can articulate the action it triggers.
- **Measuring without acting.** A Grafana dashboard nobody opens. If a metric does not trigger action at least once per quarter, replace it.
- **Comparing across teams.** Coverage in a payment service vs. an admin tool is not comparable. Track improvement over time, not cross-team rankings.

---

## Done When

- Key metrics are defined with explicit formulas: coverage % (line and branch), flakiness rate, defect escape rate, and MTTR by severity.
- Baseline values are established for each metric from at least 2 weeks of collected data, with targets set per the company-stage table.
- Data collection is automated via CI pipeline integrations (coverage from test runner, flakiness from CI run history, defects from issue tracker labels) — no manual steps required.
- Quality gates are configured in CI to block merges or deployments when flakiness exceeds threshold, coverage drops, or critical tests fail.
- Metrics are reviewed in a recurring team cadence (at minimum in sprint retrospectives), with a named owner for each metric.

## Related Skills

- **qa-project-context** -- Set up the project context file that feeds targets and baselines into metrics tracking.
- **test-strategy** -- Define the overall testing approach; metrics measure whether the strategy is working.
- **ci-cd-integration** -- Configure CI pipelines that generate the raw data metrics depend on.
- **release-readiness** -- Quality gates and release criteria consume metrics to make go/no-go decisions.
