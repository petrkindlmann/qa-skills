---
name: synthetic-monitoring
description: >-
  Implement post-deploy validation of critical flows through scheduled synthetic tests.
  Covers the boundary between QA and SRE, probe design for critical user journeys,
  alerting integration, SLA validation, and multi-region monitoring.
  Use when: "synthetic monitoring," "uptime testing," "production monitoring," "scheduled
  tests," "SLA validation," "availability monitoring."
  Related: testing-in-production, release-readiness, performance-testing, qa-metrics.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: production
---

<objective>
Synthetic monitoring runs scripted tests against production on a schedule, 24/7. It catches outages, performance degradation, and broken flows before real users report them. This skill covers probe design, alerting integration, SLA validation, and multi-region execution.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there.

**Critical flows:**
- What are the 5-10 most important user journeys? (login, search, checkout, signup, core workflow)
- Which flows, if broken, would cause immediate revenue loss or user churn?
- Are there flows that break silently (data sync, background jobs, webhooks)?
- Do you have documented SLAs or SLOs for availability and response time?

**Current monitoring:**
- What monitoring exists today? (Uptime checks, APM, error tracking, custom dashboards)
- Are there gaps between what monitoring covers and what users experience?
- How do you currently learn about production issues? (Alerts, user reports, social media)
- What was the last outage? How long before it was detected?

**Infrastructure:**
- Is the application served from multiple regions or a single region?
- Are there CDN, caching, or edge compute layers that could mask origin failures?
- Do third-party dependencies (payment, auth, email) have their own monitoring?
- What alerting systems are in place? (PagerDuty, OpsGenie, Slack, email)

**Test accounts:**
- Do dedicated synthetic test accounts exist in production?
- Can test accounts be excluded from analytics, billing, and email campaigns?
- Is there API access for programmatic account setup and data cleanup?

---

## Core Principles

### 1. Synthetic tests validate the user experience continuously

Real user monitoring (RUM) tells you what happened. Synthetic monitoring tells you what is happening right now, whether or not real users are active. At 3 AM when traffic is zero, synthetic probes are the only thing checking that your application works.

### 2. Complement real user monitoring, never replace it

Synthetic tests cover known paths with predictable inputs. Real users find creative ways to break things that no synthetic test anticipates. Use both: synthetic for baseline coverage, RUM for discovering unknowns.

### 3. Keep probes simple and fast

A synthetic probe that takes 2 minutes and touches 15 pages is not a probe -- it is an E2E test suite running in production. Probes should be short (under 30 seconds), focused (one critical path per probe), and stable (no flakiness tolerance).

### 4. Alert on trends, not single failures

A single probe failure is noise. Two consecutive failures are a signal. Three are an incident. Configure alerting with consecutive failure thresholds to avoid alert fatigue from transient network blips.

### 5. Probes must not affect production data

Synthetic probes run every few minutes, 24/7. Even small side effects (creating a record, incrementing a counter) compound over time. Probes must be non-destructive, and any created data must be cleaned up immediately.

---

## Probe Design

### What to monitor

Design probes around critical user journeys, not around infrastructure components. Users do not care if your load balancer is healthy -- they care if they can log in and use the product.

| Probe | What It Validates | Frequency | Timeout |
|-------|-------------------|-----------|---------|
| Homepage load | DNS, CDN, server, basic rendering | 1 min | 10s |
| Login flow | Authentication service, session management | 5 min | 15s |
| Core workflow | Primary value-delivering action (e.g., create document, run search) | 5 min | 20s |
| API health | Backend services, database connectivity | 1 min | 5s |
| Search | Search index, query processing, result rendering | 5 min | 15s |
| Checkout (if applicable) | Payment integration (sandbox mode), cart, order creation | 10 min | 25s |
| Third-party integrations | OAuth providers, email delivery, file storage | 10 min | 15s |

### Probe implementation: Playwright example

```typescript
// probes/login-flow.ts
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PRODUCTION_URL!;
const SYNTH_EMAIL = process.env.SYNTHETIC_USER_EMAIL!;
const SYNTH_PASS = process.env.SYNTHETIC_USER_PASSWORD!;

test.describe('Synthetic: Login Flow', () => {
  test.describe.configure({ timeout: 15_000, retries: 0 });

  test('user can authenticate and reach dashboard', async ({ page }) => {
    // Step 1: Load login page
    const loginResponse = await page.goto(`${PROD_URL}/login`);
    expect(loginResponse?.status()).toBeLessThan(400);

    // Step 2: Authenticate
    await page.getByLabel('Email').fill(SYNTH_EMAIL);
    await page.getByLabel('Password').fill(SYNTH_PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Step 3: Verify dashboard loads with data
    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});
```

### Probe implementation: API health check

```typescript
// probes/api-health.ts
import { test, expect } from '@playwright/test';

const API_URL = process.env.API_BASE_URL!;
const API_KEY = process.env.SYNTHETIC_API_KEY!;

test.describe('Synthetic: API Health', () => {
  test.describe.configure({ timeout: 5_000, retries: 0 });

  test('health endpoint returns healthy status', async ({ request }) => {
    const response = await request.get(`${API_URL}/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.database).toBe('connected');
    expect(body.cache).toBe('connected');
  });

  test('authenticated API returns valid response', async ({ request }) => {
    const response = await request.get(`${API_URL}/v1/me`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.email).toContain('synthetic');
  });

  test('core endpoint responds within latency budget', async ({ request }) => {
    const start = Date.now();
    const response = await request.get(`${API_URL}/v1/items?limit=10`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const duration = Date.now() - start;
    expect(response.ok()).toBeTruthy();
    expect(duration).toBeLessThan(2000); // 2 second latency budget
  });
});
```

### Non-destructive probe patterns

```
Safe patterns:
  - Read-only operations: GET requests, page loads, searches
  - Sandbox transactions: payment in test mode, email to internal addresses
  - Create-then-delete: create a draft, verify, delete immediately
  - Synthetic flag: operations tagged as synthetic, excluded from processing

Dangerous patterns (avoid):
  - Creating real orders, tickets, or user-facing records
  - Triggering real notifications (email, SMS, push)
  - Modifying shared resources (config, permissions, settings)
  - Operations that cannot be automatically cleaned up
```

### Dedicated test accounts

```
Account requirements:
  - Clearly identifiable: email contains "synthetic" or "monitor"
  - Flagged in database: is_synthetic = true
  - Excluded from analytics, billing, email campaigns, support queues
  - Pre-populated with stable test data that probes can rely on
  - Credentials stored in secrets manager, rotated quarterly
  - Separate accounts per probe if probes run concurrently (avoid state conflicts)
```

---

## Implementation Patterns

### Platform options

| Platform | Strengths | When to Use |
|----------|-----------|-------------|
| Checkly | Playwright-native, code-first, Git integration; **Rocky** AI agent for monitor authoring/triage (Apr 2026); MCP server | Teams already using Playwright for E2E |
| Datadog Synthetic | Deep APM integration, browser and API tests | Teams on the Datadog platform |
| Grafana Synthetic Monitoring | Open source, integrates with Grafana dashboards; pairs with k6 1.0+ as a probe runtime | Teams using Grafana stack |
| AWS CloudWatch Synthetics | Blueprints (heartbeat, API, broken-link, visual diff); Python or Node Puppeteer canaries | Teams already on AWS |
| New Relic Synthetics | Full-stack observability integration | Teams on the New Relic platform |
| Better Stack (formerly Better Uptime) | Lightweight uptime + status pages + on-call | SMB-friendly, fast setup |
| Uptime Kuma | OSS, self-hosted, lightweight | Self-hosting requirement, small surface area |
| Custom (Playwright / k6 / Puppeteer + cron) | Full control, no vendor lock-in | Budget-constrained or custom requirements |

> Probes can be authored in Playwright (TS/JS), Puppeteer, k6 (JS — k6 1.0+ is now first-class for synthetic), or Python (CloudWatch Synthetics, Checkly). Pick what your team already maintains. Pingdom is in maintenance mode under SolarWinds — avoid for new setups.

### Custom implementation: Playwright + GitHub Actions

```yaml
# .github/workflows/synthetic-monitoring.yml
name: Synthetic Monitoring
on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch: {}

jobs:
  synthetic-probes:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22 # current LTS as of May 2026 — bump as Node LTS rolls forward
      - run: npm ci
      - run: npx playwright install chromium --with-deps

      - name: Run synthetic probes
        env:
          PRODUCTION_URL: ${{ secrets.PRODUCTION_URL }}
          SYNTHETIC_USER_EMAIL: ${{ secrets.SYNTHETIC_USER_EMAIL }}
          SYNTHETIC_USER_PASSWORD: ${{ secrets.SYNTHETIC_USER_PASSWORD }}
          SYNTHETIC_API_KEY: ${{ secrets.SYNTHETIC_API_KEY }}
        run: npx playwright test probes/ --reporter=json --reporter=list

      - name: Report results to monitoring
        if: always()
        run: |
          node scripts/report-synthetic-results.js \
            --results=test-results/results.json \
            --webhook=${{ secrets.MONITORING_WEBHOOK }}
```

### Checkly-based implementation

```typescript
// checkly.config.ts
import { defineConfig } from 'checkly';

export default defineConfig({
  projectName: 'Production Monitoring',
  logicalId: 'prod-monitoring',
  checks: {
    frequency: 5,          // Every 5 minutes
    locations: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
    // Use the latest stable Checkly runtime — see https://www.checklyhq.com/docs/runtimes/
    // (e.g. 'next' for the rolling stable; pin a dated runtime for reproducibility)
    runtimeId: '2025.04',
    browserChecks: {
      testMatch: 'probes/**/*.check.ts',
    },
  },
  cli: {
    runLocation: 'us-east-1',
  },
});
```

### Environment-aware probes

Probes should adapt to the environment they run against without code changes.

```typescript
// probes/config.ts
interface ProbeConfig {
  baseUrl: string;
  credentials: { email: string; password: string };
  thresholds: { pageLoad: number; apiResponse: number };
}

function getProbeConfig(): ProbeConfig {
  const env = process.env.PROBE_ENVIRONMENT ?? 'production';

  const configs: Record<string, ProbeConfig> = {
    staging: {
      baseUrl: 'https://staging.example.com',
      credentials: { email: 'synthetic@staging.example.com', password: process.env.STAGING_PASS! },
      thresholds: { pageLoad: 5000, apiResponse: 3000 },
    },
    production: {
      baseUrl: 'https://www.example.com',
      credentials: { email: 'synthetic@example.com', password: process.env.PROD_PASS! },
      thresholds: { pageLoad: 3000, apiResponse: 1000 },
    },
  };

  return configs[env];
}
```

---

## Alerting Integration

### When to alert

Not every probe failure is an incident. Configure alerting rules that reduce noise while catching real problems.

```
Alerting rules:
  - Single failure: log, do not alert (transient network issue)
  - 2 consecutive failures from same region: warning (possible issue)
  - 2 consecutive failures from 2+ regions: alert on-call (confirmed outage)
  - Latency >2x baseline for 10 minutes: warning (performance degradation)
  - Latency >3x baseline for 5 minutes: alert on-call (severe degradation)
  - Any probe timeout: alert if 3 consecutive (service unresponsive)
```

### Alert routing

```yaml
# alerting-rules.yaml
routes:
  - match:
      severity: critical
      probe: [login, checkout, api-health]
    receivers: [pagerduty-oncall, slack-incidents]
    repeat_interval: 5m

  - match:
      severity: warning
      probe: [search, third-party]
    receivers: [slack-monitoring]
    repeat_interval: 30m

  - match:
      severity: info
    receivers: [slack-monitoring]
    repeat_interval: 4h
```

### Alert message format

Include enough context for the on-call engineer to start investigating immediately.

```
Alert template:
  Title: [SYNTHETIC] {probe_name} failing from {region}
  Severity: {critical|warning|info}
  Consecutive failures: {count}
  Last success: {timestamp}
  Error: {error_message}
  Duration: {last_response_time_ms}ms (threshold: {threshold}ms)
  Dashboard: {link_to_dashboard}
  Runbook: {link_to_runbook}
  Regions affected: {list_of_failing_regions}
```

---

## SLA Validation

### Availability calculation

```
Availability = (total_minutes - downtime_minutes) / total_minutes × 100

Where:
  - total_minutes = calendar month in minutes (e.g., 43,200 for 30-day month)
  - downtime_minutes = minutes where synthetic probes detected failure

SLA tiers:
  99.0%  = 7h 12min downtime/month   (basic web app)
  99.9%  = 43min 50s downtime/month   (business application)
  99.95% = 21min 55s downtime/month   (critical SaaS)
  99.99% = 4min 23s downtime/month    (infrastructure/platform)
```

### Response time percentiles

Track percentiles, not averages. Averages hide the worst experiences.

```
SLA response time targets (example):
  Homepage load:  P50 < 1s,  P95 < 3s,  P99 < 5s
  API response:   P50 < 200ms, P95 < 500ms, P99 < 1s
  Search results: P50 < 500ms, P95 < 2s,  P99 < 4s
  Login flow:     P50 < 2s,  P95 < 5s,  P99 < 8s
```

### Error budget tracking

Error budget connects SLA targets to engineering decisions.

```
Error budget calculation:
  SLO: 99.9% availability
  Budget: 0.1% of total time = 43 minutes/month

  Budget consumed this month: 12 minutes (28%)
  Budget remaining: 31 minutes (72%)

Actions by budget status:
  >50% remaining: normal operations, ship features
  25-50% remaining: caution, review recent changes
  <25% remaining: freeze non-critical deploys, focus on reliability
  Budget exhausted: incident mode, every deploy needs extra scrutiny
```

---

## Multi-Region Monitoring

### Global probe distribution

Run probes from regions where your users are. A service that works from us-east-1 but is broken from ap-southeast-1 is broken for APAC users.

```
Region selection strategy:
  - Minimum 3 regions for global services
  - Always include: closest to primary infrastructure, largest user base, farthest from primary
  - Example for US-primary service: us-east-1, eu-west-1, ap-southeast-1
  - Example for EU-primary service: eu-west-1, us-east-1, ap-northeast-1
```

### Latency by region

Track regional latency separately. A global average hides regional degradation.

```
Regional latency dashboard:
  Region       | P50    | P95    | Status
  us-east-1    | 120ms  | 340ms  | healthy
  eu-west-1    | 280ms  | 620ms  | healthy
  ap-southeast | 450ms  | 1200ms | warning (P95 above threshold)

Alert when:
  - Any region's P95 exceeds its regional threshold
  - Latency difference between regions exceeds 5x (CDN or routing issue)
  - A region that was healthy becomes consistently degraded
```

### CDN validation

Synthetic probes can verify CDN caching by checking response headers (`x-cache`, `cf-cache-status`) for `HIT` status and confirming the `server` header matches the expected CDN provider. This catches CDN misconfigurations before users experience slow uncached responses.

---

## Anti-Patterns

### Complex probes that break often

A probe that navigates 10 pages, fills 5 forms, and asserts on 20 elements is an E2E test, not a synthetic probe. When it breaks, you cannot tell if the application is down or the probe is flaky.

**Fix:** One critical path per probe. Under 30 seconds. Under 5 assertions. If a probe fails, it should be immediately clear what is broken.

### Alerting on every single failure

Network blips, DNS hiccups, and transient cloud issues cause occasional probe failures. Alerting on every failure produces noise that teaches the team to ignore alerts.

**Fix:** Require 2-3 consecutive failures before alerting. Require failures from 2+ regions to confirm the issue is not local. Use escalating severity: first failure logs, second warns, third pages.

### No test account isolation

Running probes with a shared user account means probes interfere with each other. One probe changes a setting, another probe fails because it expected the default.

**Fix:** One dedicated synthetic account per probe (or at minimum per concurrent probe). Flag accounts as synthetic. Exclude from analytics and billing.

### Monitoring only the happy path

Probes that only check "page loads and returns 200" miss broken functionality hiding behind a loading page. A login page that always returns 200 but never actually authenticates is not working.

**Fix:** Assert on meaningful content, not just HTTP status. Verify that data loads, that authentication succeeds, that the core action completes. A probe that checks "can the user accomplish their goal" is worth ten that check "does the page return 200."

### No runbook for probe failures

An alert fires at 3 AM. The on-call engineer sees "Login probe failing" but has no idea what to check first, what the probe actually does, or how to distinguish a real outage from a probe issue.

**Fix:** Every probe has a linked runbook. The runbook includes: what the probe tests, what to check first (service status, recent deploys, third-party status), how to verify manually, and who to escalate to.

**Emerging pattern (2026): agent-driven first response.** Tools like Checkly Rocky and Honeycomb Agent Skills (open-sourced March 2026) read probe context + linked runbook + telemetry and post a candidate diagnosis to chat. Treat this as triage assist — it shortens MTTR for routine failures, but it does not replace on-call judgment for novel incidents.

---

## Done When

- Probes cover all critical user journeys identified in discovery (not only homepage uptime or a single health endpoint)
- Alert thresholds are calibrated with consecutive-failure rules so the team is neither flooded with noise nor missing real outages
- SLA tracking dashboard is configured and shows current availability and error budget consumption
- Probe failures trigger on-call notification within the response time defined in the SLA (verified with a test alert)
- Monitoring results are reviewed in a regular health check cadence (weekly or per-sprint)

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `testing-in-production` | Synthetic monitoring is the ongoing validation after production testing validates a release |
| `release-readiness` | Post-deploy smoke tests are a form of synthetic monitoring triggered by releases |
| `performance-testing` | Synthetic probes track production performance trends between load tests |
| `qa-metrics` | Availability, response time, and error budget feed into quality dashboards |
| `observability-driven-testing` | Telemetry from synthetic probes informs what additional tests to create |
| `ci-cd-integration` | Synthetic probes can run as a CI pipeline stage for post-deploy verification |
