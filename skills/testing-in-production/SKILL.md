---
name: testing-in-production
description: >-
  Validate software quality in production safely using feature flags, progressive
  rollouts, canary analysis, guardrail metrics, production smoke tests, and synthetic
  users. Bridges QA and SRE practices. Use when: "production testing," "feature flag
  testing," "canary deploy," "progressive rollout," "guardrail metrics," "dark launch."
  Related: release-readiness, synthetic-monitoring, observability-driven-testing, qa-metrics.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: production
---

<objective>
Production is the only environment that is production. Every other environment is an approximation. This skill covers how to validate software quality in production safely -- with controlled blast radius, automated rollback, and guardrail metrics that catch problems before users do.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there.

**Feature flag system:**
- Do you have a feature flag platform? (LaunchDarkly, Statsig — now part of OpenAI, GrowthBook, Unleash, Flagsmith, Harness FME — formerly Split, custom, none)
- How are flags managed? (Dashboard, config file, environment variables)
- Can flags target specific users, percentages, or segments?
- How many active flags exist today? Is there a cleanup process?

**Rollout capability:**
- Can you deploy to a subset of traffic? (Canary infrastructure, weighted routing, feature flags)
- How long does a deployment take? How long does a rollback take?
- Do you have blue-green or rolling deployments?
- Can you route traffic by region, user cohort, or percentage?

**Monitoring maturity:**
- What observability is in place? (APM, logging, error tracking, metrics)
- Do you have dashboards for error rate, latency, and business metrics?
- Are alerts configured with appropriate thresholds?
- Can you compare metrics between canary and baseline in real time?

**Production access and safety:**
- Who has production access? Is there an approval process?
- Are there dedicated test accounts in production?
- Can you run operations in production without affecting real user data?
- Is there a production incident response process?

---

## Core Principles

### 1. Production is the final test environment

Staging approximates production. It does not replicate production's data volume, traffic patterns, third-party integrations, infrastructure quirks, or user behavior. Testing in production is not reckless -- it is realistic. The question is not whether to test in production, but how to do it safely.

### 2. Safety through blast radius control

Every production test must answer: "If this goes wrong, how many users are affected?" The answer must be as small as possible. Feature flags, canary deploys, and traffic splitting exist to shrink the blast radius from 100% to 1% or less.

### 3. Always have a rollback plan

Before any production test begins, the rollback mechanism must be identified, tested, and fast. "Disable the flag" is a good rollback plan. "Redeploy the previous version" is acceptable. "We'll figure it out" is not a plan.

### 4. Monitoring is a prerequisite, not a nice-to-have

You cannot test in production without monitoring. If you cannot measure error rates, latency, and business metrics in real time, you cannot detect problems. Fix monitoring gaps before adding production tests.

### 5. Production tests must be non-destructive

Production tests must never corrupt real user data, send real notifications to real users, charge real payment methods, or create side effects that require manual cleanup. Synthetic accounts, test flags, and isolated resources are mandatory.

---

## Feature Flag Testing

Feature flags are the safest mechanism for production testing. They decouple deployment from release and provide instant rollback.

### Test with flags ON and OFF

Every flagged feature needs tests in both states. The flag-off path is the rollback path and must work flawlessly.

```typescript
// Test the feature-on experience
test('new checkout flow renders when flag is enabled', async ({ page }) => {
  await setFeatureFlag('new-checkout', true, { userId: TEST_USER_ID });
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Express Checkout' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay with saved card' })).toBeEnabled();
});

// Test the feature-off fallback
test('legacy checkout flow renders when flag is disabled', async ({ page }) => {
  await setFeatureFlag('new-checkout', false, { userId: TEST_USER_ID });
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'Payment details' })).toBeVisible();
});
```

### Flag lifecycle testing

Flags are not just on or off. They transition through states, and each transition must be validated.

```
Flag lifecycle:
  Created → Targeting internal users → Canary (1%) → Partial (10-50%) → Full (100%) → Cleanup (removed)

Test at each stage:
  - Internal: Feature works for internal accounts, hidden from external
  - Canary: Metrics are comparable between flag-on and flag-off cohorts
  - Partial: No performance degradation at scale
  - Full: All user segments work correctly
  - Cleanup: Code with flag removed behaves identically to flag-on
```

### Stale flag cleanup

Flags left in code become technical debt. Run a weekly CI job that queries the flag provider for flags that are 100% rolled out and older than 14 days. These are candidates for code cleanup -- the flag branching logic should be removed and only the enabled path retained.

### Flag combination testing

When multiple flags interact, test the combinations that matter. Do not test all 2^N combinations -- focus on flags that affect the same user flow.

```typescript
// Identify interacting flags by feature area
const checkoutFlags = ['new-checkout', 'express-pay', 'discount-engine-v2'];

// Test the critical combinations
const criticalCombinations = [
  { 'new-checkout': true, 'express-pay': true, 'discount-engine-v2': true },   // all new
  { 'new-checkout': true, 'express-pay': false, 'discount-engine-v2': true },  // mixed
  { 'new-checkout': false, 'express-pay': false, 'discount-engine-v2': false }, // all legacy
];

for (const combo of criticalCombinations) {
  test(`checkout with flags: ${JSON.stringify(combo)}`, async ({ page }) => {
    for (const [flag, value] of Object.entries(combo)) {
      await setFeatureFlag(flag, value, { userId: TEST_USER_ID });
    }
    await page.goto('/checkout');
    // Assert checkout completes without errors
    await page.getByRole('button', { name: /place order/i }).click();
    await expect(page.getByText(/order confirmed/i)).toBeVisible();
  });
}
```

---

## Progressive Rollout

> **Vendor-native canary analysis.** Before hand-rolling the rollout-policy YAML below, check whether your platform already does it: **LaunchDarkly Guarded Rollouts** (auto-monitored progressive rollouts with metric-based auto-rollback), **Statsig Auto-tune**, **Argo Rollouts AnalysisRun**, **Flagger**, **Harness Continuous Verification**. If you have one, prefer it — the integration with your metrics and rollback mechanics is cheaper than maintaining a custom analysis loop.
>
> **AI feature rollout** is its own pattern: model variant + prompt as a flag value, with cost guardrails and a kill switch. **LaunchDarkly AI Configs** is the documented path for shipping LLM features behind progressive rollout. See `release-readiness` for the full pattern.

### Canary stages: 1% to 100%

A structured rollout with explicit promotion criteria at each stage.

| Stage | Traffic | Hold Time | Key Checks |
|-------|---------|-----------|------------|
| Canary | 1% | 15-30 min | Error rate, crash rate, exceptions |
| Early adopters | 10% | 1-2 hours | Latency P95, conversion rate |
| Partial | 50% | 2-4 hours | All guardrails, business metrics |
| Full | 100% | 24 hours monitoring | Long-tail issues, batch job compatibility |

### Automated promotion criteria

Define machine-checkable conditions for advancing between stages. Human override remains available but should be rare.

```yaml
# rollout-policy.yaml
canary_to_10_percent:
  hold_duration: 30m
  conditions:
    - metric: error_rate_5xx
      comparison: less_than
      threshold: 0.5%
      window: 15m
    - metric: latency_p95
      comparison: less_than
      threshold: 500ms
      window: 15m
    - metric: crash_rate
      comparison: equals
      threshold: 0
      window: 15m

10_percent_to_50_percent:
  hold_duration: 2h
  conditions:
    - metric: error_rate_5xx
      comparison: less_than
      threshold: 0.5%
      window: 1h
    - metric: latency_p95
      comparison: less_than
      threshold: 500ms
      window: 1h
    - metric: conversion_rate
      comparison: within_percentage
      baseline: pre_deploy_average
      tolerance: 5%
      window: 1h

50_percent_to_100_percent:
  hold_duration: 4h
  conditions:
    - metric: error_rate_5xx
      comparison: less_than
      threshold: 0.3%
      window: 2h
    - metric: all_guardrails
      comparison: passing
      window: 2h
    - metric: customer_reported_issues
      comparison: equals
      threshold: 0
```

### Rollback triggers

Automatic rollback fires when guardrails are breached. No human approval needed.

```yaml
automatic_rollback:
  - condition: error_rate_5xx > 2x_baseline
    for: 5m
    action: rollback_to_previous
    notify: [oncall-slack, pagerduty]

  - condition: latency_p99 > 3x_baseline
    for: 5m
    action: rollback_to_previous
    notify: [oncall-slack]

  - condition: crash_rate > 0.1%
    for: 2m
    action: rollback_to_previous
    notify: [oncall-slack, pagerduty, engineering-leads]

  - condition: health_check_failures > 3_consecutive
    action: rollback_immediately
    notify: [oncall-slack, pagerduty]
```

---

## Production Smoke Tests

### Post-deploy critical path tests

Run immediately after every deployment. These verify that the application's core functionality works with production configuration, data, and infrastructure.

```typescript
// production-smoke.spec.ts
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PRODUCTION_URL!;
const SMOKE_USER = process.env.SMOKE_TEST_EMAIL!;
const SMOKE_PASS = process.env.SMOKE_TEST_PASSWORD!;

test.describe('Production Smoke', () => {
  test.describe.configure({ retries: 1, timeout: 30_000 });

  test('application loads and responds', async ({ request }) => {
    const health = await request.get(`${PROD_URL}/api/health`);
    expect(health.ok()).toBeTruthy();
    const body = await health.json();
    expect(body.status).toBe('healthy');
    expect(body.version).toBeDefined();
  });

  test('authentication flow works', async ({ page }) => {
    await page.goto(`${PROD_URL}/login`);
    await page.getByLabel('Email').fill(SMOKE_USER);
    await page.getByLabel('Password').fill(SMOKE_PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('core data loads correctly', async ({ page }) => {
    // Assumes auth state from storageState
    await page.goto(`${PROD_URL}/dashboard`);
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('row')).not.toHaveCount(0);
  });

  test('search returns results', async ({ page }) => {
    await page.goto(`${PROD_URL}/search`);
    await page.getByRole('searchbox').fill('test query');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('listitem')).not.toHaveCount(0);
  });
});
```

### Synthetic user accounts

Production test accounts must be clearly distinguishable from real users.

```
Synthetic account conventions:
  - Email pattern: smoke-test+{env}@yourcompany.com
  - Display name: "[SYNTHETIC] Smoke Test User"
  - Flag: is_synthetic = true in user record
  - Excluded from: analytics, billing, email campaigns, support queues
  - Data isolation: test data uses reserved ID ranges or namespaces

Account management:
  - Create accounts via admin API, not through the UI
  - Rotate credentials quarterly
  - Store credentials in secrets manager (Vault, AWS Secrets Manager)
  - Never reuse synthetic accounts across different test suites
```

### Non-destructive assertions

Production smoke tests must read, not write. When writes are unavoidable, clean up immediately.

```typescript
// Pattern: create-verify-cleanup
test('can create and delete a draft', async ({ page }) => {
  await page.goto(`${PROD_URL}/documents`);
  // Create
  await page.getByRole('button', { name: 'New document' }).click();
  await page.getByLabel('Title').fill('[SMOKE TEST] Auto-cleanup');
  await page.getByRole('button', { name: 'Save draft' }).click();
  const url = page.url();

  // Verify
  await expect(page.getByText('[SMOKE TEST] Auto-cleanup')).toBeVisible();

  // Cleanup -- always runs, even on test failure
  test.afterEach(async ({ request }) => {
    const docId = url.split('/').pop();
    await request.delete(`${PROD_URL}/api/documents/${docId}`, {
      headers: { Authorization: `Bearer ${process.env.SMOKE_TEST_TOKEN}` },
    });
  });
});
```

---

## Guardrail Metrics

### What to monitor during rollout

| Category | Metric | Comparison Method | Alert Threshold |
|----------|--------|-------------------|-----------------|
| Errors | HTTP 5xx rate | vs. pre-deploy baseline | >2x baseline for 5 min |
| Errors | Unhandled exception count | vs. pre-deploy baseline | Any new exception type |
| Latency | P50 response time | vs. pre-deploy baseline | >1.5x baseline |
| Latency | P95 response time | vs. pre-deploy baseline | >2x baseline |
| Latency | P99 response time | vs. pre-deploy baseline | >3x baseline |
| Business | Conversion rate | vs. 7-day average | Drop >5% |
| Business | Revenue per session | vs. 7-day average | Drop >10% |
| Client | Crash rate (mobile) | vs. previous release | >0.1% increase |
| Client | JavaScript error rate | vs. pre-deploy baseline | >2x baseline |
| Infra | CPU utilization | absolute | >80% sustained |
| Infra | Memory utilization | absolute | >85% sustained |

### Baseline comparison

Compare canary metrics against a control group running the previous version, not against historical data alone.

```
Comparison approaches (best to worst):
  1. Canary vs. control: split traffic, compare groups in real time (best)
  2. Before/after: compare post-deploy metrics to pre-deploy window (good)
  3. Historical: compare to same time last week (acceptable for trends)
  4. Absolute thresholds: fixed thresholds regardless of baseline (fragile)
```

### Statistical significance

For business metrics (conversion, revenue), small sample sizes produce noisy results. Wait for statistical significance before drawing conclusions.

```
Minimum sample sizes for rollout decisions:
  - Error rate: 1,000 requests (errors are rare events, need volume)
  - Latency: 500 requests (more stable, converges faster)
  - Conversion rate: 5,000 sessions (business metrics have high variance)
  - Crash rate: 10,000 app launches (crashes are rare events)

Rule of thumb: if you don't have enough traffic at 1% to reach
significance in 30 minutes, increase to 5% or extend the hold window.
```

---

## Dark Launches

Dark launches deploy new functionality to production but hide it from users. Real production traffic exercises the new code path without user-visible impact.

### Traffic shadowing

Duplicate incoming requests to the new service. Compare responses without returning the new response to the user.

```
Request flow:
  User → Load Balancer → Production Service (returns response to user)
                       ↘ Shadow Service (processes request, logs result, discards)

What to compare:
  - Response status codes: shadow should match production
  - Response body: diff for semantic equivalence (ignore timestamps, IDs)
  - Latency: shadow should not be significantly slower
  - Error rate: shadow should not produce more errors
```

### Parallel execution

For migrations (new database, new algorithm, new service), run both the old and new path in production. The old path returns the result to the user; the new path runs asynchronously, logs differences, and discards its result. Track the match rate over time -- target 99%+ match before cutting over.

```
Shadow launch timeline:
  Week 1: Deploy shadow, start comparing, expect <50% match
  Week 2: Fix mismatches, match rate should climb to 90%+
  Week 3: Match rate stable at 99%+, handle remaining edge cases
  Week 4: Cut over: shadow becomes primary, old becomes shadow
  Week 5: Remove old path after 1 week of stability
```

---

## Anti-Patterns

### Testing in production without monitoring

Running production tests without dashboards and alerts is flying blind. You will not know if your tests caused an issue until a user reports it.

**Fix:** Monitoring is a prerequisite. Before adding any production test, verify you can see error rates, latency, and key business metrics in real time. Set up alerts before the first test runs.

### No rollback plan

"We'll deploy a fix if something goes wrong" is not a rollback plan. Under pressure, fixes take longer, introduce new bugs, and extend the outage.

**Fix:** Every production test or rollout must have a documented rollback mechanism that takes less than 5 minutes to execute. Feature flag disable, previous deployment, or traffic reroute.

### Destructive operations in production tests

Production tests that create real orders, send real emails, or modify real user data are not tests -- they are incidents waiting to happen.

**Fix:** Use synthetic accounts flagged as test data. Use sandbox modes for payment and email. Clean up any created data immediately. If a test cannot be made non-destructive, it does not belong in production.

### Testing in production instead of pre-production

Production testing supplements pre-production testing. It does not replace it. If your staging environment is broken and you are "testing in production" because it is the only working environment, fix staging first.

**Fix:** Maintain a working pre-production environment. Use production testing for what only production can validate: real traffic, real data volumes, real third-party integrations.

### Canary deploys without comparison

Deploying to 1% of traffic but not comparing canary metrics against a control group misses the entire point. You are just deploying slowly, not detecting problems.

**Fix:** Always compare canary metrics against a baseline. Use side-by-side dashboards or automated canary analysis tools (Kayenta, Argo Rollouts analysis).

### Stale feature flags

Flags that are fully rolled out but never removed accumulate. After a year, you have 200 flags with unknown interactions, and every code path has branching logic that nobody understands.

**Fix:** Every flag gets an expiration date at creation time. After full rollout + 2 weeks of stability, remove the flag. Track flag age and alert when flags exceed their expiration.

---

## Done When

- Feature flag rollout plan is documented with explicit percentage steps (1% → 10% → 50% → 100%) and named guardrail metrics at each stage
- Canary analysis is configured with automated pass/fail criteria so promotion and rollback decisions do not require manual metric comparison
- Production smoke tests run as a pipeline stage on every deploy (not only in CI pre-deploy)
- Rollback trigger conditions are defined, documented, and verified to fire correctly (e.g., tested in staging before first production use)
- Production test data strategy is documented, specifying whether synthetic users or anonymized real users are used and how they are excluded from analytics and billing

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `release-readiness` | Production testing is part of the post-deploy verification in the release process |
| `synthetic-monitoring` | Ongoing production validation after the rollout is complete |
| `observability-driven-testing` | Traces and logs from production inform which tests to write |
| `qa-metrics` | Guardrail metrics and rollout criteria feed into QA dashboards |
| `ci-cd-integration` | Production smoke tests run as a CI pipeline stage post-deployment |
| `test-environments` | Production testing complements, not replaces, pre-production environments |
