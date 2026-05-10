---
name: qa-dashboard
description: >-
  Set up QA dashboards and reporting with Allure Report, Grafana, and ReportPortal.
  Covers test execution visualization, stakeholder-facing quality reports, trend
  analysis panels, and CI integration for automated report generation.
  Use when: "test dashboard," "Allure," "test report," "quality dashboard," "Grafana
  testing," "ReportPortal," "test results visualization."
  Related: qa-metrics, ci-cd-integration, ai-bug-triage.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: metrics
---

<objective>
Build dashboards that drive decisions, not dashboards that display data.
</objective>

---

## Discovery Questions

1. **What tool do you use for test reporting today?** Console output, JUnit XML, HTML reports, or a dedicated platform? Identify the starting point.
2. **Who will look at the dashboard?** Developers need failure details and traces. QA leads need trends and flakiness. Leadership needs release confidence and defect rates. Each audience needs a different view.
3. **What decisions should the dashboard drive?** "Is this build safe to release?" "Which tests need fixing?" "Is quality improving sprint over sprint?" Dashboards without a decision context become shelfware.
4. **Where do test results live?** GitHub Actions artifacts, S3, a database? The storage location determines which dashboard tool is practical.
5. **What CI platform?** GitHub Actions, GitLab CI, Jenkins? Each has different artifact and reporting integrations.
6. **Check `.agents/qa-project-context.md` first.** Respect existing reporting conventions and infrastructure.

---

## Core Principles

**1. Dashboards answer questions, they do not display numbers.** Every panel must map to a question someone actually asks. "What is the flakiness rate?" is a question. "Total test count" is trivia.

**2. Different audiences need different views.** A developer debugging a CI failure needs stack traces, screenshots, and traces. A VP needs a single number: "Are we ready to release?" Do not force both through the same dashboard.

**3. Real-time for CI, trends for leadership.** CI dashboards update on every pipeline run. Leadership dashboards aggregate weekly or per-sprint. Mixing cadences confuses both audiences.

**4. Drill-down to action.** Every red indicator must link to the specific failing test, the specific flaky test, or the specific coverage gap. A dashboard that shows "5 failures" but does not link to the failures is a notification, not a tool.

**5. Automate report generation.** Reports that require manual effort (running scripts, copying data, formatting slides) will not survive the first busy sprint. Generate reports from CI pipelines automatically.

---

## Allure Report

Allure generates rich HTML reports from test results with history, categories, and retries built in. It works with Playwright, Jest, Vitest, pytest, and most test frameworks.

> **Allure 2 vs Allure 3.** Allure Report 3 (current v3.7.0, May 2026) is a TypeScript rewrite with a plugin system, single-file `allurerc` config, real-time `allure watch`, project-wide quality gates, multi-environment reports, and **Allure Service** for cloud history (replaces the manual artifact dance). The framework adapters (`allure-playwright`, `allure-vitest`, `allure-jest`) shown below currently target Allure 2; v3-native readers and plugins are landing across the v3.x line.
>
> **For new projects:** if your test framework has a v3-ready adapter, generate with `allure run` and add an `allurerc.mjs`. Otherwise stick with the Allure 2 CLI shown below — it remains supported (2.40.0, May 2026, mostly dependency bumps now).
>
> Reference: https://allurereport.org/docs/v3/

### Allure with Playwright

```bash
npm i -D allure-playwright
```

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    ["allure-playwright", {
      outputFolder: "allure-results",
      detail: true,
      suiteTitle: true,
      environmentInfo: {
        Browser: "Chromium",
        Environment: process.env.TEST_ENV ?? "local",
        BaseURL: process.env.BASE_URL ?? "http://localhost:3000",
      },
    }],
  ],
});
```

**Adding metadata to tests:**

```typescript
import { test, expect } from "@playwright/test";
import { allure } from "allure-playwright";

test.describe("Checkout Flow", () => {
  test("should complete purchase with valid card", async ({ page }) => {
    await allure.severity("critical");
    await allure.feature("Checkout");
    await allure.story("Payment Processing");
    await allure.tag("smoke");

    // Attach custom data to report
    await allure.attachment("Test Config", JSON.stringify({
      paymentProvider: "stripe-test",
      currency: "USD",
    }), "application/json");

    await page.goto("/checkout");
    await page.fill('[data-testid="card-number"]', "4242424242424242");
    await page.fill('[data-testid="card-expiry"]', "12/28");
    await page.fill('[data-testid="card-cvc"]', "123");
    await page.click('[data-testid="pay-button"]');

    await expect(page.locator('[data-testid="confirmation"]')).toBeVisible();
  });
});
```

### Allure with Jest/Vitest

```bash
# Jest
npm i -D jest-allure2-reporter allure-jest

# Vitest
npm i -D allure-vitest
```

**Vitest configuration:**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      "default",
      ["allure-vitest/reporter", {
        resultsDir: "allure-results",
        environmentInfo: {
          Node: process.version,
          OS: process.platform,
        },
      }],
    ],
    setupFiles: ["allure-vitest/setup"],
  },
});
```

### Generating Allure Reports

```bash
# Install Allure CLI
brew install allure  # macOS
# or: npm i -D allure-commandline

# Generate HTML report from results
npx allure generate allure-results --clean -o allure-report

# Open report in browser
npx allure open allure-report

# Serve report (for CI artifact viewing)
npx allure serve allure-results
```

### History and Trends

Allure tracks test history across runs when you preserve the `allure-report/history` directory.

```yaml
# GitHub Actions: preserve Allure history across runs
- name: Download previous Allure history
  uses: actions/download-artifact@v4
  with:
    name: allure-history
    path: allure-history
  continue-on-error: true  # First run has no history

- name: Run tests
  run: npx playwright test

- name: Copy history to results
  run: |
    mkdir -p allure-results/history
    cp -r allure-history/history/* allure-results/history/ 2>/dev/null || true

- name: Generate Allure report
  run: npx allure generate allure-results --clean -o allure-report

- name: Upload Allure report
  uses: actions/upload-artifact@v4
  with:
    name: allure-report
    path: allure-report/
    retention-days: 30

- name: Upload Allure history
  uses: actions/upload-artifact@v4
  with:
    name: allure-history
    path: allure-report/history/
    retention-days: 90
```

### Custom Categories

Define categories to group failures by type instead of showing a flat list.

```json
// allure-results/categories.json
[
  {
    "name": "Product Bugs",
    "matchedStatuses": ["failed"],
    "messageRegex": ".*Expected.*but received.*"
  },
  {
    "name": "Test Infrastructure",
    "matchedStatuses": ["broken"],
    "messageRegex": ".*(ECONNREFUSED|timeout|navigation).*"
  },
  {
    "name": "Flaky Tests",
    "matchedStatuses": ["failed"],
    "messageRegex": ".*(intermittent|race condition|retry).*"
  },
  {
    "name": "Missing Test Data",
    "matchedStatuses": ["broken"],
    "messageRegex": ".*(seed|fixture|not found in database).*"
  }
]
```

---

## Grafana Dashboards

Grafana provides real-time dashboards with alerting. Best for teams that already use Grafana for infrastructure monitoring and want to add test metrics alongside production metrics.

### Data Pipeline: CI to Grafana

```
CI Pipeline Run
  ├── Test results (JUnit XML)
  ├── Coverage report (JSON)
  └── Timing data (JSON)
        │
        ▼
  Parser script (post-test CI step)
        │
        ▼
  Time-series DB (InfluxDB / Prometheus pushgateway)
        │
        ▼
  Grafana queries + panels
```

### Pushing Test Metrics to InfluxDB

```typescript
// scripts/push-test-metrics.ts
import { InfluxDB, Point } from "@influxdata/influxdb-client";

interface TestResult {
  name: string;
  suite: string;
  status: "passed" | "failed" | "skipped";
  duration: number;
  retries: number;
}

async function pushMetrics(results: TestResult[], runId: string, branch: string) {
  const client = new InfluxDB({
    url: process.env.INFLUXDB_URL!,
    token: process.env.INFLUXDB_TOKEN!,
  });

  const writeApi = client.getWriteApi("qa", "test-results", "ms");

  for (const result of results) {
    const point = new Point("test_execution")
      .tag("suite", result.suite)
      .tag("test_name", result.name)
      .tag("status", result.status)
      .tag("branch", branch)
      .tag("run_id", runId)
      .floatField("duration_ms", result.duration)
      .intField("retries", result.retries)
      .intField("passed", result.status === "passed" ? 1 : 0)
      .intField("failed", result.status === "failed" ? 1 : 0);

    writeApi.writePoint(point);
  }

  // Push summary metrics
  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / total;

  const summary = new Point("test_run_summary")
    .tag("branch", branch)
    .tag("run_id", runId)
    .intField("total", total)
    .intField("passed", passed)
    .intField("failed", failed)
    .floatField("pass_rate", (passed / total) * 100)
    .floatField("avg_duration_ms", avgDuration);

  writeApi.writePoint(summary);
  await writeApi.close();
}
```

```yaml
# GitHub Actions: push metrics after tests
- name: Push test metrics to Grafana
  if: always()
  env:
    INFLUXDB_URL: ${{ secrets.INFLUXDB_URL }}
    INFLUXDB_TOKEN: ${{ secrets.INFLUXDB_TOKEN }}
  run: |
    npx tsx scripts/push-test-metrics.ts \
      --results-file test-results/results.json \
      --run-id "${{ github.run_id }}" \
      --branch "${{ github.head_ref || github.ref_name }}"
```

### Recommended Grafana Panels

**Panel 1: Pass Rate Trend (time series)**

```
Query: SELECT mean("pass_rate") FROM "test_run_summary"
       WHERE "branch" = 'main'
       GROUP BY time(1d)
Visualization: Time series, thresholds at 95% (yellow) and 99% (green)
```

**Panel 2: Flakiness Top 10 (table)**

```
Query: SELECT "test_name", count("retries") as retry_count
       FROM "test_execution"
       WHERE "retries" > 0 AND time > now() - 14d
       GROUP BY "test_name"
       ORDER BY retry_count DESC
       LIMIT 10
Visualization: Table with sortable columns
```

Additional panels: **Test Duration Distribution** (histogram, buckets at 1s/5s/10s/30s/60s), **Coverage Trend** (line + branch coverage over time), **CI Duration Trend** (with target line at 600s).

### Grafana Alerting

Set up alerts for: pass rate below 95% (warning, 10m window), CI duration above 15 min (warning), and coverage drop of more than 2% in a week (info). Route to the QA team's Slack channel.

---

## ReportPortal

ReportPortal is a self-hosted test reporting platform with AI-powered failure analysis, test result aggregation across frameworks, and real-time dashboards.

### Setup with Docker Compose

```bash
# Pin to a tagged release (current: 26.0.2). The `master` branch may not match
# the supported 26.x line.
curl -LO https://raw.githubusercontent.com/reportportal/reportportal/26.0.2/docker-compose.yml
docker compose up -d
# Access at http://localhost:8080 (default: superadmin/erebus)
# ML-based failure classification: ensure the `service-auto-analyzer` container
# is running — it provides the AI auto-analysis ReportPortal advertises.
```

### Allure TestOps (managed alternative)

If self-hosting feels heavy, **Allure TestOps** (current 26.2.1.4, May 2026) is the SaaS path: it adds Allure 3 quality gates, named environments, global attachments, and Allure 3-style flaky detection (≥3 status transitions in last 10 runs). An MCP server is in open beta (26.1.1, March 2026), letting AI agents query launches and quality gates directly — relevant if your QA workflow runs through Claude Code / Codex / Cursor.

### Integration with Playwright

```bash
npm i -D @reportportal/agent-js-playwright
```

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
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
      description: `Playwright E2E suite run on ${new Date().toISOString()}`,
    }],
  ],
});
```

### ReportPortal Features

| Feature | What It Does |
|---------|-------------|
| **Auto-analysis** | ML-based failure classification: product bug, test bug, system issue, or to investigate |
| **Defect type mapping** | Custom defect categories with sub-types for your project |
| **Flaky test detection** | Identifies tests that flip between pass/fail across launches |
| **Merge launches** | Combine results from sharded CI runs into one unified view |
| **Quality gates** | Define pass/fail criteria for launches (max failures, min pass rate) |
| **Comparison** | Side-by-side comparison of two launches to spot regressions |

ReportPortal quality gates can be queried via API after test completion (`GET /api/v1/$PROJECT/launch/$LAUNCH_ID/quality-gate`) and used as a CI gate -- fail the pipeline if the gate status is not `PASSED`.

---

## SaaS-Native Test Dashboards

If your test runner has a first-class hosted dashboard, prefer it over Allure/Grafana for the runner's native data — less plumbing, more retention, built-in PR comments. Cross-pollinate with Allure/Grafana only for cross-runner aggregation.

| Platform | Test runner | Native data + PR comments |
|----------|-------------|---------------------------|
| **Cypress Cloud** | Cypress | Test replay, parallelization, flake detection; AI add-on (Auto Heal, Bug Triage) |
| **Currents.dev** | Cypress, Playwright | OSS-friendly Cypress Cloud alternative; lower price point |
| **Playwright HTML report + `--reporter=blob`** | Playwright | Free, self-hosted; combine shards with `npx playwright merge-reports` |
| **Datadog Test Optimization** | Any (CI-side) | Flaky Test Management, TIA, native APM integration |
| **Allure TestOps** | Any | Allure 3 quality gates, named environments, MCP server beta |

Use Allure or Grafana when you need a single dashboard across multiple test runners or when the SaaS option's pricing/data-residency doesn't fit. Otherwise, the SaaS-native dashboard is usually the cheapest path to PR-level signal.

---

## Stakeholder Reports

**Weekly QA Summary** -- Automate via scheduled CI job. Include: pass rate + trend, new vs fixed failures, top 5 flaky tests, coverage delta, avg CI duration. Classify health: STABLE (>= 98%), NEEDS ATTENTION (>= 95%), CRITICAL (< 95%). Post to Slack automatically.

**Release Quality Report** -- Generate before each release. Gate on: E2E pass rate >= 99%, unit pass rate 100%, branch coverage >= 80%, zero critical bugs, major bugs <= 2, performance budget (LCP < 2500ms, FID < 100ms, CLS < 0.1). Output a READY/NOT READY verdict with per-gate pass/fail breakdown.

---

## Recommended Dashboard Panels

A practical set of panels that cover the most common questions teams ask.

| Panel | Question It Answers | Data Source | Audience |
|-------|-------------------|-------------|----------|
| **Pass/Fail Trend** | Is quality improving or degrading? | CI test results over time | Everyone |
| **Flakiness Top 10** | Which tests waste the most time? | Tests with retries in last 14 days | Developers, QA |
| **Coverage Heatmap** | Where are we blind? | Coverage by module/directory | Developers |
| **Defect Escape Trend** | Are bugs reaching production? | Production incidents tagged as test escapes | QA leads, Leadership |
| **CI Duration** | Is the pipeline getting slower? | Pipeline duration over time | DevOps, Developers |
| **Test Velocity** | Are we writing tests proportional to features? | New tests added per sprint | QA leads |
| **Failure Categories** | Are failures product bugs or test infra? | Categorized failure reasons | QA leads |
| **Release Readiness** | Can we ship? | Composite score from all gates | Leadership |

---

## Anti-Patterns

**Dashboard with 30 panels.** No one reads a dashboard with 30 panels. Start with 5-6 panels that answer the most urgent questions. Add panels only when someone asks a question the dashboard cannot answer.

**Metrics without context.** "Pass rate: 97%" means nothing without "target: 99%" and "last week: 98.5%." Every metric needs a target and a trend to be actionable.

**Manual report generation.** If generating the weekly QA summary requires someone to SSH into a server, run queries, and paste into a slide deck, it will stop happening by week 3. Automate everything into the CI pipeline.

**Same dashboard for developers and leadership.** Developers need failure details, stack traces, and reproduction steps. Leadership needs a single traffic light: green/yellow/red. Build separate views.

**Reporting test counts as progress.** "We added 200 tests this sprint" says nothing about quality. Report coverage of critical paths, defect escape rate, and mean time to detect regressions instead.

**No alerting on regressions.** A dashboard that no one checks is useless. Set up Grafana alerts or Slack notifications for pass rate drops, coverage decreases, and CI duration increases. Dashboards are for investigation; alerts are for detection.

**Allure without history.** A single Allure report is a snapshot. Without history, you cannot see trends, identify intermittent failures, or measure improvement. Always preserve the `history/` directory across CI runs.

---

## Done When

- Dashboard is deployed and accessible to the full team without requiring local setup or manual report generation.
- Test execution trends (pass rate, failure count, duration) are visible over at least 2 weeks of historical data.
- Flakiness trend chart is configured showing the top flaky tests with retry counts over a rolling 14-day window.
- Stakeholder-facing report template is created and generating automatically (weekly summary or per-release quality report with a clear READY/NOT READY verdict).
- Alert is configured to notify the team (via Slack or equivalent) when the main branch pass rate drops by more than 2 percentage points in a single day.

## Related Skills

- **qa-metrics** -- Defining quality KPIs, measurement frameworks, and metric interpretation.
- **ci-cd-integration** -- Pipeline configuration for automated report generation and artifact management.
- **ai-bug-triage** -- AI-powered failure classification that feeds into dashboard categories.
