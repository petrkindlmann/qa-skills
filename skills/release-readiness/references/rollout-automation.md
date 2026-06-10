# Rollout Automation & Verification Commands

Automated promotion rules for staged rollouts and the post-deployment verification commands. The decision prose (what to monitor between stages, the verification timeline checklists) lives in `SKILL.md`.

## Automated Promotion Criteria

Define rules for automatic promotion between stages. Express every threshold **relative to the measured baseline** for this service, not as an absolute number — a 500ms ceiling is wrong for most APIs and a copy-paste invitation to mis-gate. Capture the baseline (e.g. trailing 7-day P95, current 5xx rate) before the rollout starts and compare against it.

```
Promote from canary (1%) to 10% when:
  - 5xx error rate <= baseline + small margin (e.g. not above 1.2x baseline) for 15 minutes
  - P95 latency within tolerance of baseline (e.g. not above 1.2x baseline)
  - No new exception types
  - Zero crash reports

Promote from 10% to 50% when:
  - 5xx error rate at or below baseline for 1 hour
  - P95 latency within tolerance of baseline
  - Conversion rate within 5% of baseline
  - No customer-reported issues

Promote from 50% to 100% when:
  - 5xx error rate at or below baseline for 2 hours
  - All business metrics within expected range
  - No rollback signals from any monitoring system
```

These promotion ceilings are the inverse of the rollback triggers in `SKILL.md` (>2x baseline error rate, >3x baseline P95) — promote while comfortably under baseline, roll back when well over it.

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
