# Test Architecture Audit Worksheets

Fill-in worksheets for the test suite health audit. The "what to assess" guidance and the audit-output categorization live in `SKILL.md`; copy these blanks and fill them in during the 2–4 hour audit.

## Coverage and Distribution

```
Audit Worksheet: Test Suite Health
═══════════════════════════════════

Test Counts:
  Unit tests:         _____ passing / _____ total (_____ skipped)
  Integration tests:  _____ passing / _____ total (_____ skipped)
  E2E tests:          _____ passing / _____ total (_____ skipped)

Pyramid Shape: [ ] Healthy  [ ] Ice cream cone  [ ] Diamond  [ ] Hourglass
  (See test-strategy skill for shape definitions)

Code Coverage: _____ % lines / _____ % branches
  Critical paths coverage: _____ %
  Coverage trend (last 3 months): [ ] Increasing  [ ] Stable  [ ] Declining
```

## Reliability

```
Flakiness:
  Flaky test rate (last 30 days): _____ %
  Top 3 flakiest tests:
    1. _____________________
    2. _____________________
    3. _____________________
  Quarantined tests: _____ count
  Quarantine age (oldest): _____ days
```

## CI Health

```
CI Pipeline:
  Full suite duration: _____ minutes
  Unit test stage:     _____ minutes
  E2E test stage:      _____ minutes
  Parallelism:         _____ workers/shards
  Pass rate (7-day):   _____ %
  Flaky retries needed: _____ % of runs
```

## Technical Debt

```
Tech Debt Inventory:
  Skipped/disabled tests:          _____ count (review each — fix or delete)
  Tests with waitForTimeout:       _____ count (replace with proper waits)
  Tests with force: true:          _____ count (investigate why)
  Hardcoded test data:             _____ count (move to fixtures/factories)
  Tests without assertions:        _____ count (add assertions or delete)
  Deprecated API usage:            _____ count (update to current API)
  Tests older than 12 months
    with no modifications:         _____ count (review for relevance)
  AI-generated tests with no
    human review or sign-off:      _____ count (review or delete — closed AI loop is not coverage)
  Stale feature flags blocking
    test scenarios:                _____ count (use platform stale-flag detection, e.g. GrowthBook code references, LaunchDarkly archive flow)
```

## Conventions

```
Patterns in Use:
  Page objects:          [ ] Yes  [ ] Partial  [ ] No
  Fixture-based setup:   [ ] Yes  [ ] Partial  [ ] No
  Data factories:        [ ] Yes  [ ] Partial  [ ] No
  Consistent naming:     [ ] Yes  [ ] Partial  [ ] No
  Shared utilities:      [ ] Yes  [ ] Partial  [ ] No
  Test tagging/grouping: [ ] Yes  [ ] Partial  [ ] No
```
