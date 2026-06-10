# Pixels and Client-vs-Server Deduplication

Marketing pixels send their own beacons to their own endpoints. Match on the host/path and parse the event from `searchParams` or `postData()`.

| Destination | Endpoint | Event field | Dedup key |
|-------------|----------|-------------|-----------|
| Meta Pixel | `facebook.com/tr` (also `/tr?`) | `ev=PageView`, `ev=Purchase` | `eid` (carries `event_id`) |
| TikTok | `analytics.tiktok.com` | event in params or POST body | `event_id` |
| LinkedIn | `px.ads.linkedin.com` | conversion id in path/params | — |

## Why load/count checks fail

Asserting `connect.facebook.net/en_US/fbevents.js` loaded only proves the library is present. Asserting `fbq('track','Purchase')` ran only proves the call was made. Neither proves the data is right, and neither catches the real failure for a dual-fired Purchase: **double-counting**. The Pixel fires client-side AND the server fires the Conversions API (CAPI). If they don't share an `event_id`, Meta counts two conversions.

## Meta PageView + Purchase, with dedup assertion

```ts
import { test, expect } from '@playwright/test';

test('Purchase pixel de-duplicates against server CAPI', async ({ page }) => {
  // PageView on load
  const [pageView] = await Promise.all([
    page.waitForRequest(r => r.url().includes('facebook.com/tr') && r.url().includes('ev=PageView')),
    page.goto('/'),
  ]);
  expect(new URL(pageView.url()).searchParams.get('ev')).toBe('PageView');

  // Purchase on checkout completion
  const [pixel] = await Promise.all([
    page.waitForRequest(r => r.url().includes('facebook.com/tr') && r.url().includes('ev=Purchase')),
    completeCheckout(page),
  ]);
  const clientEventId = new URL(pixel.url()).searchParams.get('eid'); // event_id on the wire

  // serverCapiEventId: captured from the mocked server CAPI call, or a known fixture value
  expect(clientEventId, 'client and server event_id must match to deduplicate').toBe(serverCapiEventId);
});
```

`fbq('track', 'Purchase', {...}, { eventID })` puts the deduplication key on the beacon as `eid`. Your server's CAPI payload must send the same value in its `event_id` field.

## Capturing the server CAPI event_id

If the server CAPI call is reachable in the test environment, intercept it (it goes to `graph.facebook.com/.../events`) or read the `event_id` your checkout backend logged for the order. In an isolated test, generate the `event_id` in a fixture and assert both sides use it.

## TikTok / LinkedIn parsing

```ts
function parseTikTok(request) {
  const url = new URL(request.url());           // analytics.tiktok.com
  const body = request.postData();
  return { params: url.searchParams, body: body ? JSON.parse(body) : null };
}
// LinkedIn: px.ads.linkedin.com/collect — conversion id in the query string.
```
