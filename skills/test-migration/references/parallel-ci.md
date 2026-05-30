# Parallel-Run CI Workflow

Full CI configuration for running the old and new suites side by side during migration. The strategy prose (when the old suite is blocking vs non-blocking, cutover timeline) lives in `SKILL.md`.

## GitHub Actions: parallel suite execution

The legacy suite stays in the pipeline but is non-blocking (`continue-on-error: true`) so its failures are informational while the new suite proves itself. Flip `continue-on-error` off the new suite once it reaches parity, then remove the old job entirely at decommission.

```yaml
# GitHub Actions: parallel suite execution
jobs:
  old-suite:
    name: "E2E Tests (Cypress) [Legacy]"
    runs-on: ubuntu-latest
    # Non-blocking during migration — failures are informational
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx cypress run

  new-suite:
    name: "E2E Tests (Playwright) [Migration]"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
```
