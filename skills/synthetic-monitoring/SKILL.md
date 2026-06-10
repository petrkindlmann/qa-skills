---
name: synthetic-monitoring
description: >-
  Scheduled probes that run CONTINUOUSLY after release. Covers probe design for
  critical user journeys, alerting integration, SLA validation, multi-region
  monitoring, and the boundary between QA and SRE. Use when: "synthetic
  monitoring," "uptime testing," "scheduled probes," "SLA validation,"
  "availability monitoring," "post-deploy checks." Not for: safe-release
  techniques during rollout — use testing-in-production. Not for: designing
  tests from prod telemetry — use observability-driven-testing. Not for: a
  one-shot post-deploy smoke gate tied to a release — use release-readiness.
  Related: testing-in-production, release-readiness, performance-testing, qa-metrics.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: production
---

<objective>
Synthetic monitoring runs scripted tests against production on a schedule, 24/7. It catches outages, performance degradation, and broken flows before real users report them — at 3 AM when traffic is zero, probes are the only thing checking your app works. A login page that always returns 200 but never authenticates passes a naive uptime check; a synthetic probe that asserts the dashboard loads catches it. This skill covers probe design, alerting integration, SLA validation, multi-region execution, and the runbook discipline that keeps a 3 AM page actionable.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Picking a platform (Checkly, Datadog, Grafana, CloudWatch…) | Platform Options |
| Writing a probe (login, API health, search) | Probe Design → `references/probe-implementations.md` |
| Probe runs but users still report outages | Failure Modes |
| Alerts too noisy or missing real outages | Alerting Integration |
| Calculating downtime budget for an SLA | SLA Validation |
| Probe failed at 3 AM and on-call is lost | runbook template in `references/platforms-and-ci.md` |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there. Each answer changes the probe set, the alerting config, or the SLA math.

**Critical flows** (decides which probes you write):
- What are the 5-10 most important user journeys (login, search, checkout, signup, core workflow)? These become your probe list.
- Which flows, if broken, cause immediate revenue loss or churn? These get the shortest frequency and page on-call.
- Are there flows that break silently (data sync, background jobs, webhooks)? Silent failures need probes most — no user reports them.
- Do you have documented SLAs/SLOs for availability and response time? They set the downtime budget and the alert thresholds.

**Current monitoring** (decides where the gaps are):
- What exists today (uptime checks, APM, error tracking, dashboards)? Avoid duplicating; find the gap.
- Are there gaps between what monitoring covers and what users experience? That gap is where probes earn their keep.
- How do you learn about production issues today (alerts, user reports, social media)? If it's user reports, detection time is your first metric to fix.
- What was the last outage, and how long before it was detected? Sets the detection-time target probes must beat.

**Infrastructure** (decides regions and CDN assertions):
- Is the app served from multiple regions or one? Multi-region serving needs multi-region probing.
- Are there CDN, caching, or edge layers that could mask origin failures? If yes, probes must assert on `x-cache`/origin headers.
- Do third-party dependencies (payment, auth, email) have their own monitoring? Their status pages feed your runbooks.
- What alerting systems exist (PagerDuty, OpsGenie, Slack, email)? Decides the routing config.

**Test accounts** (decides data safety):
- Do dedicated synthetic test accounts exist in production? Without them, probes pollute real data and analytics.
- Can test accounts be excluded from analytics, billing, and email campaigns? If not, probe traffic skews every downstream number.
- Is there API access for programmatic account setup and data cleanup? Decides whether create-then-delete probes are viable.

---

## Core Principles

### 1. Synthetic tests validate the user experience continuously
RUM tells you what happened; synthetic tells you what is happening right now, whether or not real users are active. At 3 AM when traffic is zero, synthetic probes are the only thing checking the app works. Complement RUM, never replace it: synthetic covers known paths with predictable inputs, RUM discovers the creative ways real users break things.

### 2. Keep probes simple and fast
A probe that takes 2 minutes and touches 15 pages is not a probe — it is an E2E suite running in production. Probes are short (per-probe wall-clock budget under 30 seconds), focused (one critical path each), and stable (`retries: 0`, zero flakiness tolerance). The 30-second ceiling is a hard budget: a slow probe that "still passes" is masking a degradation users feel.

### 3. Alert on trends, not single failures
A single probe failure is noise — network blips and DNS hiccups cause them constantly. Two consecutive failures are a signal; failures from 2+ regions confirm it is not local. Configure consecutive-failure and multi-region thresholds, or alert fatigue teaches the team to ignore the pager.

### 4. Probes must not affect production data
Probes run every few minutes, 24/7. Even small side effects (a created record, an incremented counter) compound. Probes must be non-destructive, created data cleaned up immediately, and synthetic traffic excluded from analytics, billing, and — critically — from SLO/error-budget math itself, or probes inflate your own reliability numbers.

### 5. Assert on the goal, not the status code
A login page that returns 200 but never authenticates is broken. A search page that returns 200 with zero results is broken. Probes assert that the user can accomplish their goal — data loads, auth succeeds, results appear — not merely that the page returns a 2xx.

---

## Probe Design

Design probes around critical user journeys, not infrastructure components. Users do not care if your load balancer is healthy — they care if they can log in and use the product.

| Probe | What It Validates | Frequency | Timeout |
|-------|-------------------|-----------|---------|
| Homepage load | DNS, CDN, server, basic rendering | 1 min | 10s |
| Login flow | Authentication service, session management | 5 min | 15s |
| Core workflow | Primary value-delivering action (create document, run report) | 5 min | 20s |
| API health | Backend services, database connectivity | 1 min | 5s |
| Search | Search index, query processing, result rendering | 5 min | 15s |
| Checkout (if applicable) | Payment integration (sandbox mode), cart, order creation | 10 min | 25s |
| Third-party integrations | OAuth providers, email delivery, file storage | 10 min | 15s |

### Probe implementations

Three probe shapes cover most needs: a login flow (Playwright browser), an API health check (status + auth + latency budget), and a search probe (fill query → submit → assert on results, not just status). Keep each to one critical path, a tight timeout, and `retries: 0`. See `references/probe-implementations.md` for runnable login-flow, API-health, and search probes plus the environment-aware config.

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
  - Flagged in database with an is_synthetic flag (is_synthetic = true)
  - Excluded from analytics, billing, email campaigns, support queues
  - Excluded from RUM and SLO/error-budget pipelines (synthetic traffic is not real traffic)
  - Pre-populated with stable test data that probes can rely on
  - Credentials in a secrets manager (process.env), rotated quarterly
  - Separate accounts per concurrent probe (avoid state conflicts)
```

---

## Platform Options

| Platform | Strengths | When to Use |
|----------|-----------|-------------|
| Checkly | Playwright-native, code-first, Git integration; **Rocky** AI agent (GA 2026) now does automated root-cause analysis across Playwright/API/Multistep/TCP/DNS/ICMP checks; CLI access from any AI agent; MCP server | Teams already using Playwright for E2E |
| Datadog Synthetic | Deep APM integration, browser and API tests | Teams on the Datadog platform |
| Grafana Synthetic Monitoring | Open source, integrates with Grafana dashboards; pairs with k6 2.x; pin a version channel (v1.x/v2.x) for reproducibility | Teams using the Grafana stack |
| AWS CloudWatch Synthetics | Blueprints (heartbeat, API, broken-link, visual diff); Python or Node Puppeteer canaries | Teams already on AWS |
| New Relic Synthetics | Full-stack observability integration | Teams on the New Relic platform |
| Better Stack | Lightweight uptime + status pages + on-call | SMB-friendly, fast setup |
| Uptime Kuma | OSS, self-hosted, lightweight | Self-hosting requirement, small surface area |
| Custom (Playwright / k6 / Puppeteer + cron) | Full control, no vendor lock-in | Budget-constrained or custom requirements |

> Probes can be authored in Playwright (TS/JS), Puppeteer, k6 (JS — k6 2.0 shipped May 2026 with AI-assisted test authoring and a clearer Assertions API; first-class for synthetic), or Python (CloudWatch Synthetics, Checkly). Pick what your team already maintains. Avoid: Pingdom for new setups — it is a legacy uptime tool; prefer code-first alternatives (Checkly, Grafana, custom Playwright) that version-control probes alongside your app.

### Custom and managed implementations

Self-managed: schedule Playwright probes with a GitHub Actions `schedule` cron (every 5 minutes), inject prod credentials via secrets, and report results to a monitoring webhook. Managed: Checkly is Playwright-native and runs from multiple locations on a fixed frequency. Either way, make probes environment-aware so the same code runs against staging and production with different base URLs and thresholds. See `references/platforms-and-ci.md` for the GitHub Actions workflow, the Checkly config, the alert-routing rules, and the runbook template.

---

## Alerting Integration

Not every probe failure is an incident. Configure rules that cut noise while catching real problems.

```
Alerting rules:
  - Single failure: log, do not alert (transient network issue)
  - 2 consecutive failures from same region: warning (possible issue)
  - 2 consecutive failures from 2+ regions: alert on-call (confirmed outage)
  - Latency >2x baseline for 10 minutes: warning (performance degradation)
  - Latency >3x baseline for 5 minutes: alert on-call (severe degradation)
  - Any probe timeout: alert if 3 consecutive (service unresponsive)
```

**Routing.** Critical failures on revenue paths (login, checkout, api-health) page on-call (PagerDuty + Slack incidents) with a short repeat interval; warnings on secondary probes go to a Slack monitoring channel; info-level events use a long repeat interval. The probe must tag each result with a `severity` and `probe` label for these routes to match — see the routing note in `references/platforms-and-ci.md` for the full `alerting-rules.yaml` and the tagging step.

**Suppress synthetic alerts during planned maintenance.** A maintenance window should silence synthetic paging (the probes will fail by design) and exclude that window from error-budget math, or scheduled work burns budget and pages on-call for nothing.

**Alert message format** — include enough context to start investigating immediately:

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

The `{link_to_runbook}` points at a per-probe runbook (six lines: what it tests, first checks, manual repro, escalation, dashboard, owner). See the template in `references/platforms-and-ci.md`.

---

## SLA Validation

### Availability calculation

```
Availability = (total_minutes - downtime_minutes) / total_minutes × 100

Where:
  - total_minutes = calendar month in minutes (43,200 for a 30-day month)
  - downtime_minutes = minutes where synthetic probes detected failure

SLA tiers (downtime/month, monthly basis on 43,200 min):
  99.0%  = 432 min   = 7h 12min     (basic web app)
  99.9%  = 43.2 min  = 43min 12s    (business application)
  99.95% = 21.6 min  = 21min 36s    (critical SaaS)
  99.99% = 4.32 min  = 4min 19s     (infrastructure/platform)
```

> These are *common* availability targets, not prescriptive tiers. Pick targets from a user-impact analysis, not by tier name. Modern practice (Google SRE Workbook, OpenSLO) favors explicit SLO + error-budget policies over labelled tiers — define what user-visible failure looks like, set the budget user impact tolerates, and let the SLO follow. References: https://sre.google/workbook/ ; https://openslo.com/

### Response time percentiles

Track percentiles, not averages — averages hide the worst experiences.

```
SLA response time targets (example):
  Homepage load:  P50 < 1s,    P95 < 3s,   P99 < 5s
  API response:   P50 < 200ms, P95 < 500ms, P99 < 1s
  Search results: P50 < 500ms, P95 < 2s,   P99 < 4s
  Login flow:     P50 < 2s,    P95 < 5s,   P99 < 8s
```

### Error budget tracking

Error budget connects SLA targets to engineering decisions.

```
Error budget calculation:
  SLO: 99.9% availability on a 43,200-min month
  Budget: 0.1% of total time = 43.2 minutes/month

  Budget consumed this month: 12 minutes (28%)
  Budget remaining: 31.2 minutes (72%)

Actions by budget status:
  >50% remaining: normal operations, ship features
  25-50% remaining: caution, review recent changes
  <25% remaining: freeze non-critical deploys, focus on reliability
  Budget exhausted: incident mode, every deploy needs extra scrutiny
```

Exclude synthetic-probe downtime caused by your own maintenance windows from this calculation, or planned work shows as budget burn.

---

## Multi-Region Monitoring

Run probes from regions where your users are. A service that works from us-east-1 but is broken from ap-southeast-1 is broken for APAC users.

```
Region selection strategy:
  - Minimum 3 regions for global services
  - Always include: closest to primary infrastructure, largest user base, farthest from primary
  - Example for US-primary service: us-east-1, eu-west-1, ap-southeast-1
  - Example for EU-primary service: eu-west-1, us-east-1, ap-northeast-1
```

Track regional latency separately — a global average hides regional degradation.

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

**CDN validation.** Synthetic probes verify CDN caching by checking response headers (`x-cache`, `cf-cache-status`) for `HIT` and confirming the `server` header matches the expected provider. This catches CDN misconfigurations — and origin failures masked by a stale cache — before users hit slow uncached responses.

---

## Anti-Patterns

### Complex probes that break often
A probe that navigates 10 pages, fills 5 forms, and asserts on 20 elements is an E2E test, not a synthetic probe. When it breaks, you cannot tell if the app is down or the probe is flaky. **Fix:** one critical path per probe, under 30 seconds, under 5 assertions. A failure should make it immediately clear what is broken.

### Alerting on every single failure
Network blips, DNS hiccups, and transient cloud issues cause occasional failures. Alerting on every one produces noise that teaches the team to ignore alerts. **Fix:** require 2-3 consecutive failures and failures from 2+ regions before paging. Escalating severity: first failure logs, second warns, third pages.

### No test account isolation
Probes sharing one account interfere — one probe changes a setting, another fails because it expected the default. **Fix:** one dedicated synthetic account per concurrent probe, flagged synthetic, excluded from analytics and billing.

### Monitoring only the happy path
Probes that only check "page loads, returns 200" miss broken functionality behind a loading page. A login that returns 200 but never authenticates is not working. **Fix:** assert on meaningful content — data loads, auth succeeds, the core action completes, search returns results. One "can the user accomplish their goal" probe is worth ten "does the page return 200" probes.

### No runbook for probe failures
An alert fires at 3 AM. On-call sees "Login probe failing" but has no idea what to check first, what the probe does, or how to tell a real outage from a probe issue. **Fix:** every probe links a runbook (what it tests; first checks — third-party status, recent deploys, app telemetry; manual repro; escalation; dashboard link). See the template in `references/platforms-and-ci.md`.

**Emerging pattern (2026): agent-driven first response.** Tools like Checkly Rocky (GA 2026, automated root-cause analysis across check types) and Honeycomb Canvas Skills (Agent Observability, launched May 2026; open-source `honeycombio/agent-skill` repo ships a honeycomb-investigator and instrumentation-advisor for Claude Code and Cursor) read probe context + linked runbook + telemetry and post a candidate diagnosis to chat. Treat this as triage assist — it shortens MTTR for routine failures, but it does not replace on-call judgment for novel incidents.

---

## Failure Modes

| Symptom | Likely cause | Fix or check |
|---------|--------------|--------------|
| Probe green but users report an outage | Probe asserts only HTTP 200, not the goal | Add content/state assertions (dashboard heading, search results count, `body.status`) |
| Flapping alerts (fire/resolve repeatedly) | No consecutive-failure or multi-region rule | Require 2+ consecutive failures and 2+ regions before paging |
| Probe passes locally, fails in CI/region | Region-specific outage or CDN routing | Compare per-region results; check latency-difference and `x-cache` assertions |
| Probe failures with no real outage | Synthetic-account state drift (shared account) | One isolated account per concurrent probe; reset/seed stable data |
| Origin is down but probe stays green | CDN serving stale cache | Assert `cf-cache-status`/origin `server` header, not just 200 |
| Error budget burns with no incident | Maintenance windows counted as downtime | Suppress synthetic paging during maintenance; exclude window from budget math |
| On-call paged but can't act | Missing/empty runbook on the alert | Populate the six-line runbook; verify `{link_to_runbook}` resolves |
| Reliability numbers look too good | Synthetic traffic counted as real in SLO/RUM | Exclude `is_synthetic` traffic from RUM, billing, and error-budget pipelines |

---

## Verification

Prove the monitoring works before trusting it — smallest check first.

1. **Probes pass against staging.** Run `npx playwright test probes/ --reporter=list` against staging and confirm every probe passes within its declared timeout (no probe exceeds the 30s ceiling).
2. **A failure actually pages.** Point one probe at a known-bad URL (a `503` or a wrong path), let it run the configured consecutive-failure count, and confirm the alert routes to on-call within the SLA detection time — and resolves when you revert.
3. **Assertions are meaningful, not status-only.** Temporarily break the asserted content (rename the dashboard heading on staging) and confirm the probe fails. A probe that stays green here is asserting on the wrong thing.
4. **Synthetic traffic is excluded.** Query the analytics/RUM/billing pipeline for `is_synthetic` traffic and confirm it is filtered out.

---

## Done When

- A probe exists for every critical user journey identified in discovery (not only homepage uptime or a single health endpoint), and each asserts on the goal, not just a 2xx.
- Each probe's wall-clock budget is under 30s, with `retries: 0`.
- Alerting config encodes a ≥2 consecutive-failure rule AND a multi-region confirmation rule, and probe results are tagged with `severity` + `probe` so routes match.
- The SLA dashboard shows current availability and error-budget consumption, and synthetic traffic is excluded from RUM, billing, and error-budget pipelines.
- A test alert (probe pointed at a failing URL) reaches on-call within the SLA detection time — confirmed once, not assumed.
- Every probe links a non-empty runbook with first checks, manual repro, and an escalation path.
- A scheduled review job or recurring calendar item for monitoring health exists (not just an intention to review).

## Reference Files (in `references/`)

- **probe-implementations.md** — Runnable login-flow, API-health, and search probes, plus the environment-aware probe config.
- **platforms-and-ci.md** — GitHub Actions scheduling workflow, Checkly config, alert-routing rules + tagging note, and the per-probe runbook template.

## Related Skills

- **testing-in-production** — safe-release *techniques* (flags, canary, guardrail metrics) applied *during* a rollout; synthetic monitoring is the schedule-driven validation that runs continuously *after*.
- **release-readiness** — a one-shot post-deploy smoke gate tied to a specific release lives there; come here for the continuous, schedule-driven version that keeps running long after the release.
- **observability-driven-testing** — uses production telemetry (including signals from these probes) as *input* to design new tests; this skill instead *produces* the probes and their telemetry.
- **performance-testing** — load tests measure capacity on demand; synthetic probes track production performance *trends* between those load tests.
- **qa-metrics** — availability, response-time percentiles, and error-budget consumption from probes feed the quality dashboards defined there.
- **ci-cd-integration** — go there to wire synthetic probes into a pipeline as a post-deploy verification stage.
