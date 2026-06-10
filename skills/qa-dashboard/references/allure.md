# Allure reference

Full adapter configs, the v3 runnable path, CI history preservation, and failure categories.

## Allure 2 vs Allure 3 — which path

The **framework adapters** (`allure-playwright`, `allure-vitest`, `allure-jest`) still emit Allure 2
result files into `allure-results/`. The difference is the **reader/CLI** that turns those results into
an HTML report:

- **Allure 2 path** — `allure-commandline` (2.42.1, Jun 2026). `brew install allure` installs this. Reads
  `allure-results/categories.json`, `allure generate` / `allure open` / `allure serve`. Stable, frozen
  feature set, mostly dependency bumps now.
- **Allure 3 path** — `allure` npm package + `allurerc.mjs` (3.9.0, May 2026). TypeScript rewrite: plugin
  system, single-file config, real-time `allure watch`, project-wide quality gates, multi-environment
  reports, and **Allure Service** for cloud history (replaces the artifact dance below). Categories move
  into the `allurerc.mjs` plugin config — the dropped-in `categories.json` file is an Allure 2 concept.

Pick Allure 3 for new projects. The commands in the "Allure 3 runnable path" section below are the v3
equivalents of the v2 `allure generate` shown in the SKILL.

## Allure with Playwright

```bash
npm i -D allure-playwright
```

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: [
    ["list"],
    ["allure-playwright", {
      outputFolder: "allure-results",
      detail: true,
      suiteTitle: true,
      environmentInfo: {
        Browser: "Chromium",
        Environment: process.env.TEST_ENV ?? "local",
        BaseURL: process.env.BASE_URL ?? "http://localhost:3000",
      },
    }],
  ],
});
```

**Adding metadata to tests** (severity/feature/story/tag drive Allure's grouping and the "Behaviors" view):

```typescript
import { test, expect } from "@playwright/test";
import { allure } from "allure-playwright";

test.describe("Checkout Flow", () => {
  test("should complete purchase with valid card", async ({ page }) => {
    await allure.severity("critical");
    await allure.feature("Checkout");
    await allure.story("Payment Processing");
    await allure.tag("smoke");

    await allure.attachment("Test Config", JSON.stringify({
      paymentProvider: "stripe-test",
      currency: "USD",
    }), "application/json");

    await page.goto("/checkout");
    await page.fill('[data-testid="card-number"]', "4242424242424242");
    await page.fill('[data-testid="card-expiry"]', "12/28");
    await page.fill('[data-testid="card-cvc"]', "123");
    await page.click('[data-testid="pay-button"]');

    await expect(page.locator('[data-testid="confirmation"]')).toBeVisible();
  });
});
```

## Allure with Jest/Vitest

```bash
# Jest
npm i -D jest-allure2-reporter allure-jest
# Vitest
npm i -D allure-vitest
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: [
      "default",
      ["allure-vitest/reporter", {
        resultsDir: "allure-results",
        environmentInfo: { Node: process.version, OS: process.platform },
      }],
    ],
    setupFiles: ["allure-vitest/setup"],
  },
});
```

## Allure 2 path — generating the report (runnable)

```bash
# Install Allure 2 CLI
brew install allure  # macOS — this installs Allure 2 (allure-commandline 2.42.1)
# or: npm i -D allure-commandline

# Generate HTML report from results
npx allure generate allure-results --clean -o allure-report

# Open the generated report
npx allure open allure-report

# Generate + serve in one step (handy for CI artifact viewing)
npx allure serve allure-results
```

## Allure 3 path — runnable

Allure 3 ships as the `allure` npm package and is driven by an `allurerc.mjs` next to your test config.
This is the v3 equivalent of `allure generate` and is what the "use Allure 3 for new projects" guidance
actually looks like in code:

```bash
npm i -D allure
```

```javascript
// allurerc.mjs
import { defineConfig } from "allure";

export default defineConfig({
  name: "E2E Report",
  output: "allure-report",
  plugins: {
    awesome: {
      options: {
        // v3 reads categories here — NOT from a dropped-in categories.json
        categories: [
          { name: "Product Bugs", matchedStatuses: ["failed"], messageRegex: ".*Expected.*but received.*" },
          { name: "Test Infrastructure", matchedStatuses: ["broken"], messageRegex: ".*(ECONNREFUSED|timeout|navigation).*" },
        ],
      },
    },
  },
});
```

```bash
# Build the report from allure-results (v3 equivalent of `allure generate`)
npx allure run -- npx playwright test     # run tests + build report
npx allure generate allure-results        # build report from existing results
npx allure watch                          # real-time report that updates as tests run
```

## History and trends (Allure 2 — preserve history/ across CI runs)

Allure 2 tracks trends only when you carry the `allure-report/history` directory between runs. (Allure 3 /
Allure Service does this server-side; this snippet is the free Allure 2 way.)

```yaml
# GitHub Actions
- name: Download previous Allure history
  uses: actions/download-artifact@v4
  with:
    name: allure-history
    path: allure-history
  continue-on-error: true  # First run has no history

- name: Run tests
  run: npx playwright test

- name: Copy history to results
  run: |
    mkdir -p allure-results/history
    cp -r allure-history/history/* allure-results/history/ 2>/dev/null || true

- name: Generate Allure report
  run: npx allure generate allure-results --clean -o allure-report

- name: Upload Allure report
  uses: actions/upload-artifact@v4
  with:
    name: allure-report
    path: allure-report/
    retention-days: 30

- name: Upload Allure history
  uses: actions/upload-artifact@v4
  with:
    name: allure-history
    path: allure-report/history/
    retention-days: 90
```

## Custom categories (Allure 2 — `allure-results/categories.json`)

Drop this file into `allure-results/` before `allure generate`. It groups failures by type instead of a
flat list. **Allure 2 only** — in Allure 3 these move into `allurerc.mjs` (see the v3 path above).

```json
// allure-results/categories.json
[
  { "name": "Product Bugs", "matchedStatuses": ["failed"], "messageRegex": ".*Expected.*but received.*" },
  { "name": "Test Infrastructure", "matchedStatuses": ["broken"], "messageRegex": ".*(ECONNREFUSED|timeout|navigation).*" },
  { "name": "Flaky Tests", "matchedStatuses": ["failed"], "messageRegex": ".*(intermittent|race condition|retry).*" },
  { "name": "Missing Test Data", "matchedStatuses": ["broken"], "messageRegex": ".*(seed|fixture|not found in database).*" }
]
```
