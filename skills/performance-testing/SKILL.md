---
name: performance-testing
description: >-
  Test application performance with k6 load/stress/soak/spike scripts and k6 scenarios,
  Lighthouse CI for Web Vitals, and performance budgets as CI gates. Covers load profiles,
  custom metrics, bottleneck identification, and Core Web Vitals (LCP, INP, CLS).
  Use when: "performance test," "load test," "stress test," "soak test," "spike test,"
  "k6," "k6 scenarios," "Lighthouse," "Web Vitals," "Core Web Vitals," "performance budget."
  Not for: scheduled production probes — use synthetic-monitoring; pixel-diff regressions —
  use visual-testing; designing tests from prod telemetry — use observability-driven-testing.
  Related: ci-cd-integration, qa-metrics, release-readiness.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
Measure, assert, and protect application performance with budgets enforced in CI, not
subjective "feels fast enough" assessments. This skill covers two domains: **load testing**
(can the backend handle traffic?) and **web performance** (is the frontend fast for users?).
A report that says "LCP is 3.2s" is information; a CI gate that fails the build at 2.5s is
accountability.
</objective>

## Quick Route

| You need to... | Go to |
|----------------|-------|
| Test backend capacity / throughput / latency under traffic | **k6 Load Testing** → `references/recipes.md` |
| Pick a load shape (constant / ramp / spike / soak) | **Load Profiles** table |
| Measure frontend speed for real users (LCP, INP, CLS) | **Web Performance** + **Core Web Vitals** |
| Gate page perf in CI | **Lighthouse CI** (gate TBT, not INP — see below) |
| A budget is breached and you must find why | **Bottleneck Identification** |
| Migrate an existing suite from k6 v1 → v2 | **k6 v2 Migration** callout |

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip questions
already answered there.

### What to Measure
- **Web performance or load testing?** Web performance measures user-perceived speed (Core Web Vitals, page load). Load testing measures server capacity (RPS, latency under load). Most products need both.
- **Which user journeys are performance-critical?** Not every endpoint needs load testing. Focus on high-traffic, revenue-critical, or latency-sensitive flows.
- **Existing performance budgets?** If yes, what are the targets? If no, this skill helps establish them — measure baseline first.

### Current State
- **What is the current baseline?** You need numbers before you can set targets. Measure first, then define budgets.
- **What broke due to performance before?** Slow pages that lost users, endpoints that timed out under load, queries that locked up — these point at where to focus.
- **Existing monitoring?** APM (Datadog, New Relic), RUM, or synthetic probes give you field data to model realistic load.

### Infrastructure
- **Where does load testing run?** Target staging or a dedicated load-test environment, never production without explicit operations coordination.
- **Expected traffic pattern?** Steady, daily peaks, seasonal spikes (Black Friday), or event-driven bursts — this picks the load profile.
- **Rate limits, WAF rules, or auto-scaling in the path?** These distort results and must be accounted for in test design.

## Core Principles

### 1. Measure before optimizing
Performance intuition is unreliable; developers routinely optimize the wrong thing. Profile first, identify the actual bottleneck, then optimize. A profiled 50ms win in the right place beats an assumed 500ms win in the wrong one.

### 2. Budgets are only real if CI enforces them
A budget documented in a wiki but not checked in CI is violated within weeks. Wire budgets into the pipeline as k6 thresholds and Lighthouse assertions so regressions fail the build, not a quarterly review.

### 3. Realistic load beats maximum stress
A stress test to 10x traffic tells you the breaking point. A load test at 1.5x expected traffic tells you whether tomorrow's real users have a good experience. Both have value, but realistic load runs more often and catches regressions earlier.

### 4. Core Web Vitals are what users actually feel
Server-side metrics (latency, throughput) matter, but users experience performance through the browser. LCP, INP, and CLS measure perceived speed. A fast API that renders slowly is still slow to users.

### 5. Performance is a feature
It does not happen by accident. It needs dedicated test infrastructure, budgets, and monitoring, and the same continuous attention as functional correctness. Treat a performance regression with the same urgency as a functional bug.

## k6 Load Testing

k6 is an open-source load testing tool that uses JavaScript/TypeScript for scripts, runs
from the CLI, and integrates with CI. **Current stable: k6 v2.0.0** (final shipped
2026-05). v2 has breaking changes from v1 — see the migration callout below.

A load test is built from three pieces: a **load profile** (the `stages`/`scenarios`
shape), **checks** (per-request assertions), and **thresholds** (pass/fail budgets that
set the exit code). Always drive the base URL from `__ENV` so the same script runs against
local, staging, and CI.

See `references/recipes.md` for the full basic load test, custom metrics, and scenarios.
A minimal threshold block:

```javascript
export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 20 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};
```

### Load Profiles

| Profile | Question | Shape | Duration |
|---------|----------|-------|----------|
| **Constant** | Can the system handle normal traffic? | `vus: 50, duration: '10m'` | 10 min |
| **Ramp-up (stress)** | At what point does it degrade? | 50 → 100 → 200 → 400 → 800 → 0 | 12 min |
| **Spike** | Does it recover from a sudden surge? | 50 → spike 500 → sustain → drop 50 → recover | 6 min |
| **Soak** | Does it leak resources over time? | Ramp to 100, sustain 4h, ramp down | 4+ hours |

A spike test is not done until "does it recover?" is an **assertion, not a comment**. Tag
the post-spike window (e.g. `phase:recovery`) and scope a threshold to it so the run fails
if p95 stays elevated. See the recovery-detection recipe in `references/recipes.md`.

### Custom Metrics and Scenarios

k6 has four metric types: `Counter` (cumulative count), `Rate` (proportion of non-zero/true
values, 0..1), `Trend` (statistical distribution — p50/p95/p99), `Gauge` (latest value). Tag
requests with `{ tags: { name: 'endpoint' } }` to filter metrics per endpoint, scenario, or
flow.

**Scenarios** run distinct user flows concurrently, each with its own executor and
per-scenario thresholds (`'http_req_duration{scenario:checkout}': ['p(95)<500']`). Use them
to model a real mix — browsers + checkout + API-heavy load at once. Full custom-metric and
scenario examples are in `references/recipes.md`.

### k6 CI Integration

Install k6 with the official **`grafana/setup-k6-action@v1`** — not a hand-rolled apt/gpg
keyserver block (brittle, rots, no version pin). k6 exits non-zero when any threshold is
breached, so a breached budget fails the job with no extra wiring. The full GitHub Actions
workflow (checkout → setup-k6 → run → upload artifact) is in `references/recipes.md`.

> **k6 v1 → v2 migration (v2.0.0 final, 2026-05):**
> - `k6/experimental/websockets` → `k6/websockets` (drop the `experimental/` prefix; stable now)
> - `k6/experimental/redis` → **`k6/x/redis`** — NOT removed. The import auto-resolves the
>   `xk6-redis` extension (auto-extension-resolution is on by default; JS usage unchanged).
>   Do not hand-roll a Redis client.
> - `externally-controlled` executor removed
> - `options.ext.loadimpact` removed → use `options.cloud` (Grafana Cloud k6, formerly k6 Cloud / Load Impact)
> - CLI: `--no-summary` → **`--summary-mode=disabled`**; `--upload-only` → `k6 cloud upload script.js`;
>   `k6 login`/`pause`/`resume`/`scale`/`status` removed (use `k6 cloud login`, etc.); positional `k6 cloud script.js` removed
> - Exit code **97** is new: a non-threshold cloud-side abort. Wire it into CI handling.
> Reference: https://grafana.com/docs/k6/latest/get-started/migrating-to-v2/

## Web Performance

### Lighthouse CI

Lighthouse CI (`@lhci/cli`) automates Google Lighthouse audits and enforces budgets in the
pipeline via `lighthouserc.js` assertions. Current: `@lhci/cli` 0.15.x on the Lighthouse 12.6
engine. The project is in maintenance mode (last release ~a year ago) and does not yet
support Lighthouse 13 (needs Node 22.19+); it remains the standard CI surface for Lighthouse,
but watch upstream before adopting in greenfield projects.

The full `lighthouserc.js` (LCP/CLS/TBT/perf-score assertions) and the `lhci autorun` CI
step are in `references/recipes.md`.

### INP is field-only — gate TBT in the lab

This is the single most-misunderstood point in web perf, so be precise:

- **INP (Interaction to Next Paint) is a field-only metric.** A Lighthouse lab audit loads
  a page with no user interaction, so it **cannot measure or score INP**. Asserting
  `interaction-to-next-paint` in a standard `lhci autorun` run gates something Lighthouse
  never produces.
- **In the lab, gate Total Blocking Time (TBT)** as the proxy: assert
  `'total-blocking-time': ['error', { maxNumericValue: 200 }]`. TBT correlates with INP but
  is not identical (a page can hit 0ms TBT and still fail field INP).
- **Track real INP from the field** — Chrome UX Report (CrUX) or your RUM tool. That is the
  number users actually experience and the one Google ranks on.
- **Only if you must measure scripted-interaction latency**, use Lighthouse user-flow /
  timespan mode with scripted clicks, or `k6/browser` with a `PerformanceObserver` on
  `event` entries. Treat that as a scripted lab proxy, still not field INP.

> **FID is gone:** FID was deprecated and `web-vitals` v5+ removed it; INP became a Core Web
> Vital in March 2024. Do not assert on FID in any new code.

### Measuring CWV in Playwright

For a per-page lab check inside your existing Playwright suite, use `page.evaluate` with a
`PerformanceObserver` to capture LCP and CLS (both observe cleanly on page load), then assert
the thresholds. Full test in `references/recipes.md`. For under-load CWV capture, use the
`k6/browser` recipe in the same file.

## Core Web Vitals

The three metrics Google uses for user-perceived performance.

| Metric | Measures | Good | Needs Improvement | Poor |
|--------|----------|------|-------------------|------|
| **LCP** (Largest Contentful Paint) | Loading — when the largest element renders | ≤ 2.5s | 2.5s–4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | Responsiveness — interaction → next paint (field-only) | ≤ 200ms | 200ms–500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | Visual stability — unexpected layout movement | ≤ 0.1 | 0.1–0.25 | > 0.25 |

**Common fixes:**
- **LCP** — slow server (cache/CDN, SSR/SSG the LCP content), render-blocking CSS/JS (defer, inline critical CSS), slow image load (WebP/AVIF, `preload` the LCP image).
- **INP** — long JS tasks (`scheduler.yield()`, `requestIdleCallback`), heavy handlers (debounce/throttle, Web Workers), layout thrashing (batch DOM reads/writes via `requestAnimationFrame`).
- **CLS** — set `width`/`height` on images, reserve space for injected content (`aspect-ratio`/`min-height`), `font-display: swap` with `size-adjust`, fixed-size containers for ads/embeds.

### Field vs. Lab Data

| | Lab Data | Field Data |
|---|----------|-----------|
| **Source** | Lighthouse, WebPageTest, Playwright, k6/browser | Chrome UX Report (CrUX), RUM tools |
| **Environment** | Simulated, controlled | Real users, real devices, real networks |
| **Use for** | Debugging, CI gates, pre-deployment | Understanding actual user experience |
| **Limitation** | No real-world variance; no field INP | Cannot reproduce specific conditions |

Use lab data for CI gates and debugging; use field data to understand the real user
experience. A page that scores 100 in Lighthouse but has poor CrUX data has a real problem —
and INP only ever shows up in the field column.

## Bottleneck Identification

When a budget is breached, investigate in this order — never guess, never optimize before
profiling:

1. **Identify the slow endpoint.** Per-endpoint `Trend` metrics in k6 give p50/p95/p99 per API. The slowest is the first target.
2. **Database.** Check missing indexes (`EXPLAIN`), N+1 patterns (JOIN/batch), lock contention on write-heavy tables (optimize transactions), unbounded result sets (paginate).
3. **CDN/caching.** Verify `cache-control` on static assets (`public, max-age=31536000, immutable`) and the `x-cache: HIT` rate.
4. **Third-party scripts.** Run Lighthouse with `blockedUrlPatterns` for analytics/chat/tracking; compare scores with and without to quantify the cost.
5. **Correlate with server metrics.** Client-side latency alone hides the cause — check CPU, memory, disk I/O, connection-pool saturation, and query execution time during the run.

## Anti-Patterns

### 1. Load testing production without coordination
Load tests can trigger auto-scaling (expensive), rate limiting (test fails), alerts (unnecessary pages), or outages. Always coordinate with operations and target staging or a dedicated load-test environment.

### 2. Unrealistic load scenarios
Testing 10,000 concurrent users when the product has 500 DAU, or uniform traffic when real traffic has peaks. Model load from analytics; absent that, start at 2x estimated peak and increase.

### 3. Ignoring server-side metrics
Looking only at k6's client-side response times. The server may be at 95% CPU, the connection pool exhausted, or memory leaking. Correlate load results with server metrics.

### 4. Performance testing only before releases
A quarterly pre-release load test lets dozens of regressions accumulate with untraceable root causes. Run in CI on every merge to main with budgets that catch regressions immediately.

### 5. No performance budgets
"LCP is 3.2s" is information; "LCP must be under 2.5s" is a gate. Define budgets, enforce them as k6 thresholds and Lighthouse assertions, and treat violations as bugs.

### 6. Asserting INP in standard Lighthouse CI
Standard `lhci autorun` lab mode cannot produce an INP audit — no user interaction. Gating `interaction-to-next-paint` there gates a number Lighthouse never measures. Gate `total-blocking-time` as the lab proxy and track real INP from CrUX/RUM.

### 7. Optimizing without profiling
Spending days on a function that is 2% of response time. Profile, find the actual bottleneck, then optimize. The 200ms query beats the 5ms JS function every time.

### 8. Testing with empty databases
Load testing against 100 seeded rows when production has 10 million. Query performance is radically different at scale. Seed the load-test environment with production-scale (anonymized) data first.

## Verification

Prove the artifacts actually work before claiming done:

- **k6 script:** `k6 run --summary-mode=disabled load-tests/api-load.js` exits **0** and the
  end-of-test summary shows every `thresholds` line green (`✓`). A red threshold line means a
  breached budget and a non-zero exit.
- **Spike recovery:** run the spike script and confirm the `{phase:recovery}` threshold
  appears in the summary and passes — proving recovery is asserted, not just commented.
- **Lighthouse CI:** `lhci autorun` exits **0** with all `['error', ...]` assertions passing;
  a breached LCP/CLS/TBT assertion exits non-zero.

## Done When

- k6 scripts cover the target load profiles: baseline (constant), stress (ramp to breaking point), and soak (sustained), each with `__ENV`-driven base URL.
- Spike test asserts recovery via a threshold scoped to the post-spike window (e.g. `http_req_duration{phase:recovery}`), not just a `// recovery` comment.
- Performance budgets encoded as k6 thresholds (e.g. `p(95)<500`, `http_req_failed rate<0.01`) that fail the CI job when exceeded.
- Lighthouse CI `lighthouserc.js` gates merges on `largest-contentful-paint`, `cumulative-layout-shift`, and `total-blocking-time` (the lab proxy for INP) as `['error', ...]` assertions; real INP tracked from CrUX/RUM, not asserted in lab.
- Core Web Vitals baselines documented for each key page (home, checkout, dashboard) with Good/Needs Improvement/Poor classification.
- Test results include p95 and p99 latency, error rate, and throughput per scenario, stored as CI artifacts.

## Reference Files (in `references/`)

- **recipes.md** — runnable artifacts: basic k6 load test, spike-with-recovery detection, custom metrics, scenarios, k6 CI workflow (`grafana/setup-k6-action`), `lighthouserc.js`, the `k6/browser` CWV-under-load example, and the Playwright LCP/CLS test.

## Related Skills

- **ci-cd-integration** — pipeline wiring for k6 and Lighthouse CI, scheduling nightly runs, gating deployments on budgets.
- **qa-metrics** — LCP/INP/CLS and p95 latency as part of the broader QA metrics dashboard.
- **release-readiness** — performance benchmarks in the go/no-go checklist.
- **synthetic-monitoring** — scheduled production CWV/uptime probes *after* release; this skill is pre-release lab gating.
- **observability-driven-testing** — when prod telemetry is the *input* to designing new perf tests.
- **qa-project-context** — captures performance budgets, traffic patterns, and critical flows to test.
