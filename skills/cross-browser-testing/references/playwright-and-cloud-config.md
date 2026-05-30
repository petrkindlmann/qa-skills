# Playwright and Cloud Platform Configuration — Code

Runnable configuration for Playwright's built-in browsers, branded channels, and cloud platforms (BrowserStack, Sauce Labs). The decision prose for *when* to use each lives in `SKILL.md`; this file holds the implementations.

## Playwright Built-in Browsers

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

## Browser Channels

Playwright can drive locally installed branded browsers instead of its bundled engines.

```typescript
// Use installed Chrome instead of bundled Chromium
{ name: 'chrome', use: { channel: 'chrome' } },

// Use installed Edge
{ name: 'edge', use: { channel: 'msedge' } },

// WebKit is always Playwright's bundled version (no channel option)
// Firefox is always Playwright's bundled version
```

## Running Specific Projects

```bash
# Run only Safari tests
npx playwright test --project=webkit

# Run only mobile tests
npx playwright test --project=mobile-chrome --project=mobile-safari

# Run P0 browsers in CI, all browsers nightly
npx playwright test --project=chromium --project=webkit --project=mobile-chrome --project=mobile-safari
```

## BrowserStack

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

## Sauce Labs

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

## CI Matrix with Cloud Platforms

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
