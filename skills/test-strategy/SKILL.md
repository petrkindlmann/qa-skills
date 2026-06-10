---
name: test-strategy
description: >-
  Produce a multi-quarter QA strategy document. Covers scope, risk-based
  prioritization, test levels (unit/integration/E2E), pyramid analysis, entry/exit
  criteria, quality KPIs, tool selection rationale, CI scaling levers, and timeline
  planning. Output is an actionable strategy document, not a shelf document. Use when:
  "test strategy," "QA strategy doc," "testing approach," "QA roadmap,"
  "multi-quarter QA direction." Not for: a single-sprint or single-release plan —
  use test-planning. Not for: identifying which areas carry the most risk — use
  risk-based-testing first.
  Related: risk-based-testing, qa-metrics, release-readiness, test-planning,
  test-reliability.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: strategy
---

<objective>
Generate an actionable QA strategy tailored to the product, team, and risk profile — a document that drives daily testing decisions, not a compliance artifact that collects dust. A team with 150 E2E tests and a 52-minute pipeline thinks it has good coverage; this skill diagnoses the inverted pyramid, prescribes the rebalance, and ties every element to a measurable KPI.
</objective>

---

## Discovery Questions

Before writing a single line of strategy, gather context. Check `.agents/qa-project-context.md` first — if it exists, use it as the foundation and skip questions already answered there.

### Product & Business Context
- What is the product? (SaaS, e-commerce, API platform, mobile app, content site)
- Who are the users? (consumers, enterprise, internal, developers)
- What are the business-critical flows? (signup, checkout, payment, data export)
- What is the release cadence? (continuous, weekly, bi-weekly, quarterly)
- What compliance requirements exist? (SOC2, HIPAA, PCI-DSS, GDPR, EU AI Act)

### Current Testing State
- What test levels exist today, and the current count at each level?
- What frameworks and tools are in use?
- Current code coverage, and the target if any?
- How long does the CI pipeline take end-to-end?
- What is the current flakiness rate?

### Pain Points & Goals
- Biggest quality pain points? (regressions, slow feedback, flaky tests, gaps)
- What broke in the last 3 releases? What escaped to production?
- What does "good enough quality" look like for this team?
- Appetite for investment in test infrastructure?

### Team & Constraints
- Team size and composition (devs, QA, SDET, manual testers)
- Skill levels with automation tools
- Budget constraints for tooling
- Timeline pressure — is there a deadline driving this strategy?

---

> **Calibrate to team maturity** (set `team_maturity` in `.agents/qa-project-context.md`):
> - **startup** — Minimal pyramid: unit tests + a handful of critical E2E paths. Skip contract testing and formal metrics until CI runs reliably. Phase 1 under 4 weeks.
> - **growing** — Full pyramid with defined coverage targets, flakiness thresholds, and CI quality gates. Add risk-based prioritization.
> - **established** — SLA-backed quality gates, multi-environment coverage, advanced tooling (contract testing, chaos, observability), and formal review cadence.

---

## Core Principles

1. **Risk-based prioritization over exhaustive coverage.** Not all code is equal — a payment bug costs 1000x more than a tooltip typo. Allocate testing effort proportional to business risk, not code volume. The risk matrix drives where to invest; run `risk-based-testing` first if no matrix exists yet.

2. **Test pyramid health is the leading indicator.** A healthy suite is many fast unit tests, fewer integration, fewest E2E. When the shape inverts (ice cream cone) feedback is slow, maintenance is high, and confidence is paradoxically low. Diagnose the current shape before prescribing anything.

3. **Shift-left: catch defects earlier.** Every defect found later costs exponentially more. Push validation earlier — static analysis before tests, unit before integration, contract before E2E. Design reviews catch architecture bugs no test can find.

4. **Every strategy element has a KPI.** If you cannot measure it, you cannot improve it. Coverage targets, flakiness thresholds, escape-rate goals, MTTR limits — each section names a number and a tracking cadence.

5. **Living document, not a shelf document.** Reviewed quarterly at minimum. It carries a revision history, a named owner per section, and explicit re-evaluation triggers (new product area, team change, major incident, defect escape).

---

## Strategy Document Template

Walk through each section to produce the final document. Tailor depth to complexity — a 5-person startup needs 5 pages, not 50. The final document follows a 13-section structure (Executive Summary through Revision History); see `references/diagrams-and-worksheets.md` for the copy-paste markdown skeleton, and `references/strategy-templates.md` for four fully worked examples (SaaS, e-commerce, API-first, media).

### 1. Scope & Objectives

Define boundaries clearly. Ambiguity here causes gaps and wasted effort downstream.

- **In scope:** every product area, service, and integration this strategy covers; functional and non-functional types; platforms and browsers/devices.
- **Out of scope:** state what is NOT covered and why — third-party services tested only at the contract level, legacy systems slated for deprecation.
- **Objectives:** 3-5 measurable objectives with timelines, e.g. "Reduce defect escape rate from 12% to under 5% within two quarters," "Achieve 80% unit coverage on all services launched after Q1 2026."

### 2. Test Levels & Types

Define each level, what it covers, who owns it, and expected volume.

| Level | What It Validates | Owner | Framework | Target Count | Run Frequency |
|-------|-------------------|-------|-----------|-------------|---------------|
| **Unit** | Functions, business logic, edge cases | Developers | Vitest/Jest/pytest | 70-80% of all tests | Every commit |
| **Integration** | Service interactions, DB queries, API contracts | Developers + QA | Supertest/pytest + Testcontainers | 15-20% of all tests | Every PR |
| **E2E** | Critical user journeys through the full stack | QA/SDET | Playwright/Cypress | 5-10% of all tests | Pre-deploy + nightly |
| **API** | Contract compliance, schemas, error handling | Developers | Playwright APIRequestContext/Schemathesis | Per endpoint | Every PR |
| **Visual** | UI regression, layout shifts, responsive | QA | Playwright/Argos/Chromatic | Key pages | Nightly |
| **Performance** | Response times, throughput, resource usage | DevOps/QA | k6/Lighthouse | Critical paths | Weekly + pre-release |
| **Security** | OWASP Top 10, dep vulns, auth flows | Security/DevOps | OWASP ZAP/Snyk | Per release | Pre-release + scheduled |
| **Accessibility** | WCAG 2.2 AA, screen reader compat | QA/Frontend | axe-core | Key flows | Every PR |

Adjust to what the product actually needs. Not every product needs visual regression. Every product needs unit and integration tests.

### 3. Test Pyramid Analysis

Diagnose the current shape, then define the target.

**Shapes.** The suite takes one of four shapes — healthy pyramid (many unit, few E2E), ice cream cone (inverted, E2E-heavy), diamond (integration-heavy), or hourglass (unit-heavy and E2E-sparse with a missing integration middle). Each signals a different feedback/maintenance trade-off. See `references/diagrams-and-worksheets.md` for the side-by-side ASCII diagram.

**Current state.** Count tests at each level, compute the percentage split, identify the shape, then capture CI duration, flaky rate, and pass rate. See the Current State Assessment Worksheet in the reference file.

**Target state.** Define target ratios (70-80% unit, 15-20% integration, 5-10% E2E) with concrete counts, plus target CI duration and flaky rate. See the Target State Worksheet.

**Action plan — if ice cream cone or diamond:**
1. **Freeze E2E growth** — no new E2E tests unless covering a net-new critical path.
2. **Decompose existing E2E** — find E2E tests validating logic testable at unit level (a checkout test asserting tax math becomes a unit test on the tax function), rewrite them down a level.
3. **Add unit requirements to the PR checklist** — every PR touching business logic ships unit tests.
4. **Set CI gates** — fail PRs where the unit:E2E ratio drops below threshold.

Before rebalancing, separate genuinely flaky E2E tests from ones exposing real bugs — quarantining a flaky test that hides a race condition is how the regression escapes. For flake root-cause triage and quarantine mechanics, see `test-reliability`.

**Action plan — if hourglass:**
1. **Invest in integration infrastructure** — DB fixtures, service stubs, contract tests.
2. **Identify service boundaries** — each boundary needs integration tests for happy path + error cases.
3. **Use contract testing** (Pact) for inter-service communication.

### 4. Risk Assessment Matrix

Map features to risk levels — this directly determines testing depth. Score each feature as Impact (1 Negligible → 5 Catastrophic) × Likelihood (1 Rare → 5 Almost Certain); the product (1-25) maps to LOW/MED/HIGH/CRIT bands. See `references/diagrams-and-worksheets.md` for the full 5x5 matrix with every cell labeled.

| Risk Level | Testing Action | Automation | Monitoring |
|------------|---------------|------------|------------|
| **CRITICAL (15-25)** | Full automation + manual exploratory + load test | Mandatory, every commit | Real-time alerts, synthetic monitoring |
| **HIGH (10-14)** | Full automation + periodic manual review | Mandatory, every PR | Dashboard + daily checks |
| **MEDIUM (5-9)** | Automation for happy path + key error cases | Recommended | Weekly review |
| **LOW (1-4)** | Manual testing or skip | Optional | None required |

**Example mapping:**

| Feature Area | Impact | Likelihood | Score | Testing Approach |
|-------------|--------|------------|-------|-----------------|
| Payment processing | 5 - Catastrophic | 3 - Possible | 15 - CRIT | Automated E2E + unit + contract + monitoring |
| User authentication | 5 - Catastrophic | 2 - Unlikely | 10 - HIGH | Automated E2E + security scan + unit |
| Product search | 3 - Moderate | 3 - Possible | 9 - MED | Unit + integration + happy-path E2E |
| Dashboard rendering | 2 - Minor | 3 - Possible | 6 - MED | Unit + visual regression |
| Email preferences | 1 - Negligible | 2 - Unlikely | 2 - LOW | Manual verification |

### 5. Environment Strategy

| Environment | Purpose | Test Types | Data | Deploy Trigger |
|------------|---------|------------|------|---------------|
| **Local** | Developer feedback | Unit, integration | Mocked/seeded | On save |
| **CI** | Automated validation | Unit, integration, lint, SAST | Ephemeral | On push/PR |
| **Staging** | Pre-production validation | E2E, visual, performance, security | Production-like (anonymized) | On merge to main |
| **Production** | Monitoring & smoke | Smoke tests, synthetic monitoring | Live | On deploy |

Document: how test data is managed per environment, whether environments are ephemeral (preview deployments) or long-lived, who has access, and how environment-specific config is managed.

### 6. Tool Selection Rationale

Do not pick tools first. Understand needs, then select tools that fit. Score each candidate against weighted criteria.

| Criteria (weight) | Tool A | Tool B | Tool C |
|-------------------|--------|--------|--------|
| **Fits tech stack** (25%) | | | |
| **Team familiarity** (20%) | | | |
| **Community & docs** (15%) | | | |
| **CI integration** (15%) | | | |
| **Maintenance cost** (10%) | | | |
| **Speed of execution** (10%) | | | |
| **License cost** (5%) | | | |
| **Weighted total** | | | |

Score each 1-5, multiply by weight, sum for the weighted total. Beyond license fees, account for **total cost of ownership**: setup time (configure CI, write first tests, train team), writing time (time 5 real tests to measure), maintenance time (how often tests break on framework updates), debug time (good error messages cut this), and infrastructure cost (browser farms, parallel runners).

**Common stack starting points** — document why you chose or deviated:

| Product Type | Unit | Integration | E2E | API | Visual |
|-------------|------|-------------|-----|-----|--------|
| React SaaS | Vitest | Testing Library + MSW | Playwright | Supertest | Playwright screenshots |
| Next.js | Vitest | Testing Library + MSW | Playwright | Supertest | Playwright screenshots |
| Python API | pytest | pytest + Testcontainers | pytest + requests | Schemathesis | N/A |
| Mobile (RN) | Jest | Testing Library + MSW | Detox / Maestro / Appium 3.x | Supertest | Appium screenshots |
| Vue SaaS | Vitest | Testing Library + MSW | Playwright | Supertest | Playwright screenshots |
| AI/LLM features | Vitest | DeepEval | Playwright + Promptfoo evals | Promptfoo / Ragas | N/A |

For AI/LLM features, add explicit risk testing for hallucinations, bias, prompt injection, and privacy — see `ai-system-testing` and `compliance-testing` (EU AI Act).

**Reference frameworks:**
- **CTAL-AT v2.0** (ISTQB, Advanced Agile Tester, 2026) — a new Advanced-level certification requiring CTFL v4.0, not an update of an Advanced predecessor; it supersedes the retired Foundation-level CTFL-AT Agile extension (already absorbed into CTFL v4.0). Covers test strategy and approach, whole-team approach, shift-left, end-to-end testing, test smells, exploratory + AI-assisted testing.
- **CT-GenAI v1.1** (ISTQB, released 2026-04-27) — formalizes LLM-powered test infrastructure as a discipline; defines AI-specific risk classes (hallucinations, reasoning errors, bias, privacy, AI regulations).
- **CTFL v4.0** (ISTQB) — foundational vocabulary; useful when aligning teams from different testing traditions.
- **HTSM v6.3** (Bach) — Heuristic Test Strategy Model; emphasizes state-based testing and boundary heuristics. Lightweight alternative to ISTQB framing.
- **World Quality Report 2025-26** (Capgemini, 17th edition) — benchmark data: 43% of orgs experimenting with Gen AI in QA, 15% scaled. Useful for placing your AI-adoption stage during planning.

### 7. CI Scaling Levers

When the suite or team grows, CI wall-clock time is the constraint that breaks the strategy. Pull these levers before deleting tests:

- **Sharding** — split the suite across N parallel runners (Playwright `--shard=1/4`, Jest `--shard`, pytest-xdist, Cypress parallelization). Linear speedup until per-shard fixed costs (install, build) dominate.
- **Test impact analysis** — run only tests affected by the diff instead of the whole suite on every PR. Driven by a dependency graph (Nx affected, Vitest `--changed`, Bazel) or coverage-to-file maps. Keep the full suite on a nightly/merge gate so nothing rots.
- **Caching** — cache dependencies, build artifacts, and browser binaries between runs.
- **Selective E2E on PR** — run smoke E2E on PRs, full E2E on merge/nightly.

Measure the payoff, do not assume it. **Parallel efficiency = summed test-run time ÷ wall-clock time**; target a value approaching the shard count (e.g. >3x on 4 shards). A low value means fixed setup costs or a long-pole test are eating the speedup. Track **CI-minutes-per-PR** to catch parallelization that cuts wall-clock time but balloons billed compute.

### 8. Entry/Exit Criteria

Define what must be true before testing starts (entry) and before it is done (exit) at each level.

**Unit** — Entry: code compiles, function has a documented contract (inputs/outputs). Exit: all branches covered, edge cases tested, no skipped tests, coverage target met.

**Integration** — Entry: unit tests pass, dependent services available or stubbed, test data seeded. Exit: all service boundaries tested, error paths validated, no flaky tests.

**E2E** — Entry: integration tests pass, staging deployed, test accounts provisioned. Exit: all critical user journeys pass, no P0/P1 defects open, performance within SLA.

**Release** — Entry: all test levels pass, no CRITICAL/HIGH defects open, release notes drafted. Exit: smoke tests pass in production, monitoring shows no anomalies for an agreed bake window (30 min is a reasonable default — tune to your deploy frequency and alert latency), rollback plan verified.

### 9. Quality Gates & Definition of Done

Automated gates that prevent bad code from moving forward.

**PR gate** (every PR): unit tests pass; integration tests pass; coverage does not decrease (or meets minimum); no new lint errors; SAST scan passes (no new high/critical); bundle size within threshold; at least one reviewer approval.

**Merge gate** (merge to main): all PR-gate checks pass; E2E smoke suite passes against preview deployment; no merge conflicts; branch up to date with main.

**Deploy gate** (before production): full E2E suite passes on staging; performance benchmarks within range; security scan passes; feature flags configured; rollback plan documented and tested.

**Nightly gate** (scheduled): full E2E including edge cases; visual regression; performance/load tests; accessibility scan; dependency vulnerability scan. Results reviewed by QA lead next morning.

Every gate names a concrete pass/fail threshold and is enforced in CI — a gate that can be clicked past is documentation, not a gate.

### 10. Metrics & KPIs

| Metric | Definition | Target | Cadence |
|--------|-----------|--------|---------|
| **Code Coverage** | Lines/branches covered by unit + integration | >80% critical services, >60% overall | Per PR |
| **Test Pyramid Ratio** | Unit:Integration:E2E split | 70:20:10 (±10% tolerance) | Monthly |
| **Flakiness Rate** | % of runs with non-deterministic failures | <2% | Weekly |
| **Defect Escape Rate** | % of defects found in prod vs. total | <5% | Per release |
| **MTTR** | Detection to fix deployed | <4h P0, <24h P1 | Per incident |
| **CI Pipeline Duration** | Push to green/red signal | <15 min PR, <30 min full | Weekly |
| **CI Parallel Efficiency** | Summed test time ÷ wall-clock time | Approaching shard count (>3x on 4 shards) | Weekly |
| **CI-Minutes-per-PR** | Billed compute minutes per PR run | Flat or decreasing | Monthly |
| **Defect Density** | Defects per 1000 LOC | Decreasing trend | Monthly |
| **Automation Rate** | % of test cases automated | >80% for regression suite | Quarterly |
| **False Positive Rate** | % of failures that are not real bugs | <5% | Weekly |

**Using metrics:** track trends over time, not absolute numbers — a team going 30%→60% coverage is doing great. Set realistic targets from current state (20%→90% in one quarter is a fantasy, not a plan). Review quarterly with leadership; celebrate improvements. Investigate spikes — a sudden flakiness jump signals infrastructure, not laziness. Never use metrics to punish teams. See `qa-metrics` for full KPI definitions, DORA metrics, and dashboards.

### 11. Timeline & Milestones

Roll out in phases. Doing everything at once guarantees nothing gets done well.

**Phase 1 — Foundation (Weeks 1-4):** risk assessment for all product areas; CI pipeline with unit-test gate; baseline metrics (coverage, flakiness, pipeline time); unit tests for top 5 highest-risk areas; select and configure E2E framework. *Exit: CI runs unit tests on every PR, baseline metrics documented.*

**Phase 2 — Coverage Expansion (Weeks 5-10):** integration tests for all service boundaries; E2E for top 10 critical journeys; visual regression for key pages; test data management; nightly runs. *Exit: all critical paths have E2E coverage, integration tests cover all APIs.*

**Phase 3 — Quality Gates (Weeks 11-14):** coverage gates on PRs (no decrease); performance benchmarks in CI; security scanning; monitoring dashboards for all KPIs. *Exit: all four gates (PR, merge, deploy, nightly) active and enforced.*

**Phase 4 — Optimization (Weeks 15-20):** fix or quarantine flaky tests; CI scaling levers (sharding, caching, test impact analysis); synthetic monitoring in production; first quarterly strategy review. *Exit: CI under 15 min, flakiness under 2%, first strategy revision published.*

**Ongoing:** quarterly strategy review and revision; monthly metrics review; continuous maintenance (refactor, de-flake, retire).

---

## Anti-Patterns

**100% coverage targets.** Diminishing returns past 80%. The last 20% means testing getters and trivial code while ignoring integration gaps where real bugs live. Set coverage per module by risk, not a blanket number.

**Ice cream cone (inverted pyramid).** Too many E2E, too few unit. Symptoms: CI 45+ minutes, tests break on every UI change, nobody trusts the suite. Fix by freezing E2E growth and decomposing existing E2E into lower levels.

**Strategy as a one-time document.** Written once and never updated is worse than none — it gives false confidence. Build in review triggers: quarterly calendar review, post-incident, new product area, team composition change.

**Tool-first thinking.** "We should use Playwright" is a tool choice masquerading as a plan. Start from what you need to validate, then pick tools that fit. The document justifies tool choices, never leads with them.

**No metrics = no accountability.** A strategy without measurable targets is a wish list. Every section connects to a KPI. If you cannot define success in numbers, question whether the element belongs.

**Testing in isolation.** A strategy living only in the QA wiki is invisible to developers. It must live in PR templates, CI gates, and the Definition of Done. If developers do not see it daily, it does not exist.

**Copy-paste strategy.** Taking another company's strategy verbatim ignores your risk profile, team skills, and constraints. Templates are starting points; every section is tailored.

**Automating everything immediately.** Manual exploratory testing has enormous value, especially early. Automate regression, keep exploration manual. The strategy specifies what stays manual and why.

---

## Verification

Prove the produced document is complete before calling it done. Run against the saved strategy file:

```bash
DOC=docs/qa-strategy.md
# 1. All 13 numbered section headings present (Executive Summary → Revision History)
grep -cE '^### [0-9]+\.' "$DOC"          # expect 13
# 2. Every row in the Metrics & KPIs table has a non-empty Target cell
#    (no "| | " gaps in the target column) — visually scan the table block:
grep -nE '^\|' "$DOC" | grep -iE 'target|coverage|flak|mttr|escape'
# 3. A revision history and a named owner exist
grep -niE 'revision history|owner:' "$DOC"
```

Then sanity-check the pyramid math by hand: target unit% + integration% + E2E% should sum to ~100%. If the document recommends sharding, confirm a parallel-efficiency or CI-minutes target appears in the Metrics table — an optimization with no metric is a guess.

---

## Done When

- [ ] A strategy document exists at an agreed path and `grep -cE '^### [0-9]+\.'` returns 13 (all sections Executive Summary → Revision History populated).
- [ ] Test pyramid target ratios are defined with concrete counts and a timeline to reach them; unit+integration+E2E percentages sum to ~100%.
- [ ] Entry and exit criteria are written for each level (unit, integration, E2E, release).
- [ ] Tool selection is documented with a scored, weighted rationale matrix — not just tool names.
- [ ] Quality gates are defined for all four stages (PR, merge, deploy, nightly), each with a concrete pass/fail threshold.
- [ ] Every Metrics & KPIs row has a non-empty Target and a tracking cadence.

## Related Skills

- **risk-based-testing** — run first; deep dive into risk-assessment methodology and AI/LLM-specific failure classes. This skill consumes its matrix.
- **test-planning** — go here for a single sprint or release plan; test-strategy is the multi-quarter umbrella above it.
- **test-reliability** — flake root-cause triage, self-healing locators, and quarantine mechanics referenced in the pyramid-rebalance step.
- **qa-metrics** — full KPI definitions, DORA metrics, Test Impact Analysis, dashboards, trend analysis.
- **release-readiness** — go/no-go checklists, canary analysis, release confidence scoring.
- **ci-cd-integration** — pipeline configuration, gate implementation, and smart sharding setup.
- **shift-left-testing** — techniques for moving validation earlier.
- **ai-system-testing** — when the strategy covers AI/LLM features, defines the eval-suite layer.
- **compliance-testing** — when the strategy serves a regulated audience (GDPR, EU AI Act, EAA, US state laws).

## Reference Files (in `references/`)

- **diagrams-and-worksheets.md** — pyramid shape diagrams, current/target state worksheets, the full 5x5 risk matrix, and the 13-section output skeleton.
- **strategy-templates.md** — four fully worked strategy documents (SaaS, e-commerce, API-first, media), plus a step-by-step pyramid analysis worksheet and a risk-matrix feature-inventory template.
