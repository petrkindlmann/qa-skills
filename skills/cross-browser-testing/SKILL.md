---
name: cross-browser-testing
description: >-
  Design analytics-driven browser test matrices and execute cross-browser tests.
  Covers BrowserStack/Sauce Labs configuration, Playwright browser channels, common
  cross-browser CSS/JS issues, and progressive enhancement validation.
  Use when: "cross-browser," "browser matrix," "BrowserStack," "Safari issues,"
  "browser compatibility," "IE/Edge."
  Related: visual-testing, playwright-automation, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Design analytics-driven browser test matrices and catch cross-browser issues before users do.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains target browsers, analytics data, and platform priorities that drive matrix design.
</objective>

---

## Discovery Questions

1. **Target browsers from analytics:** What do actual users use? Pull browser/OS data from your analytics tool. Testing browsers nobody uses is waste; missing a browser 15% of users rely on is a bug.
2. **Desktop and mobile?** Mobile Safari on iOS and Chrome on Android have different rendering behaviors than their desktop counterparts. Treat them as separate matrix entries.
3. **Cloud platform:** BrowserStack, Sauce Labs, LambdaTest, or local browsers only? Cloud platforms provide real browser instances; Playwright's built-in browsers cover Chromium, Firefox, and WebKit.
4. **Progressive enhancement or pixel-perfect?** Progressive enhancement accepts graceful degradation. Pixel-perfect demands identical rendering. The answer determines pass/fail criteria.
5. **Existing Playwright config?** If the project already uses Playwright, cross-browser testing is a configuration change, not a new tool.

---

## Core Principles

1. **Analytics-driven matrix.** Test what your users actually use. A browser at 0.3% traffic does not need the same investment as one at 40%. Check analytics quarterly -- browser share shifts.

2. **Progressive enhancement over pixel-perfect.** Identical rendering across all browsers is neither achievable nor necessary. Define what "works" means: core functionality operates, content is accessible, layout is usable. Visual differences in shadows, gradients, or animation timing are acceptable.

3. **Safari and Firefox surface the most cross-browser bugs.** Chrome-only testing catches Chrome bugs. Safari's WebKit engine and Firefox's Gecko engine have the most behavioral differences from Chromium. Prioritize them.

4. **Test functionality, not rendering engine internals.** A cross-browser test should verify that the user can complete a task, not that a CSS property renders identically. Visual comparison tools handle pixel-level differences.

5. **One test, multiple browsers.** Write tests once. Run them across browser configurations. Never duplicate test logic for different browsers.

---

## Browser Matrix Design

### Analytics-Based Methodology

```
Step 1: Export browser/OS data from analytics (last 90 days)
Step 2: Rank by session share
Step 3: Group into tiers
Step 4: Assign test coverage per tier
Step 5: Review quarterly
```

### Tier System

| Tier | Criteria | Coverage | When to run |
|------|----------|----------|-------------|
| **P0** | >10% traffic share | Full test suite | Every PR, every deploy |
| **P1** | 3-10% traffic share | Smoke + critical paths | Nightly, pre-release |
| **P2** | 1-3% traffic share | Smoke tests only | Weekly, pre-release |
| **Skip** | <1% traffic share | Not tested | Manual spot-check if reported |

### Example Matrix (derived from analytics)

```markdown
## Browser Matrix — Q1 2026

| Browser | Version | Platform | Traffic % | Tier | Notes |
|---------|---------|----------|-----------|------|-------|
| Chrome | Latest | Windows | 34% | P0 | |
| Chrome | Latest | macOS | 12% | P0 | |
| Safari | Latest | macOS | 11% | P0 | WebKit-specific issues |
| Chrome | Latest | Android | 15% | P0 | Mobile viewport |
| Safari | Latest | iOS | 14% | P0 | Mobile Safari quirks |
| Firefox | Latest | Windows | 5% | P1 | Gecko rendering |
| Edge | Latest | Windows | 4% | P1 | Chromium-based but different UA |
| Samsung Internet | Latest | Android | 3% | P1 | Chromium fork, older engine |
| Firefox | Latest | macOS | 1.5% | P2 | |
| Chrome | N-1 | Windows | 1.2% | P2 | Previous major version |
```

### Version Coverage Strategy

- **Latest:** Always test current stable release.
- **Latest - 1:** Test previous major version only for P0 browsers where analytics show >1% on older versions.
- **Extended Support Release (ESR):** Test Firefox ESR only if enterprise users are a significant segment.
- **Do not test:** Beta/Canary/Nightly releases unless you are a browser vendor or building browser-facing tools.

---

## Playwright Browser Configuration

### Built-in Browsers

Playwright ships three browser engines. No cloud platform needed for basic cross-browser coverage.

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  projects: [
    // P0: Desktop
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },

    // P0: Mobile
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },

    // P1: Desktop
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'edge', use: { channel: 'msedge' } },

    // P2: Tablets
    { name: 'ipad', use: { ...devices['iPad Pro 11'] } },

    // Optional: real-Chrome rendering parity via the new Chromium headless mode (Playwright 1.49+)
    // Closer to production Chrome (extensions, codecs, fingerprinting) than headless-shell.
    { name: 'chromium-new-headless', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
  ],
});
```

**Playwright 1.59+ adds `page.screencast()`** — capture annotated video of cross-browser test runs. Useful when a matrix failure needs human review across browsers; pair with `--debug=cli` for agent-driven re-runs.

### Browser Channels

Playwright can drive locally installed branded browsers instead of its bundled engines.

```typescript
// Use installed Chrome instead of bundled Chromium
{ name: 'chrome', use: { channel: 'chrome' } },

// Use installed Edge
{ name: 'edge', use: { channel: 'msedge' } },

// WebKit is always Playwright's bundled version (no channel option)
// Firefox is always Playwright's bundled version
```

**When to use channels:** When you need to test browser-specific behavior that differs between Chromium and Chrome (extensions support, enterprise policies, codec support).

### Running Specific Projects

```bash
# Run only Safari tests
npx playwright test --project=webkit

# Run only mobile tests
npx playwright test --project=mobile-chrome --project=mobile-safari

# Run P0 browsers in CI, all browsers nightly
npx playwright test --project=chromium --project=webkit --project=mobile-chrome --project=mobile-safari
```

---

## Cloud Platform Setup

### BrowserStack

```typescript
// browserstack.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    connectOptions: {
      wsEndpoint: `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify({
        browser: 'chrome',
        browser_version: 'latest',
        os: 'Windows',
        os_version: '11',
        'browserstack.username': process.env.BROWSERSTACK_USERNAME,
        'browserstack.accessKey': process.env.BROWSERSTACK_ACCESS_KEY,
        'browserstack.playwrightVersion': '1.59.1', // keep aligned with the version in package.json
        build: `cross-browser-${process.env.CI_BUILD_NUMBER}`,
        name: 'Cross-browser test suite',
      }))}`,
    },
  },
});
```

### Sauce Labs

```typescript
// sauce.config.ts
export default defineConfig({
  use: {
    connectOptions: {
      wsEndpoint: `wss://ondemand.saucelabs.com/playwright?sauce:options=${encodeURIComponent(JSON.stringify({
        username: process.env.SAUCE_USERNAME,
        accessKey: process.env.SAUCE_ACCESS_KEY,
        browserName: 'chromium',
        browserVersion: 'latest',
        platformName: 'Windows 11',
        'sauce:build': `build-${process.env.CI_BUILD_NUMBER}`,
      }))}`,
    },
  },
});
```

### CI Matrix with Cloud Platforms

```yaml
# GitHub Actions: parallel cross-browser on BrowserStack
cross-browser:
  runs-on: ubuntu-latest
  strategy:
    fail-fast: false
    matrix:
      include:
        - browser: chrome
          os: Windows
          os_version: "11"
        - browser: safari
          os: OS X
          os_version: Sonoma
        - browser: firefox
          os: Windows
          os_version: "11"
        - browser: edge
          os: Windows
          os_version: "11"
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npx playwright test
      env:
        BROWSER: ${{ matrix.browser }}
        BROWSERSTACK_USERNAME: ${{ secrets.BROWSERSTACK_USERNAME }}
        BROWSERSTACK_ACCESS_KEY: ${{ secrets.BROWSERSTACK_ACCESS_KEY }}
```

---

## Common Cross-Browser Issues

Real issues that surface in cross-browser testing, with detection patterns and fixes.

### CSS Grid and Flexbox

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

### Scroll Behavior

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

### Date Input

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

### Clipboard API

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

### Backdrop Filter

```css
/* Issue: backdrop-filter not supported in older Firefox */
.modal-overlay {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px); /* Safari */
  background-color: rgba(0, 0, 0, 0.5); /* Fallback */
}
```

### Modern Cross-Browser Gotchas (2026)

The classic Safari laggard list is mostly resolved. Today's real divergences:

- **Partitioned cookies / partitioned storage:** Chrome's CHIPS, Safari's ITP, and Firefox's State Partitioning each behave differently for embedded contexts. Test third-party cookies in iframes per browser, not just per "browser supports cookies."
- **`:has()` selector edge cases:** Universal support but performance and specificity edge cases differ. Visual-regression a `:has()`-heavy page across all three engines.
- **View Transitions API:** Chrome and Edge ship same-document and cross-document; Safari has partial support; Firefox is behind. Treat as progressive enhancement and verify the fallback path in Firefox/older Safari.
- **WebDriver BiDi:** Production-ready in Selenium 4, partially supported in Playwright. For new cross-runner projects, BiDi is the convergence point.

### Dialog Element

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

### Web Animations API

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

---

## Testing Patterns

### Same Test, Multiple Browsers

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

### Browser-Specific Test Logic

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

### Visual Cross-Browser Comparison

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

### Progressive Enhancement Validation

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

---

## Anti-Patterns

**Testing only on Chrome.** Chrome is ~65% of desktop traffic but uses the same engine as Edge, Opera, and Brave. Safari (WebKit) and Firefox (Gecko) surface the real cross-browser issues. Chrome-only testing gives false confidence.

**Testing every browser equally.** A browser at 1% traffic share does not need the same test investment as one at 30%. Use the tier system to allocate effort proportionally.

**Duplicating tests per browser.** Write tests once, run them across browser projects via configuration. If you have a `checkout.chrome.spec.ts` and a `checkout.safari.spec.ts` with the same test logic, you are doing it wrong.

**Using `browserName` checks everywhere.** Excessive browser branching in tests signals application compatibility issues. Fix the app, do not work around it in tests.

**Pixel-perfect assertions without tolerance.** Font rendering, anti-aliasing, and sub-pixel rounding differ between browsers and platforms. Use `maxDiffPixelRatio` or `maxDiffPixels` in visual comparisons.

**Ignoring mobile browsers.** Mobile Chrome and mobile Safari are not the same as their desktop counterparts. They have different viewport behaviors, touch event handling, and CSS support. Test them as separate matrix entries.

**Static browser matrix.** Browser usage changes. If your matrix is based on data from 2 years ago, it is wrong. Review analytics data quarterly.

---

## Done When

- Browser matrix defined using real analytics data (last 90 days), with tier assignments (P0/P1/P2) documented and justified by traffic share.
- Playwright project config (or BrowserStack/Sauce Labs config) reflects the defined matrix and runs P0 browsers on every PR.
- Known browser-specific bugs documented with the affected browser, reproduction steps, and either a workaround or a linked open ticket.
- Rendering issues checklist (flexbox gaps, scroll behavior, date inputs, clipboard API, dialog element) run against all P0 and P1 target browsers.
- Browser matrix reviewed and signed off by the team, with a calendar reminder set for quarterly refresh against updated analytics data.

## Related Skills

- **visual-testing** -- Screenshot comparison, baseline management, and threshold strategies for pixel-level cross-browser validation.
- **playwright-automation** -- Core Playwright patterns, fixtures, and CI configuration that cross-browser testing builds on.
- **ci-cd-integration** -- Pipeline configuration for parallel browser matrix execution, artifact collection.
- **accessibility-testing** -- Cross-browser accessibility differences (screen reader behavior, ARIA support) overlap with cross-browser testing.
- **mobile-testing** -- Device-specific testing for native/hybrid apps extends the browser matrix to app-level concerns.