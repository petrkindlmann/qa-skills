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

For these routes to match, the probe must tag its result with a `severity` and `probe` label. Emit them when reporting results (e.g. in `report-synthetic-results.js`): map the probe file name to `probe` and the consecutive-failure count to `severity` (1 → info, 2 → warning, 2+ across regions → critical) before posting to the alert webhook. Without that tagging step the routes above never fire.

## Probe runbook template

Every probe links to a runbook (the `{link_to_runbook}` field in the alert template). Six lines, one per probe. Example for the payment-integration probe:

```markdown
# Runbook: checkout / payment-integration probe
- What the probe tests: sandbox checkout — cart → Stripe test card → order confirmation page.
- First check: status.stripe.com; then recent deploys to checkout-service (last 60 min); then payment error rate in APM.
- Manual verification (reproduce): log in as synthetic@example.com, add item, pay with test card 4242…, confirm order page.
- Escalate: page #payments-oncall (PagerDuty) if Stripe is green AND a recent deploy correlates.
- Dashboard: https://grafana.example.com/d/checkout-synthetic
- Runbook owner: payments team — review quarterly.
```

Keep the "first checks" line ordered by likelihood: third-party status, recent deploys, then app telemetry. The on-call engineer should be able to start investigating from this line alone.
