# GA4 `/g/collect` Beacon Interception

GA4 web tags can send events to `/g/collect` with parameters split between the URL
query and a form-encoded POST body. Match the exact path and an approved hostname;
a substring match also accepts `google-analytics.com.attacker.test` and URLs that
only mention `/g/collect` in a query. Configure first-party collection hosts explicitly.

The browser transport below is an observed web-tag format, not the public JSON
Measurement Protocol. Retain a redacted capture from the deployed tag version and
check this parser against it when tags change. Do not apply it to `/mp/collect` JSON.

## URL grammar

| Param | Meaning |
|-------|---------|
| `v=2` | Version field in the observed web-tag transport |
| `tid=G-XXXXXXX` | Measurement ID |
| `en=` | Event name (`en=add_to_cart`) |
| `ep.<name>=` | Custom event parameter, string type (`ep.campaign_label=spring`) |
| `epn.<name>=` | Event parameter, number type (`epn.value=49.99`) |
| `gcs=` / `gcd=` | Consent state |
| `dl=` / `dt=` | Document location / title |

## Single-event interception

The decoder imported here is a required application adapter, not a library supplied
by this skill. Verify it against actual redacted captures from the deployed tag and
make unsupported/missing fields fail. Standard ecommerce is not a flat `ep.` map:
[Google's logical contract](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
uses event-level currency and nested products. Do not invent `ep.currency` or
`ep.item_id` requirements and then misclassify a valid tag as broken. The parser below
returns raw parameters; it deliberately does not claim to decode every tag version.

```ts
import { test, expect } from '@playwright/test';
import { parseGA4 } from './helpers/ga4'; // copy the helper below
import { validateEvent } from './tracking-plan/validate';
import plan from './tracking-plan/tracking-plan.json';
import { decodeEcommerceWebEvent } from './helpers/deployed-tag-decoder';

test('add_to_cart fires with correct params', async ({ page }) => {
  await page.goto('/product/42');

  const [request] = await Promise.all([
    page.waitForRequest(r => parseGA4(r).some(event => event.name === 'add_to_cart')),
    page.getByRole('button', { name: 'Add to cart' }).click(),
  ]);

  const events = parseGA4(request).filter(event => event.name === 'add_to_cart');
  expect(events).toHaveLength(1);
  const params = events[0].params;
  expect(params.v).toBe('2');
  expect(params.tid).toBe('G-TEST'); // replace with the test property's measurement ID
  const payload = decodeEcommerceWebEvent(params);
  expect(validateEvent(plan, 'add_to_cart', payload)).toEqual([]);
  expect(payload).toMatchObject({
    currency: 'USD', value: 49.99,
    items: [{ item_id: 'SKU-42', price: 49.99, quantity: 1 }],
  });
});
```

## Collecting many events on a page

Attach before navigation or the action. Each nonempty POST line is an event record;
merge its parameters over the common URL query. Without a body, the query is the
single event. Preserve duplicates so a duplicate-purchase assertion can detect them.
Release the listener during teardown. Capturing a request proves emission, not
successful ingestion by GA4; test the server-side result separately when required.

```ts
import { Page, Request } from '@playwright/test';
type GA4Event = { name: string; params: Record<string, string> };

export function parseGA4(request: Request, extraHosts: string[] = []): GA4Event[] {
  const url = new URL(request.url());
  const approvedHost = url.hostname === 'google-analytics.com'
    || url.hostname.endsWith('.google-analytics.com')
    || url.hostname === 'analytics.google.com' || extraHosts.includes(url.hostname);
  if (!approvedHost || url.pathname !== '/g/collect') return [];
  const lines = (request.postData() ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const events: GA4Event[] = [];
  for (const line of lines.length ? lines : ['']) {
    const params = new URLSearchParams(url.searchParams);
    for (const [key, value] of new URLSearchParams(line)) params.set(key, value);
    const name = params.get('en');
    if (name?.trim()) events.push({ name, params: Object.fromEntries(params) });
  }
  return events;
}

export function attachGA4Collector(page: Page, extraHosts: string[] = []) {
  const events: GA4Event[] = [];
  const listener = (request: Request) => events.push(...parseGA4(request, extraHosts));
  page.on('request', listener);
  return { events, stop: () => page.off('request', listener) };
}
```

## Why not the alternatives

- `page.evaluate(() => window.dataLayer)` — proves the push happened, not that GA4 emitted a hit. GTM may drop or transform it.
- `toBeVisible()` on the clicked element — unrelated to whether a beacon left the browser.
- `waitForTimeout(2000)` — flaky; replace with `waitForRequest` on `/g/collect`.

## Route to an isolated collector when testing emission

Do not contaminate a production analytics property. Use a test property or a local
collector. `route.fulfill` can acknowledge an intercepted beacon in a browser-emission
test; that does not prove Google received it. Use `route.continue` only for an authorized
end-to-end ingestion test. `route.abort` changes the browser's retry behavior.

```ts
await page.route('**/g/collect*', async route => {
  const events = parseGA4(route.request());
  // Record events in the test's collector.
  await route.fulfill({ status: 204 });
});
```
