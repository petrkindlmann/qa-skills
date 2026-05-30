# Common Cross-Browser Issues — Code

Real issues that surface in cross-browser testing, with detection patterns and fixes. The summary of *which* divergences matter today lives in `SKILL.md`; this file holds the CSS workarounds and Playwright tests.

## CSS Grid and Flexbox

```css
/* Historical: Safari < 14.1 ignored `gap` on flexbox. Universally supported now —
   keep the fallback only if you support Safari 14 or older as a documented matrix entry. */
.flex-container {
  display: flex;
  gap: 16px;
}

/* Legacy fallback for very old Safari */
.flex-container > * + * {
  margin-left: 16px;
}
@supports (gap: 16px) {
  .flex-container > * + * {
    margin-left: 0;
  }
}
```

```typescript
// Test: verify layout spacing is correct across browsers
test('product grid has consistent spacing', async ({ page }) => {
  await page.goto('/products');
  const cards = page.getByTestId('product-card');
  await expect(cards).toHaveCount(6);

  // Verify cards are laid out in a grid (not stacked vertically)
  const firstBox = await cards.nth(0).boundingBox();
  const secondBox = await cards.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  // Cards should be side by side, not stacked
  expect(secondBox!.x).toBeGreaterThan(firstBox!.x);
});
```

## Scroll Behavior

```css
/* Issue: scroll-behavior: smooth is inconsistent across browsers */
html {
  scroll-behavior: smooth; /* Firefox/Chrome: works. Safari: partial. */
}
```

```typescript
// Test: verify anchor navigation works (regardless of smooth scroll support)
test('clicking anchor scrolls to section', async ({ page }) => {
  await page.goto('/docs');
  await page.getByRole('link', { name: 'Installation' }).click();
  // Check that the section is visible, not the scroll animation
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeInViewport();
});
```

## Date Input

```typescript
// Issue: <input type="date"> renders differently across browsers
// Firefox: native date picker. Safari: text input (older versions). Chrome: native picker.
test('date picker accepts valid date', async ({ page, browserName }) => {
  await page.goto('/booking');
  const dateInput = page.getByLabel('Check-in date');

  if (browserName === 'webkit') {
    // Safari may render as text input -- type the date
    await dateInput.fill('2026-06-15');
  } else {
    await dateInput.fill('2026-06-15');
  }

  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('June 15, 2026')).toBeVisible();
});
```

## Clipboard API

```typescript
// Issue: navigator.clipboard requires focus and permissions; behavior differs by browser
test('copy button copies text to clipboard', async ({ page, context, browserName }) => {
  // Grant clipboard permission (Chromium only -- Firefox/WebKit handle differently)
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }

  await page.goto('/share');
  await page.getByRole('button', { name: 'Copy link' }).click();

  // Verify via UI feedback rather than clipboard API (more reliable cross-browser)
  await expect(page.getByText('Copied!')).toBeVisible();
});
```

## Backdrop Filter

```css
/* Issue: backdrop-filter not supported in older Firefox */
.modal-overlay {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px); /* Safari */
  background-color: rgba(0, 0, 0, 0.5); /* Fallback */
}
```

## Dialog Element

```typescript
// Issue: <dialog> element behavior varies. Safari had bugs with ::backdrop and form[method=dialog].
test('modal dialog opens and closes', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Delete account' }).click();

  const dialog = page.getByRole('dialog', { name: 'Confirm deletion' });
  await expect(dialog).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).not.toBeVisible();
});
```

## Web Animations API

```typescript
// Issue: animation timing and composite modes differ across engines
test('loading spinner is visible during fetch', async ({ page }) => {
  // Slow down the API response to catch the loading state
  await page.route('**/api/data', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.getByRole('progressbar')).not.toBeVisible({ timeout: 5000 });
});
```
