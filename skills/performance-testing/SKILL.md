---
name: performance-testing
description: >-
  Test application performance with k6 load/stress/soak scripts, Lighthouse CI for
  Web Vitals, and performance budgets as CI gates. Covers load profiles, custom metrics,
  bottleneck identification, and Core Web Vitals monitoring.
  Use when: "performance test," "load test," "k6," "Lighthouse," "Web Vitals,"
  "stress test," "performance budget."
  Related: ci-cd-integration, qa-metrics, release-readiness.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Measure, assert, and protect application performance. This skill covers two domains: **load testing** (can the backend handle traffic?) and **web performance** (is the frontend fast for users?). Both use measurable budgets enforced in CI, not subjective "feels fast enough" assessments.
</objective>

---

## Discovery Questions

Before writing performance tests, gather context. Check `.agents/qa-project-context.md` first -- if it exists, use it and skip questions already answered there.

### What to Measure

- **Web performance or load testing?** Web performance measures user-perceived speed (Core Web Vitals, page load time). Load testing measures server capacity (requests per second, response time under load). Most products need both.
- **What are the critical user journeys for performance?** Not every endpoint needs load testing. Focus on high-traffic, revenue-critical, or latency-sensitive flows.
- **Are there existing performance budgets?** If yes, what are the targets? If no, this skill helps establish them.

### Current State

- **What is the current baseline performance?** You need numbers before you can set targets. Measure first, then define budgets.
- **What broke due to performance in the past?** Slow pages that lost users, endpoints that timed out under load, database queries that locked up.
- **Is there existing monitoring?** APM tools (Datadog, New Relic), Real User Monitoring (RUM), or synthetic monitoring that provides field data.

### Infrastructure

- **Where does load testing run?** Load tests should target staging or a dedicated load-test environment, never production without explicit coordination.
- **What is the expected traffic pattern?** Steady traffic, daily peaks, seasonal spikes (Black Friday), or event-driven bursts.
- **Are there rate limits, WAF rules, or auto-scaling that affect test results?** These must be accounted for in test design.

---

## Core Principles

### 1. Measure Before Optimizing

Performance intuition is unreliable. Developers often optimize the wrong thing. Measure first, identify the actual bottleneck, then optimize. A profiled 50ms improvement in the right place beats an assumed 500ms improvement in the wrong place.

### 2. Budgets as CI Gates

Performance budgets are only useful if they are enforced. A budget documented in a wiki but not checked in CI will be violated within weeks. Wire budgets into the pipeline so regressions fail the build.

### 3. Realistic Load Is More Valuable Than Maximum Stress

A stress test that pushes the system to 10x expected traffic tells you the breaking point. A load test at 1.5x expected traffic tells you whether tomorrow's real users will have a good experience. Both have value, but realistic load tests run more frequently and catch regressions earlier.

### 4. Core Web Vitals = User-Perceived Performance

Server-side metrics (response time, throughput) matter, but users experience performance through the browser. Core Web Vitals (LCP, INP, CLS) measure what users actually feel. A fast API that renders slowly in the browser is still slow to users.

### 5. Performance Is a Feature

Performance does not happen by accident. It requires dedicated test infrastructure, budgets, monitoring, and the same continuous attention as functional correctness. Treat performance regressions with the same urgency as functional bugs.

---

## k6 Load Testing

k6 is an open-source load testing tool that uses JavaScript/TypeScript for test scripts. It runs from the command line, integrates with CI, and outputs detailed metrics.

### Basic Load Test Script

```javascript
// load-tests/api-load.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const loginDuration = new Trend('login_duration', true);

export const options = {
  stages: [
    { duration: '1m', target: 20 },   // Ramp up to 20 users over 1 minute
    { duration: '3m', target: 20 },   // Stay at 20 users for 3 minutes
    { duration: '1m', target: 0 },    // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // 95th percentile under 500ms
    http_req_failed: ['rate<0.01'],                    // Less than 1% failure rate
    errors: ['rate<0.05'],                              // Custom error rate under 5%
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Login
  const loginStart = Date.now();
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: 'loadtest@example.com',
    password: 'testpassword',
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' },
  });
  loginDuration.add(Date.now() - loginStart);

  check(loginRes, {
    'login returns 200': (r) => r.status === 200,
    'login returns token': (r) => !!r.json('token'),
  }) || errorRate.add(1);

  const token = loginRes.json('token');

  // Fetch dashboard
  const dashboardRes = http.get(`${BASE_URL}/api/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: 'dashboard' },
  });

  check(dashboardRes, {
    'dashboard returns 200': (r) => r.status === 200,
    'dashboard has widgets': (r) => r.json('widgets') !== undefined,
  }) || errorRate.add(1);

  sleep(1); // Simulate user think time (1 second between actions)
}
```

### Load Profiles

| Profile | Question | Shape | Duration |
|---------|----------|-------|----------|
| **Constant** | Can the system handle normal traffic? | `vus: 50, duration: '10m'` | 10 min |
| **Ramp-up** | At what point does the system degrade? | Stages: 50 → 100 → 200 → 400 → 800 → 0 | 12 min |
| **Spike** | Does the system recover from sudden spikes? | 50 → spike to 500 → sustain → drop to 50 | 6 min |
| **Soak** | Does the system leak resources over time? | Ramp to 100, sustain 4 hours, ramp down | 4+ hours |

```javascript
// Spike test example
export const options = {
  stages: [
    { duration: '1m', target: 50 },    // Normal load
    { duration: '10s', target: 500 },   // Spike to 10x
    { duration: '2m', target: 500 },    // Sustain spike
    { duration: '10s', target: 50 },    // Drop back to normal
    { duration: '2m', target: 50 },     // Recovery period
  ],
};
```

### Custom Metrics and Tags

k6 provides four metric types: `Counter` (cumulative count), `Rate` (percentage), `Trend` (statistical distribution), `Gauge` (current value). Use tags to filter metrics by endpoint, scenario, or flow.

```javascript
import { Counter, Rate, Trend } from 'k6/metrics';

const ordersCreated = new Counter('orders_created');
const errorRate = new Rate('checkout_errors');
const checkoutDuration = new Trend('checkout_duration', true);

export default function () {
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/orders`, orderPayload, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: 'create_order', flow: 'checkout' },
  });
  checkoutDuration.add(Date.now() - start);
  res.status === 201 ? ordersCreated.add(1) : errorRate.add(1);
}
```

### Scenarios for Multi-Flow Testing

Scenarios simulate different user behaviors concurrently with per-scenario thresholds:

```javascript
export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 100, duration: '10m', exec: 'browseProducts' },
    checkout: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '2m', target: 20 }, { duration: '6m', target: 20 }], exec: 'performCheckout' },
    api_heavy: { executor: 'constant-arrival-rate', rate: 50, timeUnit: '1s', duration: '10m', preAllocatedVUs: 100, exec: 'apiHeavyOperations' },
  },
  thresholds: {
    'http_req_duration{scenario:browse}': ['p(95)<200'],
    'http_req_duration{scenario:checkout}': ['p(95)<500'],
  },
};
```

Each `exec` function defines a separate user flow. Tag requests with `{ tags: { name: 'endpoint_name' } }` for per-endpoint analysis.

### k6 CI Integration

```yaml
# GitHub Actions
name: Performance Tests
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 2 * * 1-5'  # Weekday nights

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install k6
      - name: Run load tests
        run: k6 run load-tests/api-load.js --out json=results.json
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: k6-results
          path: results.json
```

---

## Lighthouse CI

Lighthouse CI automates Google Lighthouse audits and enforces performance budgets in the pipeline.

```javascript
// lighthouserc.js
module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:3000/', 'http://localhost:3000/products', 'http://localhost:3000/checkout'],
      startServerCommand: 'npm run start',
      numberOfRuns: 3,
      settings: { preset: 'desktop' },
    },
    assert: {
      assertions: {
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
        'categories:performance': ['error', { minScore: 0.9 }],
        'resource-summary:script:size': ['warn', { maxNumericValue: 300000 }],
        'resource-summary:total:size': ['warn', { maxNumericValue: 1000000 }],
        'interactive': ['error', { maxNumericValue: 5000 }],
      },
    },
    upload: { target: 'temporary-public-storage' },
  },
};
```

```yaml
# CI: npm install -g @lhci/cli && lhci autorun
- name: Lighthouse CI
  run: npm install -g @lhci/cli && lhci autorun
  env:
    LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```

For historical tracking, self-host an LHCI server (`lhci server --storage.storageMethod=sql`) to detect gradual degradation and correlate performance changes with commits.

---

## Core Web Vitals

The three metrics Google uses to measure user-perceived performance.

### LCP (Largest Contentful Paint)

Measures loading performance -- when the largest visible content element finishes rendering.

| Rating | Threshold |
|--------|-----------|
| Good | <= 2.5s |
| Needs Improvement | 2.5s - 4.0s |
| Poor | > 4.0s |

**Common LCP issues and fixes:**
- Slow server response: optimize backend, add caching, use CDN
- Render-blocking resources: defer non-critical CSS/JS, inline critical CSS
- Slow resource load: optimize images (WebP/AVIF), preload LCP image
- Client-side rendering: use SSR/SSG for LCP content

### INP (Interaction to Next Paint)

Measures responsiveness -- the delay between user interaction and the next visual update.

| Rating | Threshold |
|--------|-----------|
| Good | <= 200ms |
| Needs Improvement | 200ms - 500ms |
| Poor | > 500ms |

**Common INP issues and fixes:**
- Long JavaScript tasks: break up long tasks with `scheduler.yield()` or `requestIdleCallback`
- Heavy event handlers: debounce/throttle input handlers, move computation to Web Workers
- Layout thrashing: batch DOM reads/writes, use `requestAnimationFrame`

### CLS (Cumulative Layout Shift)

Measures visual stability -- how much the page layout shifts during loading.

| Rating | Threshold |
|--------|-----------|
| Good | <= 0.1 |
| Needs Improvement | 0.1 - 0.25 |
| Poor | > 0.25 |

**Common CLS issues and fixes:**
- Images without dimensions: always set `width` and `height` attributes
- Dynamically injected content: reserve space with CSS `aspect-ratio` or `min-height`
- Web fonts causing FOUT: use `font-display: swap` with `size-adjust`
- Ads and embeds: reserve space with fixed-size containers

### Field vs. Lab Data

| | Lab Data | Field Data |
|---|----------|-----------|
| **Source** | Lighthouse, WebPageTest, Playwright | Chrome UX Report (CrUX), RUM tools |
| **Environment** | Simulated, controlled | Real users, real devices, real networks |
| **Use for** | Debugging, CI gates, pre-deployment | Understanding actual user experience |
| **Limitation** | Does not reflect real-world variance | Cannot reproduce specific conditions |

Use lab data for CI gates and debugging. Use field data for understanding the real user experience. A page that scores 100 in Lighthouse but has poor CrUX data has a real problem.

### Measuring in Playwright

Use `page.evaluate` with `PerformanceObserver` to capture LCP and CLS:

```typescript
test('checkout page meets Core Web Vitals', async ({ page }) => {
  await page.goto('/checkout');

  const lcp = await page.evaluate(() => new Promise<number>((resolve) => {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      resolve(entries[entries.length - 1].startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    setTimeout(() => resolve(-1), 10000);
  }));
  expect(lcp).toBeLessThan(2500);

  const cls = await page.evaluate(() => new Promise<number>((resolve) => {
    let score = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as any[]) { if (!e.hadRecentInput) score += e.value; }
    }).observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => resolve(score), 3000);
  }));
  expect(cls).toBeLessThan(0.1);
});
```

---

## Bottleneck Identification

When performance tests reveal problems, investigate in this order:

**1. Identify slow endpoints:** Create per-endpoint `Trend` metrics in k6 to see p50/p95/p99 for each API. The slowest endpoint is the first investigation target.

**2. Database queries:** Check for missing indexes (`EXPLAIN`), N+1 query patterns (use JOINs/batch), lock contention on write-heavy tables (optimize transactions), and unbounded result sets (add pagination).

**3. CDN/Caching:** Verify `cache-control` headers on static assets (`public, max-age=31536000, immutable`) and check `x-cache: HIT` rate.

**4. Third-party scripts:** Run Lighthouse with `blockedUrlPatterns` for analytics/chat/tracking scripts, compare scores with and without them to quantify their impact.

---

## Anti-Patterns

### Load Testing Production Without Coordination

Running load tests against production infrastructure without warning the operations team. Load tests can trigger auto-scaling (expensive), rate limiting (test fails), alerts (unnecessary pages), or actual outages (worst case). Always coordinate with operations and test against staging or a dedicated load-test environment.

### Unrealistic Load Scenarios

Testing with 10,000 concurrent users when the product has 500 daily active users. Or testing with uniform traffic when real traffic has peaks and valleys. Use analytics data to model realistic load profiles. If you do not have analytics, start with 2x your estimated peak and increase from there.

### Ignoring Server-Side Metrics

Running k6 and only looking at client-side response times. The server might be at 95% CPU, the database connection pool might be exhausted, or memory might be leaking. Correlate load test results with server metrics (CPU, memory, disk I/O, connection count, query execution time).

### Performance Testing Only Before Releases

Running load tests once per quarter before a major release. By then, dozens of performance regressions have accumulated and the root causes are impossible to trace. Run performance tests in CI on every merge to main, with budgets that catch regressions immediately.

### No Performance Budgets

Measuring performance without defining acceptable thresholds. A report that says "LCP is 3.2 seconds" is information. A CI gate that says "LCP must be under 2.5 seconds" is accountability. Define budgets, enforce them in CI, and treat violations as bugs.

### Optimizing Without Profiling

Spending days optimizing a function that contributes 2% of the total response time. Profile first, find the actual bottleneck, then optimize. The database query that takes 200ms is more impactful than the JavaScript function that takes 5ms.

### Testing With Empty Databases

Running load tests against a freshly seeded database with 100 records when production has 10 million. Query performance is radically different at scale. Seed the load-test environment with production-scale data (anonymized) before testing.

---

## Done When

- k6 script covers all target load scenarios: baseline (normal traffic), stress (ramp to breaking point), and soak (sustained load over hours).
- Performance budgets defined for critical flows and encoded as k6 thresholds (e.g., `p(95)<500`, `http_req_failed rate<0.01`) that fail the CI job when exceeded.
- Lighthouse CI configured with a `budget.json` that gates merges on LCP, INP, CLS, and total JS/resource size.
- Core Web Vitals baselines documented for each key page (home, checkout, dashboard) with Good/Needs Improvement/Poor classification.
- Test results include p95 and p99 latency, error rate, and throughput for each scenario, stored as CI artifacts.

## Related Skills

- **ci-cd-integration** -- Pipeline configuration for running k6 and Lighthouse CI, scheduling nightly performance runs, and gating deployments on performance budgets.
- **qa-metrics** -- Performance metrics (LCP, INP, CLS, p95 response time) as part of the broader QA metrics dashboard.
- **release-readiness** -- Performance benchmarks as part of the go/no-go release checklist.
- **qa-project-context** -- The project context file captures performance budgets, expected traffic patterns, and critical flows to test.
