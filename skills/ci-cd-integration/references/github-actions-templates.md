# GitHub Actions Templates

Copy-paste-ready workflow files. Drop into `.github/workflows/` and customize environment variables and secrets for your project.

---

## 1. Unit Test Workflow

Fast feedback on every push. Runs lint, type-check, and unit tests with coverage.

```yaml
# .github/workflows/unit-tests.yml
name: Unit Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

concurrency:
  group: unit-${{ github.ref }}
  cancel-in-progress: true

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Type-check
        run: npm run type-check

      - name: Run unit tests with coverage
        run: npm test -- --ci --coverage --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: test-results

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: unit-test-results
          path: test-results/
          retention-days: 7
```

---

## 2. Playwright E2E Workflow

Runs Playwright tests sharded across multiple runners. Caches browsers to avoid reinstalling on every run. Merges reports from all shards into a single HTML report.

```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests

on:
  pull_request:
    branches: [main]
  push:
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
          node-version: 20
          cache: npm

      - run: npm ci

      # Cache Playwright browsers to skip 200MB+ download on cache hit
      - name: Cache Playwright browsers
        id: playwright-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install Playwright browsers
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium

      # Install OS-level dependencies even on cache hit (they aren't cached)
      - name: Install Playwright OS dependencies
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium

      - name: Build application
        run: npm run build

      # Start the app in the background; wait-on polls until it responds
      - name: Start application
        run: npm start &
        env:
          NODE_ENV: test

      - name: Wait for application
        run: npx wait-on http://localhost:3000 --timeout 60000

      - name: Run Playwright tests (shard ${{ matrix.shard }}/4)
        run: npx playwright test --shard=${{ matrix.shard }}/4
        env:
          BASE_URL: http://localhost:3000
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

      # Upload results even on failure so we can debug
      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: test-results-shard-${{ matrix.shard }}
          path: |
            test-results/
            playwright-report/
          retention-days: 7

      # Upload traces only on failure to save storage
      - name: Upload traces on failure
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: traces-shard-${{ matrix.shard }}
          path: test-results/**/trace.zip
          retention-days: 7

  # Merge all shard reports into one browsable HTML report
  merge-reports:
    needs: e2e
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    timeout-minutes: 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Download all shard results
        uses: actions/download-artifact@v4
        with:
          pattern: test-results-shard-*
          path: all-results

      - name: Merge into single HTML report
        run: npx playwright merge-reports --reporter=html all-results

      - name: Upload merged report
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
```

---

## 3. Full CI Pipeline

Multi-job pipeline with proper dependencies. Lint and unit tests run first, then E2E, then deploy. Uses concurrency groups to cancel stale runs.

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # --- Stage 1: Validate ---
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check

  # --- Stage 2: Unit Tests ---
  unit-tests:
    needs: lint
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm test -- --ci --coverage
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: coverage
          path: coverage/
          retention-days: 7

  # --- Stage 3: E2E Tests ---
  e2e:
    needs: unit-tests
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci

      - name: Cache Playwright browsers
        id: pw-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: pw-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

      - name: Install Playwright
        if: steps.pw-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium

      - name: Install Playwright OS deps
        if: steps.pw-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium

      - run: npm run build

      - name: Start app
        run: npm start &
        env: { NODE_ENV: test }

      - run: npx wait-on http://localhost:3000 --timeout 60000

      - run: npx playwright test --shard=${{ matrix.shard }}/3
        env:
          BASE_URL: http://localhost:3000

      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: e2e-results-${{ matrix.shard }}
          path: |
            test-results/
            playwright-report/
          retention-days: 7

  # --- Stage 4: Deploy (main only) ---
  deploy:
    needs: [unit-tests, e2e]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Prevent concurrent deploys
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - name: Deploy to production
        run: npm run deploy
        env:
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
```

---

## 4. Nightly Full Suite

Scheduled to run the complete test suite every night. Includes all browsers, visual regression, and performance tests. Sends a Slack notification on failure.

```yaml
# .github/workflows/nightly.yml
name: Nightly Full Suite

on:
  schedule:
    # Run at 2am UTC every day, Monday through Friday
    - cron: '0 2 * * 1-5'
  # Allow manual trigger for debugging
  workflow_dispatch:

jobs:
  full-suite:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        # Test across all browsers nightly
        project: [chromium, firefox, webkit]

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }

      - run: npm ci

      - name: Install all Playwright browsers
        run: npx playwright install --with-deps

      - run: npm run build

      - name: Start application
        run: npm start &
        env: { NODE_ENV: test }

      - run: npx wait-on http://localhost:3000 --timeout 60000

      # Run the full suite including visual and performance tests
      - name: Run full test suite (${{ matrix.project }})
        run: npx playwright test --project=${{ matrix.project }}
        env:
          BASE_URL: http://localhost:3000
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

      - name: Upload results
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: nightly-${{ matrix.project }}
          path: |
            test-results/
            playwright-report/
          retention-days: 14

  # Notify the team on failure so flaky tests don't go unnoticed
  notify:
    needs: full-suite
    if: failure()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Send Slack notification
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "Nightly test suite failed",
              "blocks": [
                {
                  "type": "header",
                  "text": { "type": "plain_text", "text": "Nightly Tests Failed" }
                },
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Repository:* ${{ github.repository }}\n*Run:* <${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View logs>\n*Triggered by:* ${{ github.event_name }}"
                  }
                }
              ]
            }
```

---

## 5. PR Quality Gate

Runs on pull requests. Posts test results as a PR comment and blocks merge on failure. Combines lint, unit tests, and a quick E2E smoke suite.

```yaml
# .github/workflows/pr-quality-gate.yml
name: PR Quality Gate

on:
  pull_request:
    branches: [main]

concurrency:
  group: pr-gate-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  checks: write
  pull-requests: write
  contents: read

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }

      - run: npm ci

      - name: Lint and type-check
        run: |
          npm run lint
          npm run type-check

      - name: Run unit tests
        run: npm test -- --ci --coverage --reporters=default --reporters=jest-junit
        env:
          JEST_JUNIT_OUTPUT_DIR: test-results
          JEST_JUNIT_OUTPUT_NAME: junit.xml

      # Publish test results as a check run visible in the PR
      - name: Publish test results
        uses: dorny/test-reporter@v1
        if: ${{ !cancelled() }}
        with:
          name: Unit Test Results
          path: test-results/junit.xml
          reporter: jest-junit
          fail-on-error: true

      # Post coverage summary as a sticky PR comment (updates on new pushes)
      - name: Generate coverage summary
        if: ${{ !cancelled() }}
        run: |
          echo "## Test Coverage" > coverage-comment.md
          echo "" >> coverage-comment.md
          echo '```' >> coverage-comment.md
          npx istanbul report --include coverage/coverage-final.json text-summary 2>/dev/null \
            | tail -n +2 >> coverage-comment.md || echo "Coverage summary unavailable" >> coverage-comment.md
          echo '```' >> coverage-comment.md
          echo "" >> coverage-comment.md
          echo "_Updated by CI on $(date -u +'%Y-%m-%d %H:%M UTC')_" >> coverage-comment.md

      - name: Comment coverage on PR
        uses: marocchino/sticky-pull-request-comment@v2
        if: ${{ !cancelled() }}
        with:
          header: test-coverage
          path: coverage-comment.md

      - name: Upload coverage artifact
        uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: pr-coverage
          path: coverage/
          retention-days: 7
```

---

## Usage Notes

### Customizing for Your Project

1. **Replace `npm test`** with your actual test command (`npx jest`, `npx vitest`, etc.)
2. **Replace `npm start`** with however your app starts (`npm run dev`, `npx serve dist`, etc.)
3. **Set secrets** in GitHub repo Settings > Secrets and variables > Actions
4. **Adjust shard counts** based on test suite size. Rule of thumb: aim for 3-5 minutes per shard.
5. **Adjust `timeout-minutes`** based on your suite's actual duration plus a 50% buffer.

### Shard Count Guidelines

| Suite Size | Recommended Shards | Expected Duration |
|------------|-------------------|-------------------|
| < 50 tests | 1-2 | 2-5 min |
| 50-200 tests | 3-4 | 4-8 min |
| 200-500 tests | 4-6 | 5-10 min |
| 500+ tests | 6-10 | 5-10 min |

### Required npm Scripts

These workflows assume these scripts exist in `package.json`:

```json
{
  "scripts": {
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "build": "next build",
    "start": "next start",
    "deploy": "your-deploy-command"
  }
}
```

### Required Packages

```bash
# For unit test reporting
npm install -D jest-junit

# For E2E tests
npm install -D @playwright/test

# For waiting on the app to start in CI
npm install -D wait-on
```
