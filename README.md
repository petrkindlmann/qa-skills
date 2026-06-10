# QA Skills for AI Agents

QA and test automation skills for Claude Code, Codex, Cursor,
Gemini CLI, VS Code, and other agents that support the Agent Skills Standard.

**Website:** [qa-skills.com](https://qa-skills.com)

```bash
npx skills add petrkindlmann/qa-skills
```

50 skills covering:
- Playwright and Cypress automation
- API, unit, and mobile testing
- Test strategy and risk-based planning
- CI/CD integration and test environments
- Accessibility, security, and compliance
- Visual regression and performance testing
- AI-assisted test generation, bug triage, and agentic browser testing
- Email, payment, and analytics-tracking testing
- Manual test-case management and regression-suite curation
- Chaos engineering, observability, and QA dashboards

Based on patterns from QA automation work across 6+ production sites.

[![Skills](https://img.shields.io/badge/Skills-50-blue.svg)](#full-skills-table)
[![Website](https://img.shields.io/badge/Website-qa--skills.com-6366f1.svg)](https://qa-skills.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Agent Skills Standard](https://img.shields.io/badge/Agent_Skills-Standard-purple.svg)](https://agentskills.io)
[![Playwright](https://img.shields.io/badge/Playwright-First-green.svg)](https://playwright.dev)

---

## Quick start

### Option 1: Install specific skills (recommended)

```bash
npx skills add petrkindlmann/qa-skills playwright-automation test-strategy
```

### Option 2: Clone the full repo

```bash
git clone https://github.com/petrkindlmann/qa-skills.git .skills/qa-skills
```

### Option 3: Add as a git submodule

```bash
git submodule add https://github.com/petrkindlmann/qa-skills.git .skills/qa-skills
```

### Option 4: Manual download

Download individual skill folders from `skills/` and place them in your project's `.skills/` directory.

---

## Usage

Ask your AI agent in natural language. The right skill activates automatically.

| You say | Skill activated |
|---------|----------------|
| "Write Playwright tests for our checkout flow" | `playwright-automation` |
| "Create a QA strategy for this project" | `test-strategy` |
| "Generate tests from this PRD" | `ai-test-generation` |
| "This bug keeps happening in prod, classify and triage it" | `ai-bug-triage` |
| "Set up test reporting in GitHub Actions" | `ci-cd-integration` + `qa-metrics` |
| "What should we test before this release?" | `release-readiness` |
| "Run a visual regression check on the homepage" | `visual-testing` |
| "Load test our API with 1000 concurrent users" | `performance-testing` |
| "Check our app for OWASP Top 10 vulnerabilities" | `security-testing` |
| "Set up synthetic monitoring for critical flows" | `synthetic-monitoring` |

---

## Skill categories

50 skills across 10 categories. Each skill keeps a lean `SKILL.md` (heavy code offloaded to `references/`, loaded on demand) with cross-references to related skills.

### Foundation (3)
`qa-project-context` · `qa-start` · `qa-do` — project context template every other skill reads first, new-project QA bootstrap, and the last-resort skill router

### Strategy (4)
`test-strategy` · `test-planning` · `risk-based-testing` · `exploratory-testing` — QA strategy, sprint/release test plans, risk-based prioritization, session-based exploratory testing

### Automation (8)
`playwright-automation` · `cypress-automation` · `selector-drift-recovery` · `api-testing` · `unit-testing` · `mobile-testing` · `visual-testing` · `performance-testing` — Playwright E2E, Cypress component/E2E, bulk post-refactor selector regeneration, REST/GraphQL, Jest/Vitest/pytest, Appium/Detox, visual regression, k6 load testing and Lighthouse CI

### Specialized (7)
`accessibility-testing` · `security-testing` · `cross-browser-testing` · `database-testing` · `email-testing` · `payment-testing` · `analytics-tracking-testing` — WCAG compliance, OWASP Top 10 + LLM, analytics-driven browser matrices, migration testing, email-flow capture, Stripe/PSP checkout and 3DS, GA4/pixel tracking correctness

### AI-augmented QA (6)
`ai-test-generation` · `ai-bug-triage` · `test-reliability` · `ai-qa-review` · `bug-reproduction` · `agentic-browser-testing` — LLM test generation, automated bug triage, flaky test management, test quality review, report-to-failing-test reproduction, goal-driven agentic browser testing

### Infrastructure (5)
`ci-cd-integration` · `test-environments` · `test-data-management` · `contract-testing` · `service-virtualization` — CI/CD pipelines, environment strategy, data factories, Pact consumer-driven contracts, WireMock/MSW

### Metrics (3)
`qa-metrics` · `qa-dashboard` · `coverage-analysis` — quality gates and KPIs, Allure/Grafana/ReportPortal dashboards, coverage-as-ratchet in CI

### Process (8)
`shift-left-testing` · `qa-project-bootstrap` · `release-readiness` · `quality-postmortem` · `compliance-testing` · `qa-report-humanizer` · `test-case-management` · `test-suite-curation` — shift-left patterns, QA onboarding, go/no-go checklists, blameless postmortems, GDPR/CMP compliance, QA report humanization, manual test-case authoring, regression-suite pruning

### Production and observability (3)
`testing-in-production` · `synthetic-monitoring` · `observability-driven-testing` — feature flag validation, scheduled synthetic probes, trace-based test assertions

### Knowledge and migration (3)
`ai-system-testing` · `chaos-engineering` · `test-migration` — LLM/AI feature testing, controlled fault injection, framework migration guides (Selenium/Cypress/Jest to modern stacks)

---

## Full skills table

| Skill | Description | Category |
|-------|-------------|----------|
| [`qa-project-context`](skills/qa-project-context) | Project context template covering tech stack, test frameworks, CI/CD, environments, quality goals. Every other skill reads this first. | Foundation |
| [`test-strategy`](skills/test-strategy) | QA strategy creation with risk-based prioritization, test pyramid design, entry/exit criteria, and tool selection rationale. | Strategy |
| [`test-planning`](skills/test-planning) | Sprint and release test plans. Feature decomposition, requirements-to-test mapping, effort estimation, resource allocation. | Strategy |
| [`risk-based-testing`](skills/risk-based-testing) | Risk assessment matrices, priority-based test selection, impact/likelihood analysis, regression risk scoring. | Strategy |
| [`exploratory-testing`](skills/exploratory-testing) | Session-Based Test Management (SBTM), charter writing, heuristic-based exploration (HICCUPS, FEW HICCUPS), debrief templates. | Strategy |
| [`playwright-automation`](skills/playwright-automation) | Playwright E2E testing. Page Object Model, fixtures, parallel execution, API mocking, visual comparisons, CI integration. | Automation |
| [`cypress-automation`](skills/cypress-automation) | Cypress test suites with component testing, E2E testing, custom commands, cy.intercept, Cypress Cloud, and TypeScript support. | Automation |
| [`selector-drift-recovery`](skills/selector-drift-recovery) | Bulk-regenerate broken test selectors after a UI refactor. Snapshot old vs new DOM, map locators with confidence scores, ship a single PR. | Automation |
| [`api-testing`](skills/api-testing) | REST and GraphQL testing with schema validation, contract testing patterns, auth flows, and response assertions. | Automation |
| [`unit-testing`](skills/unit-testing) | Jest, Vitest, and pytest patterns. Mocking strategies, coverage thresholds, snapshot testing, test doubles taxonomy. | Automation |
| [`mobile-testing`](skills/mobile-testing) | Mobile testing with Appium 2.0 and Detox for React Native. Device farms, gesture simulation, deep link testing, push notifications. | Automation |
| [`visual-testing`](skills/visual-testing) | Visual regression testing with Playwright screenshots, Chromatic, Percy, and Argos CI. Baseline management, diff thresholds, dynamic content masking. | Automation |
| [`performance-testing`](skills/performance-testing) | k6 load/stress/soak scripts, Lighthouse CI for Web Vitals, performance budgets as CI gates. | Automation |
| [`accessibility-testing`](skills/accessibility-testing) | WCAG 2.1 compliance testing, axe-core integration, screen reader testing, keyboard navigation, color contrast validation. | Specialized |
| [`security-testing`](skills/security-testing) | OWASP Top 10 vulnerability testing. ZAP integration, dependency scanning (Snyk/Dependabot), SAST with ESLint security plugins. | Specialized |
| [`cross-browser-testing`](skills/cross-browser-testing) | Analytics-driven browser test matrices, BrowserStack/Sauce Labs configuration, Playwright browser channels, common rendering issues. | Specialized |
| [`database-testing`](skills/database-testing) | Database integrity validation, migration testing (forward/backward), schema constraints, seed data management, query performance. | Specialized |
| [`ai-test-generation`](skills/ai-test-generation) | Generate tests from specs, PRDs, and user stories using a staged pipeline with guardrails. Coverage matrix before code. | AI-QA |
| [`ai-bug-triage`](skills/ai-bug-triage) | Classify bugs by severity/component/root cause. Deduplicate issues, analyze CI failures, generate tickets. | AI-QA |
| [`test-reliability`](skills/test-reliability) | Locator resilience, flaky test classification by root cause, quarantine management, confidence-scored auto-repair. | AI-QA |
| [`ai-qa-review`](skills/ai-qa-review) | Test quality review across five smell dimensions. Coverage gap detection, testability analysis, anti-pattern detection. | AI-QA |
| [`ci-cd-integration`](skills/ci-cd-integration) | GitHub Actions and GitLab CI pipeline templates. Parallelism, artifact management, flaky test quarantine, test result publishing. | Infrastructure |
| [`test-environments`](skills/test-environments) | Environment strategy for dev, staging, preview, and production. Docker Compose, seed data, environment parity, cleanup. | Infrastructure |
| [`test-data-management`](skills/test-data-management) | Test data with factories, fixtures, synthetic data generation, database seeding, data cleanup, environment isolation. | Infrastructure |
| [`contract-testing`](skills/contract-testing) | Consumer-driven contract testing with Pact.js. Consumer tests, provider verification, Pact Broker, can-i-deploy gates. | Infrastructure |
| [`service-virtualization`](skills/service-virtualization) | Dependency isolation decision framework. Mocks, stubs, fakes, record-replay, WireMock, MSW (Mock Service Worker). | Infrastructure |
| [`qa-metrics`](skills/qa-metrics) | QA metrics with formulas: coverage %, flakiness rate, defect escape rate, MTTR, test execution trends, quality gates. | Metrics |
| [`qa-dashboard`](skills/qa-dashboard) | QA dashboards with Allure Report, Grafana, and ReportPortal. Test execution visualization, trend analysis, stakeholder reports. | Metrics |
| [`coverage-analysis`](skills/coverage-analysis) | Coverage measurement with Istanbul/V8/c8/coverage.py. Gap analysis, coverage-as-ratchet in CI, meaningful vs vanity coverage. | Metrics |
| [`shift-left-testing`](skills/shift-left-testing) | Move quality earlier. Dev/QA pairing, Three Amigos, TDD facilitation, PR review checklists, pre-merge quality gates. | Process |
| [`qa-project-bootstrap`](skills/qa-project-bootstrap) | Onboard a QA engineer to an existing codebase. First 30 days checklist, test architecture audit, framework walkthrough, mentorship patterns. | Process |
| [`release-readiness`](skills/release-readiness) | Go/no-go checklists, smoke test suite design, rollback criteria, staged rollout validation, release sign-off. | Process |
| [`quality-postmortem`](skills/quality-postmortem) | Blameless postmortems for escaped defects. Bug pattern analysis, 5 Whys root cause analysis, test gap identification. | Process |
| [`compliance-testing`](skills/compliance-testing) | Regulatory compliance testing. GDPR/CMP consent verification, Better Ads Standards, cookie auditing, privacy policy validation. | Process |
| [`qa-report-humanizer`](skills/qa-report-humanizer) | Remove AI patterns from QA reports, bug reports, test summaries, and status updates. Makes QA writing sound like a real engineer wrote it. | Process |
| [`testing-in-production`](skills/testing-in-production) | Production validation with feature flags, progressive rollouts, canary analysis, guardrail metrics, production smoke tests. | Production |
| [`synthetic-monitoring`](skills/synthetic-monitoring) | Post-deploy validation via scheduled synthetic tests. Probe design for critical user journeys, alert thresholds, SLA tracking. | Production |
| [`observability-driven-testing`](skills/observability-driven-testing) | Use traces, logs, and telemetry as test evidence. OpenTelemetry integration, trace-based assertions, log-informed test design. | Production |
| [`ai-system-testing`](skills/ai-system-testing) | Test AI features. LLM prompt regression, tool call validation, nondeterministic output evaluation, hallucination risk assessment. | Knowledge |
| [`chaos-engineering`](skills/chaos-engineering) | Controlled fault injection. Hypothesis-driven chaos experiments, network/service/infrastructure failure injection, blast radius control. | Knowledge |
| [`test-migration`](skills/test-migration) | Incremental test suite migration. Selenium to Playwright, Cypress to Playwright, Jest to Vitest, Mocha to Jest, Protractor to Playwright. | Knowledge |
| [`test-case-management`](skills/test-case-management) | Author and maintain manual/hybrid test cases in TestRail, Xray, Zephyr, Qase. Case anatomy, bulk authoring from stories, ambiguous-step linting, CSV/API import-export, traceability. | Process |
| [`test-suite-curation`](skills/test-suite-curation) | Audit and prune a regression suite with evidence: coverage fingerprinting, AST duplicate clustering, CI-history mining, smoke/core/extended tiering, quarantine-before-delete. | Process |
| [`bug-reproduction`](skills/bug-reproduction) | Turn a vague bug report into a verified minimal reproduction and a failing regression test. Reproduce-minimize-isolate-capture, git bisect, deterministic repro, red-before-fix. | AI-QA |
| [`agentic-browser-testing`](skills/agentic-browser-testing) | Goal-driven E2E via a browser agent (Playwright MCP / computer-use). Determinism controls, cost/latency budgets, accessibility-tree interaction, graduation to scripted tests. | AI-QA |
| [`email-testing`](skills/email-testing) | End-to-end email-flow testing: signup, password reset, magic-link, OTP/MFA. Mailpit/Mailosaur/MailSlurp capture, inbox polling, link/OTP extraction, deliverability checks. | Specialized |
| [`payment-testing`](skills/payment-testing) | Payment/checkout testing against PSP sandboxes. Stripe test cards, 3DS/SCA iframe handling, test clocks, webhook signature/idempotency, refunds — never real cards. | Specialized |
| [`analytics-tracking-testing`](skills/analytics-tracking-testing) | Validate GA4/GTM dataLayer, pixels, and ad-tech tags fire correctly. Tracking-plan contract, beacon interception, param/value/timing assertions, Consent Mode v2, CI gating. | Specialized |

---

## AI-augmented QA

Most QA skills repos stop at framework tutorials. This one also covers how AI agents can help with the testing itself.

| Skill | What it does |
|-------|-------------|
| `ai-test-generation` | Generate test cases from PRDs, specs, and user stories. Builds a coverage matrix before writing code. |
| `ai-bug-triage` | Classify bugs by severity/component/root cause, deduplicate issues, analyze CI failures |
| `test-reliability` | Per-test runtime healing: detect broken locators, score selector stability, quarantine flaky tests, classify root causes |
| `selector-drift-recovery` | Bulk offline regeneration: snapshot old vs new DOM after a UI refactor, ship one PR with per-change evidence |
| `ai-qa-review` | Test quality review. Coverage gap detection, test smell identification, testability analysis |

---

## Compatibility

Works with any tool that supports the [Agent Skills Standard](https://agentskills.io).

| Agent | Support | Install method |
|-------|---------|----------------|
| [Claude Code](https://claude.ai/claude-code) | Native | `npx skills add` or clone |
| [OpenAI Codex](https://openai.com/codex) | Native | Clone or submodule |
| [Cursor](https://cursor.sh) | Native | Clone to `.cursor/skills` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Native | Clone or submodule |
| [VS Code Copilot](https://code.visualstudio.com/docs/copilot) | Via instructions | Clone and reference in settings |
| [OpenCode](https://opencode.ai) | Native | Clone or submodule |
| [Windsurf](https://codeium.com/windsurf) | Native | Clone or submodule |
| Any Agent Skills-compatible tool | Standard | Clone or submodule |

---

## Tools registry

Skills reference specific QA tools for implementation. The [Tools Registry](tools/REGISTRY.md) lists all supported tools with capabilities, MCP server availability, and integration guides.

Covered: test frameworks, reporting, visual testing, CI/CD, project management, security scanning, observability.

---

## Project context

Every skill checks for `.agents/qa-project-context.md` before asking discovery questions. This file captures your project's QA setup: tech stack, test frameworks, CI/CD, environments, quality goals, risk areas, team structure.

Create it once using the `qa-project-context` skill. All other skills read it automatically.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Star to follow new skills and updates.

---

## License

MIT. See [LICENSE](LICENSE).

---

<sub>This project is not affiliated with, endorsed by, or sponsored by Microsoft, Cypress, Grafana Labs, BrowserStack, Sauce Labs, or any other referenced vendor. Product names and brands are the property of their respective owners.</sub>
