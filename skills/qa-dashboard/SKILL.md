---
name: qa-dashboard
description: >-
  Build and visualize QA dashboards and reports with Allure Report, Grafana, and
  ReportPortal. Covers test execution visualization, stakeholder-facing quality
  reports, trend/flakiness panels, release-readiness gates, alerting, and CI
  integration for automated report generation.
  Use when: "test dashboard," "Allure," "test report," "quality dashboard,"
  "Grafana," "ReportPortal," "test results visualization."
  Not for: defining which KPIs to measure or how to interpret them — use qa-metrics
  (this skill builds the panels; qa-metrics decides what they should show).
  Related: qa-metrics, ci-cd-integration, ai-bug-triage.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: metrics
---

<objective>
Build dashboards that drive decisions, not dashboards that display data. The failure
mode this prevents: a wall of panels showing "5 failures" with no link to the failures,
no target, and no trend — a notification dressed up as a tool that everyone stops opening
by week three. This skill delivers audience-specific QA reporting — rich HTML reports
(Allure), real-time trend panels with regression alerts (Grafana/InfluxDB), self-hosted
AI-assisted aggregation (ReportPortal), and automated stakeholder summaries — each panel
mapped to a question someone actually asks and every red indicator drilling down to the
failing test.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Already on Grafana for infra metrics | **Grafana Dashboards** — add test metrics alongside prod |
| Test runner has a hosted dashboard (Cypress/Playwright) | **SaaS-Native Dashboards** — least plumbing |
| Need rich HTML report, no infra to run | **Allure Report** — generate in CI, publish artifact |
| Need self-hosted aggregation across frameworks + AI triage | **ReportPortal** |
| Need a single view across multiple runners | **Grafana** or **Allure** (cross-runner aggregation) |
| Need a weekly summary / release verdict for stakeholders | **Stakeholder Reports** |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything answered there. Then:

1. **What tool do you use for test reporting today?** Console output, JUnit XML, HTML reports, or a dedicated platform? Identifies the starting point and how much plumbing is left.
2. **Who will look at the dashboard?** Developers need failure details and traces; QA leads need trends and flakiness; leadership needs release confidence and defect rates. Each audience needs a different view.
3. **What decisions should the dashboard drive?** "Is this build safe to release?" "Which tests need fixing?" "Is quality improving sprint over sprint?" Dashboards without a decision context become shelfware.
4. **Where do test results live?** GitHub Actions artifacts, S3, a database? The storage location determines which dashboard tool is practical.
5. **What CI platform?** GitHub Actions, GitLab CI, Jenkins? Each has different artifact and reporting integrations.

---

## Core Principles

**1. Dashboards answer questions, they do not display numbers.** Every panel must map to a question someone actually asks. "What is the flakiness rate?" is a question. "Total test count" is trivia.

**2. Different audiences need different views.** A developer debugging a CI failure needs stack traces, screenshots, and traces. A VP needs a single number: "Are we ready to release?" Do not force both through the same dashboard.

**3. Real-time for CI, trends for leadership.** CI dashboards update on every pipeline run. Leadership dashboards aggregate weekly or per-sprint. Mixing cadences confuses both audiences.

**4. Drill-down to action.** Every red indicator must link to the specific failing test, the specific flaky test, or the specific coverage gap. A dashboard that shows "5 failures" but does not link to the failures is a notification, not a tool.

**5. Automate report generation.** Reports that require manual effort (running scripts, copying data, formatting slides) will not survive the first busy sprint. Generate reports from CI pipelines automatically.

---

## Allure Report

Allure generates rich HTML reports from test results with history, categories, and retries built in. It works with Playwright, Jest, Vitest, pytest, and most frameworks.

**Allure 2 vs Allure 3.** Two paths, and they are easy to mix up because the framework adapters (`allure-playwright`, `allure-vitest`, `allure-jest`) emit the same Allure 2 result files; only the reader differs:

- **Allure 2 path** — `allure-commandline` (2.42.1, Jun 2026). `brew install allure` installs **this**, not v3. Commands: `allure generate` / `allure open` / `allure serve`; categories via a `categories.json` dropped into `allure-results/`. Stable, frozen, dependency-bump-only now.
- **Allure 3 path** — `allure` npm package + `allurerc.mjs` (3.9.0, May 2026). TypeScript rewrite: plugins, single-file config, real-time `allure watch`, project-wide quality gates, multi-environment reports, and **Allure Service** for server-side history. Commands: `npx allure run` / `npx allure generate` / `npx allure watch`; categories move into `allurerc.mjs` (the dropped-in `categories.json` is a v2 concept).

Choose Allure 3 for new projects. If you follow only the `brew install allure` / `allure generate` commands you are on the **v2** path — that is fine and fully supported; just know which one you are running.

Minimal Playwright reporter wiring — register the adapter as `reporter: ["allure-playwright", { outputFolder, environmentInfo }]` so every run drops results into `allure-results/` with the environment captured:

```typescript
// playwright.config.ts
reporter: [
  ["list"],
  ["allure-playwright", {
    outputFolder: "allure-results",
    environmentInfo: {
      Environment: process.env.TEST_ENV ?? "local",
      BaseURL: process.env.BASE_URL ?? "http://localhost:3000",
    },
  }],
],
```

Add per-test metadata (`allure.severity` / `feature` / `story` / `tag`) to drive grouping, define failure
`categories` to split product bugs from infra breakage, and preserve `history/` across CI runs so trends
exist at all. **Without history an Allure report is a single snapshot — no trends, no intermittent-failure
detection.** See `references/allure.md` for the full Playwright/Vitest configs, the v2 `categories.json`,
the v3 `allurerc.mjs` + `allure run` runnable path, and the GitHub Actions history-preservation steps.

---

## Grafana Dashboards

Grafana gives real-time dashboards with alerting. Best when the team already runs Grafana for infrastructure and wants test metrics next to production metrics.

**Data pipeline:** a post-test CI step parses results (JUnit XML, coverage JSON, timing) and pushes points to a time-series DB (InfluxDB or a Prometheus pushgateway); Grafana queries those. The push script writes two measurements — `test_execution` (one point per test, tagged by `suite`/`test_name`/`status`/`branch`/`run_id`) and `test_run_summary` (one point per run with `pass_rate`, `total`, `failed`, `avg_duration_ms`). Tag every point with `branch` and `run_id` so panels can filter to `main` and link back to a specific run.

The script runs under `if: always()`, so wrap the write loop in try/flush/close — a throw mid-loop otherwise loses every buffered point. See `references/grafana.md` for the full `push-test-metrics.ts` (with the flush guard) and the GitHub Actions step.

### Recommended panels

| Panel | Question | Query shape |
|-------|----------|-------------|
| **Pass Rate Trend** (time series) | Is quality improving? | `SELECT mean("pass_rate") FROM "test_run_summary" WHERE "branch"='main' GROUP BY time(1d)`, thresholds at 95% (yellow) / 99% (green) |
| **Release Readiness** (stat) | Is main ready to release? | `SELECT last("pass_rate") FROM "test_run_summary" WHERE "branch"='main'`, red <95 / yellow 95–99 / green ≥99 — pair with a coverage stat ≥80 |
| **Flakiness Top 10** (table) | Which tests waste the most time? | `SELECT "test_name", count("retries") AS retry_count FROM "test_execution" WHERE "retries">0 AND time>now()-14d GROUP BY "test_name" ORDER BY retry_count DESC LIMIT 10` |
| **CI Duration Trend** | Is the pipeline getting slower? | `avg_duration_ms` over time with a target line at 600s |

Full queries plus Coverage Trend and Duration Distribution panels are in `references/grafana.md`.

### Alerting

Provision alert rules as YAML under `provisioning/alerting/` (Grafana 11+). The one the Done When
requires: **main pass rate drops more than 2 percentage points in a single day.** Build it from two
queries (mean `pass_rate` over the last `1d` vs the day before) feeding a math expression
`$yesterday - $today > 2`, then route via a Slack contact point (incoming-webhook URL). The full
provisioned rule + contact point is in `references/grafana.md`. Also alert on: pass rate below 95%
(10m window), CI duration above 15 min, coverage drop >2% in a week. **Dashboards are for
investigation; alerts are for detection** — a dashboard no one opens catches nothing.

---

## ReportPortal

Self-hosted test reporting platform with ML-powered failure analysis, cross-framework aggregation, and real-time dashboards.

```bash
# Pin to a tagged release (current 26.0.x line: 26.0.3). The `master` branch may not
# match the supported 26.x line.
curl -LO https://raw.githubusercontent.com/reportportal/reportportal/26.0.3/docker-compose.yml
docker compose up -d
# Access at http://localhost:8080 (default: superadmin/erebus)
# ML auto-analysis lives in the `service-auto-analyzer` container — confirm it is running.
```

As of 26.0.3 ReportPortal also ingests **agentic** test results (launches carry an `AGENTIC` vs
`AUTOMATION` execution-type badge) — relevant if part of your suite runs through Claude Code or another agent.

### Playwright integration

```typescript
// playwright.config.ts
reporter: [
  ["list"],
  ["@reportportal/agent-js-playwright", {
    apiKey: process.env.RP_API_KEY,
    endpoint: process.env.RP_ENDPOINT ?? "http://localhost:8080/api/v1",
    project: "my-project",
    launch: `E2E Tests - ${process.env.CI ? "CI" : "local"}`,
    attributes: [
      { key: "branch", value: process.env.GITHUB_HEAD_REF ?? "local" },
      { key: "build", value: process.env.GITHUB_RUN_ID ?? "dev" },
    ],
  }],
],
```

Install with `npm i -D @reportportal/agent-js-playwright`.

| Feature | What it does |
|---------|--------------|
| **Auto-analysis** | ML failure classification: product bug, test bug, system issue, or to-investigate |
| **Defect type mapping** | Custom defect categories with sub-types for your project |
| **Flaky test detection** | Tests that flip pass/fail across launches |
| **Merge launches** | Combine sharded CI runs into one unified view |
| **Quality gates** | Pass/fail criteria per launch (max failures, min pass rate) |
| **Comparison** | Side-by-side of two launches to spot regressions |

Quality gates are queryable after a run (`GET /api/v1/$PROJECT/launch/$LAUNCH_ID/quality-gate`) — use the
status as a CI gate and fail the pipeline if it is not `PASSED`.

### Allure TestOps (managed alternative)

If self-hosting feels heavy, **Allure TestOps** (26.2.x line, 2026) is the SaaS path: Allure 3 quality
gates, named environments, global attachments, and Allure 3-style flaky detection (flags a test once it
shows ≥3 status transitions across its last 10 runs). Its **MCP server is in public beta (26.1.1)**, letting
AI agents query launches and quality gates directly — relevant when your QA workflow runs through Claude
Code / Cursor.

---

## SaaS-Native Test Dashboards

If your test runner has a first-class hosted dashboard, prefer it over Allure/Grafana for that runner's native data — less plumbing, more retention, built-in PR comments. Cross-pollinate with Allure/Grafana only for cross-runner aggregation.

| Platform | Test runner | Native data + PR comments |
|----------|-------------|---------------------------|
| **Cypress Cloud** | Cypress | Test replay, parallelization, flake detection; AI add-on (Auto Heal, Bug Triage) |
| **Currents.dev** | Cypress, Playwright | OSS-friendly Cypress Cloud alternative; lower price point |
| **Playwright HTML + `--reporter=blob`** | Playwright | Free, self-hosted; combine shards with `merge-reports` |
| **Datadog Test Optimization** | Any (CI-side) | Flaky Test Management (now with Bits AI auto-fix), TIA, native APM |
| **Allure TestOps** | Any | Allure 3 quality gates, named environments, MCP server beta |

**Combining sharded Playwright runs (free, native).** Have each shard emit a blob report, then merge into
one HTML report — the no-cost answer to "combine sharded CI runs":

```bash
# each shard: npx playwright test --reporter=blob   (uploads blob-report/ as an artifact)
npx playwright merge-reports --reporter html ./blob-reports
```

Use Allure or Grafana when you need one dashboard across multiple runners, or when a SaaS option's pricing/data-residency does not fit. Otherwise the SaaS-native dashboard is usually the cheapest path to PR-level signal.

---

## Stakeholder Reports

**Weekly QA Summary** — automate via a scheduled CI job. Include: pass rate + trend, new vs fixed failures, top 5 flaky tests, coverage delta, avg CI duration. Classify health: STABLE (>= 98%), NEEDS ATTENTION (>= 95%), CRITICAL (< 95%). Post to Slack automatically.

**Release Quality Report** — generate before each release. Gate on: E2E pass rate >= 99%, unit pass rate 100%, branch coverage >= 80%, zero critical bugs, major bugs <= 2, and the Core Web Vitals budget. Output a READY / NOT READY verdict with a per-gate pass/fail breakdown.

Core Web Vitals "good" thresholds for the perf gate (current as of 2026): **LCP < 2500ms, INP < 200ms, CLS < 0.1.** Gate on INP, not FID — INP replaced FID as a Core Web Vital on 2024-03-12 and FID was fully retired on 2024-09-09.

---

## Recommended Dashboard Panels

A practical set covering the most common questions teams ask.

| Panel | Question It Answers | Data Source | Audience |
|-------|-------------------|-------------|----------|
| **Pass/Fail Trend** | Is quality improving or degrading? | CI test results over time | Everyone |
| **Flakiness Top 10** | Which tests waste the most time? | Tests with retries in last 14 days | Developers, QA |
| **Coverage Heatmap** | Where are we blind? | Coverage by module/directory | Developers |
| **Defect Escape Trend** | Are bugs reaching production? | Incidents tagged as test escapes | QA leads, Leadership |
| **CI Duration** | Is the pipeline getting slower? | Pipeline duration over time | DevOps, Developers |
| **Test Velocity** | Tests proportional to features? | New tests added per sprint | QA leads |
| **Failure Categories** | Product bugs or test infra? | Categorized failure reasons | QA leads |
| **Release Readiness** | Can we ship? | Composite score from all gates | Leadership |

---

## Anti-Patterns

**Dashboard with 30 panels.** No one reads it. Start with 5–6 panels that answer the most urgent questions; add panels only when someone asks one the dashboard cannot answer.

**Metrics without context.** "Pass rate: 97%" means nothing without "target: 99%" and "last week: 98.5%." Every metric needs a target and a trend to be actionable.

**Manual report generation.** If the weekly summary needs someone to SSH in, run queries, and paste into slides, it stops happening by week 3. Automate it into CI.

**Same dashboard for developers and leadership.** Developers need failure details, stack traces, and repro steps; leadership needs one traffic light. Build separate views.

**Reporting test counts as progress.** "We added 200 tests" says nothing about quality. Report critical-path coverage, defect escape rate, and mean time to detect regressions instead.

**No alerting on regressions.** A dashboard no one checks is useless. Alert on pass-rate drops, coverage decreases, and CI-duration increases. Dashboards are for investigation; alerts are for detection.

**Allure without history.** A single Allure report is a snapshot — no trends, no intermittent-failure detection, no measure of improvement. Always preserve `history/` across CI runs (or use Allure 3 / Allure Service for server-side history).

**Mixing the Allure 2 and 3 code paths.** Following the v3 callout in prose but copying `brew install allure` + `allure generate` + a dropped-in `categories.json` lands you on v2 with v2 categories. Pick one path and use its commands end to end.

---

## Verification

Prove the report/dashboard actually renders before calling it done. Smallest checks first:

```bash
# Allure: a report builds and the trend widget shows >1 run (history preserved)
npx allure generate allure-results --clean -o allure-report && npx allure open allure-report
#   -> Overview page loads; the "Trend" widget shows more than one run.

# Grafana push: the summary point landed in InfluxDB
influx query 'from(bucket:"test-results") |> range(start:-1d) |> filter(fn:(r)=> r._measurement=="test_run_summary")'
#   -> returns at least one row with a pass_rate field for branch=main.

# Grafana alert: the provisioned rule loaded
curl -s http://localhost:3000/api/v1/provisioning/alert-rules -u admin:admin | jq '.[].title'
#   -> includes "Main pass rate dropped >2pp in a day".
```

---

## Done When

- Dashboard is published to a known location that returns HTTP 200 for the team (CI artifact URL, Grafana URL, or hosted SaaS link) — no local setup or manual report run required.
- Test execution trends (pass rate, failure count, duration) are visible over at least 2 weeks of historical data.
- Flakiness panel is configured showing the top flaky tests with retry counts over a rolling 14-day window.
- A stakeholder report template is generating automatically — **either** a weekly summary with a STABLE/NEEDS ATTENTION/CRITICAL health label **or** a per-release quality report with a READY/NOT READY verdict and per-gate breakdown (one or both is acceptable).
- An alert is configured and routed (Slack or equivalent) that fires when the main-branch pass rate drops by more than 2 percentage points in a single day.

## Related Skills

- **qa-metrics** — Defining quality KPIs, measurement frameworks, and metric interpretation. Go there to decide *what* to measure; come here to *visualize* it.
- **ci-cd-integration** — Pipeline configuration for automated report generation and artifact management.
- **ai-bug-triage** — AI-powered failure classification that feeds into dashboard failure categories.

## Reference Files (in `references/`)

- **allure.md** — full Playwright/Vitest adapter configs, per-test metadata, the v2 `categories.json`, the v3 `allurerc.mjs` + `allure run` runnable path, and the CI history-preservation workflow.
- **grafana.md** — the `push-test-metrics.ts` script (with flush guard), all panel queries, and the provisioned ">2pp pass-rate drop" alert rule + Slack contact point.
