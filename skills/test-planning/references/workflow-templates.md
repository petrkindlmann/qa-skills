# Workflow Step Templates

Copy-paste scaffolds for each workflow step in `SKILL.md`. The decision prose (when and why to use each) lives in `SKILL.md`; this file holds the fill-in-the-blank artifacts.

## Step 1: Feature Decomposition

**Decomposition template:**

```
Feature: [Feature Name]
Source: [User story / PRD / Ticket ID]

Testable Scenarios:
  1. [User action] → [Expected outcome]
  2. [User action with edge case input] → [Expected outcome]
  3. [Error condition] → [Expected error handling]
  4. [Integration point] → [Expected behavior across boundary]
  5. [Performance expectation] → [Response time / throughput target]
```

**Example -- User profile edit:**

```
Feature: User Profile Edit
Source: PROJ-1234

Testable Scenarios:
  1. User updates display name → Name appears updated across all pages
  2. User updates email → Verification email sent, old email works until verified
  3. User uploads avatar > 5MB → Error message shown, upload rejected
  4. User uploads avatar in unsupported format → Error message with supported formats listed
  5. User clears required field and saves → Validation error, field highlighted
  6. Two users edit same profile simultaneously → Last write wins, no data corruption
  7. Profile edit with slow connection → Loading state shown, no duplicate submissions
```

## Step 2: Coverage Mapping

**Coverage matrix template:**

```
| Req ID   | Requirement Description          | Test Type  | Test ID(s)     | Status     |
|----------|----------------------------------|------------|----------------|------------|
| REQ-101  | User can update display name     | Automated  | TC-201, TC-202 | Covered    |
| REQ-102  | Email change requires verification| Automated  | TC-210         | Covered    |
| REQ-103  | Avatar upload size limit 5MB     | Manual     | TC-215         | Planned    |
| REQ-104  | Profile changes audit logged     | None       | --             | GAP        |
```

## Step 3: Effort Estimation

**Sprint estimation worksheet:**

```
Sprint Test Plan Estimation:

New automated tests to write:
  Unit:        ___ tests × 0.5 hrs = ___ hrs
  Integration: ___ tests × 1.0 hrs = ___ hrs
  E2E:         ___ tests × 2.0 hrs = ___ hrs

Manual testing:
  Test cases to execute: ___ × 0.25 hrs = ___ hrs
  Exploratory sessions:  ___ × 1.5 hrs  = ___ hrs

Bug verification buffer (20%):     ___ hrs
Re-test after fixes buffer (10%):  ___ hrs

Total estimated effort:            ___ hrs
Available tester hours this sprint: ___ hrs
Capacity utilization:              ___%  (target: 70-80%)
```

## Step 4: Prioritization Matrix (Risk x Effort)

```
                    EFFORT
                    Low             Medium          High
                   (< 1 hr)        (1-4 hrs)       (> 4 hrs)
                 +---------------+---------------+---------------+
  High           | DO FIRST      | DO SECOND     | DO THIRD      |
  (CRIT/HIGH     | Quick wins    | Core coverage | Invest if     |
   risk score)   | on critical   | for critical  | time allows   |
                 | features      | features      |               |
R                +---------------+---------------+---------------+
I Medium         | DO SECOND     | DO THIRD      | DEFER         |
S (MED risk      | Quick wins    | If capacity   | Move to next  |
K score)         | on moderate   | allows        | sprint        |
                 | features      |               |               |
                 +---------------+---------------+---------------+
  Low            | DO IF TIME    | DEFER         | SKIP          |
  (LOW risk      | Minimal       | Not worth     | Automate      |
   score)        | effort, why   | the effort    | later or      |
                 | not           | this sprint   | never         |
                 +---------------+---------------+---------------+
```

## Step 5: Resource Allocation

**Allocation table:**

```
| Tester    | Available Hours | Assigned Work                    | Hours | Utilization |
|-----------|----------------|----------------------------------|-------|-------------|
| Alice     | 20             | E2E: checkout flow (8h)          | 16    | 80%         |
|           |                | Exploratory: payment (4h)        |       |             |
|           |                | Bug verification buffer (4h)     |       |             |
| Bob       | 16             | Unit: discount calc (4h)         | 12    | 75%         |
|           |                | Integration: payment API (6h)    |       |             |
|           |                | Buffer (2h)                      |       |             |
| Carol     | 12             | Manual: accessibility (4h)       | 10    | 83%         |
|           |                | Exploratory: profile edit (4h)   |       |             |
|           |                | Buffer (2h)                      |       |             |
```

## Step 6: Schedule with Buffers

**Schedule template (2-week sprint):**

```
Week 1:
  Day 1-2: Test plan finalized, test data prepared, environments verified
  Day 3-4: Automated tests written for features delivered early
  Day 5:   First round of manual/exploratory testing on available features

Week 2:
  Day 1-2: Remaining automated tests written, first round regression
  Day 3:   Full regression run, bug verification
  Day 4:   Re-test fixes, exploratory testing on integrated features
  Day 5:   Final regression, sign-off, release readiness assessment

Buffer allocation:
  20% of total hours reserved for unplanned work (bugs, re-tests, blockers)
  Bug triage happens daily at standup -- do not wait until Day 5
```
