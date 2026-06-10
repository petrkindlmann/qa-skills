# axe-core Setup, Keyboard Specs, and CI

Runnable recipes for automated scanning and keyboard auditing. Decision prose lives in
`SKILL.md`.

## Install

```bash
# @axe-core/playwright tracks axe-core's major.minor; install the 4.11.x line
npm install --save-dev @axe-core/playwright
```

> **RGAA tag caveat:** Several best-practice rules (`focus-order-semantics`, `region`,
> `skip-link`, `table-duplicate-name`) are also tagged `RGAAv4` (the French national standard).
> If you don't intend to test against RGAA, filter by the explicit WCAG tags shown below and
> avoid the `best-practice` tag, which pulls in RGAA-specific rules you didn't ask for.

## Reusable Helper

```typescript
// e2e/helpers/a11y.ts
import { type Page, type TestInfo, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

interface A11yOptions {
  tags?: string[];
  exclude?: string[];
  disableRules?: string[];
}

export async function checkAccessibility(
  page: Page, testInfo: TestInfo, options: A11yOptions = {}
): Promise<void> {
  let builder = new AxeBuilder({ page })
    .withTags(options.tags ?? ['wcag2a', 'wcag2aa', 'wcag22aa']);

  for (const sel of options.exclude ?? []) builder = builder.exclude(sel);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);

  const results = await builder.analyze();

  await testInfo.attach('a11y-results', {
    body: JSON.stringify(results, null, 2), contentType: 'application/json',
  });

  const violations = results.violations.map((v) => ({
    rule: v.id, impact: v.impact, description: v.description,
    helpUrl: v.helpUrl, elements: v.nodes.map((n) => n.html).slice(0, 5),
  }));

  expect(violations, `${violations.length} a11y violations:\n${JSON.stringify(violations, null, 2)}`)
    .toHaveLength(0);
}
```

## Using in Tests

```typescript
// e2e/tests/a11y/pages.spec.ts
import { test, expect } from '@playwright/test';
import { checkAccessibility } from '../../helpers/a11y';

test.describe('Accessibility - public pages', () => {
  for (const { name, path } of [
    { name: 'Home', path: '/' }, { name: 'Login', path: '/login' },
    { name: 'Pricing', path: '/pricing' }, { name: 'Sign Up', path: '/signup' },
  ]) {
    test(`${name} page has no a11y violations`, async ({ page }, testInfo) => {
      await page.goto(path);
      await checkAccessibility(page, testInfo);
    });
  }
});

test.describe('Accessibility - interactive states', () => {
  test('modal dialog is accessible when open', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkAccessibility(page, testInfo);
  });
});
```

## Rule Suppression

Suppress rules only with documented justification — a tracking issue or inline comment so the
suppression is reviewable and removable:

```typescript
await checkAccessibility(page, testInfo, {
  disableRules: ['frame-title'], // Third-party chat widget; tracked in PROJ-4521
  exclude: ['#third-party-analytics-widget'],
});
```

## Keyboard Audit Specs

```typescript
// e2e/tests/a11y/keyboard.spec.ts
import { test, expect } from '@playwright/test';

test('skip link moves focus to main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: /skip to (main )?content/i });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('modal traps focus and returns it on close', async ({ page }) => {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Create project' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Escape closes and returns focus to trigger
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('form can be completed entirely by keyboard', async ({ page }) => {
  await page.goto('/signup');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Jane Doe');
  await page.keyboard.press('Tab');
  await page.keyboard.type('jane@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('SecureP@ss123');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space'); // Toggle checkbox
  await expect(page.getByRole('checkbox', { name: /terms/i })).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); // Submit
  await expect(page).toHaveURL(/\/welcome/);
});
```

## CI Integration

```yaml
# .github/workflows/a11y.yml
name: Accessibility Tests
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  a11y:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build && npm start &
      - run: npx wait-on http://localhost:3000 --timeout 60000
      - run: npx playwright test e2e/tests/a11y/
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: a11y-report
          # upload-artifact takes newline-separated paths via a block scalar
          path: |
            test-results/
            playwright-report/
          retention-days: 14
```
