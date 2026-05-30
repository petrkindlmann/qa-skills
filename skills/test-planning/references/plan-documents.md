# Plan Document Templates

Full copy-paste documents for sprint plans, release plans, coverage matrices, and estimation worksheets. `SKILL.md` describes when to reach for each; this file holds the templates verbatim.

## Sprint Test Plan (1-Page)

```markdown
# Sprint [N] Test Plan
**Sprint dates:** [start] - [end]
**Features in scope:** [list with ticket IDs]
**Test lead:** [name]
**Last updated:** [date]

## Scope
| Feature | Risk | Test Types | Owner | Status |
|---------|------|-----------|-------|--------|
| [name]  | HIGH | E2E, Unit, Exploratory | [name] | Not Started |
| [name]  | MED  | Unit, Manual | [name] | In Progress |

## Coverage Summary
- Requirements mapped: __ / __ (target: 100%)
- Automated coverage: __ / __ test cases
- Manual coverage: __ / __ test cases
- Gaps identified: __ (with justification)

## Effort Budget
- Total available: __ hours
- Allocated: __ hours (target: 70-80% utilization)
- Buffer: __ hours (20-30%)

## Environment & Data
- Staging URL: [url]
- Test accounts: [location/reference]
- Test data setup: [script/manual steps]

## Entry Criteria
- [ ] Features code-complete and deployed to staging
- [ ] Test data seeded
- [ ] Automated suite passing (existing tests)

## Exit Criteria
- [ ] All HIGH-risk features tested
- [ ] No open P0/P1 defects
- [ ] Coverage matrix shows no unaccepted gaps
- [ ] Regression suite green

## Risks to the Plan
| Risk | Mitigation |
|------|-----------|
| Feature X not code-complete by Day 3 | Test Feature Y first, shift X to Week 2 |
| Staging environment unstable | Run E2E locally against dev server |
```

## Release Test Plan

A release test plan aggregates sprint test plans and adds release-specific concerns.

```markdown
# Release [version] Test Plan
**Release date:** [date]
**Release manager:** [name]
**QA lead:** [name]

## Release Contents
| Sprint | Features | Test Status |
|--------|----------|------------|
| Sprint N | [features] | Complete |
| Sprint N+1 | [features] | In Progress |

## Release-Specific Testing
| Activity | Owner | Schedule | Status |
|----------|-------|----------|--------|
| Full regression on release candidate | [name] | Day -3 | Planned |
| Cross-browser verification (Chrome, Firefox, Safari) | [name] | Day -2 | Planned |
| Performance benchmark vs. previous release | [name] | Day -2 | Planned |
| Security scan on release branch | CI | Day -1 | Planned |
| Smoke test on production after deploy | [name] | Day 0 | Planned |

## Go/No-Go Criteria
See `release-readiness` for the full checklist.

- [ ] All sprint exit criteria met
- [ ] No P0/P1 defects open
- [ ] Performance within 10% of previous release
- [ ] Security scan clean
- [ ] Rollback plan tested
```

## Feature Coverage Matrix

```markdown
# Coverage Matrix: [Feature Name]

| ID | Scenario | Priority | Test Type | Test Location | Status |
|----|----------|----------|-----------|---------------|--------|
| S1 | Happy path: user completes flow | P0 | E2E | e2e/tests/feature/happy.spec.ts | Automated |
| S2 | Validation: required fields empty | P0 | Unit | src/feature/__tests__/validate.test.ts | Automated |
| S3 | Error: server returns 500 | P1 | E2E | e2e/tests/feature/errors.spec.ts | Automated |
| S4 | Edge: unicode in text fields | P2 | Manual | -- | Planned |
| S5 | Perf: page loads under 2s | P1 | Perf | perf/feature-load.js | Automated |
| S6 | A11y: keyboard navigation | P1 | Manual | -- | GAP |
```

## Test Estimation Worksheet

```markdown
# Estimation: [Feature/Sprint Name]

## New Test Development
| Test | Type | Complexity | Estimate | Actual | Notes |
|------|------|-----------|----------|--------|-------|
| Checkout E2E | E2E | High | 3h | -- | Multi-step form |
| Discount calc | Unit | Medium | 1h | -- | 8 combinations |
| Payment API | Integration | High | 2h | -- | Mock gateway |

## Existing Test Execution
| Suite | Count | Est. Duration | Flaky? |
|-------|-------|--------------|--------|
| Unit suite | 342 | 45s | No |
| Integration suite | 87 | 3m | 2 flaky |
| E2E regression | 54 | 12m | 5 flaky |

## Manual Testing
| Activity | Sessions | Duration Each | Total |
|----------|----------|--------------|-------|
| Exploratory: new feature | 2 | 60 min | 2h |
| Cross-browser check | 1 | 45 min | 45m |
| Accessibility review | 1 | 30 min | 30m |

## Summary
| Category | Hours |
|----------|-------|
| New test development | __ |
| Manual testing | __ |
| Bug verification (20% buffer) | __ |
| **Total** | **__** |
| Available capacity | __ |
| **Delta** | **__** |
```
