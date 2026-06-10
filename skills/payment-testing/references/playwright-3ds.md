# 3DS / SCA challenge handling in Playwright (nested iframes)

The single hardest part of payment E2E. The Stripe 3DS challenge is **a frame nested
inside the Stripe modal frame** — a single `frameLocator` cannot reach it. You need
nested `frameLocator` chaining and a click on the "Complete authentication" button.

## Why the naive approaches fail

- `page.locator('#card')` — the card input is in a **cross-origin iframe**. The locator
  silently matches nothing and the test hangs or times out with a confusing error.
- `page.frames()[1]` — brittle. The frame index shifts the moment Stripe adds, removes,
  or reorders frames (loading spinners, hCaptcha, analytics frames). Never select frames
  by index.
- `await page.waitForTimeout(5000)` — guessing how long the challenge takes. Flaky on
  slow CI, wasteful on fast CI. Wait on the element, not the clock.
- Selenium's `switch_to.frame` — wrong tool; this is Playwright.

## The correct pattern

Use a 3DS-required card (`4000000000003220`) so the challenge always appears. Chain
`frameLocator` from outer modal frame → inner challenge frame, then click
**Complete authentication**.

```ts
import { test, expect } from '@playwright/test';

test('3DS challenge completes and payment succeeds', async ({ page }) => {
  await page.goto('/checkout');

  // 1. Fill the Payment Element (itself a cross-origin frame).
  const card = page.frameLocator('iframe[name^="__privateStripeFrame"]');
  await card.getByPlaceholder('Card number').fill('4000000000003220');
  await card.getByPlaceholder('MM / YY').fill('12 / 34');
  await card.getByPlaceholder('CVC').fill('123');
  await page.getByRole('button', { name: /pay/i }).click();

  // 2. The challenge is NESTED: outer Stripe challenge frame → inner ACS frame.
  //    A single frameLocator is insufficient — chain two.
  const challengeOuter = page.frameLocator('iframe[name^="__privateStripeFrame"]');
  const challengeInner = challengeOuter.frameLocator('iframe#challengeFrame, iframe[name="acsFrame"]');

  // 3. Click "Complete authentication" inside the nested challenge frame.
  await challengeInner
    .getByRole('button', { name: /complete authentication|complete|authorize/i })
    .click();

  // 4. Assert success — never trust a redirect alone; assert the success state.
  await expect(page).toHaveURL(/\/success/);
  await expect(page.getByText(/payment succeeded/i)).toBeVisible();
});

test('3DS challenge can be failed', async ({ page }) => {
  await page.goto('/checkout');
  const card = page.frameLocator('iframe[name^="__privateStripeFrame"]');
  await card.getByPlaceholder('Card number').fill('4000000000003220');
  await card.getByPlaceholder('MM / YY').fill('12 / 34');
  await card.getByPlaceholder('CVC').fill('123');
  await page.getByRole('button', { name: /pay/i }).click();

  const inner = page
    .frameLocator('iframe[name^="__privateStripeFrame"]')
    .frameLocator('iframe#challengeFrame, iframe[name="acsFrame"]');
  await inner.getByRole('button', { name: /fail authentication/i }).click();
  await expect(page.getByText(/authentication failed|could not be authenticated/i)).toBeVisible();
});
```

## Selector notes

- Stripe frame names are prefixed `__privateStripeFrame…` with a numeric suffix that
  changes per render — match on the **prefix** with `[name^="…"]`, not the full name.
- The inner challenge frame id/name varies by Stripe version (`challengeFrame`,
  `acsFrame`). Match on a comma-separated union and a button-name regex so a version bump
  doesn't break the test.
- Playwright auto-waits on `frameLocator` actions — no `waitForTimeout` needed. If you
  must wait for the modal to appear, use `await expect(challengeInner.getByRole('button',
  { name: /complete/i })).toBeVisible()` (waits on the element).
- Frame structure is current Playwright guidance as of mid-2026; frame-by-index is
  explicitly discouraged.
