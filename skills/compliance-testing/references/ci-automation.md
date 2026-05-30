# Scheduled Compliance Audits — CI Workflow

Run compliance tests weekly to catch configuration drift, not just on PR. Compliance evidence is retained longer than standard test artifacts to support audit-trail requirements.

```yaml
# .github/workflows/compliance-audit.yml
name: Weekly Compliance Audit
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 06:00 UTC
  workflow_dispatch: {}
jobs:
  compliance:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run build && npm start &
      - run: npx wait-on http://localhost:3000 --timeout 60000
      - run: npx playwright test --project=chromium --grep @compliance
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: compliance-report-${{ github.run_number }}
          path: test-results/
          retention-days: 90  # Keep compliance evidence longer
```
