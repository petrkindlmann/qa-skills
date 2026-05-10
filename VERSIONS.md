# Versions

## v2.4.0 (2026-05-10)

### 2026-05 currency pass — every skill refreshed

Six-month staleness audit (cutoff 2025-11-10) across all 42 skills, applied in 14 commits across two rounds (must-fix + secondary). Net change: +1,201 / −181 lines. No new skills; existing skills track current tools, standards, and regulations.

#### Factual fixes

- `database-testing` — replaced fictitious `npx prisma migrate rollback --steps 1` with the supported pattern (forward-revert migration + `prisma migrate resolve` + hand-written `down.sql`).
- `compliance-testing` — re-framed EAA as in force since 2025-06-28 (was treated as future).
- `visual-testing` — added Lost Pixel deprecation warning (repo archived 2026-04-22).

#### Standard / regulation updates

- `security-testing` — rewritten for **OWASP Top 10:2025** ordering: A03 Software Supply Chain Failures (new), A10 Mishandling of Exceptional Conditions (new), SSRF folded under A01/A06, A07/A09 renamed.
- `compliance-testing` — added **EU AI Act** phased timeline (Article 50 transparency, GPAI obligations live since 2025-08-02, prohibitions live since 2025-02-02), expanded US state-privacy list (~20 states), added **Global Privacy Control** (`Sec-GPC: 1`) and **Google Consent Mode v2** test patterns, updated CMP list (Cookiebot now Usercentrics; Google-certified CMP requirement).
- `accessibility-testing` — EAA enforcement date corrected; ISO/IEC 40500:2025 added; WCAG 3 March 2026 draft note; axe-core 4.11+ RGAA filter caveat.

#### Tool / version refreshes

- **Playwright** — bumped baseline references to **1.59.1**; added Test Agents (1.56), `@playwright/mcp`, `page.screencast` (1.59), Test Migrator (1.55), `--debug=cli`; corrected `routeWebSocket` version to 1.48.
- **k6** — added v2.0-rc1 migration callout (`experimental/websockets` → `websockets`, removed executors, exit code 97); added `k6/browser` module section; noted FID removal from web-vitals v5.
- **Vitest** — bumped to 4.1.x (5.0-beta breaking changes flagged); added `coverage.changed` and Vitest 4 browser mode.
- **Cypress** — 15.x baseline; dropped `experimentalRunAllSpecs`; Cypress AI Cloud add-on callout.
- **Appium** — renamed to 3.x throughout (3.4.2 stable); Maestro added as cross-platform CLI option; Detox `by.type()` semantic matching.
- **Pact-JS v16** rename: `PactV4` → `Pact`, `MatchersV3` → `Matchers`.
- **Faker v10** ESM-only callout (silently breaks CJS users).
- **Image bumps**: postgres 16 → 17, redis 7 → 8, node 20 → 22, wiremock 3.9.1 → 3.13.2, toxiproxy 2.9.0 → 2.12.0.
- **GitHub Actions** v4 → v5+/Node 24 deprecation note in ci-cd-integration.

#### AI-augmented QA — fully fleshed out

- `ai-system-testing` — added concrete Tooling section naming **Promptfoo, DeepEval v3.9.9 (agentic metrics: TaskCompletion / ToolCorrectness / ArgumentCorrectness), Ragas, TruLens, Inspect AI, Garak, PyRIT, Braintrust** with one recipe per category.
- `ai-test-generation` — added Q2a deciding between Playwright CLI+SKILLS, Playwright MCP, and hand-written; expanded reproducibility metadata (Opus 4.7 / Sonnet 4.6 / Haiku 4.5-20251001 model IDs).
- `ai-bug-triage` — added Buy vs Build callout (Trunk Flaky Tests, CloudBees Smart Tests — formerly Launchable, Datadog Test Optimization, Sealights); model selection cost note.
- `test-reliability` — wired Playwright 1.59 `page.screencast` "agentic video receipts" into Repair Evidence record fields.
- `ai-qa-review` — added "AI-Generated Test Smells" subsection (hallucinated locators, fabricated imports, closed AI loops, project-convention drift).

#### Vendor renames + acquisitions

- Statsig → operating under OpenAI (Sept 2025); Split → Harness FME; Lightstep → ServiceNow Cloud Observability; Bugsnag → SmartBear Insight Hub; Tracetest Cloud EOL'd (Oct 2024, OSS still active); Launchable → CloudBees Smart Tests; Highlight.io → LaunchDarkly Observability; MailHog (unmaintained) → Mailpit; Promptfoo → joining OpenAI.

#### New first-class sections

- `qa-metrics` — DORA metrics (Lead Time, Deployment Frequency, Change Failure Rate, MTTR) and Test Impact Analysis as a metric/lever.
- `qa-dashboard` — Allure 2 vs Allure 3 callout (TS rewrite, plugin system, `allurerc`, quality gates, Allure Service); SaaS-Native Test Dashboards comparison; Allure TestOps section with MCP server beta.
- `coverage-analysis` — Mutation testing promoted from footnote to first-class section; pinned `c8@^11` / `nyc@^18` with Node 20+ baseline; coverage.py 7.13's `.coveragerc.toml`.
- `release-readiness` — Vendor-native canary analysis (LaunchDarkly Guarded Rollouts, Statsig Auto-tune, Flagger, Harness CV); AI/LLM rollout pattern; canary-alerts-that-lie + Switchback anti-patterns.
- `mobile-testing` — Maestro section as cross-platform YAML option.
- `service-virtualization` — Mockoon, Hoverfly, Prism, MockServer comparison table.
- `contract-testing` — Pactflow bi-directional contracts; Schemathesis property-based testing.
- `test-data-management` — Database Branching (Supabase, Neon, PlanetScale).
- `ci-cd-integration` — smarter sharding (knapsack-pro, CloudBees Smart Tests, Trunk); Actions Runner Controller for K8s self-hosted runners.
- `observability-driven-testing` — continuous profiling (Pyroscope, Parca, Polar Signals, OTel profiling signal); zero-instrumentation eBPF (Beyla, Tetragon, Pixie, Coroot); OTel Weaver; Tracetest Cloud EOL warning; OTel sem-conv 1.41 GenAI breaking changes; OpenTracing deprecation.
- `chaos-engineering` — AWS FIS, Steadybit, kube-monkey, Pumba; eBPF chaos (Chaos Mesh `bpfki`); GameDay-as-code subsection.
- `exploratory-testing` — Assisted Exploration section paired with Bolton's "AI Productivity Paradox" warning; Tester Roles in Modern Teams (Tissue Testers, coach testers).

#### Frontmatter / spec compliance

- All three Foundation skills got `compatibility:` frontmatter per the agentskills.io spec.
- Replaced fake colon-form trigger phrases (`qa:start` → `/qa-start`, `qa:do` → `/qa-do`) per Claude Code's plugin namespacing.
- `qa-do` now consumes `$ARGUMENTS` for one-shot routing.
- `qa-project-context` codebase-detection table refreshed (Bun, Turborepo, Astro, React Router 7, `.claude/`, `.claude-plugin/`, `AGENTS.md`).

#### Strategy + Process refresh

- `test-strategy` — Reference Frameworks block (CTAL-AT v2.0 — replaces CTFL-AT, CT-GenAI v1.1, HTSM v6.3, WQR 2025-26 with adoption stats); AI/LLM features row in Common Stack table.
- `risk-based-testing` — AI/LLM-specific failure classes from CT-GenAI v1.1.
- `test-planning` — AI-assisted authoring footnote with Productivity Paradox warning; test-smells review per CTAL-AT v2.0; LLM-eval row in estimation table.
- `shift-left-testing` — AI-generated PR review checklist; AI participant in Three Amigos; TDD row for AI-generated implementation.
- `quality-postmortem` — action-item-closure-rate; AI-assisted RCA principle.

---

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
