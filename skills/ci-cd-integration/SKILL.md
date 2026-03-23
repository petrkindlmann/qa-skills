---
name: ci-cd-integration
description: >-
  Design CI/CD pipelines for test execution. Covers GitHub Actions and GitLab CI
  pipeline templates, parallelism and sharding strategies, artifact management,
  flaky test quarantine, test result publishing, and quality gates. Includes
  copy-paste-ready workflow files for Playwright, Jest, and multi-stage pipelines.
  Use when: "CI/CD," "GitHub Actions," "pipeline," "test in CI," "GitLab CI,"
  "continuous integration," "test automation pipeline."
  Related: playwright-automation, qa-metrics, self-healing-tests, coverage-analysis.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: infrastructure
---

# CI/CD Integration

## Discovery Questions

1. **Which CI platform?** GitHub Actions, GitLab CI, CircleCI, Jenkins? This skill focuses on GitHub Actions and GitLab CI.
2. **What test types need to run?** Unit, integration, E2E, visual regression, performance? Each has different resource and timing needs.
3. **What is the current CI duration?** If over 10 minutes, parallelism and sharding are essential.
4. **How many developers push per day?** High-frequency teams need aggressive concurrency controls and caching.
5. **What triggers should run which tests?** Not every push needs a full E2E suite.
6. **Check `.agents/qa-project-context.md` first.** Respect existing CI conventions and infrastructure constraints.

---

## Core Principles

1. **Fast feedback: right tests at the right time.** Unit tests on every push (under 2 min). E2E on PRs (under 10 min). Full suite on merge and nightly.
2. **Parallel first: shard tests across workers.** A 20-minute serial suite becomes 5 minutes across 4 shards. Always worth the runner cost.
3. **Artifacts are evidence.** Every CI run must store traces, screenshots, coverage reports, and HTML reports. Without artifacts, CI failures are undebuggable.
4. **Flaky tests need quarantine, not retries.** Retrying hides the problem. Move flaky tests to a separate non-blocking job, track them, and fix them.
5. **Quality gates at every stage.** Define what must pass before code moves forward. Gates get stricter as code gets closer to production.

---

## Pipeline Architecture

```
Push to branch:
  ┌─────────────┐
  │ lint + types │  (30s)
  └──────┬──────┘
         │
  ┌──────▼──────┐
  │  unit tests  │  (1-2 min)
  └──────┬──────┘
         │ (pass)
         ▼
  PR opened/updated:
  ┌──────────────┐
  │  integration  │  (2-3 min)
  └──────┬───────┘
         │
  ┌──────▼──────────┐
  │  E2E (sharded)   │  (5-8 min)
  └──────┬──────────┘
         │
  ┌──────▼──────┐
  │ merge report │
  └─────────────┘

Merge to main:
  ┌───────────┐  ┌──────────┐  ┌──────────┐
  │  full E2E  │  │  visual   │  │  perf     │
  └─────┬─────┘  └────┬─────┘  └────┬─────┘
        └──────────────┼─────────────┘
                       ▼
                ┌─────────────┐
                │   deploy     │
                └─────────────┘

Nightly (scheduled):
  full suite + security scan + a11y audit + flaky quarantine
```

### What Runs When

| Trigger | Tests | Max Duration |
|---------|-------|-------------|
| Push to branch | lint, type-check, unit | 2 min |
| PR opened/updated | + integration, E2E smoke | 10 min |
| Merge to main | + full E2E, visual, perf budget | 15 min |
| Nightly schedule | full suite, security, a11y, flaky quarantine | 30 min |
| Release tag | full suite, smoke against staging | 20 min |

---

## GitHub Actions Templates

For complete, copy-paste-ready workflow files, see `references/github-actions-templates.md`.

### Key Concepts

**Concurrency groups** prevent wasted runs when a branch gets multiple pushes:

```yaml
concurrency:
  group: tests-${{ github.ref }}
  cancel-in-progress: true
```

**Matrix strategy** for sharding tests across runners:

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/4
```

**Caching** to avoid reinstalling on every run:

```yaml
# Node modules: handled by setup-node's cache option
- uses: actions/setup-node@v4
  with: { node-version: 20, cache: npm }

# Playwright browsers: cache separately
- name: Cache Playwright browsers
  id: playwright-cache
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

- name: Install Playwright browsers
  if: steps.playwright-cache.outputs.cache-hit != 'true'
  run: npx playwright install --with-deps chromium
```

**Artifact management** for reports and traces:

```yaml
- uses: actions/upload-artifact@v4
  if: ${{ !cancelled() }}
  with:
    name: test-results-${{ matrix.shard }}
    path: |
      test-results/
      playwright-report/
      coverage/
    retention-days: 7
```

**Merging sharded reports** into a single HTML report:

```yaml
merge-reports:
  needs: e2e
  if: ${{ !cancelled() }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: npm }
    - run: npm ci
    - uses: actions/download-artifact@v4
      with: { pattern: 'test-results-*', path: all-results }
    - run: npx playwright merge-reports --reporter=html all-results
    - uses: actions/upload-artifact@v4
      with: { name: playwright-report, path: playwright-report/, retention-days: 14 }
```

### Status Checks Configuration

Required status checks protect your main branch. Configure in GitHub repo settings:

1. Go to Settings > Branches > Branch protection rules
2. Enable "Require status checks to pass before merging"
3. Add these required checks: `lint`, `unit-tests`, `e2e` (all shards)
4. Enable "Require branches to be up to date before merging"

---

## GitLab CI Templates

```yaml
# .gitlab-ci.yml
stages: [validate, test, e2e, deploy]

variables:
  NODE_ENV: test
  npm_config_cache: '$CI_PROJECT_DIR/.npm'

cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths: [.npm/, node_modules/]

lint:
  stage: validate
  image: node:20-alpine
  script: [npm ci --prefer-offline, npm run lint, npm run type-check]

unit-tests:
  stage: test
  image: node:20-alpine
  script: [npm ci --prefer-offline, 'npm run test:ci -- --coverage']
  coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'
  artifacts:
    when: always
    paths: [coverage/]
    reports:
      junit: junit.xml
      coverage_report: { coverage_format: cobertura, path: coverage/cobertura-coverage.xml }

e2e-tests:
  stage: e2e
  image: mcr.microsoft.com/playwright:v1.49.0-noble
  parallel: 4  # GitLab provides CI_NODE_INDEX and CI_NODE_TOTAL automatically
  script:
    - npm ci --prefer-offline
    - npm run build
    - npm start &
    - npx wait-on http://localhost:3000 --timeout 60000
    - npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL
  artifacts:
    when: always
    paths: [test-results/, playwright-report/]
    expire_in: 7 days
    reports:
      junit: test-results/junit.xml  # GitLab parses this and shows results in MR UI
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy-staging:
  stage: deploy
  script: [./deploy.sh staging]
  rules: [{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' }]
  needs: [unit-tests, e2e-tests]
```

---

## Advanced Patterns

### Test Result Publishing to PR Comments

Post test results directly on the PR for visibility:

```yaml
# Add after test step in GitHub Actions
- name: Publish test results
  uses: dorny/test-reporter@v1
  if: ${{ !cancelled() }}
  with:
    name: Test Results
    path: test-results/junit.xml
    reporter: jest-junit  # or java-junit for Playwright

- name: Comment coverage on PR
  uses: marocchino/sticky-pull-request-comment@v2
  if: github.event_name == 'pull_request'
  with:
    header: coverage
    path: coverage/coverage-summary.md
```

### Conditional Test Execution

Only test what changed to save CI time:

```yaml
- name: Detect changed files
  id: changes
  uses: dorny/paths-filter@v3
  with:
    filters: |
      frontend:
        - 'src/**'
        - 'e2e/**'
      backend:
        - 'api/**'
        - 'lib/**'
      config:
        - 'package.json'
        - 'playwright.config.ts'

- name: Run E2E tests
  if: steps.changes.outputs.frontend == 'true' || steps.changes.outputs.config == 'true'
  run: npx playwright test

- name: Run API tests
  if: steps.changes.outputs.backend == 'true' || steps.changes.outputs.config == 'true'
  run: npm run test:api
```

### Test Timing Optimization

Playwright `--shard` distributes tests by file, balancing duration from previous runs. For custom balancing, generate timing data: `npx playwright test --reporter=json | jq '[.suites[].specs[] | {file: .file, duration: .tests[].results[].duration}]'`. For Jest, use `jest-slow-test-reporter` to identify slow tests.

### Flaky Test Quarantine

Separate flaky tests into a non-blocking job:

```yaml
e2e-stable:
  runs-on: ubuntu-latest
  steps:
    - run: npx playwright test --grep-invert @flaky
  # This job is required for merge

e2e-quarantine:
  runs-on: ubuntu-latest
  continue-on-error: true  # Non-blocking
  steps:
    - run: npx playwright test --grep @flaky
    - name: Report flaky results
      if: failure()
      run: |
        echo "::warning::Quarantined tests failed. Review and fix or remove."
```

Tag flaky tests in your test files:

```typescript
test('sometimes fails due to race condition @flaky', async ({ page }) => {
  // This test is quarantined -- runs in CI but doesn't block merges
});
```

Track flaky tests over time. If a quarantined test passes 10 consecutive runs, remove the `@flaky` tag.

### Cache Strategies

| Layer | Path | Cache Key |
|-------|------|-----------|
| Node modules | (handled by `setup-node` `cache: npm`) | automatic |
| Playwright browsers | `~/.cache/ms-playwright` | `pw-{os}-{hash(package-lock.json)}` |
| Build cache (Next.js) | `.next/cache` | `nextjs-{os}-{hash(lockfile)}-{hash(src)}` |
| Test fixtures | `e2e/fixtures/.cache` | `test-data-{hash(seed.sql)}` |

Use `actions/cache@v4` for layers 2-4. Add `restore-keys` for build caches to allow partial matches.

### Slack/Teams Notification on Failure

Use `slackapi/slack-github-action@v2.0.0` with `webhook-type: incoming-webhook`. Condition on `if: failure() && github.ref == 'refs/heads/main'` so notifications only fire for main branch failures. See `references/github-actions-templates.md` (Nightly Full Suite) for a complete example.

---

## Quality Gates

### Gate Definitions

| Gate | When | Required Checks | Blocking? |
|------|------|-----------------|-----------|
| **PR Gate** | PR opened/updated | lint, type-check, unit tests | Yes |
| **Merge Gate** | Before merge to main | + E2E smoke suite | Yes |
| **Deploy Gate** | Before production deploy | + full E2E, visual regression, perf budget | Yes |
| **Nightly Gate** | Scheduled 2am daily | full suite, security scan, a11y audit | Alert only |

### PR Gate (fast, under 3 minutes)

```yaml
pr-gate:
  runs-on: ubuntu-latest
  steps:
    - run: npm run lint
    - run: npm run type-check
    - run: npm test -- --ci --coverage
    - run: |
        COVERAGE=$(npx coverage-summary --json | jq '.total.lines.pct')
        if (( $(echo "$COVERAGE < 80" | bc -l) )); then
          echo "::error::Coverage $COVERAGE% is below 80% threshold"
          exit 1
        fi
```

### Merge Gate (comprehensive, under 10 minutes)

Requires PR Gate + E2E smoke tests. Configure as required status checks in branch protection.

### Deploy Gate (full confidence, under 15 minutes)

```yaml
deploy-gate:
  needs: [unit-tests, e2e-tests, visual-tests]
  runs-on: ubuntu-latest
  steps:
    - name: Check performance budget
      run: |
        npx lighthouse-ci assert --config=lighthouserc.json
    - name: Deploy to production
      if: success()
      run: ./deploy.sh production
```

### Nightly Gate (thorough, up to 30 minutes)

```yaml
on:
  schedule:
    - cron: '0 2 * * *'  # 2am UTC daily
```

Runs everything: full E2E suite across all browsers, security scan (npm audit, Snyk), accessibility audit (axe-core), and the flaky quarantine suite. Results go to Slack, not as blocking checks.

---

## Anti-Patterns

### 1. Running all tests on every commit
A 20-minute full suite on every push destroys developer velocity. Use the pipeline architecture above: fast tests on push, comprehensive tests on PR and merge.

### 2. No artifact storage
When CI tests fail, developers need traces, screenshots, and logs to debug. Without artifacts, every failure requires a "reproduce locally" cycle that wastes hours.

### 3. Retrying flaky tests without tracking them
Adding `retries: 3` hides flakiness. The test passes on retry, the report is green, but the underlying race condition persists. Quarantine flaky tests, track them in a dashboard, and fix the root cause.

### 4. CI-only failures without local reproduction steps
If a test only fails in CI, document why (e.g., different timezone, missing env var, screen resolution). Add a `Makefile` or script that replicates CI conditions locally:

```bash
# Reproduce CI environment locally
docker run --rm -v $(pwd):/work -w /work \
  mcr.microsoft.com/playwright:v1.49.0-noble \
  npx playwright test --project=chromium
```

### 5. Shared state between CI jobs
Jobs that depend on files from other jobs without using artifacts or proper `needs` dependencies. Each job starts fresh. Use `actions/upload-artifact` and `actions/download-artifact` to pass data.

### 6. No concurrency controls
Multiple CI runs for the same branch waste resources. Always use concurrency groups with `cancel-in-progress: true`.

### 7. Hardcoded secrets in workflow files
Never put tokens, passwords, or API keys in YAML. Use GitHub Actions secrets (`${{ secrets.MY_SECRET }}`) or GitLab CI/CD variables.

### 8. Ignoring job timeouts
A stuck test can consume a runner for hours. Always set `timeout-minutes` on jobs and `actionTimeout` / `navigationTimeout` in test configs.

---

## Related Skills

- **playwright-automation** -- E2E test framework setup, Page Object Model, and test patterns.
- **qa-metrics** -- Test result dashboards, coverage tracking, and flakiness monitoring.
- **self-healing-tests** -- Strategies for reducing test maintenance and auto-recovering from UI changes.
- **test-strategy** -- Overall test planning, pyramid design, and risk-based test selection.

For complete, copy-paste-ready GitHub Actions workflow files, see `references/github-actions-templates.md`.
