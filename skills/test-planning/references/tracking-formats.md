# Tracking & Retrospective Formats

Copy-paste formats for tracking a plan during the sprint and feeding results back into future planning. `SKILL.md` explains the cadence; this file holds the formats verbatim.

## Daily Test Status Format

```
Test Status - [Date]

Completed today:
  ✓ E2E: checkout happy path (TC-201)
  ✓ Unit: discount stacking (TC-305, TC-306)

Blocked:
  ✗ Integration: payment API -- staging env down since 2pm
    Action: DevOps notified, ETA unknown

Found today:
  BUG-789: Discount applies twice on retry (P1, assigned to Dev)
  BUG-790: Avatar upload spinner never stops on timeout (P2, backlog)

Tomorrow:
  - E2E: checkout error paths (TC-202, TC-203)
  - Exploratory: payment flow edge cases (1h session)

Coverage: 14/22 scenarios complete (64%)
Blockers: 1 (staging environment)
Buffer consumed: 2h of 8h (25%)
```

## Sprint Retrospective Inputs

After each sprint, feed these data points back into future planning:

```
Estimation accuracy: Estimated 40h | Actual 46h | Variance +15%
  Cause: Bug verification took 6h more than buffered

Coverage: Planned 22 scenarios | Tested 20 | Skipped 2 (low risk, time pressure)
  Gap: accessibility review deferred

Bugs: Total 7 | P0: 0 | P1: 2 | P2: 3 | P3: 2 | Escaped: 0

Lessons:
  - Buffer was too low for this complexity (increase to 30%)
  - E2E estimation accurate; unit test estimation too low
  - Start testing Day 2 instead of Day 3
```
