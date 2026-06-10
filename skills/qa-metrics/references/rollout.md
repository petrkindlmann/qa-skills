# Implementing Metrics — Phased Rollout

Don't stand up a full observability stack on day one. Earn each metric by being able
to articulate the action it triggers.

## Phase 1: Foundation (Week 1-2)

1. **Pick 3 metrics.** Start with code coverage, flakiness rate, and defect escape
   rate. These three give the most signal with the least setup.
2. **Automate collection.** Coverage comes from your test runner (Istanbul, c8,
   coverage.py). Flakiness comes from CI run history. Defect escapes come from tagging
   production bugs.
3. **Set initial targets.** Use the company-stage table in SKILL.md. Adjust after 2-4
   weeks of baseline data.
4. **Assign owners.** One engineer owns coverage. One owns flakiness. Engineering
   manager owns defect escape rate.

## Phase 2: Visibility (Week 3-4)

1. **Create the engineering dashboard.** Use Grafana, Datadog, or even a shared Google
   Sheet. The tool matters less than the habit of looking at it.
2. **Add CI annotations.** Surface coverage deltas and flakiness warnings directly in
   PR comments (many CI tools support this natively).
3. **Set up alerts.** Flakiness >5%: Slack alert to the team. Coverage drops >2% on a
   PR: block merge or flag for review.
4. **Establish a review cadence.** Review metrics in weekly team standup (5 minutes,
   not 30).

## Phase 3: Quality Gates (Month 2)

1. **Define quality gates for releases.** Example gates:
   - All P0 tests pass
   - Coverage has not decreased
   - No new P0/P1 bugs unresolved
   - Flakiness rate below threshold
   - E2E smoke suite green
2. **Automate gate enforcement.** Use CI pipeline stages, branch protection rules, or
   deployment gates.
3. **Track gate pass rate.** If gates are consistently overridden, the gates are either
   too strict or the team does not trust them. Adjust.

## Phase 4: Advanced Metrics (Month 3+)

1. **Add process metrics** (automation rate, test velocity, ROI).
2. **Build the leadership dashboard** (see `references/dashboards.md`).
3. **Implement trend alerting** (not just threshold alerts, but "coverage has been
   declining for 3 consecutive sprints" alerts).
4. **Connect metrics to retros.** Use data to drive sprint retrospective discussions,
   not opinions.

## Data Sources and Integration

| Data source | Metrics it feeds | How to extract |
|---|---|---|
| CI system (GitHub Actions, GitLab CI) | Pass rate, duration, flakiness | API or built-in analytics |
| Coverage tool (Istanbul, c8, coverage.py) | Code coverage % | Coverage report JSON output |
| Issue tracker (Jira, Linear, GitHub Issues) | Defect escape rate, MTTR, severity distribution | API queries with label/tag filters |
| Test runner (Playwright, Jest, pytest) | Test count, skip count, duration per test | JUnit XML or JSON reporter output |
| Source control (Git) | Test creation velocity, churn | Git log analysis |

## Metric half-life

Every quarter, walk the list and ask of each metric: did this trigger an action in the
last 90 days? If a metric never moved a decision, retire it — a dashboard nobody acts
on is cost, not insight. New metrics earn their slot only when you can name the action
they trigger.
