# Log-Informed Test Design & Error-to-Test Pipeline — Code

Runnable implementations for analyzing production errors and turning them into tests. The categorization workflow, prioritization matrix, and step-by-step pipeline prose live in `SKILL.md`; this file holds the code.

## Analyze production error logs for test gaps

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

## Production error to test — implementation example

A test created directly from a production error, with the originating issue documented in the test itself.

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
