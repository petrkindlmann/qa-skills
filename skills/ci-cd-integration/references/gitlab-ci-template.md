# GitLab CI Template

A full `.gitlab-ci.yml` for lint, unit, sharded E2E, and deploy. Image versions reflect mid-2026 (`node:22-alpine`, `mcr.microsoft.com/playwright:v1.60.0-noble`); keep the Playwright image pinned to your installed `@playwright/test` minor.

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
  image: node:22-alpine
  script: [npm ci --prefer-offline, npm run lint, npm run type-check]

unit-tests:
  stage: test
  image: node:22-alpine
  script: [npm ci --prefer-offline, 'npm run test:ci -- --coverage']
  artifacts:
    when: always
    paths: [coverage/]
    reports:
      junit: junit.xml
      # GitLab reads the coverage % and per-line data from the cobertura report.
      coverage_report: { coverage_format: cobertura, path: coverage/cobertura-coverage.xml }

e2e-tests:
  stage: e2e
  image: mcr.microsoft.com/playwright:v1.60.0-noble
  parallel: 4  # GitLab exposes CI_NODE_INDEX and CI_NODE_TOTAL automatically
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
      junit: test-results/junit.xml  # GitLab parses this and shows results in the MR UI
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy-staging:
  stage: deploy
  script: [./deploy.sh staging]
  rules: [{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' }]
  needs: [unit-tests, e2e-tests]
```

## Coverage reporting

Prefer the cobertura `coverage_report` artifact above — GitLab reads the percentage and per-line coverage from it and renders coverage in the MR diff. Emit cobertura from Jest with `jest --coverage --coverageReporters=cobertura` (or via `coverageReporters` in `jest.config.js`).

The legacy stdout regex is a fragile fallback (it breaks across Jest text-table format changes) and is redundant once the cobertura report is present. Only add it if you cannot produce a cobertura report:

```yaml
# Legacy fallback only — drop this once coverage_report (cobertura) is wired up.
coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'
```
