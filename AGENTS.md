# Agent Behavior Specification

How AI agents should discover, load, and use skills from this repository.

## Skill Discovery

On first skill use per session:

1. Check for `.agents/qa-project-context.md` in the user's project root
   - If exists: read it and use as context for all subsequent skill interactions
   - If not: suggest the user creates one using the `qa-project-context` skill
2. Read the activated skill's `SKILL.md` from `skills/<skill-name>/SKILL.md`
3. Follow the skill's Discovery Questions, skip any already answered by qa-project-context
4. Load files from `references/` only when deeper detail is needed — do not read all reference files upfront

## Cross-Skill References

- Skills reference each other with: "For [topic], see `skill-name`"
- Workflow steps that span skills include direct references at the relevant step
- The `qa-project-context` skill is the universal dependency — every skill checks for it first

## Description Quality

Each skill's YAML frontmatter `description` must be specific enough to match the right skill without fuzzy boundaries. Descriptions include what the skill does, when to use it, trigger phrases, and cross-references to related skills.

## Tools Integration

- Skills reference tools listed in `tools/REGISTRY.md`
- Tool-specific integration guides live in `tools/integrations/`
- Examples: `playwright-automation` references the Playwright integration guide, `qa-metrics` references Allure/Grafana dashboards

## Available Skills — 39 skills across 10 categories

### Foundation
| `qa-project-context` | "set up QA context," "configure testing," first use of any skill |

### Strategy
| `test-strategy` | "test strategy," "QA plan," "quality strategy," "testing approach" |
| `test-planning` | "test plan," "sprint testing," "release plan," "what to test" |
| `risk-based-testing` | "risk assessment," "what could break," "critical paths," "risk matrix" |
| `exploratory-testing` | "exploratory testing," "SBTM," "manual testing," "bug hunting" |

### Automation
| `playwright-automation` | "Playwright," "browser testing," "E2E test," "end-to-end" |
| `cypress-automation` | "Cypress," "cy.," "component test," "Cypress Cloud" |
| `api-testing` | "API test," "endpoint test," "REST test," "GraphQL test" |
| `unit-testing` | "unit test," "Jest," "Vitest," "pytest," "mock," "coverage" |
| `mobile-testing` | "mobile test," "Appium," "Detox," "iOS test," "Android test" |
| `visual-testing` | "visual test," "screenshot," "visual regression," "pixel diff" |
| `performance-testing` | "performance test," "load test," "k6," "Lighthouse," "Web Vitals" |

### Specialized
| `accessibility-testing` | "accessibility," "a11y," "WCAG," "screen reader," "axe" |
| `security-testing` | "security test," "OWASP," "vulnerability," "ZAP," "XSS" |
| `cross-browser-testing` | "cross-browser," "browser matrix," "BrowserStack," "Safari" |
| `database-testing` | "database test," "migration test," "data integrity," "SQL test" |

### AI-Augmented QA
| `ai-test-generation` | "generate tests," "AI tests," "tests from spec," "tests from PRD" |
| `ai-bug-triage` | "bug triage," "classify bugs," "failure analysis," "CI failures" |
| `test-reliability` | "flaky test," "self-healing," "broken locator," "test stability" |
| `ai-qa-review` | "review tests," "test quality," "test smells," "coverage gaps" |

### Infrastructure
| `ci-cd-integration` | "CI/CD," "GitHub Actions," "pipeline," "test in CI" |
| `test-environments` | "test environment," "staging," "Docker," "preview environment" |
| `test-data-management` | "test data," "fixtures," "factories," "seed data" |
| `contract-testing` | "contract test," "Pact," "consumer-driven," "API contract" |
| `service-virtualization` | "mock service," "stub API," "WireMock," "MSW," "test isolation" |

### Metrics
| `qa-metrics` | "QA metrics," "test metrics," "quality KPIs," "test health" |
| `qa-dashboard` | "test dashboard," "Allure," "test report," "Grafana" |
| `coverage-analysis` | "code coverage," "coverage gap," "Istanbul," "coverage threshold" |

### Process
| `shift-left-testing` | "shift left," "TDD," "dev-QA pairing," "definition of done" |
| `qa-project-bootstrap` | "QA onboarding," "new tester," "ramp up," "test architecture audit" |
| `release-readiness` | "release ready," "go/no-go," "smoke test," "release checklist" |
| `quality-postmortem` | "QA retro," "escaped bugs," "postmortem," "improvement" |
| `compliance-testing` | "GDPR test," "compliance," "CMP test," "cookie consent" |

### Production & Observability
| `testing-in-production` | "production testing," "feature flags," "canary," "guardrails" |
| `synthetic-monitoring` | "synthetic monitoring," "uptime," "SLA validation," "probes" |
| `observability-driven-testing` | "observability," "trace-based testing," "telemetry" |

### Knowledge & Migration
| `ai-system-testing` | "AI testing," "LLM testing," "prompt testing," "evals" |
| `chaos-engineering` | "chaos engineering," "fault injection," "resilience," "game day" |
| `test-migration` | "migrate tests," "switch framework," "Selenium to Playwright" |
