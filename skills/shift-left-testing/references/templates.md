# Shift-Left Templates

Copy-paste templates referenced from `SKILL.md`: the Definition of Done with quality gates, and the maturity self-assessment worksheet. The narrative on how to enforce the DoD and interpret maturity levels lives in `SKILL.md`.

## Recommended Definition of Done with Quality Gates

```
Definition of Done
═══════════════════════════════════════════════════════

Code Complete
  [ ] Feature implemented per acceptance criteria
  [ ] Code peer-reviewed and approved
  [ ] No TODO/FIXME comments without a linked ticket

Tested
  [ ] Unit tests written for business logic (coverage not decreased)
  [ ] Integration tests written for API/service changes
  [ ] E2E test added/updated for user-facing changes to critical paths
  [ ] Edge cases and error states tested
  [ ] Manual exploratory testing completed for medium/high risk changes

Quality Gates Pass
  [ ] CI pipeline green (all tests pass)
  [ ] No new linting or type errors
  [ ] No new security vulnerabilities (SAST scan)
  [ ] Code coverage not decreased from baseline

Documentation
  [ ] API changes documented (OpenAPI spec, changelog)
  [ ] Breaking changes noted in PR description
  [ ] Runbook updated if operational behavior changed

Deployment Ready
  [ ] Feature flag configured (if applicable)
  [ ] Database migration tested on staging
  [ ] Monitoring/alerting configured for new endpoints
  [ ] Rollback plan identified
```

## Shift-Left Maturity Self-Assessment Worksheet

```
Shift-Left Maturity Assessment
Date: ___________  Team: ___________

For each practice, check the column that best describes your current state:

Practice                          Never  Sometimes  Usually  Always
──────────────────────────────────────────────────────────────────────
QA in sprint planning               [ ]     [ ]       [ ]     [ ]
Three Amigos before dev              [ ]     [ ]       [ ]     [ ]
QA reviews PRs                       [ ]     [ ]       [ ]     [ ]
Tests written during development     [ ]     [ ]       [ ]     [ ]
Bug fixes start with failing test    [ ]     [ ]       [ ]     [ ]
TDD for business logic               [ ]     [ ]       [ ]     [ ]
DoD enforced with quality gates      [ ]     [ ]       [ ]     [ ]
Quality metrics reviewed regularly   [ ]     [ ]       [ ]     [ ]

Scoring: Never=0, Sometimes=1, Usually=2, Always=3
Total: _____ / 24

 0-6:  Level 1 (Reactive)
 7-11: Level 2 (Gate)
12-16: Level 3 (Embedded)
17-20: Level 4 (Collaborative)
21-24: Level 5 (Preventive)
```
