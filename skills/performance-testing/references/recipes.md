# Performance Testing Recipes

Runnable artifacts for the performance-testing skill. The decision prose, principles,
and Done When criteria live in `SKILL.md`; this file holds the heavy code.

## Basic k6 Load Test

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

## Spike Test With Recovery Detection

A spike test is only complete when "does it recover?" is an assertion, not a comment.
Tag each phase, then scope a threshold to the post-spike `recovery` window so the run
fails if p95 does not return to near-baseline. Compare against the normal-load threshold
to prove the system actually came back.

```javascript
import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },    // Normal load
    { duration: '10s', target: 500 },   // Spike to 10x
    { duration: '2m', target: 500 },    // Sustain spike
    { duration: '10s', target: 50 },    // Drop back to normal
    { duration: '2m', target: 50 },     // Recovery period
  ],
  thresholds: {
    // Baseline: p95 under 500ms during the initial normal phase.
    'http_req_duration{phase:normal}': ['p(95)<500'],
    // Recovery assertion: after the spike, p95 must return to within ~20% of
    // baseline. If it stays elevated, the system did NOT recover -> CI fails.
    'http_req_duration{phase:recovery}': ['p(95)<600'],
    // Optional: error rate must also settle back during recovery.
    'http_req_failed{phase:recovery}': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Tag each request with the current phase so the scoped thresholds above resolve.
function phase() {
  const t = (Date.now() - __ENV.START) / 1000;
  if (t > 200) return 'recovery';      // last ~2m window
  if (t > 70 && t < 190) return 'spike';
  return 'normal';
}

export function setup() { return { start: Date.now() }; }

export default function () {
  http.get(`${BASE_URL}/api/dashboard`, { tags: { phase: phase() } });
  sleep(1);
}
```

For a simpler version, drive phases off `exec.scenario` stage timing or split the spike
and recovery into separate `scenarios` with their own thresholds.

## Custom Metrics and Tags

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

## Scenarios for Multi-Flow Testing

Scenarios simulate different user behaviors concurrently with per-scenario thresholds.
Each `exec` function defines a separate user flow.

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

## k6 CI Integration (GitHub Actions)

Use the official `grafana/setup-k6-action` instead of hand-rolled apt/gpg installs —
fewer moving parts, pins a version, and optionally installs Chrome for `k6/browser`.

```yaml
# .github/workflows/performance.yml
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
      - name: Set up k6
        uses: grafana/setup-k6-action@v1
        with:
          k6-version: '2.0.0'
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

k6 exits non-zero when any threshold is breached, so a breached budget fails the job
with no extra wiring. Watch for **exit code 97** (new in v2): a non-threshold cloud-side
abort — handle it explicitly if you run against Grafana Cloud k6.

## Lighthouse CI Config

INP is field-only — Lighthouse lab mode cannot measure it. Gate `total-blocking-time`
as the lab proxy; track real INP from CrUX/RUM (see SKILL.md, "INP is field-only").

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
        'total-blocking-time': ['error', { maxNumericValue: 200 }], // lab proxy for INP
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
# CI step
- name: Lighthouse CI
  run: npm install -g @lhci/cli && lhci autorun
  env:
    LHCI_GITHUB_APP_TOKEN: ${{ secrets.LHCI_GITHUB_APP_TOKEN }}
```

For historical tracking, self-host an LHCI server
(`lhci server --storage.storageMethod=sql`) to detect gradual degradation and correlate
performance changes with commits.

## k6 Browser Module — Core Web Vitals Under Load

The `k6/browser` module (built on Playwright) is stable in k6 1.x and 2.x. Use it to
capture Core Web Vitals under load, and to measure INP under *scripted* interaction
(field INP still requires CrUX/RUM). Enable Chrome in `setup-k6-action` with
`browser: true`.

```javascript
import { browser } from 'k6/browser';
import { check } from 'k6';

export const options = {
  scenarios: {
    ui: {
      executor: 'shared-iterations',
      options: { browser: { type: 'chromium' } },
      vus: 5, iterations: 25,
    },
  },
};

export default async function () {
  const page = await browser.newPage();
  try {
    await page.goto(__ENV.BASE_URL || 'http://localhost:3000');
    const lcp = await page.evaluate(() => new Promise((resolve) => {
      new PerformanceObserver((list) => resolve(list.getEntries().pop()?.startTime ?? 0)).observe({ type: 'largest-contentful-paint', buffered: true });
    }));
    check(lcp, { 'LCP < 2500ms': (v) => v < 2500 });
  } finally {
    await page.close();
  }
}
```

## Measuring Core Web Vitals in Playwright

Use `page.evaluate` with `PerformanceObserver` to capture LCP and CLS in a lab test.

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

LCP and CLS observe cleanly in a page-load audit. To approximate INP, drive a real
interaction (click/type) and observe `event`/`first-input` entries — but treat that as
a scripted lab proxy, not the field INP users actually experience.
