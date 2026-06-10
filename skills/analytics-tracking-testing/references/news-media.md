# News-Media Events

Publisher pages add a tracking surface generic e-commerce plans miss: article view, scroll depth, and the paywall meter. Drive every interaction with real actions and wait on the beacon — never `waitForTimeout`.

## article_view on load

```ts
import { test, expect } from '@playwright/test';

test('article_view fires once with metadata', async ({ page }) => {
  const [request] = await Promise.all([
    page.waitForRequest(r => r.url().includes('/g/collect') && r.url().includes('en=article_view')),
    page.goto('/news/2026/election-results'),
  ]);
  const params = new URL(request.url()).searchParams;
  expect(params.get('en')).toBe('article_view');
  expect(params.get('ep.article_id')).toBeTruthy();
  expect(params.get('ep.section')).toBe('politics');
  expect(params.get('ep.author')).toBeTruthy();
});
```

## Scroll depth at 25 / 50 / 75 / 100

Drive real scrolling (`page.evaluate(scrollTo)`, `mouse.wheel`, or `scrollIntoView`) and wait for each bucket's beacon. Assert each fires once — a common bug is firing the same threshold twice.

```ts
test('scroll_depth fires once per threshold', async ({ page }) => {
  await page.goto('/news/2026/election-results');

  const fired: string[] = [];
  page.on('request', r => {
    if (r.url().includes('/g/collect') && r.url().includes('en=scroll')) {
      fired.push(new URL(r.url()).searchParams.get('epn.percent_scrolled') ?? '');
    }
  });

  for (const pct of [25, 50, 75, 100]) {
    await Promise.all([
      page.waitForRequest(r => r.url().includes('en=scroll') && r.url().includes(`percent_scrolled=${pct}`)),
      page.evaluate(p => window.scrollTo(0, document.body.scrollHeight * (p / 100)), pct),
    ]);
  }

  expect(fired.sort()).toEqual(['100', '25', '50', '75']); // each exactly once, no dupes
});
```

Alternative scroll drivers when `scrollTo` doesn't trigger the listener:

```ts
await page.mouse.wheel(0, 2000);                              // wheel events
await page.locator('#article-footer').scrollIntoViewIfNeeded(); // scroll an element into view
await page.evaluate(() => window.scrollBy(0, 1000));          // incremental
```

## Paywall / meter event

When the free-article meter is exhausted, a `paywall_hit` (or `meter`) event fires. Seed the meter count past its limit (cookie/localStorage) so the next article trips the wall, then assert the event.

```ts
test('paywall_hit fires when the meter is exhausted', async ({ page, context }) => {
  await context.addCookies([{ name: 'meter_count', value: '5', domain: 'localhost', path: '/' }]); // limit is 5

  const [request] = await Promise.all([
    page.waitForRequest(r => r.url().includes('/g/collect') && r.url().includes('en=paywall_hit')),
    page.goto('/news/2026/premium-analysis'),
  ]);
  const params = new URL(request.url()).searchParams;
  expect(params.get('en')).toBe('paywall_hit');
  expect(params.get('ep.wall_type')).toBe('metered');
  await expect(page.getByTestId('paywall-overlay')).toBeVisible();
});
```

Cover all three (article_view, the four scroll buckets, paywall) — asserting only `article_view` and skipping scroll depth and the paywall is the gap this surface most often ships with.
