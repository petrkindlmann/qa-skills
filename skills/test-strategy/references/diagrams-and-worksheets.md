# Diagrams, Worksheets & Output Template

ASCII reference diagrams and fill-in worksheets for the test-strategy skill. The decision prose and tables that explain how to use these live in `SKILL.md`; this file holds the full templates so the SKILL.md loads lean. Copy the relevant block into the strategy document and fill it in.

## Test Pyramid Shapes

The four shapes the test suite can take, and what each one signals.

```
HEALTHY PYRAMID         ICE CREAM CONE         DIAMOND              HOURGLASS

    /  E2E  \           +-----------+                                 /  E2E  \
   /  ~5-10% \          | E2E ~60%  |            / Int \             / ~30%    \
  /           \         |           |           / ~50%  \           +----------+
 / Integration \        +-----------+          /         \          | Int ~10% |
/   ~15-20%     \       | Int ~20%  |         +-----------+         +----------+
+---------------+       +-----------+         | Unit ~30% |        /  Unit     \
|   Unit ~70%   |       | Unit ~20% |         +-----------+       /   ~60%      \
+---------------+       +-----------+                             +--------------+

Fast feedback,          Slow, brittle,        Heavy on mocks,      Missing middle
high confidence,        expensive to run,     integration gaps      layer, gaps in
cheap to maintain       hard to maintain      still possible        service boundaries
```

## Current State Assessment Worksheet

Fill in these values from the codebase:

```
Current Test Distribution:
  Unit tests:        _____ count  →  _____ %
  Integration tests: _____ count  →  _____ %
  E2E tests:         _____ count  →  _____ %
  Manual test cases:  _____ count  (not in pyramid, but track)

Current Shape: [ ] Pyramid  [ ] Ice Cream Cone  [ ] Diamond  [ ] Hourglass  [ ] No Shape

CI Pipeline Duration: _____ minutes
Flaky Test Rate:      _____ %
Test Suite Pass Rate: _____ %
```

## Target State Worksheet

Define the target ratios and the timeline to get there:

```
Target Test Distribution:
  Unit:        70-80%  → target count: _____
  Integration: 15-20%  → target count: _____
  E2E:          5-10%  → target count: _____

Target CI Duration: < _____ minutes
Target Flaky Rate:  < _____ %
```

## 5x5 Risk Matrix

Score = Impact × Likelihood. Use the cell label (LOW/MED/HIGH/CRIT) to pick a testing action from the Risk-to-Testing Action Map in `SKILL.md`.

```
LIKELIHOOD →     Rare      Unlikely    Possible    Likely    Almost Certain
IMPACT ↓          1           2           3          4            5

Catastrophic (5)  5-MED      10-HIGH    15-CRIT    20-CRIT      25-CRIT
Major (4)         4-LOW       8-MED     12-HIGH    16-CRIT      20-CRIT
Moderate (3)      3-LOW       6-MED      9-MED     12-HIGH      15-CRIT
Minor (2)         2-LOW       4-LOW      6-MED      8-MED       10-HIGH
Negligible (1)    1-LOW       2-LOW      3-LOW      4-LOW        5-MED
```

## Strategy Document Output Skeleton

The final strategy document should follow this structure:

```markdown
# QA Strategy: [Product Name]
## Version [X.Y] | Last Updated: [Date] | Owner: [Name]

### 1. Executive Summary (1 paragraph)
### 2. Scope & Objectives
### 3. Test Levels & Types (table)
### 4. Test Pyramid Analysis (current → target)
### 5. Risk Assessment (matrix + feature mapping)
### 6. Environment Strategy (table)
### 7. Tool Selection (decisions + rationale)
### 8. Entry/Exit Criteria (per level)
### 9. Quality Gates (per stage)
### 10. Metrics & KPIs (table with targets)
### 11. Timeline & Milestones (phased)
### 12. Risks to the Strategy Itself
### 13. Revision History
```
