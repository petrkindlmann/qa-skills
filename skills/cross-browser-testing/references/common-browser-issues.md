# Common Cross-Browser Issues — Code

Real divergences that surface in cross-browser testing, with detection patterns and fixes. The summary of *which* divergences matter today lives in `SKILL.md`; this file holds the per-engine tests and CSS workarounds. Every test asserts the user outcome, not the CSS property.

## Partitioned Cookies / CHIPS (the live 2026 divergence)

Third-party cookies in an embedded context behave differently per engine: Chrome's CHIPS keys a `Partitioned` cookie to the top-level site, Safari's ITP blocks most third-party state, and Firefox's State Partitioning isolates it. "The browser supports cookies" is not enough — test the cookie *inside an iframe* per engine and assert that the embedded widget still works for the user.

```typescript
// Issue: a third-party widget setting a Partitioned cookie behaves differently per engine.
// Assert the user outcome (widget loads its session), not the Set-Cookie header.
test('embedded widget keeps its session in a partitioned context', async ({ page, browserName }) => {
  await page.goto('https://parent-site.example/dashboard'); // page that embeds the widget iframe

  const widget = page.frameLocator('iframe[title="Support widget"]');
  await widget.getByRole('button', { name: 'Start chat' }).click();

  // Chrome (CHIPS): partitioned cookie is kept and the session persists across reload.
  // WebKit (ITP) / Firefox (State Partitioning): may have no third-party cookie at all,
  // so the widget MUST degrade to a same-context fallback rather than break.
  await page.reload();
  if (browserName === 'chromium') {
    await expect(widget.getByText('Chat resumed')).toBeVisible();
  } else {
    // The widget must still be usable without cross-site state.
    await expect(widget.getByRole('button', { name: 'Start chat' })).toBeVisible();
  }
});
```

## Date Input

```typescript
// Issue: <input type="date"> renders differently across browsers.
// Chrome/Firefox: native date picker accepts an ISO value via fill().
// Older Safari (WebKit): renders as a plain text input — fill() lands raw text, so type
// the user-facing format and assert the booking outcome, not the widget chrome.
test('date picker accepts a date across browsers', async ({ page, browserName }) => {
  await page.goto('/booking');
  const dateInput = page.getByLabel('Check-in date');

  if (browserName === 'webkit') {
    // WebKit text-input fallback: clear and type the value the field actually parses.
    await dateInput.click();
    await dateInput.fill('');
    await dateInput.pressSequentially('2026-06-15');
  } else {
    await dateInput.fill('2026-06-15'); // native picker accepts the ISO value directly
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

## Backdrop Filter

```css
/* Issue: backdrop-filter unsupported in older Firefox */
.modal-overlay {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px); /* Safari */
  background-color: rgba(0, 0, 0, 0.5); /* Fallback keeps the overlay readable */
}
```

## View Transitions API (cross-document is the remaining gap)

```typescript
// Issue: same-document View Transitions are Baseline (Chrome 111, Safari 18, Firefox 144).
// CROSS-document transitions are still divergent: Chrome 126+, Safari 18.2+, Firefox flagged.
// Treat cross-document as progressive enhancement — assert the navigation completes, with or
// without the transition.
test('cross-document navigation works with or without view transition', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Products' }).click();
  // Whether or not the engine animated the transition, the destination must render.
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await expect(page).toHaveURL(/.*\/products/);
});
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

## Layout Spacing (flexbox `gap` — historical, kept as a layout-outcome example)

Flexbox `gap` is universally supported now (the Safari <14.1 bug is dead). The pattern that still earns its place is asserting *layout outcome* — that cards lay out side by side — rather than a CSS property:

```typescript
// Verify grid layout outcome across browsers (not the `gap` value itself).
test('product grid lays out side by side', async ({ page }) => {
  await page.goto('/products');
  const cards = page.getByTestId('product-card');
  await expect(cards).toHaveCount(6);

  const firstBox = await cards.nth(0).boundingBox();
  const secondBox = await cards.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  // Cards should be side by side, not stacked vertically
  expect(secondBox!.x).toBeGreaterThan(firstBox!.x);
});
```
