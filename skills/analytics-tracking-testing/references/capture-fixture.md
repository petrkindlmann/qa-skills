# Reusable Multi-Pixel Capture Fixture

One `test.extend` fixture that captures every analytics and pixel beacon during a test, so individual tests assert against a `collected` list instead of re-implementing capture. It listens with `page.on('request')` and parses each request's `searchParams` and `postData()`.

Critical: a capture helper must **observe**, never block. Use `page.on('request')` (or `page.route` + `route.continue()`). **Never** `page.route(...).abort()` — aborting blocks the very beacons you want to see. And capture pixels too, not GA4 only.

## The fixture

```ts
// fixtures/analytics.ts
import { test as base, expect } from '@playwright/test';

export type Beacon = { destination: string; eventName: string; params: Record<string, string> };

const ENDPOINTS = [
  { match: '/g/collect',           destination: 'ga4',      event: (sp: URLSearchParams) => sp.get('en') },
  { match: 'facebook.com/tr',      destination: 'meta',     event: (sp: URLSearchParams) => sp.get('ev') },
  { match: 'analytics.tiktok.com', destination: 'tiktok',   event: (sp: URLSearchParams) => sp.get('event') },
  { match: 'px.ads.linkedin.com',  destination: 'linkedin', event: (sp: URLSearchParams) => sp.get('conversionId') },
];

export const test = base.extend<{ beacons: Beacon[] }>({
  beacons: async ({ page }, use) => {
    const collected: Beacon[] = [];

    page.on('request', request => {
      const url = request.url();
      const ep = ENDPOINTS.find(e => url.includes(e.match));
      if (!ep) return;

      const sp = new URL(url).searchParams;
      const params: Record<string, string> = {};
      for (const [k, v] of sp.entries()) params[k] = v;

      // Some pixels carry the payload in the POST body.
      const body = request.postData();
      if (body) {
        try { Object.assign(params, JSON.parse(body)); }
        catch { for (const [k, v] of new URLSearchParams(body)) params[k] = v; }
      }

      collected.push({ destination: ep.destination, eventName: ep.event(sp) ?? '', params });
    });

    await use(collected); // tests read this list after their actions
  },
});

export { expect };
```

## Using it in a test

```ts
import { test, expect } from '../fixtures/analytics';

test('add_to_cart hits GA4 and Meta', async ({ page, beacons }) => {
  await page.goto('/product/42');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.waitForLoadState('networkidle');

  const ga4 = beacons.find(b => b.destination === 'ga4' && b.eventName === 'add_to_cart');
  expect(ga4?.params['ep.currency']).toBe('USD');

  const meta = beacons.find(b => b.destination === 'meta' && b.eventName === 'AddToCart');
  expect(meta).toBeTruthy();
});
```

## Why a fixture, not per-test capture

- Tests stay about assertions, not plumbing.
- One place to add a new destination endpoint when marketing adds a pixel.
- The same `collected` list feeds the CI regression gate (`ci-gating.md`): run the journeys, dump `beacons`, diff against the tracking-plan baseline.
