# CI Recipes

Production-ready CI/CD configurations for Playwright test suites: reporters, sharding, caching, artifacts, and advanced flags.

---

## Reporter Configuration

### Multiple Reporters

Configure reporters for both human and machine consumption.

```typescript
// playwright.config.ts
const isCI = !!process.env.CI;

export default defineConfig({
  reporter: isCI
    ? [
        // GitHub Actions inline annotations
        ['github'],

        // HTML report for human review
        ['html', { open: 'never', outputFolder: 'playwright-report' }],

        // JSON for downstream processing (dashboards, Slack bots)
        ['json', { outputFile: 'test-results/results.json' }],

        // JUnit XML for CI systems (Jenkins, CircleCI, etc.)
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : [
        // Local: HTML report, auto-open on failure
        ['html', { open: 'on-failure' }],
      ],
});
```

### Custom Reporter

```typescript
// e2e/reporters/slack-reporter.ts
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

class SlackReporter implements Reporter {
  private failures: string[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'failed') {
      this.failures.push(`${test.title} (${test.location.file}:${test.location.line})`);
    }
  }

  async onEnd(result: FullResult) {
    if (this.failures.length > 0 && process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `E2E failures (${this.failures.length}):\n${this.failures.map(f => `- ${f}`).join('\n')}`,
        }),
      });
    }
  }
}

export default SlackReporter;
```

Add to config:

```typescript
reporter: [
  ['html', { open: 'never' }],
  ['./e2e/reporters/slack-reporter.ts'],
],
```

---

## Sharding Setup with Merge

Split tests across multiple CI machines, then merge results into a single report.

### GitHub Actions with Sharding

```yaml
name: E2E Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - run: npx playwright install --with-deps chromium

      - run: npx playwright test --shard=${{ matrix.shard }}/4
        env:
          CI: true
          BASE_URL: ${{ vars.STAGING_URL }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

      - name: Upload blob report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: blob-report-${{ matrix.shard }}
          path: blob-report/
          retention-days: 1

  merge-reports:
    needs: e2e
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Download blob reports
        uses: actions/download-artifact@v4
        with:
          pattern: blob-report-*
          path: all-blob-reports
          merge-multiple: true

      - name: Merge reports
        run: npx playwright merge-reports --reporter=html ./all-blob-reports

      - name: Upload merged report
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

**Key detail:** For shard merge to work, use the `blob` reporter (default when sharding) which creates `blob-report/` with binary blobs that `merge-reports` can combine.

```typescript
// playwright.config.ts -- ensure blob reporter is active for sharding
reporter: process.env.CI
  ? [['blob'], ['github']]
  : [['html', { open: 'on-failure' }]],
```

---

## Retry Configuration

```typescript
export default defineConfig({
  retries: process.env.CI ? 2 : 0,

  // Combine with --fail-on-flaky-tests in CI
  // A test that passes on retry is still flagged as a problem
});
```

```yaml
# In CI workflow
- run: npx playwright test --fail-on-flaky-tests
```

---

## forbidOnly and fail-on-flaky-tests Flags

### forbidOnly

Prevents `test.only` from being committed. The CI run fails immediately if any test uses `.only`.

```typescript
// playwright.config.ts
export default defineConfig({
  forbidOnly: !!process.env.CI,
});
```

### fail-on-flaky-tests

A test that fails on the first attempt but passes on retry is "flaky." This flag treats flaky tests as failures in CI, preventing silent degradation.

```bash
npx playwright test --fail-on-flaky-tests
```

---

## --only-changed for PR Builds

Run only tests affected by files changed in the current PR. Dramatically speeds up PR feedback.

```bash
# Run tests affected by changes since the base branch
npx playwright test --only-changed=origin/main
```

```yaml
# In PR workflow
- run: npx playwright test --only-changed=origin/${{ github.base_ref }}
```

**Note:** This is git-diff-aware. It analyzes import chains to determine which test files are affected by changed source files.

---

## Browser Caching in CI

Downloading browsers on every CI run wastes time and bandwidth. Cache them.

### GitHub Actions

```yaml
- name: Cache Playwright browsers
  id: playwright-cache
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

- name: Install browsers (cache miss only)
  if: steps.playwright-cache.outputs.cache-hit != 'true'
  run: npx playwright install --with-deps chromium

- name: Install system deps (cache hit)
  if: steps.playwright-cache.outputs.cache-hit == 'true'
  run: npx playwright install-deps chromium
```

**Why `install-deps` separately?** Browser binaries are cached, but OS-level dependencies (shared libraries) are not. `install-deps` installs only the system packages.

---

## Artifact Upload Patterns

### Upload on Failure Only

```yaml
- name: Upload test artifacts
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: test-artifacts-${{ matrix.shard }}
    path: |
      test-results/
      playwright-report/
    retention-days: 7
```

### Upload Always (for dashboards, trends)

```yaml
- name: Upload test results
  if: ${{ !cancelled() }}
  uses: actions/upload-artifact@v4
  with:
    name: test-results-${{ matrix.shard }}
    path: test-results/results.json
    retention-days: 30
```

---

## Concurrency and Timeout Configuration

### Worker Concurrency

```typescript
export default defineConfig({
  // Percentage of CPU cores
  workers: process.env.CI ? '50%' : undefined,

  // Or absolute number
  // workers: process.env.CI ? 2 : undefined,

  fullyParallel: true,
});
```

### Timeouts

```typescript
export default defineConfig({
  // Global test timeout (includes all retries)
  timeout: 60_000, // 60 seconds per test

  // Expect timeout (how long web-first assertions retry)
  expect: {
    timeout: 10_000, // 10 seconds
  },

  use: {
    // Action timeout (click, fill, etc.)
    actionTimeout: 15_000,

    // Navigation timeout (goto, waitForURL)
    navigationTimeout: 30_000,
  },
});
```

### CI Job Timeout

Always set a job-level timeout to prevent runaway jobs:

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30  # Kill the job after 30 minutes
```

---

## Complete GitHub Actions Workflow (Production Template)

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

env:
  CI: true

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Cache Playwright browsers
        id: pw-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: pw-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install Playwright browsers
        if: steps.pw-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium firefox webkit

      - name: Install system deps only
        if: steps.pw-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium firefox webkit

      - name: Build application
        run: npm run build

      - name: Run E2E tests
        run: npx playwright test --shard=${{ matrix.shard }}/4 --fail-on-flaky-tests
        env:
          BASE_URL: http://localhost:3000
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

      - name: Upload blob report
        if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v4
        with:
          name: blob-report-${{ matrix.shard }}
          path: blob-report/
          retention-days: 1

  merge-reports:
    needs: e2e
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - uses: actions/download-artifact@v4
        with:
          pattern: blob-report-*
          path: all-blob-reports
          merge-multiple: true

      - run: npx playwright merge-reports --reporter=html ./all-blob-reports

      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14

  pr-tests:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history needed for --only-changed

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: pw-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - run: npx playwright install --with-deps chromium

      - run: npm run build

      - name: Run changed tests only
        run: npx playwright test --only-changed=origin/${{ github.base_ref }} --project=chromium
        env:
          BASE_URL: http://localhost:3000
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
```

---

## Docker Setup

For reproducible CI environments, use the official Playwright Docker image.

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.52.0-noble
      options: --user 1001  # Non-root user
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      # No need to install browsers -- they are pre-installed in the image
      - run: npx playwright test
```

---

## Summary of CI Flags

| Flag | Purpose | When to use |
|---|---|---|
| `--shard=N/M` | Split tests across M machines | Parallel CI jobs |
| `--fail-on-flaky-tests` | Treat retried passes as failures | Always in CI |
| `--only-changed=ref` | Run only affected tests | PR builds |
| `--project=name` | Run specific project | Targeted runs |
| `--grep=pattern` | Filter tests by title pattern | Smoke suites (`@smoke`) |
| `--repeat-each=N` | Run each test N times | Flaky test investigation |
| `--forbid-only` | Fail if `test.only` is used | Always in CI (or config) |
| `--workers=N` | Set parallelism | Tune for CI machine size |
