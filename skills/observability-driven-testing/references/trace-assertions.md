# Traces as Test Evidence — Code

OpenTelemetry test-runner instrumentation and trace-based assertion patterns. The decision prose ("traces are test evidence," when to assert on spans) lives in `SKILL.md`; this file holds the runnable implementations.

## OpenTelemetry integration in test infrastructure

Instrument the process that emits the spans. Each test worker owns its SDK and must
await shutdown in that same worker. A runner's coordinator-level global teardown cannot
flush a different process's SDK. Install compatible OpenTelemetry packages and retain
their lockfile; this example uses the current `resourceFromAttributes` API.

```typescript
// test-setup/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'integration-tests',
    'test.suite': process.env.TEST_SUITE_NAME ?? 'unknown',
    'test.run_id': process.env.TEST_RUN_ID ?? randomUUID(),
  }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
});

export async function startTracing() {
  sdk.start();
}

// Await this in the same worker that called startTracing().
export async function stopTracing() {
  await sdk.shutdown();
}

// Starting an SDK does not itself create a span for a test.
export async function traced<T>(name: string, work: () => Promise<T>): Promise<T> {
  return trace.getTracer('qa-tests').startActiveSpan(name, async span => {
    try {
      const result = await work();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
```

> **Do not flush from `process.on('beforeExit', () => sdk.shutdown())`.** `beforeExit`
> does not fire on `process.exit()`, an uncaught exception, or SIGINT/SIGTERM — the
> process termination paths — and an un-awaited promise can drop the last spans.
> Use the worker's awaited teardown. Abrupt termination or a failed exporter can still
> lose spans, so check collector receipt rather than promising delivery from shutdown.

```typescript
// test-setup/tracing-fixture.ts
import { test as base, expect } from '@playwright/test';
import { startTracing, stopTracing } from './tracing';
export const test = base.extend<{}, { tracing: void }>({
  tracing: [async ({}, use) => {
    await startTracing();
    try { await use(); }
    finally { await stopTracing(); }
  }, { scope: 'worker', auto: true }],
});
export { expect };
```

Import `test` from this fixture in traced tests, then wrap real work with
`await traced('checkout', async () => { /* existing test actions and assertions */ })`.
Supply one unique `TEST_RUN_ID` to all workers when the run should be grouped together.
For Vitest or Node's test runner, use their per-worker/test-process setup and awaited
cleanup hooks instead of a coordinator global teardown. Verify the final expected span
arrives with that run ID. See the [Node SDK](https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-node.html)
and [Playwright worker fixtures](https://playwright.dev/docs/test-fixtures#worker-scoped-fixtures).

### Fast, deterministic alternative: in-memory exporter

For unit-level span assertions you do not need a real collector or `waitForTrace`. Export
spans to an in-process `InMemorySpanExporter` via a `SimpleSpanProcessor`, run the code,
then read `exporter.getFinishedSpans()` synchronously — no network, no async wait, no
timeout flake. Use this for the 80% case (assert one service's own spans); reach for the
collector + `waitForTrace` path below only when you must assert a trace that crosses
process boundaries.

## Trace-based assertions

Assert on trace structure, span attributes, and timing -- not just HTTP responses.

> **Force-sample test traffic.** Head/probabilistic sampling will randomly drop the very
> trace a test is asserting on — the #1 cause of these tests being intermittently flaky.
> Run the test workload under an always-on sampler (`OTEL_TRACES_SAMPLER=always_on`) or a
> per-request sampling override and configure the collector to retain test traffic.
> Sampling configuration alone does not guarantee exporter or collector delivery.
> Never assert against a probabilistically sampled trace.

```typescript
import { test, expect } from '@playwright/test';
import { TraceCollector } from './trace-collector';

test('order creation produces correct trace structure', async ({ request }) => {
  const collector = new TraceCollector();
  const traceId = crypto.randomUUID().replace(/-/g, '');
  const inboundParentSpanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);

  // Make request with trace context
  const response = await request.post('/api/orders', {
    data: { items: [{ sku: 'WIDGET-1', quantity: 2 }] },
    headers: { 'traceparent': `00-${traceId}-${inboundParentSpanId}-01` },
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

  // Normalize the collector's status representation at the adapter boundary.
  // Unknown encodings must fail rather than silently hiding an error span.
  const errorSpans = spans.filter(s => normalizeSpanStatus(s.status?.code) === 'error');
  expect(errorSpans).toHaveLength(0);

  // Verify latency requirements
  // The caller supplied a parent ID, so the server entry span is not a root.
  const entrySpans = spans.filter(s => s.parentSpanId === inboundParentSpanId
    && s.resource['service.name'] === 'api-gateway');
  expect(entrySpans).toHaveLength(1);
  expect(entrySpans[0].durationMs).toBeLessThan(500);

  // Verify correct database operations
  const dbSpans = spans.filter(s => s.attributes['db.system'] !== undefined);
  expect(dbSpans.some(s => s.attributes['db.operation'] === 'INSERT')).toBeTruthy();
  expect(dbSpans.some(s => s.attributes['db.statement']?.toString().includes('orders'))).toBeTruthy();
});
```

The `TraceCollector` is an application-specific adapter, not an installed library in
this repository. The status helper below accepts the standard numeric/OTLP names and
the explicitly documented short names. Adapt it only after inspecting actual records;
missing status means UNSET, while an unrecognized supplied value is a schema error.

```typescript
export function normalizeSpanStatus(code: unknown): 'unset' | 'ok' | 'error' {
  if (code === undefined || code === 0 || code === 'STATUS_CODE_UNSET' || code === 'UNSET') return 'unset';
  if (code === 1 || code === 'STATUS_CODE_OK' || code === 'OK') return 'ok';
  if (code === 2 || code === 'STATUS_CODE_ERROR' || code === 'ERROR') return 'error';
  throw new Error(`Unknown span status encoding: ${String(code)}`);
}
```

## Distributed trace validation across services

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
