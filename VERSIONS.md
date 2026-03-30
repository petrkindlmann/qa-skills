# Versions

## v2.3.0 (2026-03-30)

### Improvements

- Added `<objective>` semantic XML block to all 42 skills — replaces H1 heading with agent-facing context: why the skill is structured the way it is, when to use it vs. others, and the core approach
- Added explicit state machine flow diagram to `risk-based-testing` `## Workflow` section (6-phase cycle with skip conditions)
- Added `argument-hint` to `qa-do` frontmatter so agents know what input the router expects

---

## v2.2.0 (2026-03-29)

### New skills

**Foundation:**
- `qa-start` v1.0 — Onboarding launcher: chains qa-project-context → test-strategy → test-planning in one guided sequence
- `qa-do` v1.0 — Diagnostic router: maps a plain-language QA situation to the right 1-3 skills

### Improvements

- Added `## Done When` completion criteria to all 40 existing skills
- Added team maturity callout (startup / growing / established) to test-strategy, playwright-automation, ci-cd-integration, qa-project-bootstrap
- Added `Team Maturity` field to `.agents/qa-project-context.md` template
- Normalized `## Output Artifacts` in ai-test-generation to `## Done When`

---

## v2.1.0 (2026-03-23)

### New skill

**Process:**
- `qa-report-humanizer` v1.0 — Remove AI patterns from QA reports, bug reports, test summaries, and status updates

---

## v2.0.0 (2026-03-23)

### Complete collection — 40 skills

Added 25 Phase 2 skills to complete the full QA lifecycle coverage.

**Strategy:**
- `test-planning` v1.0 — Sprint/release test plans, coverage mapping, effort estimation
- `exploratory-testing` v1.0 — SBTM charters, heuristics (HICCUPS), bug discovery patterns

**Automation:**
- `cypress-automation` v1.0 — Component + E2E testing, cy.intercept, custom commands
- `visual-testing` v1.0 — Playwright screenshots, Chromatic, Percy, baseline management
- `performance-testing` v1.0 — k6 load/stress/soak, Lighthouse CI, Core Web Vitals
- `mobile-testing` v1.0 — Appium 2.0, Detox, device farms, gesture simulation

**Specialized:**
- `security-testing` v1.0 — OWASP Top 10, ZAP integration, dependency scanning
- `cross-browser-testing` v1.0 — Analytics-driven browser matrix, BrowserStack/Sauce Labs
- `database-testing` v1.0 — Migration testing, data integrity, query performance

**AI-Augmented QA:**
- `ai-qa-review` v1.0 — Test smell detection, testability analysis, coverage gap review

**Infrastructure:**
- `test-environments` v1.0 — Environment strategy, Docker Compose, parity checklist
- `contract-testing` v1.0 — Pact.js consumer-driven contracts, can-i-deploy
- `service-virtualization` v1.0 — Decision framework for mocks, stubs, fakes, WireMock, MSW

**Metrics:**
- `qa-dashboard` v1.0 — Allure, Grafana, ReportPortal setup and stakeholder reports
- `coverage-analysis` v1.0 — Gap analysis, coverage-as-ratchet, meaningful vs vanity

**Process:**
- `shift-left-testing` v1.0 — Dev/QA pairing, TDD, PR review checklists, maturity model
- `qa-project-bootstrap` v1.0 — First 30 days, test architecture audit, onboarding
- `quality-postmortem` v1.0 — Bug pattern analysis, 5 Whys, postmortem templates
- `compliance-testing` v1.0 — GDPR/CMP, Better Ads, cookie compliance

**Production & Observability:**
- `testing-in-production` v1.0 — Feature flags, canary analysis, guardrail metrics
- `synthetic-monitoring` v1.0 — Post-deploy validation, SLA monitoring, multi-region
- `observability-driven-testing` v1.0 — Traces as test evidence, log-informed test design

**Knowledge & Migration:**
- `ai-system-testing` v1.0 — LLM/prompt testing, evals, hallucination risk, nondeterminism
- `chaos-engineering` v1.0 — Fault injection, game days, resilience validation
- `test-migration` v1.0 — Framework migration guides, parallel running, incremental adoption

---

## v1.0.0 (2026-03-23)

### Initial Release — 14 Phase 1 Skills

**Foundation:**
- `qa-project-context` v1.0 — Universal project context template

**Strategy:**
- `test-strategy` v1.0 — Full QA strategy creation with risk-based prioritization
- `risk-based-testing` v1.0 — Risk assessment matrices, priority-based test selection

**Automation:**
- `playwright-automation` v1.0 — Playwright E2E testing with POM, fixtures, CI integration
- `api-testing` v1.0 — REST/GraphQL testing with schema validation
- `unit-testing` v1.0 — Jest/Vitest/pytest patterns with mocking and coverage

**AI-Augmented QA:**
- `ai-test-generation` v1.0 — LLM-powered test generation from specs and PRDs
- `ai-bug-triage` v1.0 — Auto-classify bugs by severity/component/root-cause, CI failure analysis
- `test-reliability` v1.0 — Locator resilience, flaky test detection and quarantine

**Infrastructure:**
- `ci-cd-integration` v1.0 — GitHub Actions/GitLab CI pipeline templates
- `test-data-management` v1.0 — Test data strategies, factories, fixtures, synthetic data

**Specialized:**
- `accessibility-testing` v1.0 — WCAG 2.1 compliance, axe-core integration, screen reader testing

**Process:**
- `release-readiness` v1.0 — Go/no-go checklists, smoke tests, staged rollouts

**Metrics:**
- `qa-metrics` v1.0 — Essential QA metrics with formulas and dashboards
