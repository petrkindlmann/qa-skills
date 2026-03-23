# Debugging and Triage

How to debug failing tests, triage flaky tests, and configure artifacts for fast diagnosis.

---

## Trace Viewer Workflow

The trace viewer is Playwright's most powerful debugging tool. It records a timeline of actions, network requests, DOM snapshots, and console logs.

### Record Traces

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    // CI: record on first retry (saves storage, captures failures)
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
});
```

Trace options:
- `'off'` -- No traces (fastest)
- `'on'` -- Always record (generates large files)
- `'on-first-retry'` -- Record only when a test retries (best for CI)
- `'retain-on-failure'` -- Record always, keep only if test fails (best for local dev)
- `'on-all-retries'` -- Record every retry attempt

### Open a Trace

```bash
# From a local trace file
npx playwright show-trace test-results/my-test-chromium/trace.zip

# From a URL (e.g., CI artifact link)
npx playwright show-trace https://ci.example.com/artifacts/trace.zip
```

### What to Look For in a Trace

1. **Action timeline:** Each action shows the element state before and after. Look for actions that took unexpectedly long or targeted the wrong element.
2. **Network tab:** Check if API responses returned expected data. Look for failed requests, unexpected redirects, or slow responses.
3. **Console tab:** Look for JavaScript errors, warnings, or unhandled promise rejections.
4. **Before/After DOM snapshots:** Compare the DOM state before and after an action. Look for elements that were not yet rendered or were obscured.
5. **Source tab:** Shows which line of test code triggered each action. Jump directly to the problem.

---

## HTML Report Navigation

```bash
# Generate and open the HTML report
npx playwright show-report

# Open a specific report directory
npx playwright show-report playwright-report/
```

The HTML report shows:
- Pass/fail summary per project and file
- Duration per test (identify slow tests)
- Retry history (see which attempts failed and why)
- Attached traces, screenshots, and videos
- Error messages and stack traces
- **Speedboard** (v1.57+): Performance timeline showing test execution distribution

### Filtering the Report

- Click a project name to filter by browser/device
- Click "Flaky" tab to see tests that passed after retry
- Click "Failed" tab to focus on current failures
- Search by test name or file path

---

## Screenshot, Video, and Trace Artifacts

### Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    screenshot: 'only-on-failure',        // Save screenshots on failure
    video: process.env.CI ? 'on-first-retry' : 'off',  // Video on retry
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },
});
```

### Manual Screenshots in Tests

```typescript
test('visual checkpoint', async ({ page }) => {
  await page.goto('/dashboard');

  // Attach a screenshot to the test report
  await test.info().attach('dashboard-loaded', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
```

### Artifact Directory Structure

```
test-results/
├── my-test-chromium/
│   ├── trace.zip          # Trace viewer archive
│   ├── test-failed-1.png  # Failure screenshot
│   └── video.webm         # Test video (if enabled)
├── another-test-firefox/
│   └── ...
```

---

## Flaky Test Triage Process

A test is "flaky" when it sometimes passes and sometimes fails with no code change. Flaky tests erode trust in the test suite.

### Step 1: Identify

```bash
# Run with --fail-on-flaky-tests to catch flakes in CI
npx playwright test --fail-on-flaky-tests

# Run a specific test multiple times to reproduce
npx playwright test my-test.spec.ts --repeat-each=10

# Run only tests affected by recent changes
npx playwright test --only-changed
```

### Step 2: Classify the Root Cause

| Symptom | Likely cause | Fix |
|---|---|---|
| Element not found | Race condition; element not rendered yet | Use web-first assertion (`expect().toBeVisible()`) before interacting |
| Element obscured | Overlay, toast, or animation covering the target | Dismiss the overlay first, or wait for animation to complete |
| Stale data | Previous test's data leaked | Use fixtures with setup/teardown for test data |
| Different on CI vs local | Timing difference due to slower CI machines | Remove `waitForTimeout()`, use proper waits |
| Fails only in Firefox/WebKit | Browser-specific rendering or event timing | Check for browser-specific workarounds or bugs |
| Network-related | Real API response varies or is slow | Mock the API response with `page.route()` |
| Order-dependent | Test relies on another test's state | Use fixtures for data setup; ensure test isolation |

### Step 3: Fix or Quarantine

```typescript
// If you understand the flake and have a fix: fix it immediately

// If the fix requires app changes: quarantine with a link to the issue
test.fixme('flaky: card drag-and-drop sometimes fails', async ({ page }) => {
  // TODO: Investigate DOM mutation timing. Tracked in JIRA-1234.
});

// If it is a known platform bug: skip on the affected browser
test.skip(({ browserName }) => browserName === 'webkit', 'WebKit bug #12345');
```

### Step 4: Never Ignore

Do not let flaky tests accumulate. A suite with 5% flake rate means every CI run has a ~40% chance of a false failure (with 10 tests).

---

## Retries Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  // Global retries
  retries: process.env.CI ? 2 : 0,

  // Per-project retries (override global)
  projects: [
    {
      name: 'chromium',
      retries: process.env.CI ? 2 : 0,
    },
    {
      name: 'webkit',
      retries: process.env.CI ? 3 : 0, // WebKit can be flakier
    },
  ],
});
```

### Per-Test Retries

```typescript
// Override retries for a specific test
test('known-flaky integration', async ({ page }) => {
  test.info().config.retries; // Read current retry count
});

// Or in describe block
test.describe('external service integration', () => {
  test.describe.configure({ retries: 3 });

  test('calls external API', async ({ page }) => {
    // ...
  });
});
```

### CI: Fail on Flaky

```bash
# In CI, use --fail-on-flaky-tests to treat retried-then-passed as failure
npx playwright test --fail-on-flaky-tests
```

This prevents the suite from silently passing with flaky tests.

---

## VS Code Extension Debugging

Install `ms-playwright.playwright` from the VS Code marketplace.

### Features

- **Gutter run/debug icons:** Click the green triangle next to any test to run it. Click the debug icon to debug it.
- **Pick locator:** Click "Pick Locator" in the testing sidebar, then click any element in the browser. The extension generates the best locator.
- **Watch mode:** Enable "Show Browser" in settings, then edit tests -- they re-run automatically.
- **Trace viewer integration:** Failed tests show a "Show Trace" button that opens the trace viewer inline.

### Debug Configuration

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Playwright Test",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/.bin/playwright",
      "args": ["test", "--debug", "${file}"],
      "console": "integratedTerminal",
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

---

## page.pause() Usage

`page.pause()` opens the Playwright Inspector mid-test. Use it for interactive debugging during development.

```typescript
test('debug this flow', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByLabel('Card number').fill('4242424242424242');

  // Opens the Inspector: step through actions, inspect elements, try locators
  await page.pause();

  await page.getByRole('button', { name: 'Pay' }).click();
});
```

**Rules:**
- NEVER commit `page.pause()` to the repository
- NEVER use `page.pause()` in CI code paths
- Use `forbidOnly: isCI` to catch accidental `test.only`, and consider a linting rule for `page.pause()`

---

## Common Debugging Commands

```bash
# Run a specific test in debug mode (headed browser, pauses at each action)
npx playwright test my-test.spec.ts --debug

# Run in UI mode (interactive, time-travel debugging)
npx playwright test --ui

# Run headed (see the browser, no pausing)
npx playwright test --headed

# Run a specific test by title
npx playwright test -g "submits the form"

# Show the last test report
npx playwright show-report

# Open a trace file
npx playwright show-trace test-results/path/trace.zip

# Generate code by recording browser actions
npx playwright codegen http://localhost:3000

# List available tests without running them
npx playwright test --list
```

---

## Debugging Checklist

When a test fails, work through this checklist:

1. **Read the error message.** What assertion failed? What element was not found?
2. **Open the trace.** Look at the DOM snapshot at the moment of failure.
3. **Check the network tab.** Did the API return unexpected data or a non-200 status?
4. **Check the console tab.** Are there JavaScript errors?
5. **Run locally with --debug.** Does it reproduce? If not, it may be a timing issue.
6. **Run with --repeat-each=10.** Is it flaky?
7. **Check if the test depends on another test's state.** Run it in isolation.
8. **Check if it is browser-specific.** Run with --project=firefox or --project=webkit.
9. **Check recent code changes.** Did a UI change break a locator?
10. **If all else fails,** add `await page.pause()` before the failing line and inspect interactively.
