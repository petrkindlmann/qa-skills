---
name: qa-do
description: >-
  QA diagnostic router. Describes a testing situation or problem in plain language and identifies
  the right 1-3 skills to use and in what order. Use when: "which skill", "where do I start",
  "I'm not sure what to test", "qa:do", or any vague QA situation that doesn't map to one skill.
  Related: qa-start, qa-project-context, test-strategy.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: foundation
  argument-hint: "plain-language QA situation (e.g. 'our checkout flow is slow and tests are flaky')"
---

<objective>
Most QA situations fit a recognizable pattern. This skill takes a plain-language description of what you're trying to do or what problem you're facing, matches it to a pattern, and tells you which 1-3 skills to use and in what order. It does not duplicate content from other skills — it just diagnoses and routes.
</objective>

## How to Use

Describe what you're trying to do or what problem you're facing. A sentence or two is enough.

The skill will output:
- **Recommended skills** (1-3, in order)
- **Why** — one line per skill explaining the role it plays

Example input: "Our E2E tests keep failing in CI but pass locally."
Example output:
1. `test-reliability` — diagnose and fix flaky/environment-sensitive tests
2. `ci-cd-integration` — align the pipeline environment with local behavior

---

## Common Situations and Their Skills

| Situation | Recommended Skills | Order |
|-----------|-------------------|-------|
| New project, no tests at all | `qa-project-context` → `test-strategy` | Context first, then strategy |
| "Tests keep breaking in CI" | `test-reliability` → `ci-cd-integration` | Reliability first, then pipeline |
| "What should we test before this release?" | `risk-based-testing` → `release-readiness` | Risk first, then checklist |
| "We need Playwright tests" | `playwright-automation` | Direct |
| "Write tests from this PRD/spec" | `ai-test-generation` | Direct |
| "Our test suite is slow and flaky" | `test-reliability` → `qa-metrics` | Diagnose first, measure second |
| "Set up test reporting" | `qa-dashboard` → `ci-cd-integration` | Dashboard design, then CI wiring |
| "Test our API" | `api-testing` | Direct |
| "Check accessibility compliance" | `accessibility-testing` | Direct |
| "We got a bug in prod, understand why" | `ai-bug-triage` → `quality-postmortem` | Triage first, then retro |
| "We're migrating from Selenium/Cypress" | `test-migration` | Direct |
| "Performance is degrading" | `performance-testing` → `observability-driven-testing` | Measure first, then trace |
| "Set up test data" | `test-data-management` | Direct |
| "Add tests to CI" | `ci-cd-integration` | Direct |
| "Visual changes breaking tests" | `visual-testing` → `test-reliability` | Baseline first, then stabilize |
| "We have no idea what quality looks like" | `qa-metrics` → `qa-dashboard` | Define KPIs, then surface them |
| "Third-party API is unreliable in tests" | `service-virtualization` | Direct |
| "Need to test on multiple browsers/devices" | `cross-browser-testing` | Direct |
| "Security audit coming up" | `security-testing` | Direct |
| "Tests depend on each other and break in random order" | `test-data-management` → `test-reliability` | Fix data isolation first |
| "Our QA is only catching bugs after dev, too late" | `shift-left-testing` → `test-planning` | Process change first, then plan |
| "We're building an AI feature and need to test it" | `ai-system-testing` | Direct |

---

## When the Situation is Ambiguous

If your description maps to 3 or more skills with equal weight, one clarifying question will narrow it down. Examples:

- "Are you trying to fix something that's broken, or build new coverage from scratch?"
- "Is this a process problem (how the team works) or a tooling problem (what's running)?"
- "Is the priority speed of delivery, or confidence in correctness?"
- "Are you the only QA, or is this a team-wide change?"

Answer the clarifying question and the router will reduce to 1-2 skills.

---

## Skill Categories Quick Reference

| Category | What it covers |
|----------|---------------|
| **Foundation** | Project setup, context capture, QA onboarding |
| **Strategy** | Test planning, risk assessment, exploratory testing |
| **Automation** | Playwright, Cypress, API, unit, mobile, visual, performance |
| **Specialized** | Accessibility, security, cross-browser, database |
| **AI-Augmented QA** | Test generation, bug triage, flakiness, test quality review |
| **Infrastructure** | CI/CD, environments, test data, contracts, service mocks |
| **Metrics** | KPIs, dashboards, coverage analysis |
| **Process** | Shift-left, onboarding, release readiness, postmortems, compliance |
| **Production & Observability** | Production testing, synthetic monitoring, trace-based testing |
| **Knowledge & Migration** | AI system testing, chaos engineering, framework migration |

---

## Related Skills

- `qa-project-context` — capture project setup before using most skills; every skill checks for it first
- `test-strategy` — when the situation is "we need a QA strategy" rather than a specific problem
