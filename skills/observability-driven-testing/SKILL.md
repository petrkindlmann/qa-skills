---
name: observability-driven-testing
description: >-
  Use production telemetry as INPUT to design new tests. Covers OpenTelemetry
  integration with tests, trace-based assertions, log-informed test creation,
  production-error analysis for coverage gaps, and telemetry-driven test
  prioritization. Use when: "trace-based testing," "design tests from logs,"
  "OpenTelemetry assertions," "production errors point to test gaps,"
  "telemetry-driven testing." Not for: safe rollout techniques (flags, canary)
  during release — use testing-in-production. Not for: scheduled post-deploy
  probes — use synthetic-monitoring. Not for: triaging CI failures — use
  ai-bug-triage.
  Related: testing-in-production, synthetic-monitoring, qa-metrics, ai-bug-triage.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: production
---

<objective>
Production is the richest source of test design input: every error log, slow trace, and latency spike tells you where tests are missing. This skill closes the feedback loop between production observability and test creation, and makes trace structure a test assertion. A `200 OK` that silently hit the database on a path meant to be cache-only passes an HTTP assertion — a trace assertion catches it. Output: instrumented test runners, trace-based assertions, and a production-error-to-test pipeline.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Make test execution emit traces correlated with the app | OTel test-runner setup (`references/trace-assertions.md`) |
| Assert which services were called / no error spans / latency | Traces as Test Evidence |
| Turn a Sentry/Datadog error into a test | Production Error to Test Pipeline |
| Decide which endpoints need tests next | Telemetry-Driven Test Prioritization |
| A trace assertion is flaky or a span never arrives | Failure Modes |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there.

**Observability stack:**
- What APM/tracing tool is in place? (Datadog, New Relic, Honeycomb, Splunk Observability/SignalFx, ServiceNow Cloud Observability — formerly Lightstep, Dash0, Jaeger, Grafana Tempo, OpenTelemetry-native) — determines how you pull traces and which query syntax the diagnosis workflow uses.
- Is OpenTelemetry instrumented in the application, and which services? — un-instrumented services are invisible and untestable via traces.
- What logging infrastructure exists? (ELK, Loki, CloudWatch, Datadog Logs) — sets where log-by-trace-ID correlation happens.
- Are structured logs used, or free-form text? — structured logs are parseable into test gaps; free-form needs a fingerprinting step first.

**Tracing maturity:**
- Are distributed traces available across service boundaries? — without them, only single-service span assertions are possible.
- What is the trace sampling rate? (100%, 10%, head-based, tail-based) — probabilistic sampling will randomly drop the trace a test asserts on; you must force-sample test traffic (see Failure Modes).
- Can you search traces by error status, latency threshold, or custom attributes?
- Are traces correlated with logs and metrics? — enables exemplars (metric → representative trace ID), which makes prioritization concrete.

**Production error tracking:**
- What error tracking tool is used? (Sentry, SmartBear Insight Hub — formerly Bugsnag, Rollbar, Datadog Error Tracking, LaunchDarkly Observability — incl. session replay, formerly Highlight.io)
- How are production errors triaged? (Automated, manual, ignored)
- Is there a process for turning production errors into test cases?
- What was the last production error that a test should have caught?

**Test infrastructure:**
- Can tests emit telemetry? (Traces, custom metrics, structured logs)
- Are test results correlated with application telemetry?
- Do you have a test-to-code coverage mapping? — required to compute the error-rate-to-coverage matrix below.

---

## Core Principles

### 1. Production data informs test priorities
The most valuable tests prevent real production errors — not theoretical edge cases, not contrived scenarios. Production error logs are a pre-prioritized backlog of tests you should have written, ordered by what real users actually hit.

### 2. Traces are test evidence
"The API returned 200" proves the endpoint responded. "The request hit the cache, skipped the database, and returned in <50ms" proves the system behaved correctly at every layer. Traces make tests deeper without making them more brittle.

### 3. Observability gaps equal test gaps
A code path with no traces, no logs, and no metrics is invisible — untestable in production and unverifiable during incidents. Observability coverage and test coverage are two views of the same problem.

### 4. Close the feedback loop
The complete cycle: error detected → analyzed → test written → deployed → recurrence prevented. If your team finds production errors but does not systematically create tests, the same class of error recurs.

---

## Traces as Test Evidence

> **Pin `@opentelemetry/semantic-conventions` to an exact version and treat sem-conv bumps as breaking.** Trace assertions reference attribute names by string; those names drift across releases and your assertions silently break. v1.41.0 (April 2026) shipped GenAI breaking changes and a `process.executable` entity split, and moved `graphql.document` from Recommended to Opt-In. Pin the literal version and bump deliberately:
>
> ```json
> // package.json — exact pin, no caret
> "@opentelemetry/semantic-conventions": "1.41.1"
> ```
> ```bash
> npm install --save-exact @opentelemetry/semantic-conventions@1.41.1
> ```
>
> **Do not introduce new OpenTracing shims.** The OTel spec deprecated OpenTracing compatibility in March 2026 (removal no earlier than March 2027); new instrumentation should target native OTel APIs and OTLP.

Three patterns, all in `references/trace-assertions.md`:

- **OpenTelemetry integration in test infrastructure** — instrument the test runner (`test-setup/tracing.ts`) so test execution correlates with application traces via `service.name`, `test.suite`, and `test.run_id` resource attributes. Flush from the runner's **global teardown** with an awaited `sdk.shutdown()` — not `process.on('beforeExit')`, which drops trailing spans.
- **Trace-based assertions** — assert on trace structure, span attributes, and timing (which services were called, no ERROR spans, root-span latency, DB operations) instead of only the HTTP status. For unit-level span checks, use an in-process **`InMemorySpanExporter` + `SimpleSpanProcessor`** and read `getFinishedSpans()` synchronously — no network, no `waitForTrace`, no timeout flake. Reserve the real collector + `waitForTrace` path for cross-process traces.
- **Distributed trace validation across services** — an `assertTraceStructure` helper that verifies a request flowed through the expected services in order, with per-span attribute and `maxDuration` checks.

For declarative trace-based assertions (YAML/UI-driven instead of hand-rolled span queries), the OSS **Tracetest** project (`kubeshop/tracetest`) is still available, but the last public OSS release is v1.7.1 (Oct 2024) with low recent activity — evaluate maintenance before adopting. Tracetest's commercial Cloud offering was end-of-lifed October 2024; do not set up Tracetest Cloud, users will hit a dead product.

---

## Log-Informed Test Design

### Analyze production error logs for test gaps

Production errors are the highest-priority input for test creation. Each unhandled error is a missing test. See `references/log-and-error-pipeline.md` for the `analyze-production-errors.ts` script that maps each production error to test coverage, assigns a priority by frequency and recency, and suggests a test layer (unit/integration/e2e) from the error characteristics.

### Categorize errors: covered vs. uncovered

```
1. Export production errors from error tracker (Sentry, Insight Hub, etc.)
   - Filter: last 30 days, count > 5 (ignore one-off errors)
   - Group by: error message fingerprint

2. For each error group:
   a. Does a test exist that would catch this error?
      → Yes: the test is either not running or has a gap (investigate)
      → No: this is a test gap (create a test)

   b. What layer should the test live at?
      → TypeError, null reference → unit test
      → Timeout, connection error → integration test with fault injection
      → UI rendering error → E2E test
      → Data inconsistency → contract test or database test

3. Output: prioritized list of tests to create, ordered by:
   error frequency × user impact × recency
```

### Prioritize test creation by error frequency and impact

Prioritize using a 2×2 of frequency (high/low) vs. impact (high/low): P0 = high-frequency + high-impact (fix now), P1 = low-frequency + high-impact (next sprint), P2 = high-frequency + low-impact (this sprint), P3 = both low (backlog). Impact indicators: high = payment/auth failure, data loss, crash; low = UI glitch, slow-but-functional response.

---

## Telemetry-Driven Test Prioritization

### Score endpoints by error-weighted gap

Invest test effort proportional to real usage and real failure. **Gap Score is the canonical formula used throughout this skill:**

```
Gap Score = (error_rate × requests_per_day) / max(test_count, 1)
```

This is error-weighted: it ranks an endpoint by the absolute volume of failing requests it produces, divided by how much test coverage already guards it. (If you instead want a volume-weighted lens that surfaces high-traffic-but-healthy endpoints, multiply by `(1 + error_rate)` rather than `error_rate` — a different question, not the matrix's labels.)

### Error rate by endpoint to test coverage mapping

```
Endpoint           | Requests/day | Error Rate | Test Count | Gap Score
POST /api/orders   | 50,000       | 0.3%       | 2          | 75   CRITICAL
PUT  /api/profile  | 5,000        | 1.2%       | 1          | 60   CRITICAL
DELETE /api/items  | 2,000        | 0.8%       | 0          | 16   HIGH
POST /api/auth     | 80,000       | 0.1%       | 8          | 10   OK
GET  /api/search   | 200,000      | 0.05%      | 15         | 6.7  OK

Gap Score = (error_rate × requests_per_day) / max(test_count, 1)
Labels: CRITICAL ≥ 50, HIGH 12–49, OK < 12.

Action: create tests for endpoints at HIGH or above, highest score first.
```

Every label above is derived from the formula and the stated thresholds — copy the formula and you reproduce the matrix exactly. Pick your own thresholds, but state them; never hand-label.

**Exemplars close the metric → trace → test loop.** When a high-error endpoint surfaces in this matrix, OTel **exemplars** let you jump straight from the error-rate metric to a representative failing trace ID, then walk that trace (below) to write the test — instead of hunting for a matching trace by hand.

### Hot path analysis

Identify the most-traversed code paths in production and ensure they have proportional test coverage.

```
1. Extract top 20 endpoints by request volume from APM data
2. For each endpoint, trace the code path through services
3. Map each service-level span to test coverage data
4. Identify hot paths with zero or low test coverage

Output:
  /api/checkout → cart-service → pricing-service → payment-service
  Coverage: cart-service (82%) → pricing-service (45%) → payment-service (91%)
  Gap: pricing-service discount calculation has 45% coverage on a critical path
  Action: Add tests for discount edge cases in pricing-service
```

> **Pair endpoint-level traffic data with continuous profiling** to find CPU and allocation hot paths *inside* endpoints, not just at the boundary. The OTel **profiling signal** entered public alpha on 2026-03-26 (OTLP path `/v1development/profiles`), with GA targeted for Q3 2026 — treat it as not-yet-production. Production-ready alternatives today: **Pyroscope**, **Parca**, **Polar Signals**, **Datadog Profiling**. eBPF zero-instrumentation profilers (no SDK changes): Polar Signals, Parca, Grafana **Beyla**.

> **Zero-instrumentation observability** — when adding the OTel SDK isn't feasible, eBPF tools capture HTTP/gRPC traces from kernel syscalls without code changes: **Beyla** (Grafana), **Cilium Tetragon**, **Pixie**, **Coroot**. Useful for legacy or polyglot services where SDK rollout takes quarters.

> **OTel Weaver** generates type-safe instrumentation code from semantic-convention YAML — keeping trace assertions in sync with sem-conv bumps. Worth adopting if you maintain custom conventions or hit attribute drift between versions.

---

## Production Error to Test Pipeline

The most important workflow in this skill: turning production errors into tests that prevent recurrence.

```
1. ERROR DETECTED
   Source: Sentry, Datadog, CloudWatch, or any error tracker
   Capture: error message, stack trace, request context, trace ID, user impact

2. REPRODUCE
   - Pull the trace from the observability platform (exemplar → trace ID if available)
   - Identify the exact request parameters and state that triggered the error
   - Reproduce locally or in staging with equivalent input
   - If not reproducible: add targeted logging and wait for recurrence

3. WRITE TEST
   - Choose the right layer (unit for logic bugs, integration for service interactions)
   - Test must fail before the fix (red-green verification)
   - Document the originating production error in the test name or a comment

4. FIX AND DEPLOY
   - Fix the bug; verify the test passes with the fix
   - Deploy fix + test together

5. VERIFY ELIMINATION
   - Monitor the same error in production after deploy
   - Confirm error count drops to zero
   - If it recurs: the fix was incomplete, repeat from step 2
```

See `references/log-and-error-pipeline.md` for a full test built from Sentry issue PROJ-4521 (null shipping address → null reference), asserting either a `400` or `422` (whichever your contract uses) at the API layer plus the E2E checkout prompt. The test name and a comment document the originating error, frequency, and context — the convention to follow when creating tests from production signals.

### Establish the team feedback loop

- **Weekly error review (30 min):** pull the top 10 new errors by frequency from the error tracker. For each: assign an owner, create a test, or mark as known/acceptable. An error tracker with thousands of unresolved entries that nobody reads is the anti-pattern.
- **Incident close gate:** add "What test would have prevented this?" to every postmortem; the test is created (or the gap is explicitly recorded) before the incident is closed. Tie this to a checklist item so it is auditable, not aspirational.

---

## Diagnosis Workflows

### Trace a failing request end-to-end

When a test fails or a production error occurs, use the trace to understand exactly what happened.

```
1. Get the trace ID (from test output, error tracker, or user report)

2. Open the trace in your APM tool
   - Jaeger: /trace/{traceId}
   - Datadog: /apm/traces?traceId={traceId}
   - Honeycomb: query by trace.trace_id

3. Walk the span tree
   - Root span: what did the user request?
   - Child spans: which services were called?
   - Error spans: where did it fail? (which span FIRST shows an error)
   - Slow spans: where did latency accumulate?

4. Correlate with logs
   - Filter logs by trace ID to see every log entry for this request
   - Look for warnings or errors that precede the failure

5. Identify the root cause
   - Is the error in your code, a dependency, or infrastructure?
   - Transient failure or persistent bug?
```

### Correlate test failures with production telemetry

When a test fails, query your observability platform: (1) search production errors for matching messages (last 7 days); (2) search traces for the same HTTP route with ERROR status. Matches exist → the bug is real and affecting users, prioritize the fix. No matches → likely a test-only issue or a new bug not yet in production. This turns "probably flaky" into "confirmed production impact" or "test-only issue."

---

## Anti-Patterns

### 1. Ignoring production signals
The error tracker has 500 unresolved errors nobody looks at; the suite passes, so the team assumes quality is fine. **Fix:** run the weekly 30-minute error review above — top 10 new errors, each assigned an owner, a test, or a known/acceptable mark.

### 2. Testing only what is easy to observe
Teams assert HTTP status and response time while ignoring data consistency, background-job completion, and cache coherence. **Fix:** add spans to background jobs, cache ops, and async workflows, then assert on them. If it runs in production, it should produce telemetry.

### 3. No feedback loop between production and testing
SRE handles errors, QA writes tests, neither shares systematically, the same class of bug recurs. **Fix:** establish the production-error-to-test pipeline and the incident-close gate.

### 4. Over-instrumenting tests without acting on data
Thousands of metrics and logs emitted, nobody analyzes them — cost with no benefit. **Fix:** start with three specific questions you want test telemetry to answer; build those dashboards; add instrumentation only when you have a new question.

### 5. Using traces only for debugging, not for assertions
Traces treated as a post-break debugging tool rather than a source of assertions that prevent breaks. **Fix:** add trace-based assertions to integration tests — correct services called, efficient queries, expected cache hits. These catch regressions HTTP-level assertions miss.

### 6. Asserting against a probabilistically sampled trace
Head/probabilistic sampling randomly drops the trace the test is asserting on, producing intermittent failures. **Fix:** force-sample test traffic (`OTEL_TRACES_SAMPLER=always_on` or a per-request override) so every asserted trace is recorded.

---

## Failure Modes

| Symptom | Likely cause | Fix or check |
|---------|--------------|--------------|
| `waitForTrace` times out, span never arrives | Sampling dropped it, or exporter didn't flush before assert | Set `OTEL_TRACES_SAMPLER=always_on` for the test run; flush via awaited `sdk.shutdown()` in global teardown |
| Trailing spans from the last test missing | Flushed from `process.on('beforeExit')` (doesn't fire on exit/signal) | Move shutdown to the runner's global teardown hook; `await sdk.shutdown()` |
| App spans not part of the test's trace | `traceparent` header not propagated by the app | Confirm the app reads/forwards W3C `traceparent`; check the OTel propagator is configured |
| Assertion on `db.system`/`graphql.document`/GenAI attrs suddenly fails | sem-conv version bump renamed/moved the attribute | Pin `@opentelemetry/semantic-conventions` exact; diff the release notes; update assertions deliberately |
| No spans reach the collector in CI | `OTEL_EXPORTER_ENDPOINT` unreachable from the CI network | Point at the in-CI collector address; smoke-test with the Verification step below |
| `status?.code === 'ERROR'` matches nothing despite real errors | Collector serializes status as `2` / `'STATUS_CODE_ERROR'`, not `'ERROR'` | Match what your collector actually emits (see note in `references/trace-assertions.md`) |

---

## Verification

Prove the telemetry path works before trusting any trace assertion, smallest first:

```bash
# 1. Start a local collector, point the runner at it, run one instrumented test.
OTEL_EXPORTER_ENDPOINT=http://localhost:4318/v1/traces \
OTEL_TRACES_SAMPLER=always_on \
  npx playwright test --grep @trace

# 2. Confirm a span with service.name=integration-tests arrived at the collector
#    (check the collector's debug/logging exporter output, or query your APM).
```

Then, in code, assert a **known** trace ID resolves before relying on any structural assertion: `await collector.waitForTrace(traceId, { timeout: 10_000 })` must return spans — if it times out, fix sampling/flush/propagation (Failure Modes) before adding more assertions. For unit-level span checks, the `InMemorySpanExporter` path returns spans synchronously with no collector at all.

## Done When

- Every one of the top-20-by-traffic endpoints (from the hot-path matrix) resolves to at least one span in a sampled trace — no high-traffic endpoint is invisible.
- Trace-based assertions exist for at least one key user journey, verifying service calls and span attributes (not just HTTP status), and pass under `OTEL_TRACES_SAMPLER=always_on`.
- Log-informed test cases exist for the known failure modes surfaced by the production error analysis.
- The error-rate/Gap-Score matrix has been computed and has produced at least one prioritized set of untested code paths.
- `@opentelemetry/semantic-conventions` is pinned to an exact version in `package.json` (no caret).
- A recorded post-deploy review (checklist item or postmortem entry) confirms observability signals were checked before the release was marked stable.

## Reference Files (in `references/`)

- **trace-assertions.md** — OTel test-runner setup (with correct global-teardown flush and the in-memory exporter alternative), force-sampling note, trace-based assertions, and the distributed `assertTraceStructure` helper.
- **log-and-error-pipeline.md** — the `analyze-production-errors.ts` test-gap script and a worked production-error-to-test example (400-or-422 assertion).

## Related Skills

- **testing-in-production** — safe rollout techniques (flags, canary, guardrail metrics) *during* a release; this skill instead uses the telemetry those releases produce as input to design tests *after*.
- **synthetic-monitoring** — scheduled probes that run *after* release and themselves emit telemetry; that telemetry feeds the analysis here.
- **qa-metrics** — turns telemetry-derived numbers (error rates, latency, Gap Score) into quality dashboards and KPIs; this skill produces the raw signals, qa-metrics aggregates them.
- **ai-bug-triage** — when the input is a pile of CI/production failures to classify and route; use it to feed the error-categorization step here, then return to write the tests.
