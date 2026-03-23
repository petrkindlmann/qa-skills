# Network Interception and Mocking

Every `page.route()` pattern for API mocking, response modification, HAR replay, WebSocket interception, and request assertion.

---

## page.route() Basics

`page.route()` intercepts network requests matching a URL pattern or predicate. Every matched request must be fulfilled, continued, or aborted.

```typescript
// Mock: return a fake response
await page.route('**/api/users', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
  });
});

// Continue: let the request go through (optionally modify it)
await page.route('**/api/**', async (route) => {
  await route.continue();
});

// Abort: block the request
await page.route('**/analytics/**', async (route) => {
  await route.abort('blockedbyclient');
});
```

**Important:** Always set up routes BEFORE the action that triggers the request.

---

## Mock a REST API Response

```typescript
test('displays product list', async ({ page }) => {
  await page.route('**/api/products*', async (route) => {
    await route.fulfill({
      json: {
        items: [
          { id: '1', name: 'Widget', price: 29.99, inStock: true },
          { id: '2', name: 'Gadget', price: 49.99, inStock: false },
        ],
        total: 2,
      },
    });
  });

  await page.goto('/products');
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Widget')).toBeVisible();
  await expect(page.getByText('Out of stock')).toBeVisible();
});
```

---

## Modify a Real Response (route.fetch)

Let the real request go through, then alter the response before the browser receives it.

```typescript
test('overrides a feature flag', async ({ page }) => {
  await page.route('**/api/feature-flags', async (route) => {
    const response = await route.fetch();
    const body = await response.json();

    // Override specific flags
    body.flags['new-checkout-flow'] = true;
    body.flags['maintenance-mode'] = false;

    await route.fulfill({ response, json: body });
  });

  await page.goto('/');
  // The app now sees new-checkout-flow = true
  await expect(page.getByTestId('new-checkout')).toBeVisible();
});
```

---

## Modify Request Headers

```typescript
await page.route('**/api/**', async (route) => {
  const headers = {
    ...route.request().headers(),
    'x-test-mode': 'true',
    'x-test-run-id': testInfo.testId,
  };
  await route.continue({ headers });
});
```

---

## Conditional Routing

Handle different endpoints with different strategies in a single handler.

```typescript
await page.route('**/api/**', async (route) => {
  const url = route.request().url();
  const method = route.request().method();

  if (url.includes('/api/products') && method === 'GET') {
    // Mock reads
    await route.fulfill({ json: { items: mockProducts } });
  } else if (url.includes('/api/products') && method === 'POST') {
    // Let writes go through to the real server
    await route.continue();
  } else if (url.includes('/api/analytics')) {
    // Block analytics in tests
    await route.abort('blockedbyclient');
  } else {
    // Everything else passes through
    await route.continue();
  }
});
```

---

## Simulate Errors

```typescript
test('handles 500 error gracefully', async ({ page }) => {
  await page.route('**/api/dashboard/stats', async (route) => {
    await route.fulfill({ status: 500, json: { error: 'Internal server error' } });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toContainText('Failed to load');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('handles network timeout', async ({ page }) => {
  await page.route('**/api/dashboard/stats', async (route) => {
    await route.abort('timedout');
  });

  await page.goto('/dashboard');
  await expect(page.getByText('Connection timed out')).toBeVisible();
});
```

---

## Simulate Slow Responses

Test loading states by delaying the response.

```typescript
test('shows loading skeleton while data is fetching', async ({ page }) => {
  await page.route('**/api/dashboard/stats', async (route) => {
    // Delay the response
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({
      json: { revenue: 50000, users: 1200 },
    });
  });

  await page.goto('/dashboard');

  // Verify loading state
  await expect(page.getByTestId('stats-skeleton')).toBeVisible();

  // Verify data replaces the skeleton
  await expect(page.getByText('$50,000')).toBeVisible();
  await expect(page.getByTestId('stats-skeleton')).toBeHidden();
});
```

---

## Intercept Requests for Assertions

Record which requests were made and assert on them.

```typescript
test('sends correct analytics events', async ({ page }) => {
  const analyticsRequests: Array<{ url: string; body: unknown }> = [];

  await page.route('**/api/analytics/**', async (route) => {
    analyticsRequests.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({ status: 204 });
  });

  await page.goto('/products');
  await page.getByRole('link', { name: 'Widget Pro' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();

  const events = analyticsRequests.map((r) => (r.body as any).event);
  expect(events).toContain('page_view');
  expect(events).toContain('product_view');
  expect(events).toContain('add_to_cart');
});
```

---

## Wait for a Specific Network Response

```typescript
test('submits order and waits for confirmation', async ({ page }) => {
  await page.goto('/checkout');

  // Set up the listener BEFORE the action
  const orderResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/orders') && resp.status() === 201
  );

  await page.getByRole('button', { name: 'Place order' }).click();
  const orderResponse = await orderResponsePromise;
  const order = await orderResponse.json();

  expect(order.id).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/orders/${order.id}`));
});
```

---

## HAR Replay

Record real network traffic to a HAR file, then replay it in tests for deterministic, offline-capable testing.

### Recording a HAR File

```typescript
// Record HAR during a test run
test('record HAR', async ({ page }) => {
  await page.routeFromHAR('e2e/fixtures/har/products.har', {
    update: true,                    // Record mode
    url: '**/api/products/**',       // Only record matching requests
    updateMode: 'minimal',           // Only headers needed for matching
    updateContent: 'embed',          // Embed response bodies in the HAR file
  });

  await page.goto('/products');
  // Interact with the page -- all matching requests are recorded
  await page.getByRole('link', { name: 'Widget' }).click();
});
```

### Replaying a HAR File

```typescript
test('displays products from HAR', async ({ page }) => {
  await page.routeFromHAR('e2e/fixtures/har/products.har', {
    url: '**/api/products/**',
    update: false, // Replay mode (default)
  });

  await page.goto('/products');
  // Requests matching the URL pattern are served from the HAR file
  await expect(page.getByText('Widget')).toBeVisible();
});
```

### HAR at Config Level

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    // Apply HAR replay to all tests
    // Useful for full offline testing
  },
});
```

### HAR Best Practices

- Store HAR files in `e2e/fixtures/har/` and commit them to git
- Re-record when APIs change: `npx playwright test --grep "record HAR"`
- Use `updateMode: 'minimal'` to reduce HAR file size
- Scope HAR to specific URL patterns -- do not record everything

---

## WebSocket Interception (routeWebSocket)

Available since Playwright v1.49. Intercepts WebSocket connections.

### Mock WebSocket Messages

```typescript
test('receives real-time notifications', async ({ page }) => {
  await page.routeWebSocket('**/ws/notifications', (ws) => {
    ws.onMessage((message) => {
      if (message === 'subscribe:alerts') {
        ws.send(
          JSON.stringify({
            type: 'alert',
            title: 'New deployment',
            message: 'v2.1.0 deployed to production',
          })
        );
      }
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('alert')).toContainText('New deployment');
});
```

### WebSocket with Delayed Messages

```typescript
test('shows typing indicator then message', async ({ page }) => {
  await page.routeWebSocket('**/ws/chat', (ws) => {
    ws.onMessage((message) => {
      const data = JSON.parse(message as string);
      if (data.type === 'send_message') {
        // Simulate the other user typing
        ws.send(JSON.stringify({ type: 'typing', user: 'Alice' }));

        // Then send a response after a delay
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              type: 'message',
              user: 'Alice',
              text: 'Got it, thanks!',
            })
          );
        }, 500);
      }
    });
  });

  await page.goto('/chat');
  await page.getByPlaceholder('Type a message').fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Alice is typing')).toBeVisible();
  await expect(page.getByText('Got it, thanks!')).toBeVisible();
});
```

### Pass-Through with Modification

```typescript
test('modifies real WebSocket messages', async ({ page }) => {
  await page.routeWebSocket('**/ws/feed', (ws) => {
    const server = ws.connectToServer();

    // Pass messages through but modify them
    server.onMessage((message) => {
      const data = JSON.parse(message as string);
      // Add test metadata
      data.testMode = true;
      ws.send(JSON.stringify(data));
    });

    // Pass client messages to server unchanged
    ws.onMessage((message) => {
      server.send(message);
    });
  });

  await page.goto('/live-feed');
});
```

---

## API Mocking for Test Isolation

### Fixture-Based Route Setup

```typescript
// e2e/fixtures/mock.fixture.ts
import { test as base } from '@playwright/test';

type MockFixtures = {
  mockApi: {
    products: (items: any[]) => Promise<void>;
    error: (path: string, status: number) => Promise<void>;
  };
};

export const test = base.extend<MockFixtures>({
  mockApi: async ({ page }, use) => {
    const mockApi = {
      products: async (items: any[]) => {
        await page.route('**/api/products*', async (route) => {
          await route.fulfill({ json: { items, total: items.length } });
        });
      },
      error: async (path: string, status: number) => {
        await page.route(`**${path}`, async (route) => {
          await route.fulfill({ status, json: { error: 'Mocked error' } });
        });
      },
    };
    await use(mockApi);
  },
});
```

Usage:

```typescript
import { test, expect } from '../fixtures/mock.fixture';

test('empty product list shows empty state', async ({ page, mockApi }) => {
  await mockApi.products([]);
  await page.goto('/products');
  await expect(page.getByText('No products found')).toBeVisible();
});

test('API error shows error state', async ({ page, mockApi }) => {
  await mockApi.error('/api/products', 500);
  await page.goto('/products');
  await expect(page.getByRole('alert')).toContainText('Failed to load');
});
```

---

## Unroute and Route Cleanup

Remove routes when you need to change mocking behavior mid-test.

```typescript
test('transitions from loading to loaded state', async ({ page }) => {
  // Start with a slow response
  const slowHandler = async (route: Route) => {
    await new Promise((r) => setTimeout(r, 5000));
    await route.fulfill({ json: { data: 'loaded' } });
  };

  await page.route('**/api/data', slowHandler);
  await page.goto('/dashboard');
  await expect(page.getByTestId('loading')).toBeVisible();

  // Remove the slow handler and add an instant one
  await page.unroute('**/api/data', slowHandler);
  await page.route('**/api/data', async (route) => {
    await route.fulfill({ json: { data: 'loaded' } });
  });

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('loaded')).toBeVisible();
});
```

---

## Offline Simulation

```typescript
test('shows offline banner when connection drops', async ({ page, context }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading')).toHaveText('Dashboard');

  // Go offline
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('alert')).toContainText('You are offline');

  // Come back online
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('alert')).toBeHidden();
});
```

---

## Summary

| I want to... | Use |
|---|---|
| Return a fake response | `route.fulfill({ json: ... })` |
| Modify a real response | `const resp = await route.fetch(); route.fulfill({ response: resp, json: modified })` |
| Block a request | `route.abort('blockedbyclient')` |
| Add headers to a request | `route.continue({ headers: { ...existing, 'x-new': 'val' } })` |
| Delay a response | `await new Promise(r => setTimeout(r, ms)); route.fulfill(...)` |
| Record/replay traffic | `page.routeFromHAR('file.har', { update: true/false })` |
| Mock WebSocket | `page.routeWebSocket('**/ws/**', handler)` |
| Assert on requests | Capture in array, assert after actions |
| Go offline | `context.setOffline(true)` |
