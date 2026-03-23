# QA Project Context

> Customize this file with your project's specifics. Every QA skill checks for this
> file first to tailor its output to your codebase, stack, and quality goals.
> Replace all `[bracketed placeholders]` with your actual values.
> Delete any sections that don't apply to your project.

---

## Product

- **Name:** [Your product name]
- **Type:** [SaaS / E-commerce / Media / Mobile app / API / Internal tool]
- **Description:** [One-sentence description of what the product does]
- **URLs:**
  - Production: [https://yourproduct.com]
  - Staging: [https://staging.yourproduct.com]
  - Development: [http://localhost:3000]
- **Key User Flows:**
  - [Sign up and onboarding]
  - [Core action users perform most often, e.g., "Create and publish a post"]
  - [Payment / checkout flow]
  - [Settings and account management]

---

## Tech Stack

### Frontend
- **Framework:** [React / Vue / Next.js / Svelte / Angular / etc.]
- **Language:** [TypeScript / JavaScript]
- **Styling:** [Tailwind CSS / CSS Modules / styled-components / etc.]
- **State Management:** [Redux / Zustand / Pinia / etc.]

### Backend
- **Framework:** [Node.js + Express / Python + FastAPI / Go + Gin / etc.]
- **Language:** [TypeScript / Python / Go / Java / etc.]
- **API Style:** [REST / GraphQL / tRPC / gRPC]

### Database
- **Primary:** [PostgreSQL / MongoDB / MySQL / etc.]
- **Cache:** [Redis / Memcached / none]
- **ORM:** [Prisma / Drizzle / SQLAlchemy / TypeORM / etc.]

### Hosting
- **Platform:** [AWS / Vercel / GCP / Azure / Cloudflare / etc.]
- **CDN:** [CloudFront / Cloudflare / Vercel Edge / etc.]
- **Monitoring:** [Datadog / Sentry / New Relic / etc.]

---

## Test Stack

### E2E / Integration
- **Framework:** [Playwright / Cypress / none]
- **Config Location:** [e.g., playwright.config.ts]
- **Test Directory:** [e.g., tests/e2e/]

### Unit / Component
- **Framework:** [Jest / Vitest / pytest / Go testing / etc.]
- **Config Location:** [e.g., vitest.config.ts]
- **Test Directory:** [e.g., src/__tests__/ or tests/unit/]

### API Testing
- **Framework:** [Playwright API / Supertest / httpx / Postman / etc.]
- **Test Directory:** [e.g., tests/api/]

### Visual Testing
- **Tool:** [Chromatic / Percy / Playwright screenshots / none]
- **Baseline Location:** [e.g., tests/visual/baselines/]

### Performance
- **Tool:** [k6 / Lighthouse / Artillery / none]
- **Test Directory:** [e.g., tests/performance/]

---

## CI/CD

- **Platform:** [GitHub Actions / GitLab CI / CircleCI / Jenkins / etc.]
- **Config Location:** [e.g., .github/workflows/]
- **Test Pipeline:**
  - Unit tests run on: [every push / PR only]
  - E2E tests run on: [PR to main / nightly / manual]
  - Parallelism: [number of shards or workers, e.g., 4 shards]
  - Artifacts: [screenshots on failure / test reports / coverage reports]
- **Deployment:**
  - Staging: [auto-deploy on merge to develop / manual]
  - Production: [manual approval / auto-deploy on merge to main]

---

## Environments

### Development
- **URL:** [http://localhost:3000]
- **Characteristics:** [Local DB, mock external services, hot reload]

### Staging
- **URL:** [https://staging.yourproduct.com]
- **Characteristics:** [Mirrors production, seeded test data, connected to sandbox APIs]

### Production
- **URL:** [https://yourproduct.com]
- **Characteristics:** [Real user data, rate limits enforced, monitoring active]

---

## Quality Goals

- **Unit Test Coverage Target:** [e.g., 80%]
- **E2E Coverage:** [e.g., 100% of critical paths, 60% of all paths]
- **Flakiness Threshold:** [e.g., <2% flake rate]
- **Max Test Suite Duration:**
  - Unit: [e.g., 3 minutes]
  - E2E: [e.g., 15 minutes]
- **Key Metrics:**
  - [Test pass rate > 98%]
  - [Mean time to detect regression < 1 hour]
  - [Zero P0 bugs in production per quarter]

---

## Risk Areas

> List the parts of your system that are most likely to break or have the highest
> business impact when they do. QA skills use this to prioritize test coverage.

| Area | Risk Level | Business Impact | Notes |
|------|-----------|----------------|-------|
| [Payment processing] | [High] | [Revenue loss, compliance] | [Third-party gateway, edge cases with currencies] |
| [User authentication] | [High] | [Security, user lockout] | [OAuth + email/password, session management] |
| [Data export] | [Medium] | [Customer trust] | [Large datasets can timeout] |
| [Notification system] | [Low] | [User engagement] | [Email + push, third-party dependencies] |

---

## Team

- **QA Engineers:** [e.g., 2 — 1 automation, 1 manual]
- **Total Developers:** [e.g., 8]
- **Dev/QA Ratio:** [e.g., 4:1]
- **Process:** [Agile Scrum / Kanban / Shape Up / etc.]
- **Sprint Length:** [e.g., 2 weeks]
- **QA Involvement:** [Shift-left — QA reviews specs before dev / traditional — QA tests after dev]

---

## Conventions

### Test Files
- **Naming Pattern:** [e.g., *.spec.ts for E2E, *.test.ts for unit]
- **Co-located or Separate:** [Tests live next to source / in a separate tests/ directory]

### Selectors (E2E)
- **Strategy:** [data-testid attributes / ARIA roles and labels / CSS selectors / mixed]
- **Naming Convention:** [e.g., data-testid="login-submit-button" — kebab-case, descriptive]

### Branching
- **Strategy:** [feature branches -> develop -> main / feature branches -> main / trunk-based]
- **PR Requirements:** [Tests must pass / code review required / QA sign-off for critical paths]

### Test Data
- **Strategy:** [Factory functions / fixtures / seeded DB / API-generated per test]
- **Cleanup:** [Each test cleans up after itself / DB reset between suites / shared state]

---

## Additional Notes

> Add any project-specific context that would help QA skills give better recommendations.
> Examples: known technical debt, upcoming migrations, compliance requirements (SOC2, GDPR),
> accessibility standards (WCAG 2.1 AA), browser/device support matrix, etc.

[Add your notes here]
