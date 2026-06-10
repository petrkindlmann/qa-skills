# Capturing `dataLayer.push`

When the contract is the GTM **input** — "what object is pushed to `window.dataLayer`?" — assert the push, not the GA4 beacon. Wrap `dataLayer.push` in `addInitScript` *before navigation* so you record pushes that happen at page load.

Do **not**:
- `page.route` to mock the dataLayer — you would replace the thing under test.
- read the GA4 `/g/collect` beacon instead — that is the output (a different contract).

## Wrapping push before navigation

```ts
import { test, expect } from '@playwright/test';

test('view_item pushes the ecommerce shape', async ({ page }) => {
  await page.addInitScript(() => {
    window.dataLayer = window.dataLayer || [];
    const orig = window.dataLayer.push.bind(window.dataLayer);
    (window as any).__pushes = [];
    window.dataLayer.push = (...args: any[]) => {
      (window as any).__pushes.push(...args);
      return orig(...args);
    };
  });

  await page.goto('/product/42'); // page-load pushes are now captured

  const pushes = await page.evaluate(() => (window as any).__pushes);
  const viewItem = pushes.find((p: any) => p.event === 'view_item');
  expect(viewItem, 'view_item was never pushed').toBeTruthy();
  expect(viewItem.ecommerce.items[0]).toMatchObject({
    item_id: 'SKU-42',
    price: 49.99,
    currency: 'USD',
  });
});
```

## Asserting the nested ecommerce shape

GA4 ecommerce pushes nest the products under `ecommerce.items` (an array). Assert the array shape, not only the event name:

```ts
const items = viewItem.ecommerce.items;
expect(items).toHaveLength(1);
expect(items.every((i: any) => typeof i.item_id === 'string')).toBe(true);
expect(items.every((i: any) => typeof i.price === 'number')).toBe(true);
expect(items[0].currency).toBe('USD');
```

Use `find` / `filter` / `some` over the recorded `__pushes` to locate or count the event(s) of interest. `find` for the single expected push; `filter(...).length` to assert a push fired exactly once and wasn't duplicated.

## Both layers when it matters

For a full input→output check, capture the dataLayer push (this file) AND the resulting GA4 beacon (`ga4-interception.md`) in the same test, then assert the beacon's `ep.`/`epn.` params match the pushed object. That catches GTM tag misconfigurations that silently drop or rename a param between the push and the beacon.
