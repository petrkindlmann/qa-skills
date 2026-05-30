# Cypress CI Recipes

GitHub Actions workflows for Cypress, with and without Cypress Cloud. The decision prose on when to use Cloud and version-pinning guidance lives in `SKILL.md`.

## With Cypress Cloud

Set `projectId` in `cypress.config.ts`. Run with `npx cypress run --record --key $CYPRESS_RECORD_KEY`. Cloud provides parallelization, flake detection, test replay, and analytics.

```yaml
# GitHub Actions -- Cloud parallelization
jobs:
  cypress:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        containers: [1, 2, 3, 4]
    steps:
      - uses: actions/checkout@v4
      - uses: cypress-io/github-action@v6
        with:
          record: true
          parallel: true
          group: 'E2E Tests'
        env:
          CYPRESS_RECORD_KEY: ${{ secrets.CYPRESS_RECORD_KEY }}
```

## Without Cloud

```yaml
# GitHub Actions -- standalone
steps:
  - uses: actions/checkout@v4
  - uses: cypress-io/github-action@v6
    with:
      build: npm run build
      start: npm run start
      wait-on: 'http://localhost:3000'
      browser: chrome
  - uses: actions/upload-artifact@v4
    if: failure()
    with:
      name: cypress-artifacts
      path: |
        cypress/screenshots
        cypress/videos
```
