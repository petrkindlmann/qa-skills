---
name: observability-driven-testing
description: >-
  Use traces, logs, and telemetry as test evidence and test design input. Covers
  OpenTelemetry integration with tests, trace-based assertions, log-informed test
  creation, production error analysis for test gaps, and telemetry-driven test
  prioritization. Use when: "observability testing," "trace-based testing," "log analysis,"
  "telemetry," "production errors," "OpenTelemetry."
  Related: testing-in-production, synthetic-monitoring, qa-metrics, ai-bug-triage.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: production
---

<objective>
Production is the richest source of test design input. Every error log, every slow trace, every spike in latency is a signal telling you where tests are missing. This skill closes the feedback loop between production observability and test creation.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first. If it exists, use it as context and skip questions already answered there.

**Observability stack:**
- What APM/tracing tool is in place? (Datadog, New Relic, Honeycomb, Splunk Observability/SignalFx, ServiceNow Cloud Observability — formerly Lightstep, Dash0, Jaeger, Grafana Tempo, OpenTelemetry-native)
- Is OpenTelemetry instrumented in the application? Which services?
- What logging infrastructure exists? (ELK, Loki, CloudWatch, Datadog Logs)
- Are structured logs used, or free-form text?

**Tracing maturity:**
- Are distributed traces available across service boundaries?
- What is the trace sampling rate? (100%, 10%, head-based, tail-based)
- Can you search traces by error status, latency threshold, or custom attributes?
- Are traces correlated with logs and metrics?

**Production error tracking:**
- What error tracking tool is used? (Sentry, Bugsnag — now SmartBear Insight Hub, Rollbar, Datadog Error Tracking, LaunchDarkly Observability — incl. session replay, formerly Highlight.io)
- How are production errors triaged? (Automated, manual, ignored)
- Is there a process for turning production errors into test cases?
- What was the last production error that a test should have caught?

**Test infrastructure:**
- Can tests emit telemetry? (Traces, custom metrics, structured logs)
- Are test results correlated with application telemetry?
- Do you have a test-to-code coverage mapping?

---

## Core Principles

### 1. Production data informs test priorities

The most valuable tests are the ones that prevent real production errors. Not theoretical edge cases, not contrived scenarios -- real failures that real users experienced. Production error logs are a prioritized backlog of tests you should have written.

### 2. Traces are test evidence

A test assertion that checks "the API returned 200" proves the endpoint responded. A trace assertion that verifies "the request hit the cache, skipped the database, and returned in <50ms" proves the system behaved correctly at every layer. Traces make tests deeper without making them more brittle.

### 3. Observability gaps equal test gaps

If a code path has no traces, no logs, and no metrics, it is invisible. Invisible code is untestable in production and unverifiable during incidents. Observability coverage and test coverage are two views of the same problem.

### 4. Close the feedback loop

The complete cycle: production error detected, error analyzed, test written, test deployed, error prevented from recurring. If your team finds production errors but does not systematically create tests, the same class of error will recur.

---

## Traces as Test Evidence

### OpenTelemetry integration in test infrastructure

Instrument your test runner to emit traces that correlate test execution with application behavior.

> **Pin `@opentelemetry/semantic-conventions`** and treat sem-conv version bumps as breaking. v1.41.0 (April 2026) shipped GenAI breaking changes and a `process.executable` entity split; `graphql.document` moved from Recommended to Opt-In. Trace assertions written against attribute names will silently drift if you don't pin.
>
> **Do not introduce new OpenTracing shims.** The OpenTelemetry spec deprecated OpenTracing compatibility requirements in March 2026 — new instrumentation should target native OTel APIs and OTLP.

```typescript
// test-setup/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources'; // helper preferred over `new Resource(...)` on @opentelemetry/sdk-node >= 0.50
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'integration-tests',
    'test.suite': process.env.TEST_SUITE_NAME ?? 'unknown',
    'test.run_id': process.env.CI_RUN_ID ?? `local-${Date.now()}`,
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
});

sdk.start();

// Shutdown gracefully after tests
process.on('beforeExit', () => sdk.shutdown());
```

### Trace-based assertions

Assert on trace structure, span attributes, and timing -- not just HTTP responses.

```typescript
import { expect } from '@playwright/test';
import { TraceCollector } from './trace-collector';

test('order creation produces correct trace structure', async ({ request }) => {
  const collector = new TraceCollector();
  const traceId = crypto.randomUUID().replace(/-/g, '');

  // Make request with trace context
  const response = await request.post('/api/orders', {
    data: { items: [{ sku: 'WIDGET-1', quantity: 2 }] },
    headers: { 'traceparent': `00-${traceId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}-01` },
  });
  expect(response.ok()).toBeTruthy();

  // Wait for trace to propagate (async collection)
  const trace = await collector.waitForTrace(traceId, { timeout: 10_000 });

  // Assert on trace structure
  const spans = trace.spans;

  // Verify the expected service calls happened
  const serviceNames = spans.map(s => s.resource['service.name']);
  expect(serviceNames).toContain('api-gateway');
  expect(serviceNames).toContain('order-service');
  expect(serviceNames).toContain('inventory-service');

  // Verify no unexpected errors in any span
  const errorSpans = spans.filter(s => s.status?.code === 'ERROR');
  expect(errorSpans).toHaveLength(0);

  // Verify latency requirements
  const rootSpan = spans.find(s => !s.parentSpanId);
  expect(rootSpan!.durationMs).toBeLessThan(500);

  // Verify correct database operations
  const dbSpans = spans.filter(s => s.attributes['db.system'] !== undefined);
  expect(dbSpans.some(s => s.attributes['db.operation'] === 'INSERT')).toBeTruthy();
  expect(dbSpans.some(s => s.attributes['db.statement']?.toString().includes('orders'))).toBeTruthy();
});
```

### Distributed trace validation across services

For microservices, verify that requests flow through the expected services in the correct order.

```typescript
// Trace structure assertion helper
interface ExpectedSpan {
  service: string;
  operation: string;
  attributes?: Record<string, string | number>;
  maxDuration?: number;
}

async function assertTraceStructure(
  traceId: string,
  expected: ExpectedSpan[],
  collector: TraceCollector,
): Promise<void> {
  const trace = await collector.waitForTrace(traceId, { timeout: 15_000 });

  for (const exp of expected) {
    const matching = trace.spans.find(
      s => s.resource['service.name'] === exp.service && s.name === exp.operation,
    );

    expect(matching, `Expected span: ${exp.service}/${exp.operation}`).toBeDefined();

    if (exp.attributes) {
      for (const [key, value] of Object.entries(exp.attributes)) {
        expect(matching!.attributes[key]).toBe(value);
      }
    }

    if (exp.maxDuration) {
      expect(matching!.durationMs).toBeLessThan(exp.maxDuration);
    }
  }
}

// Usage
test('checkout flow traverses expected services', async ({ request }) => {
  const traceId = generateTraceId();
  await request.post('/api/checkout', {
    headers: { traceparent: formatTraceparent(traceId) },
    data: { cartId: 'test-cart-123' },
  });

  await assertTraceStructure(traceId, [
    { service: 'api-gateway', operation: 'POST /api/checkout' },
    { service: 'cart-service', operation: 'getCart', maxDuration: 100 },
    { service: 'pricing-service', operation: 'calculateTotal', maxDuration: 200 },
    { service: 'payment-service', operation: 'processPayment', attributes: { 'payment.provider': 'stripe' } },
    { service: 'order-service', operation: 'createOrder' },
    { service: 'notification-service', operation: 'sendConfirmation' },
  ], collector);
});
```

For declarative trace-based assertions (YAML/UI-driven instead of hand-rolled span queries), the OSS **Tracetest** project (`kubeshop/tracetest`) is still active. Note: **Tracetest's commercial Cloud offering was end-of-lifed October 2024** — only the OSS project is supported. Do not recommend or set up Tracetest Cloud; users will hit a dead product.

---

## Log-Informed Test Design

### Analyze production error logs for test gaps

Production errors are the highest-priority input for test creation. Each unhandled error represents a missing test.

```typescript
// Script: analyze-production-errors.ts
// Run weekly to identify test gaps from production error data

interface ProductionError {
  message: string;
  stack: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  endpoint: string;
  userId?: string;
}

interface TestGap {
  error: ProductionError;
  coveredByTest: boolean;
  suggestedTestType: 'unit' | 'integration' | 'e2e';
  priority: 'critical' | 'high' | 'medium' | 'low';
}

function analyzeTestGaps(
  errors: ProductionError[],
  testCoverage: Map<string, string[]>, // endpoint -> test file paths
): TestGap[] {
  return errors.map(error => {
    const testsForEndpoint = testCoverage.get(error.endpoint) ?? [];
    const coveredByTest = testsForEndpoint.length > 0;

    // Prioritize by frequency and recency
    const daysSinceLastSeen = daysBetween(new Date(error.lastSeen), new Date());
    const priority = error.count > 100 && daysSinceLastSeen < 7 ? 'critical'
      : error.count > 50 ? 'high'
      : error.count > 10 ? 'medium'
      : 'low';

    // Suggest test type based on error characteristics
    const suggestedTestType = error.stack.includes('TypeError') ? 'unit'
      : error.stack.includes('timeout') || error.stack.includes('ECONNREFUSED') ? 'integration'
      : 'e2e';

    return { error, coveredByTest, suggestedTestType, priority };
  });
}
```

### Categorize errors: covered vs. uncovered

```
Error categorization workflow:

1. Export production errors from error tracker (Sentry, Bugsnag, etc.)
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

Prioritize using a 2x2 matrix of frequency (high/low) vs. impact (high/low): P0 = high-frequency + high-impact (fix now), P1 = low-frequency + high-impact (next sprint), P2 = high-frequency + low-impact (this sprint), P3 = both low (backlog). Impact indicators: high = payment/auth failure, data loss, crash; low = UI glitch, slow but functional response.

---

## Telemetry-Driven Test Prioritization

### Use real usage data to weight test importance

Not all features are equally used. Invest test effort proportionally to real usage. Score each endpoint by: `(requests_per_day / 1000) * (1 + error_rate * 100) / max(test_count, 1)`. High traffic + high error rate + low test count = highest priority for new tests.

### Hot path analysis

Identify the most-traversed code paths in production and ensure they have proportional test coverage.

```
Hot path analysis process:

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

> **Pair endpoint-level traffic data with continuous profiling** to find CPU and allocation hot paths *inside* endpoints, not just at the endpoint boundary. The OTel **profiling signal** is moving toward stable; alternatives include **Pyroscope**, **Parca**, **Polar Signals**, and **Datadog Profiling**. eBPF-based zero-instrumentation profilers (no SDK changes) include Polar Signals, Parca, and Grafana **Beyla**.

> **Zero-instrumentation observability** — when adding the OTel SDK isn't feasible, eBPF-based tools capture HTTP/gRPC traces from kernel syscalls without code changes: **Beyla** (Grafana), **Cilium Tetragon**, **Pixie**, **Coroot**. Useful for legacy services or polyglot environments where SDK rollout would take quarters.

> **OTel Weaver** generates type-safe instrumentation code from semantic-convention YAML — keeping trace assertions in sync with sem-conv version bumps. Worth adopting if you maintain custom conventions or hit attribute drift between sem-conv versions.

### Error rate by endpoint to test coverage mapping

```
Endpoint error-coverage matrix:

Endpoint           | Requests/day | Error Rate | Test Count | Gap Score
POST /api/orders   | 50,000       | 0.3%       | 2          | CRITICAL
GET  /api/search   | 200,000      | 0.05%      | 15         | OK
POST /api/auth     | 80,000       | 0.1%       | 8          | OK
PUT  /api/profile  | 5,000        | 1.2%       | 1          | HIGH
DELETE /api/items   | 2,000        | 0.8%       | 0          | HIGH

Gap Score = (error_rate × requests_per_day) / max(test_count, 1)

Action: Create tests for endpoints with Gap Score > threshold
```

---

## Production Error to Test Pipeline

The most important workflow in this skill: turning production errors into tests that prevent recurrence.

### Step-by-step pipeline

```
1. ERROR DETECTED
   Source: Sentry, Datadog, CloudWatch, or any error tracker
   Capture: error message, stack trace, request context, trace ID, user impact

2. REPRODUCE
   - Pull the trace from the observability platform
   - Identify the exact request parameters and state that triggered the error
   - Reproduce locally or in staging with equivalent input
   - If not reproducible: add targeted logging and wait for recurrence

3. WRITE TEST
   - Choose the right test layer (unit for logic bugs, integration for service interactions)
   - Test must fail before the fix is applied (red-green verification)
   - Include the production context in the test name or comment

4. FIX AND DEPLOY
   - Fix the bug
   - Verify the test passes with the fix
   - Deploy fix + test together

5. VERIFY ELIMINATION
   - Monitor the same error in production after deploy
   - Confirm error count drops to zero
   - If error recurs: the fix was incomplete, repeat from step 2
```

### Implementation example

```typescript
// Test created from production error: Sentry issue PROJ-4521
// Error: "Cannot read properties of null (reading 'address')"
// Context: POST /api/orders when user has no shipping address saved
// Frequency: 47 occurrences in last 7 days

describe('order creation with missing shipping address', () => {
  // This test was created because production error PROJ-4521 showed that
  // users without a saved shipping address triggered a null reference error
  // in the order validation pipeline.

  it('returns 400 with clear error message when shipping address is null', async () => {
    const user = await createTestUser({ address: null });
    const response = await api.post('/api/orders', {
      userId: user.id,
      items: [{ sku: 'WIDGET-1', quantity: 1 }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('MISSING_SHIPPING_ADDRESS');
    expect(response.body.message).toContain('shipping address is required');
  });

  it('prompts user to add address when attempting checkout without one', async ({ page }) => {
    await loginAs(page, { address: null });
    await page.goto('/checkout');
    await expect(page.getByText('Please add a shipping address')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add address' })).toBeVisible();
  });
});
```

---

## Diagnosis Workflows

### Trace a failing request end-to-end

When a test fails or a production error occurs, use the trace to understand exactly what happened.

```
Diagnosis flow:

1. Get the trace ID (from test output, error tracker, or user report)

2. Open the trace in your APM tool
   - Jaeger: /trace/{traceId}
   - Datadog: /apm/traces?traceId={traceId}
   - Honeycomb: query by trace.trace_id

3. Walk the span tree
   - Root span: what did the user request?
   - Child spans: which services were called?
   - Error spans: where did it fail?
   - Slow spans: where did latency accumulate?

4. Correlate with logs
   - Filter logs by trace ID to see all log entries for this request
   - Look for warnings or errors that precede the failure

5. Identify the root cause
   - Which span first shows an error?
   - Is the error in your code, a dependency, or infrastructure?
   - Was this a transient failure or a persistent bug?
```

### Correlate test failures with production telemetry

When a test fails, query your observability platform:

1. Search production errors for matching messages (last 7 days)
2. Search traces for the same HTTP route with ERROR status
3. Matches exist: the bug is real and affecting users -- prioritize the fix
4. No matches: may be a test-only issue or a new bug not yet in production

This turns "probably flaky" into "confirmed production impact" or "test-only issue," enabling better prioritization.

---

## Anti-Patterns

### Ignoring production signals

The error tracker has 500 unresolved errors. Nobody looks at it. New errors added daily. The test suite passes, so the team assumes quality is fine.

**Fix:** Schedule a weekly 30-minute error review. Pull the top 10 new errors by frequency; for each, assign an owner, create a test, or mark as known/acceptable.

### Testing only what is easy to observe

Teams test HTTP status codes and response times while ignoring data consistency, background job completion, and cache coherence.

**Fix:** Use distributed tracing to make invisible code paths visible. Add spans to background jobs, cache operations, and async workflows. If it runs in production, it should produce telemetry.

### No feedback loop between production and testing

Production errors are handled by SRE. Tests are written by QA. Neither team shares information systematically. The same class of bugs recurs.

**Fix:** Establish the production-error-to-test pipeline above. Add to incident postmortems: "What test would have prevented this?" Create the test before closing the incident.

### Over-instrumenting tests without acting on data

Thousands of metrics and logs emitted. Nobody analyzes them. Data collection has cost but no benefit.

**Fix:** Start with three specific questions you want to answer from test telemetry. Build those dashboards. Add more instrumentation only when you have a new question.

### Using traces only for debugging, not for assertions

Traces treated as a post-break debugging tool rather than a source of test assertions to prevent breaks.

**Fix:** Add trace-based assertions to integration tests -- correct services called, efficient queries, expected cache hits. These catch regressions that HTTP-level assertions miss.

---

## Done When

- OpenTelemetry covers all critical code paths -- no high-traffic endpoints or key service boundaries are invisible in traces
- Trace-based assertions exist for at least one key user journey, verifying service calls and span attributes, not just HTTP status
- Log-informed test cases exist for known failure modes from production error analysis
- Telemetry data (hot-path or error-rate matrix) has identified and prioritized at least one set of untested code paths
- Observability signals are reviewed as part of post-deploy validation before a release is considered stable

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `testing-in-production` | Production observability is the prerequisite for safe production testing |
| `synthetic-monitoring` | Synthetic probes produce telemetry that feeds into observability analysis |
| `qa-metrics` | Telemetry-derived metrics (error rates, latency) feed into quality dashboards |
| `ai-bug-triage` | AI can analyze production error patterns to suggest test priorities |
| `api-testing` | Trace-based assertions strengthen API test evidence |
| `ci-cd-integration` | Test telemetry integrates with CI pipelines for trend analysis |
