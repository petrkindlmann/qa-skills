# Visual Testing Recipes

Runnable Playwright snippets for the patterns SKILL.md points to. All examples assume
`@playwright/test` 1.60+.

## Freezing dynamic content before capture

Pin the clock, stub the API, and abort fonts so the render is byte-deterministic.
Use `page.clock.setFixedTime` to hold the clock dead-still (best for screenshots);
use `page.clock.install` only when the page must observe the clock ticking from a seed.

```typescript
test('dashboard with frozen data', async ({ page }) => {
  // Pin time dead-still — eliminates timestamp differences. setFixedTime does not tick.
  await page.clock.setFixedTime(new Date('2026-01-15T10:00:00Z'));

  // Stub API to return deterministic data
  await page.route('**/api/dashboard', async (route) => {
    await route.fulfill({
      json: {
        stats: { users: 1234, revenue: 56789 },
        chart: [10, 20, 30, 40, 50],
      },
    });
  });

  // Disable font loading to prevent FOUT (Flash of Unstyled Text)
  await page.route('**/*.woff2', (route) => route.abort());

  await page.goto('/dashboard');
  await expect(page.getByTestId('chart-container')).toBeVisible();

  // Force any in-flight animations to their end frame
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => a.finish());
  });

  await expect(page).toHaveScreenshot('dashboard-frozen.png', {
    animations: 'disabled',
  });
});
```

## Hiding dynamic regions with stylePath (cleaner than mask)

`stylePath` injects a stylesheet at capture time only. It hides cursors, animations, and
dynamic chrome declaratively without per-element `mask:[]` arrays — the preferred approach
in 1.60+ for animation/cursor noise. Use `mask:[]` when you need to blank a specific element
the stylesheet cannot target.

```typescript
// screenshot.css
// * { caret-color: transparent !important; }
// .live-clock, .activity-feed { visibility: hidden !important; }
// *, *::before, *::after { animation: none !important; transition: none !important; }

await expect(page).toHaveScreenshot('profile.png', {
  stylePath: './screenshot.css',
});
```

## Component-level screenshots across states

Screenshot the component, not the page — stub the API to drive each state.

```typescript
test('data table renders with normal data', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page.getByRole('table')).toBeVisible();
  const table = page.getByRole('table', { name: 'Users' });
  await expect(table).toHaveScreenshot('users-table.png');
});

test('empty state renders correctly', async ({ page }) => {
  await page.route('**/api/users', (route) => route.fulfill({ json: { users: [] } }));
  await page.goto('/admin/users');
  const emptyState = page.getByTestId('empty-state');
  await expect(emptyState).toHaveScreenshot('users-empty-state.png');
});

test('error state renders correctly', async ({ page }) => {
  await page.route('**/api/users', (route) => route.fulfill({ status: 500 }));
  await page.goto('/admin/users');
  const errorState = page.getByTestId('error-state');
  await expect(errorState).toHaveScreenshot('users-error-state.png');
});
```

## Responsive visual testing across viewports

Test at breakpoints where layout changes, not every possible width. Drive the matrix from
analytics data.

```typescript
const VISUAL_VIEWPORTS = [
  { name: 'mobile', width: 375, height: 667, isMobile: true },
  { name: 'tablet', width: 768, height: 1024, isMobile: false },
  { name: 'desktop', width: 1280, height: 720, isMobile: false },
] as const;

for (const vp of VISUAL_VIEWPORTS) {
  test.describe(`Visual @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile });

    test('homepage layout', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page).toHaveScreenshot(`homepage-${vp.name}.png`, {
        fullPage: true,
        animations: 'disabled',
      });
    });
  });
}
```

Alternatively, define one Playwright project per viewport in `playwright.config.ts` (see
SKILL.md "playwright.config.ts visual settings") and let the runner fan the suite out.

## Dedicated-tool snippets

### Chromatic (Storybook)

```yaml
# GitHub Actions
- uses: chromaui/action@latest
  with:
    projectToken: ${{ secrets.CHROMATIC_PROJECT_TOKEN }}
    exitZeroOnChanges: true    # Changes go to review, not CI failure
    onlyChanged: true          # TurboSnap: only test stories affected by code changes
```

Workflow: push code, CI captures screenshots, reviewers approve/reject in the Chromatic UI,
PR merges after approval.

### Storybook without Chromatic

You do not need Chromatic to visual-test Storybook stories. Point `@playwright/test` at the
story iframe and capture it like any page — keeps baselines in-repo, no SaaS bill:

```typescript
test('Button/Primary story', async ({ page }) => {
  await page.goto('/iframe.html?id=button--primary&viewMode=story');
  await expect(page.getByRole('button')).toBeVisible();
  await expect(page).toHaveScreenshot('button-primary.png');
});
```

The Storybook test-runner can also iterate every story automatically if you want full coverage.

### Percy (any framework)

```typescript
import { percySnapshot } from '@percy/playwright';

test('checkout page visual', async ({ page }) => {
  await page.goto('/checkout');
  await percySnapshot(page, 'Checkout Page', {
    widths: [375, 768, 1280],
    percyCSS: `.ad-banner { display: none !important; }`,
  });
});
// CI: npx percy exec -- npx playwright test --grep @visual
```

### Argos CI (open source)

```typescript
import { argosScreenshot } from '@argos-ci/playwright';

test('pricing page visual', async ({ page }) => {
  await page.goto('/pricing');
  // Confirm preset names against argos-ci.com/docs/viewports before pinning them.
  await argosScreenshot(page, 'pricing-page', { viewports: ['iphone-x', 'macbook-16'] });
});
```

## Platform-specific baselines in CI

Playwright renders differently per OS, so baselines are tagged `*-chromium-linux.png` etc.
Generate them in the same Docker image CI uses so they always match.

```yaml
jobs:
  visual-tests:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.60.0-noble # match @playwright/test in package.json
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright test --grep @visual
```
