---
name: qa-do
description: >-
  Routing skill of last resort. Takes a plain-language QA situation and names the
  right 1-2 skills to use and in what order. Use ONLY when the request does not
  match any other skill's trigger phrases. Use when: "which skill should I use,"
  "where do I start," "I'm not sure what to test," "/qa-do," or any vague QA
  situation that doesn't map to one skill. Not for: bootstrapping a brand-new
  project with no QA — use qa-start. Not for: capturing project setup/context —
  use qa-project-context. If the request clearly matches another skill, invoke
  that skill directly instead of routing through here.
  Related: qa-start, qa-project-context, test-strategy.
license: MIT
compatibility: Cross-tool. Tested with Claude Code, Codex, Cursor, Gemini CLI. Reads the project root; no network access required.
metadata:
  author: kindlmann
  version: "2.0"
  category: foundation
  argument-hint: "plain-language QA situation (e.g. 'our checkout flow is slow and tests are flaky')"
---

<objective>
Most QA situations fit a recognizable pattern. This skill takes a plain-language
description of what you're trying to do or what problem you're facing, matches it to a
pattern, and names the 1-2 skills to use and in what order. It diagnoses and routes — it
does not duplicate content from the skills it points to. If invoked with arguments, the
situation is `$ARGUMENTS`; otherwise ask the user for a sentence or two describing it.
</objective>

## Core Principles

1. **Route to the most precise skill, not the nearest neighbor.** A vague match to a
   broad skill is worse than a direct hit on a narrow one. "Reproduce this bug" goes to
   `bug-reproduction`, not the broader `ai-bug-triage`; "test our Stripe checkout" goes to
   `payment-testing`, not generic `api-testing`. When in doubt, prefer the skill whose
   trigger phrases name the exact artifact in the request.

2. **One or two skills, in order — never a pile.** Output at most two skills. A second
   skill earns its place only when the first leaves a clear gap (diagnose → measure, risk →
   checklist). If one skill covers the request, say "Direct" and stop. Routing to three
   skills means the situation is ambiguous — ask a clarifying question instead.

3. **The routing table is the source of truth, and it goes stale.** This router is uniquely
   prone to drift: every skill added to `skills/` is a row that may be missing here.
   Regenerate the table and the Skill Categories reference against `skills/` whenever a
   skill is added or removed. If a request has no row, fall back to the closest category in
   the Quick Reference rather than forcing a wrong direct match.

## How to Use

Describe what you're trying to do or what problem you're facing — a sentence or two is
enough. The router outputs **the recommended skill(s) (1-2, in order)** and **one line per
skill** explaining the role it plays. Example: "Our E2E tests keep failing in CI but pass
locally." → `test-reliability` (diagnose flaky/environment-sensitive tests), then
`ci-cd-integration` (align the pipeline environment with local behavior).

## Common Situations and Their Skills

| Situation | Recommended Skills | Order |
|-----------|-------------------|-------|
| New project, no tests at all | `qa-start` (or `qa-project-context` → `test-strategy`) | Bootstrap the whole QA setup |
| Onboard a QA engineer to an existing codebase | `qa-project-bootstrap` | Direct — 30-day ramp + architecture audit |
| "Tests keep breaking in CI" | `test-reliability` → `ci-cd-integration` | Reliability first, then pipeline |
| "A UI refactor/redesign broke many selectors" | `selector-drift-recovery` | Direct — bulk regen, not per-test healing |
| "What should we test before this release?" | `risk-based-testing` → `release-readiness` | Risk first, then checklist |
| "We need Playwright tests" | `playwright-automation` | Direct |
| "We need Cypress tests" | `cypress-automation` | Direct |
| "Let an agent explore the app and assert outcomes" | `agentic-browser-testing` | Direct — goal-driven, no script |
| "Write tests from this PRD/spec/story" | `ai-test-generation` | Direct |
| "Reproduce this vague bug / turn this report into a failing test" | `bug-reproduction` | Direct — verified minimal repro + regression test |
| "Review my tests / find test smells" | `ai-qa-review` | Direct |
| "Our test suite is slow and flaky" | `test-reliability` → `qa-metrics` | Diagnose first, measure second |
| "Our suite is bloated / too many redundant tests" | `test-suite-curation` | Direct — audit + prune with evidence |
| "Manage / author manual test cases (TestRail, Xray, Zephyr, Qase)" | `test-case-management` | Direct |
| "Set up test reporting" | `qa-dashboard` → `ci-cd-integration` | Dashboard design, then CI wiring |
| "Test our API" | `api-testing` | Direct |
| "Write unit tests / add a mock / coverage threshold" | `unit-testing` | Direct |
| "Test our database / migration / data integrity" | `database-testing` | Direct |
| "Set up consumer-driven contract tests (Pact)" | `contract-testing` | Direct |
| "Where are our coverage gaps?" | `coverage-analysis` | Direct |
| "Do a structured exploratory / charter-based testing session" | `exploratory-testing` | Direct |
| "Check accessibility compliance" | `accessibility-testing` | Direct |
| "Test our payment / Stripe checkout / 3DS / subscription billing" | `payment-testing` | Direct |
| "Test the signup confirmation / password reset / OTP email flow" | `email-testing` | Direct |
| "Verify analytics / GA4 / pixel / dataLayer events fire correctly" | `analytics-tracking-testing` | Direct |
| "We got a bug in prod, understand why" | `bug-reproduction` → `quality-postmortem` | Reproduce first, then retro |
| "Classify / triage a batch of CI failures" | `ai-bug-triage` | Direct — batch failure clustering |
| "We're migrating from Selenium/Cypress" | `test-migration` | Direct |
| "Performance is degrading" | `performance-testing` → `observability-driven-testing` | Measure first, then trace |
| "Set up test data" | `test-data-management` | Direct |
| "Set up / containerize a test environment or staging" | `test-environments` | Direct |
| "Add tests to CI" | `ci-cd-integration` | Direct |
| "Visual changes breaking tests" | `visual-testing` → `test-reliability` | Baseline first, then stabilize |
| "We have no idea what quality looks like" | `qa-metrics` → `qa-dashboard` | Define KPIs, then surface them |
| "Third-party API is unreliable in tests" | `service-virtualization` | Direct |
| "Need to test on multiple browsers" | `cross-browser-testing` | Direct |
| "Need to test on real iOS/Android devices (Appium/Detox/Maestro)" | `mobile-testing` | Direct |
| "Security audit coming up" | `security-testing` | Direct |
| "Tests depend on each other and break in random order" | `test-data-management` → `test-reliability` | Fix data isolation first |
| "Roll out a feature safely (flags, canary) during release" | `testing-in-production` | Direct |
| "Schedule probes / SLA checks that run after release" | `synthetic-monitoring` | Direct |
| "Our QA is only catching bugs after dev, too late" | `shift-left-testing` → `test-planning` | Process change first, then plan |
| "We're building an AI/LLM feature and need to test it" | `ai-system-testing` | Direct |
| "Make this test report sound human / less AI-y" | `qa-report-humanizer` | Direct |
| "Make sure this is GDPR/EAA/AI Act compliant" | `compliance-testing` | Direct |
| "Run chaos / failure injection on staging" | `chaos-engineering` | Direct |

## When the Situation is Ambiguous

If a description maps to three or more skills with equal weight, one clarifying question
narrows it down. Answer it and the router reduces to 1-2 skills.

- "Are you fixing something broken, or building new coverage from scratch?"
- "Is this a process problem (how the team works) or a tooling problem (what's running)?"
- "Is the priority speed of delivery, or confidence in correctness?"
- "Are you the only QA, or is this a team-wide change?"

### Disambiguation pairs (the four overlaps to resolve, not guess)

- **`test-reliability` vs `selector-drift-recovery`** — one flaky test healed at runtime →
  `test-reliability`; many selectors broken by a planned UI refactor → `selector-drift-recovery`.
- **`cross-browser-testing` vs `mobile-testing`** — browsers/CSS engines → `cross-browser-testing`;
  real devices, Appium/Detox/Maestro, gestures/deep links → `mobile-testing`.
- **`ai-bug-triage` vs `bug-reproduction`** — classify/dedupe a batch of CI failures →
  `ai-bug-triage`; reproduce and understand one specific bug → `bug-reproduction`.
- **`qa-start` vs `qa-project-bootstrap`** — brand-new project, no QA yet → `qa-start`;
  onboarding a QA engineer to an existing codebase → `qa-project-bootstrap`.

## Skill Categories Quick Reference

Regenerate this from the `category:` field of every `skills/*/SKILL.md` whenever skills change.

| Category | Skills |
|----------|--------|
| **Foundation** | qa-project-context, qa-start, qa-do |
| **Strategy** | test-strategy, test-planning, risk-based-testing, exploratory-testing |
| **Automation** | playwright-automation, cypress-automation, api-testing, unit-testing, mobile-testing, visual-testing, performance-testing, cross-browser-testing, database-testing, security-testing, selector-drift-recovery |
| **Specialized** | accessibility-testing, payment-testing, email-testing, analytics-tracking-testing |
| **AI-QA** | ai-test-generation, ai-bug-triage, bug-reproduction, test-reliability, ai-qa-review, agentic-browser-testing |
| **Infrastructure** | ci-cd-integration, test-environments, test-data-management, contract-testing, service-virtualization |
| **Metrics** | qa-metrics, qa-dashboard, coverage-analysis |
| **Process** | shift-left-testing, qa-project-bootstrap, release-readiness, quality-postmortem, compliance-testing, qa-report-humanizer, test-case-management, test-suite-curation |
| **Production** | testing-in-production, synthetic-monitoring, observability-driven-testing |
| **Knowledge** | ai-system-testing, chaos-engineering, test-migration |

## Anti-Patterns

- **Routing to a broad skill when a precise one exists.** "Reproduce this bug" → routing to
  `ai-bug-triage` (batch classification) instead of `bug-reproduction` (single verified
  repro). Fix: match the exact artifact in the request to the skill that names it.
- **Stacking three or more skills on one situation.** That signals ambiguity, not thoroughness.
  Fix: ask one clarifying question and reduce to 1-2.
- **Trusting a stale table.** If a recently added skill has no row, the router silently
  mis-routes to a weaker neighbor. Fix: regenerate the table from `skills/` (Core Principle 3)
  and fall back to the closest Quick Reference category rather than forcing a wrong match.
- **Grabbing a request that belongs to a named sibling.** "Set up QA on a new project" is
  `qa-start`; "capture project context" is `qa-project-context`. qa-do is last resort only.

## Related Skills

- **qa-start** — the sibling most confused with this one. Use it (not qa-do) when starting QA on a brand-new project with no QA in place; it chains context → strategy → planning.
- **qa-project-context** — capture project setup before using most skills; every skill checks for it first. Route here, don't reimplement it.
- **test-strategy** — when the situation is "we need a QA strategy" rather than a specific problem to route.
