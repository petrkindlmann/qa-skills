---
name: ci-cd-integration
description: >-
  Design CI/CD pipelines that run test suites. Covers GitHub Actions and GitLab CI
  templates, parallelism and sharding, artifact management, flaky-test quarantine,
  test-result publishing, coverage quality gates, OIDC keyless deploy, and copy-paste
  workflows for Playwright, Jest, and multi-stage pipelines.
  Use when: "CI/CD," "GitHub Actions," "pipeline," "test in CI," "GitLab CI,"
  "continuous integration," "test automation pipeline," "shard tests in CI."
  Not for: per-test flaky healing at runtime — use test-reliability; go/no-go release
  decisions and smoke-test checklists — use release-readiness; test-result dashboards
  and trend reporting — use qa-metrics.
  Related: playwright-automation, qa-metrics, test-reliability, coverage-analysis, release-readiness.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: infrastructure
---

<objective>
A 20-minute serial suite on every push destroys developer velocity; a green pipeline that retries flaky tests three times hides the race condition until it ships. This skill produces CI/CD pipelines that run the right tests at the right trigger, shard them across runners, store traces and reports as evidence, quarantine flaky tests instead of masking them, and gate merges on real coverage numbers. Use this skill when the question is about running tests in a pipeline, not writing them.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there (especially `team_maturity` and existing CI conventions). Then:

1. **Which CI platform?** GitHub Actions, GitLab CI, CircleCI, Jenkins? This skill ships templates for GitHub Actions and GitLab CI.
2. **What test types need to run?** Unit, integration, E2E, visual, performance? Each has different resource and timing needs.
3. **What is the current CI duration?** Over 10 minutes means parallelism and sharding are mandatory, not optional.
4. **How many developers push per day?** High-frequency teams need aggressive concurrency cancellation and caching.
5. **What triggers should run which tests?** Not every push needs a full E2E suite — map triggers to suites before writing YAML.

### Calibrate to team maturity

Set `team_maturity` in `.agents/qa-project-context.md`; pick the matching pipeline shape:

- **startup** — one job: lint + unit + one E2E smoke on PR. Fast feedback over completeness.
- **growing** — separate jobs for unit, integration, E2E. Parallelization, artifact uploads, result publishing, flaky quarantine.
- **established** — full matrix: sharded E2E, multi-environment promotion gates, perf and security scans, deploy-gated checks, SLA-backed pipelines.

---

## Core Principles

1. **Fast feedback: right tests at the right time.** Unit tests on every push (under 2 min). E2E on PRs (under 10 min). Full suite on merge and nightly. The trigger-to-suite map below is the contract.
2. **Parallel first: shard tests across workers.** A 20-minute serial suite becomes 5 minutes across 4 shards. Always worth the runner cost.
3. **Artifacts are evidence.** Every run stores traces, screenshots, coverage, and HTML reports. Without artifacts, a CI failure is an undebuggable "reproduce locally" cycle.
4. **Flaky tests need quarantine, not retries.** Retrying hides the problem — the test passes on retry, the report is green, the race condition persists. Move flaky tests to a non-blocking job, track them, fix the root cause.
5. **Quality gates get stricter toward production.** Define what must pass at each stage; PR gate is fast and cheap, deploy gate is comprehensive.
6. **Read thresholds from config, not from bash.** Let the test runner enforce coverage via its own `coverageThreshold`/`thresholds` and exit non-zero. Scraping percentages out of stdout with regex is fragile across runner versions.

---

## Pipeline Architecture

```
Push to branch:   lint+types (30s) → unit (1-2m)
PR opened:        + integration (2-3m) → E2E sharded (5-8m) → merge report
Merge to main:    full E2E ∥ visual ∥ perf budget → deploy (OIDC)
Nightly (cron):   full suite + npm audit + axe a11y + flaky quarantine
```

### What runs when

| Trigger | Tests | Max duration |
|---------|-------|--------------|
| Push to branch | lint, type-check, unit | 2 min |
| PR opened/updated | + integration, E2E smoke | 10 min |
| Merge to main | + full E2E, visual, perf budget | 15 min |
| Nightly schedule | full suite, security, a11y, flaky quarantine | 30 min |
| Release tag | full suite, smoke against staging | 20 min |

---

## GitHub Actions

For complete copy-paste workflow files (unit, sharded Playwright E2E, full pipeline, nightly, PR gate), see `references/github-actions-templates.md`.

### Action versions (June 2026)

Pin to the current major and let Dependabot bump them. The `actions/*` family runs on the Node 24 runner; Node 20 is deprecated on GH-hosted runners.

| Action | Current major | Notes |
|--------|---------------|-------|
| `actions/checkout` | `@v6` | |
| `actions/setup-node` | `@v6` | v5+ auto-caches only when `packageManager` is set; use `cache: npm` to be explicit |
| `actions/cache` | `@v5` | new cache service v2 backend |
| `actions/upload-artifact` | `@v7` | v7 can upload unzipped (`archive: false`) |
| `actions/download-artifact` | `@v7` | pair with upload-artifact major |
| `dorny/test-reporter` | `@v3` | v3 requires Node 24 runner; reporter keys unchanged |
| `dorny/paths-filter` | `@v3` | |
| `marocchino/sticky-pull-request-comment` | `@v3` | |
| `slackapi/slack-github-action` | `@v2` | floating major; see notification note before adopting v3 |

For supply-chain-sensitive pipelines, pin third-party actions (dorny, marocchino, slackapi, knapsack) to a full-length commit SHA with a version comment, and let Dependabot update the SHA: `uses: dorny/test-reporter@<40-char-sha> # v3.0.0`. First-party `actions/*` are lower risk; tags are acceptable there.

### Key concepts

**Concurrency groups** cancel wasted runs when a branch gets multiple pushes:

```yaml
concurrency:
  group: tests-${{ github.ref }}
  cancel-in-progress: true
```

**Matrix sharding** across runners:

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - run: npx playwright test --shard=${{ matrix.shard }}/4
```

**Caching** browsers so they aren't re-downloaded every run:

```yaml
- uses: actions/setup-node@v6
  with: { node-version: 22, cache: npm }

- name: Cache Playwright browsers
  id: playwright-cache
  uses: actions/cache@v5
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}

- name: Install Playwright browsers
  if: steps.playwright-cache.outputs.cache-hit != 'true'
  run: npx playwright install --with-deps chromium
```

**Artifacts** for reports and traces, and **merging sharded reports** into one HTML report — see `references/github-actions-templates.md` (E2E workflow). The merge job uses `actions/download-artifact@v7` with `pattern: test-results-*` then `npx playwright merge-reports --reporter=html`.

### Smarter sharding at scale

Past 10–15 shards, naïve hash-based splitting wastes runner time on uneven shards. Use a timing-aware balancer:

- **`knapsack-pro`** — timing-data based, supports Playwright/Jest/Cypress/RSpec; distributes by historical duration.
- **CloudBees Smart Tests** (formerly **Launchable**) — ML prioritization + Test Impact Analysis; runs only the tests likely to fail for the diff.
- **Datadog Test Optimization** — TIA + flake management; shard-balancing by historical time.
- **Trunk Flaky Tests** — flake-aware quarantine + retry budgeting.

Before reaching for a paid balancer: Playwright's `--shard` already distributes by file and balances on duration from prior runs. To inspect or feed custom timing data, dump it yourself — `npx playwright test --reporter=json | jq '[.suites[].specs[] | {file: .file, duration: .tests[].results[].duration}]'`. For Jest, `jest-slow-test-reporter` surfaces the slowest specs so you can split or fix them.

For self-hosted runners on Kubernetes, use **Actions Runner Controller** (`arc-runner-set` / `gha-runner-scale-set`) — Helm-installed, auto-scales runner pods per workflow. Replaces the deprecated `runner-deployment` CRD.

### Required status checks

Protect main in Settings → Branches → Branch protection rules: enable "Require status checks to pass before merging," add `lint`, `unit-tests`, and `e2e` (all shards) as required checks, and enable "Require branches to be up to date."

---

## GitLab CI

For the full pipeline, see `references/gitlab-ci-template.md`. Key points:

- Stages `[validate, test, e2e, deploy]`; `node:22-alpine` for lint/unit, `mcr.microsoft.com/playwright:v1.60.0-noble` for E2E (keep this pinned to your installed `@playwright/test` minor).
- Parallel sharding: `parallel: 4` exposes `CI_NODE_INDEX`/`CI_NODE_TOTAL`; run `npx playwright test --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL`.
- Coverage: emit a cobertura `coverage_report` artifact and a `junit` report; GitLab reads the percentage and test results from those. The legacy `coverage:` stdout regex is a fragile fallback across Jest versions — prefer the cobertura report.

---

## Advanced Patterns

### Test result publishing to PR comments

```yaml
- name: Publish test results
  uses: dorny/test-reporter@v3
  if: ${{ !cancelled() }}
  with:
    name: Test Results
    path: test-results/junit.xml
    reporter: jest-junit  # use java-junit for a Playwright JUnit report
```

For the sticky coverage PR comment (`marocchino/sticky-pull-request-comment@v3`), see `references/github-actions-templates.md` (PR Quality Gate).

### Conditional test execution

Only test what changed. Use `dorny/paths-filter@v3` to set outputs, then gate steps on them — see `references/github-actions-templates.md` (Conditional execution).

### Flaky test quarantine

Separate flaky tests into a non-blocking job so they run in CI but don't block merges:

```yaml
e2e-stable:        # required for merge
  steps:
    - run: npx playwright test --grep-invert @flaky

e2e-quarantine:    # non-blocking
  continue-on-error: true
  steps:
    - run: npx playwright test --grep @flaky
    - if: failure()
      run: echo "::warning::Quarantined tests failed. Review and fix or remove."
```

Tag flaky tests at the source so the grep splits them:

```typescript
test('sometimes fails due to race condition @flaky', async ({ page }) => {
  // runs in CI but doesn't block merges
});
```

If a quarantined test passes 10 consecutive runs, remove the `@flaky` tag. For runtime self-healing of a single flaky test (selector recovery, auto-retry policy), use `test-reliability`.

### Cache strategies

| Layer | Path | Cache key |
|-------|------|-----------|
| Node modules | (handled by `setup-node` `cache: npm`) | automatic |
| Playwright browsers | `~/.cache/ms-playwright` | `pw-{os}-{hash(package-lock.json)}` |
| Build cache (Next.js) | `.next/cache` | `nextjs-{os}-{hash(lockfile)}-{hash(src)}` |
| Test fixtures | `e2e/fixtures/.cache` | `test-data-{hash(seed.sql)}` |

Use `actions/cache@v5` for layers 2–4; add `restore-keys` on build caches for partial matches.

### OIDC keyless deploy

Don't store a long-lived `DEPLOY_TOKEN`. Use GitHub Actions OIDC to assume a cloud role for short-lived credentials — nothing static to leak or rotate:

```yaml
deploy:
  permissions:
    id-token: write   # request the OIDC JWT
    contents: read
  steps:
    - uses: aws-actions/configure-aws-credentials@v6
      with:
        role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
        aws-region: eu-central-1
    - run: ./deploy.sh production   # uses short-lived STS creds, no static secret
```

The IAM role's trust policy pins the `sub` claim to your repo and branch. GCP (`google-github-actions/auth`) and Azure (`azure/login`) have equivalent OIDC flows.

### Slack/Teams notification on failure

Use `slackapi/slack-github-action@v2` with `webhook-type: incoming-webhook`, gated on `if: failure() && github.ref == 'refs/heads/main'` so only main-branch failures notify. Before moving to `@v3`, note v3 changed payload handling for workflow-trigger webhooks (no longer flattened/stringified) — verify your payload against the v3 docs first. Full example in `references/github-actions-templates.md` (Nightly Full Suite).

---

## Quality Gates

| Gate | When | Required checks | Blocking? |
|------|------|-----------------|-----------|
| **PR Gate** | PR opened/updated | lint, type-check, unit, coverage threshold | Yes |
| **Merge Gate** | Before merge to main | + E2E smoke suite | Yes |
| **Deploy Gate** | Before production deploy | + full E2E, visual, perf budget | Yes |
| **Nightly Gate** | Scheduled 2am daily | full suite, npm audit, axe a11y | Alert only |

### PR Gate (under 3 minutes)

Enforce the coverage floor in the test runner's config, not in bash. In `jest.config.js` (or `vitest.config.ts` `coverage.thresholds`):

```javascript
coverageThreshold: { global: { lines: 80, statements: 80, branches: 70 } }
```

Then `jest --coverage` exits non-zero when coverage drops, so the job fails with no extra script. If you must read the number in CI (e.g. to print it), have Jest emit `json-summary` and read the file — there is no `coverage-summary` CLI:

```yaml
- run: npm test -- --ci --coverage   # exits 1 if below coverageThreshold
- name: Print coverage (optional)
  run: |
    PCT=$(jq '.total.lines.pct' coverage/coverage-summary.json)
    echo "Line coverage: ${PCT}%"
```

(`json-summary` reporter writes `coverage/coverage-summary.json`. For nyc/c8 projects, `nyc report --reporter=text-summary`. The standalone `istanbul` CLI is deprecated — don't use `istanbul report`.)

### Merge Gate (under 10 minutes)

PR Gate + E2E smoke. Configure as required status checks in branch protection.

### Deploy Gate (under 15 minutes)

Needs `[unit-tests, e2e-tests, visual-tests]`, then a perf budget check (`npx lhci autorun` / `lhci assert --config=lighthouserc.json`) before the OIDC deploy step above.

### Nightly Gate (up to 30 minutes)

Full E2E across all browsers, security scan, a11y audit, flaky quarantine. Wire the security and a11y steps as real jobs, not just prose:

```yaml
- run: npm audit --audit-level=high   # fails on high/critical advisories
- run: npx playwright test --grep @a11y   # specs that call @axe-core/playwright
```

Where the `@a11y`-tagged specs use `@axe-core/playwright`:

```typescript
import AxeBuilder from '@axe-core/playwright';
test('home page has no a11y violations @a11y', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

Results go to Slack, not as blocking checks.

---

## Anti-Patterns

### 1. Running all tests on every commit
A 20-minute full suite on every push destroys velocity. Use the trigger-to-suite map: fast tests on push, comprehensive on PR and merge.

### 2. No artifact storage
Without traces, screenshots, and logs, every CI failure becomes a "reproduce locally" cycle that wastes hours. Upload artifacts on `if: ${{ !cancelled() }}`.

### 3. Retrying flaky tests without tracking them
`retries: 3` hides flakiness — the report is green but the race condition persists. Quarantine, track, fix the root cause.

### 4. CI-only failures without local reproduction
If a test only fails in CI, document why (timezone, missing env var, screen resolution) and add a script that replicates CI locally with the **same** Playwright image you run in CI — don't pin a stale image. See `references/github-actions-templates.md` (Local repro).

### 5. Shared state between CI jobs
Jobs that read files from sibling jobs without artifacts or `needs`. Each job starts fresh; pass data via `upload-artifact`/`download-artifact`.

### 6. No concurrency controls
Multiple runs for the same branch waste runners. Always use a concurrency group with `cancel-in-progress: true`.

### 7. Hardcoded secrets in workflow files
Never put tokens, passwords, or keys in YAML. Use repo secrets (`${{ secrets.X }}`) or GitLab CI/CD variables — and prefer OIDC keyless auth over any long-lived deploy token.

### 8. Ignoring job timeouts
A stuck test can hold a runner for hours. Set `timeout-minutes` on every job and `actionTimeout`/`navigationTimeout` in the Playwright config.

---

## Verification

Prove the pipeline before relying on it. Smallest check first:

1. **Lint the workflow syntax** — `actionlint .github/workflows/*.yml` catches expression, `needs`, and shell-quoting errors before they fail at runtime. Add a `yamllint .github/workflows/` pass for indentation. Run actionlint as a job too.
2. **Dry-run a job locally** — `act -j unit-tests` runs the job in a container so you can iterate without pushing.
3. **Confirm required checks appear** — push to a throwaway branch, open a draft PR, and verify the expected check runs (`lint`, `unit-tests`, `e2e`) show up and that the coverage gate fails when you drop coverage below the threshold.
4. **Verify artifacts** — download the run's artifacts from the Actions UI (or `gh run download <id>`) and confirm `playwright-report/` and traces are present.

---

## Done When

- A trigger map exists: push runs lint+unit only; the PR workflow gates E2E behind `if: github.event_name == 'pull_request'` (verify the YAML, not "integration runs somewhere").
- `actionlint .github/workflows/*.yml` exits 0.
- A non-blocking quarantine job runs `--grep @flaky` with `continue-on-error: true`; the stable job runs `--grep-invert @flaky` and is in the required checks list.
- Test artifacts (reports, screenshots, traces) upload on `if: ${{ !cancelled() }}` with an explicit `retention-days`/`expire_in`.
- Concurrency groups with `cancel-in-progress: true` are set on the PR/test workflows.
- Coverage is enforced by the runner's `coverageThreshold`/`thresholds` (job exits non-zero below the floor) — no `coverage-summary` CLI scrape.
- Branch protection lists `lint`, `unit-tests`, and `e2e` as required status checks.
- No long-lived deploy token in YAML — deploy uses OIDC (`id-token: write` + cloud role) or, at minimum, a secrets-store reference.

---

## Related Skills

- **playwright-automation** — writing the E2E tests, Page Object Model, and the `playwright.config.ts` whose sharding/timeouts this pipeline drives.
- **test-reliability** — runtime self-healing of one flaky test (selector recovery, retry policy); go there to fix a flaky test, come here to quarantine it in CI.
- **qa-metrics** — turning the JUnit/coverage artifacts this pipeline produces into dashboards and flakiness trends.
- **release-readiness** — the human go/no-go decision and release checklist that consumes these gate results; this skill builds the gates, that one decides on them.
- **coverage-analysis** — finding the coverage gaps and setting the threshold this skill's PR gate enforces.

## Reference Files (in `references/`)

- **github-actions-templates.md** — copy-paste unit, sharded Playwright E2E (+ report merge), full pipeline, nightly (Slack + audit + axe), and PR quality-gate workflows, plus conditional execution and local-repro snippets.
- **gitlab-ci-template.md** — full `.gitlab-ci.yml` with parallel sharding, cobertura coverage, and JUnit MR reporting.
