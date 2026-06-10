# Cross-Browser Testing Patterns — Code

Runnable patterns for writing one test that runs across many browsers, branching on `browserName` only when behavior genuinely differs, visual comparison, and progressive-enhancement validation. The rules for *when* each applies live in `SKILL.md`.

## Same Test, Multiple Browsers

The default pattern. Write once, configure projects.

```typescript
// This test runs on every configured browser project automatically
test('user can complete checkout', async ({ page }) => {
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByLabel('Expiry').fill('12/28');
  await page.getByLabel('CVC').fill('123');
  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
});
```

## Browser-Specific Test Logic

When browser behavior genuinely differs, use `browserName` to branch.

```typescript
test('file upload works', async ({ page, browserName }) => {
  await page.goto('/upload');
  const fileInput = page.locator('input[type="file"]');

  // WebKit does not support directory upload
  if (browserName === 'webkit') {
    await fileInput.setInputFiles('/path/to/file.pdf');
  } else {
    await fileInput.setInputFiles(['/path/to/file1.pdf', '/path/to/file2.pdf']);
  }

  await expect(page.getByText('Upload complete')).toBeVisible();
});
```

**Rule:** Browser-specific logic in tests should be rare. If you have many browser branches, the application likely has compatibility bugs to fix.

## Visual Cross-Browser Comparison

Use Playwright's screenshot comparison to catch rendering differences.

```typescript
test('homepage renders correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('homepage.png', {
    maxDiffPixelRatio: 0.01, // Allow 1% pixel difference
  });
  // Each browser project generates its own baseline:
  // homepage-chromium.png, homepage-webkit.png, homepage-firefox.png
});
```

## Progressive Enhancement Validation

Abort every request whose `resourceType === 'script'` so the page runs with no JavaScript, then assert the native HTML form still submits. The route interception is Chromium-only — gate it on `browserName === 'chromium'`.

```typescript
test('form works without JavaScript', async ({ page, browserName }) => {
  // Disable JavaScript to test progressive enhancement
  // Note: only works with Chromium
  if (browserName === 'chromium') {
    await page.context().route('**/*', (route) => {
      if (route.request().resourceType() === 'script') {
        return route.abort();
      }
      return route.continue();
    });
  }

  await page.goto('/contact');
  // Core form submission should work via native HTML form action
  await page.getByLabel('Message').fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();
  // Even without JS, the form should submit and show confirmation
  await expect(page).toHaveURL(/.*thank-you/);
});
```
