# QA Tools Registry

Central registry of QA tools referenced across qaskills. Each skill declares which tools it uses; this file provides the canonical list with categories, MCP availability, and skill cross-references.

**MCP Server availability matters for agent integration.** Tools marked with an MCP server can be called directly by AI agents within a conversation (e.g., creating a Jira ticket, querying Grafana). Tools without MCP servers require CLI execution, script wrappers, or library imports to operate.

---

## Test Frameworks

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| Playwright | E2E, API, Visual | No native MCP | playwright-automation, api-testing, visual-testing |
| Cypress | E2E, Component | No | cypress-automation |
| Jest | Unit | No | unit-testing |
| Vitest | Unit | No | unit-testing |
| pytest | Unit (Python) | No | unit-testing |
| k6 | Performance | No | performance-testing |
| Appium | Mobile | No | mobile-testing |
| Detox | Mobile (React Native) | No | mobile-testing |

## Quality & Reporting

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| Allure | Reporting | No | qa-dashboard |
| ReportPortal | Reporting, AI | No | qa-dashboard |
| Chromatic | Visual | No | visual-testing |
| Percy | Visual | No | visual-testing |
| BrowserStack | Cross-browser, Mobile | No | cross-browser-testing, mobile-testing |
| axe-core | Accessibility | No | accessibility-testing |

## CI/CD

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| GitHub Actions | CI/CD | Yes (GitHub MCP) | ci-cd-integration |
| GitLab CI | CI/CD | No | ci-cd-integration |
| CircleCI | CI/CD | No | ci-cd-integration |

## Bug Tracking (via MCP)

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| Jira | Bug tracking | Yes (Atlassian MCP) | bug-reporting |
| Linear | Bug tracking | Yes (Linear MCP) | bug-reporting |
| GitHub Issues | Bug tracking | Yes (GitHub MCP) | bug-reporting |

## Security

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| OWASP ZAP | Security scan | No | security-testing |
| Snyk | Dependency scan | No | security-testing |
| Dependabot | Dependency scan | Yes (GitHub) | security-testing |

## Observability

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| Grafana | Dashboards | Yes (Grafana MCP) | qa-dashboard |
| Datadog | Monitoring | No | qa-dashboard |
| Sentry | Error tracking | No | qa-dashboard |

## Contract Testing

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| Pact.js | Consumer-driven contracts | No | contract-testing |

## Test Data

| Tool | Category | MCP Server | Referenced by Skills |
|------|----------|------------|---------------------|
| Fishery | TypeScript factories | No | test-data-management |
| Faker.js | Synthetic data | No | test-data-management |
