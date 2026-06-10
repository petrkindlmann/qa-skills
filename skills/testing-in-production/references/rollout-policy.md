# Rollout Policy & Rollback Configuration

Machine-checkable promotion criteria and automatic-rollback triggers for progressive
rollouts. The decision prose, canary-stage table, and guardrail-metric table live in
`SKILL.md`; this file holds the full policy YAML. These are vendor-neutral shapes — map
them onto Argo Rollouts `AnalysisTemplate`, Flagger `MetricTemplate`, or your flag
platform's guarded-rollout config.

## Automated promotion criteria

Define machine-checkable conditions for advancing between stages. Human override remains
available but should be rare.

```yaml
# rollout-policy.yaml
canary_to_10_percent:
  hold_duration: 30m
  conditions:
    - metric: error_rate_5xx
      comparison: less_than
      threshold: 0.5%
      window: 15m
    - metric: latency_p95
      comparison: less_than
      threshold: 500ms
      window: 15m
    - metric: crash_rate
      comparison: equals
      threshold: 0
      window: 15m

10_percent_to_50_percent:
  hold_duration: 2h
  conditions:
    - metric: error_rate_5xx
      comparison: less_than
      threshold: 0.5%
      window: 1h
    - metric: latency_p95
      comparison: less_than
      threshold: 500ms
      window: 1h
    - metric: conversion_rate
      comparison: within_percentage
      baseline: pre_deploy_average
      tolerance: 5%
      window: 1h

50_percent_to_100_percent:
  hold_duration: 4h
  conditions:
    - metric: error_rate_5xx
      comparison: less_than
      threshold: 0.3%
      window: 2h
    - metric: all_guardrails
      comparison: passing
      window: 2h
    - metric: customer_reported_issues
      comparison: equals
      threshold: 0
```

## Automatic rollback triggers

Automatic rollback fires when guardrails are breached. No human approval needed.

```yaml
automatic_rollback:
  - condition: error_rate_5xx > 2x_baseline
    for: 5m
    action: rollback_to_previous
    notify: [oncall-slack, pagerduty]

  - condition: latency_p99 > 3x_baseline
    for: 5m
    action: rollback_to_previous
    notify: [oncall-slack]

  - condition: crash_rate > 0.1%   # mobile: calibrate to user-perceived crash rate
    for: 2m                          # (Play Console Vitals, App Store Connect Crashes,
    action: rollback_to_previous     # iOS Hang Rate / ANR rate) — not raw exception counts
    notify: [oncall-slack, pagerduty, engineering-leads]

  - condition: health_check_failures > 3_consecutive
    action: rollback_immediately
    notify: [oncall-slack, pagerduty]
```

## Error-budget / SLO gates

Raw `2x_baseline` thresholds catch sudden cliffs but miss slow burns that still blow the
SLO. Gate promotion and rollback on **error-budget burn rate**, not only multiplier
thresholds — this is the SRE practice the rollout bridges to. Use multi-window,
multi-burn-rate alerting: a fast window (e.g. 5m) catches sharp regressions, a slow window
(e.g. 1h) catches sustained drains. If the canary cohort burns budget faster than the
fleet's allowable rate for the window, halt promotion or roll back even when the absolute
error rate looks acceptable.

```yaml
slo_gate:
  - condition: budget_burn_rate_5m > 14.4   # ~2% of 30d budget in 1h
    action: rollback_to_previous
    notify: [oncall-slack, pagerduty]
  - condition: budget_burn_rate_1h > 6       # sustained drain
    action: halt_promotion
    notify: [oncall-slack]
```

Tie these to the same SLO definitions the service already publishes so the rollout gate
and the on-call alert never disagree about what "healthy" means.
