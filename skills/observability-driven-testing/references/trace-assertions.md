# Traces as Test Evidence — Code

OpenTelemetry test-runner instrumentation and trace-based assertion patterns. The decision prose ("traces are test evidence," when to assert on spans) lives in `SKILL.md`; this file holds the runnable implementations.

## OpenTelemetry integration in test infrastructure

Instrument your test runner to emit traces that correlate test execution with application behavior.

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

## Trace-based assertions

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
