# GA4 `/g/collect` Beacon Interception

GA4 (gtag.js / GTM) sends each event as a request to `https://www.google-analytics.com/g/collect`. Region variants exist (`region1.google-analytics.com/g/collect`, `analytics.google.com/g/collect`), so match on the path `/g/collect`, not the full host. The event identity is in the URL query string.

## URL grammar

| Param | Meaning |
|-------|---------|
| `v=2` | Measurement Protocol version (always 2 for GA4 web) |
| `tid=G-XXXXXXX` | Measurement ID |
| `en=` | Event name (`en=add_to_cart`) |
| `ep.<name>=` | Event parameter, string type (`ep.currency=USD`) |
| `epn.<name>=` | Event parameter, number type (`epn.value=49.99`) |
| `gcs=` / `gcd=` | Consent state |
| `dl=` / `dt=` | Document location / title |

## Single-event interception

```ts
import { test, expect } from '@playwright/test';

test('add_to_cart fires with correct params', async ({ page }) => {
  await page.goto('/product/42');

  const [request] = await Promise.all([
    page.waitForRequest(r =>
      r.url().includes('/g/collect') && r.url().includes('en=add_to_cart')),
    page.getByRole('button', { name: 'Add to cart' }).click(),
  ]);

  const params = new URL(request.url()).searchParams;
  expect(params.get('v')).toBe('2');
  expect(params.get('tid')).toContain('G-');
  expect(params.get('en')).toBe('add_to_cart');
  expect(params.get('ep.currency')).toBe('USD');     // string param
  expect(Number(params.get('epn.value'))).toBe(49.99); // number param
  expect(params.get('ep.item_id')).toBe('SKU-42');
});
```

## Collecting many events on a page

Listen with `page.on('request')` and push parsed events onto an array. Note GA4 can pack multiple events into a single POST: extra events arrive in the request `postData()` as newline-separated `&`-joined param strings, each with its own `en=`.

```ts
type GA4Event = { name: string; params: Record<string, string> };

function parseGA4(request): GA4Event[] {
  const events: GA4Event[] = [];
  const base = new URL(request.url()).searchParams;

  const collect = (sp: URLSearchParams) => {
    const name = sp.get('en');
    if (!name) return;
    const params: Record<string, string> = {};
    for (const [k, v] of sp.entries()) if (k.startsWith('ep.') || k.startsWith('epn.')) params[k] = v;
    events.push({ name, params });
  };

  collect(base);
  // Batched events live in the POST body, one event per line.
  const body = request.postData();
  if (body) for (const line of body.split('\n')) {
    if (line.trim()) collect(new URLSearchParams(line));
  }
  return events;
}

function attachGA4Collector(page) {
  const collected: GA4Event[] = [];
  page.on('request', r => { if (r.url().includes('/g/collect')) collected.push(...parseGA4(r)); });
  return collected;
}
```

## Why not the alternatives

- `page.evaluate(() => window.dataLayer)` — proves the push happened, not that GA4 emitted a hit. GTM may drop or transform it.
- `toBeVisible()` on the clicked element — unrelated to whether a beacon left the browser.
- `waitForTimeout(2000)` — flaky; replace with `waitForRequest` on `/g/collect`.

## `page.route` when you need to inspect AND let it through

```ts
await page.route('**/g/collect*', async route => {
  const params = new URL(route.request().url()).searchParams;
  // record params here…
  await route.continue(); // never route.abort() — that kills the beacon
});
```
