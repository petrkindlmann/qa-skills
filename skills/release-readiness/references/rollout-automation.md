# Rollout Automation & Verification Commands

Automated promotion rules for staged rollouts and the post-deployment verification commands. The decision prose (what to monitor between stages, the verification timeline checklists) lives in `SKILL.md`.

## Automated Promotion Criteria

Define rules for automatic promotion between stages:

```
Promote from canary (1%) to 10% when:
  - Error rate < 0.5% for 15 minutes
  - P95 latency < 500ms
  - No new exception types
  - Zero crash reports

Promote from 10% to 50% when:
  - Error rate < 0.5% for 1 hour
  - P95 latency < 500ms
  - Conversion rate within 5% of baseline
  - No customer-reported issues

Promote from 50% to 100% when:
  - Error rate < 0.5% for 2 hours
  - All business metrics within expected range
  - No rollback signals from any monitoring system
```

## Verification Commands

Quick checks you can run right after deployment:

```bash
# Check application health
curl -s https://your-app.com/health | jq .

# Check response time
curl -o /dev/null -s -w "HTTP %{http_code} in %{time_total}s\n" https://your-app.com

# Check for new errors in the last 15 minutes (Sentry CLI example)
sentry-cli issues list --project your-project --query "firstSeen:>15m"

# Compare error counts (Datadog example)
# Before deploy: note the 5xx count
# After deploy: check if 5xx count increased
```
