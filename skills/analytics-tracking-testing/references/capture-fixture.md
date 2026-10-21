# Reusable Analytics Capture Fixture

Observe requests before navigation, reuse `parseGA4` from
[`ga4-interception.md`](ga4-interception.md), and retain every event in a POST batch.
The collector below does not route or abort requests. It proves browser emission,
not delivery or ingestion. Use a test property or a separately configured local
collector; an isolated browser test may acknowledge requests with `route.fulfill`.

Other pixels require a reviewed adapter for the deployed transport. Match the
exact origin, path, and method, then decode that contract explicitly. There is no
generic JSON pixel body shared by Meta, TikTok, and LinkedIn. Do not infer an event
name from URL fields when the approved transport puts it in the body.

## The fixture

Copy `parseGA4` into `helpers/ga4.ts` and this block into `fixtures/analytics.ts`.
Configure additional GA4 hosts explicitly. Non-GA4 adapters are disabled by default;
only add destinations present in the approved tracking inventory. Decoder errors
fail the fixture rather than silently producing an empty collection.

```ts
// fixtures/analytics.ts
import { test as base, expect, Page, Request } from '@playwright/test';
import { parseGA4 } from '../helpers/ga4';

export type Beacon = { destination: string; eventName: string; params: Record<string, string> };
export type PixelAdapter = {
  destination: string;
  origin: string;
  pathname: string;
  method: 'GET' | 'POST';
  decode: (request: Request, url: URL) => { eventName: string; params: Record<string, string> }[];
};
export type AnalyticsOptions = { extraGA4Hosts: string[]; pixels: PixelAdapter[] };

export function attachAnalyticsCollector(page: Page, options: AnalyticsOptions) {
  const events: Beacon[] = [];
  const errors: string[] = [];
  const listener = (request: Request) => {
    try {
      events.push(...parseGA4(request, options.extraGA4Hosts).map(event => ({
        destination: 'ga4', eventName: event.name, params: event.params,
      })));
      const url = new URL(request.url());
      const adapters = options.pixels.filter(adapter => url.origin === adapter.origin
        && url.pathname === adapter.pathname && request.method() === adapter.method);
      if (adapters.length > 1) throw new Error('Multiple pixel adapters match one request');
      for (const adapter of adapters) {
        const decoded = adapter.decode(request, url);
        if (!decoded.length || decoded.some(event => !event.eventName?.trim())) {
          throw new Error(`${adapter.destination}: matched request did not decode an event`);
        }
        events.push(...decoded.map(event => ({ ...event, destination: adapter.destination })));
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  };
  page.on('request', listener);
  return { events, errors, stop: () => page.off('request', listener) };
}

export const test = base.extend<{ beacons: Beacon[]; analyticsOptions: AnalyticsOptions }>({
  analyticsOptions: [{ extraGA4Hosts: [], pixels: [] }, { option: true }],
  beacons: async ({ page, analyticsOptions }, use) => {
    const collector = attachAnalyticsCollector(page, analyticsOptions);
    try {
      await use(collector.events);
      expect(collector.errors, 'Analytics capture failed').toEqual([]);
    } finally { collector.stop(); }
  },
});

export { expect };
```

## Add one inspected pixel contract

This adapter is limited to a Meta browser **GET query** fixture with the configured
pixel ID and an `ev` event name. Confirm the exact URL and fields against a redacted
capture from the deployed tag before enabling it. A POST, different path, or
different host needs its own inspected adapter and regression; this helper does
not claim coverage of those formats. Copy it into `helpers/meta-get.ts`.

```ts
import { PixelAdapter } from '../fixtures/analytics';

export function metaGETPixel(pixelID: string): PixelAdapter {
  return {
    destination: 'meta', origin: 'https://www.facebook.com', pathname: '/tr/', method: 'GET',
    decode: (_request, url) => {
      if (url.searchParams.get('id') !== pixelID) throw new Error('Unexpected Meta pixel ID');
      const eventName = url.searchParams.get('ev');
      if (!eventName?.trim()) throw new Error('Meta GET query is missing ev');
      return [{ eventName, params: Object.fromEntries(url.searchParams) }];
    },
  };
}
```

## Assert new events after meaningful completion

The example tracking plan requires exactly one `add_to_cart` and one `AddToCart`
after the action. `analytics-state` is an **application-provided** milestone: here
`ready` means initial tag work is complete, and `cart-complete` means all tag work
scheduled by that action is complete. Replace it with the product's documented
signal; the test must not manufacture it. If none exists, establish a bounded
observation window and report the interval covered. `networkidle` does not establish
analytics completion, and seeing the first event cannot exclude a later duplicate.

```ts
import { test, expect } from '../fixtures/analytics';
import { metaGETPixel } from '../helpers/meta-get';

test.use({ analyticsOptions: { extraGA4Hosts: [], pixels: [metaGETPixel('1234567890')] } });

test('add_to_cart hits the configured GA4 and Meta destinations', async ({ page, beacons }) => {
  await page.goto('/product/42');
  await expect(page.getByTestId('analytics-state')).toHaveAttribute('data-phase', 'ready');
  const checkpoint = beacons.length;
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await expect(page.getByTestId('analytics-state')).toHaveAttribute('data-phase', 'cart-complete');

  const actionEvents = beacons.slice(checkpoint);
  const ga4 = actionEvents.filter(event => event.destination === 'ga4' && event.eventName === 'add_to_cart');
  expect(ga4, 'Expected exactly one new GA4 add_to_cart').toHaveLength(1);
  expect(ga4[0].params.tid).toBe('G-TEST'); // the approved test measurement ID
  const meta = actionEvents.filter(event => event.destination === 'meta' && event.eventName === 'AddToCart');
  expect(meta, 'Expected exactly one new Meta AddToCart').toHaveLength(1);
});
```

For ecommerce values and nested items, assert the typed `dataLayer` event using
[`datalayer-capture.md`](datalayer-capture.md) and the tracking-plan validator.
An input-to-network comparison additionally needs a decoder validated against
captures from the deployed GA4 tag version; do not assume `ep.currency` or a flat
`ep.item_id` represents the standard ecommerce payload. Include the destination,
adapter/tag revision, observation interval, and capture errors in CI evidence.
A missing expected event fails even when the collector has no errors.
