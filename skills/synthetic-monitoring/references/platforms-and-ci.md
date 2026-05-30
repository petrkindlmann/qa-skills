# Platforms and CI Scheduling

Config for running synthetic probes on a schedule. The platform comparison table and selection guidance live in `SKILL.md`.

## Custom implementation: Playwright + GitHub Actions

```yaml
# .github/workflows/synthetic-monitoring.yml
name: Synthetic Monitoring
on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch: {}

jobs:
  synthetic-probes:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22 # current LTS as of May 2026 — bump as Node LTS rolls forward
      - run: npm ci
      - run: npx playwright install chromium --with-deps

      - name: Run synthetic probes
        env:
          PRODUCTION_URL: ${{ secrets.PRODUCTION_URL }}
          SYNTHETIC_USER_EMAIL: ${{ secrets.SYNTHETIC_USER_EMAIL }}
          SYNTHETIC_USER_PASSWORD: ${{ secrets.SYNTHETIC_USER_PASSWORD }}
          SYNTHETIC_API_KEY: ${{ secrets.SYNTHETIC_API_KEY }}
        run: npx playwright test probes/ --reporter=json --reporter=list

      - name: Report results to monitoring
        if: always()
        run: |
          node scripts/report-synthetic-results.js \
            --results=test-results/results.json \
            --webhook=${{ secrets.MONITORING_WEBHOOK }}
```

## Checkly-based implementation

```typescript
// checkly.config.ts
import { defineConfig } from 'checkly';

export default defineConfig({
  projectName: 'Production Monitoring',
  logicalId: 'prod-monitoring',
  checks: {
    frequency: 5,          // Every 5 minutes
    locations: ['us-east-1', 'eu-west-1', 'ap-southeast-1'],
    // Use the latest stable Checkly runtime — see https://www.checklyhq.com/docs/runtimes/
    // (e.g. 'next' for the rolling stable; pin a dated runtime for reproducibility)
    runtimeId: '2025.04',
    browserChecks: {
      testMatch: 'probes/**/*.check.ts',
    },
  },
  cli: {
    runLocation: 'us-east-1',
  },
});
```

## Alert routing config

```yaml
# alerting-rules.yaml
routes:
  - match:
      severity: critical
      probe: [login, checkout, api-health]
    receivers: [pagerduty-oncall, slack-incidents]
    repeat_interval: 5m

  - match:
      severity: warning
      probe: [search, third-party]
    receivers: [slack-monitoring]
    repeat_interval: 30m

  - match:
      severity: info
    receivers: [slack-monitoring]
    repeat_interval: 4h
```
