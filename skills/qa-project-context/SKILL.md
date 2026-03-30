---
name: qa-project-context
description: >-
  Set up your QA project context. Creates and fills .agents/qa-project-context.md
  with your tech stack, test frameworks, CI/CD pipeline, environments, coverage goals,
  risk areas, and team structure. Every other QA skill reads this file first to skip
  redundant questions and give context-aware recommendations. Use when: "set up QA context,"
  "configure testing," first use of any QA skill, "initialize project."
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: foundation
---

<objective>
Universal QA context file. Creates .agents/qa-project-context.md capturing tech stack, test frameworks, CI/CD, environments, coverage goals, risk areas, and team structure. Every other skill reads this first — run qa-project-context before any other skill to avoid redundant discovery questions.
</objective>

## What Is This File

Every QA skill in this collection depends on a single context file: `.agents/qa-project-context.md` in your project root. This file captures everything about your product, tech stack, test infrastructure, quality goals, and team structure in one place.

**Why it matters:**

- **No repeated questions.** Without context, every skill starts from scratch: "What framework do you use? What's your CI pipeline? Where do tests live?" With context, skills already know.
- **Better recommendations.** A Playwright skill that knows you use Next.js on Cloudflare with GitHub Actions gives different advice than one that assumes a generic React SPA on Vercel.
- **Cross-skill consistency.** When `test-strategy` recommends a coverage target and `qa-metrics` tracks it, they both reference the same goals from the same file.
- **Onboarding accelerator.** New team members (human or AI) read one file and understand the entire QA landscape.

**Location:** `.agents/qa-project-context.md` in your project root (not in the qaskills repo itself). A blank template ships with qaskills at `.agents/qa-project-context.md` for reference.

## How To Fill It Out

### If `.agents/qa-project-context.md` Does Not Exist

1. Create the `.agents/` directory in the user's project root if it does not exist
2. Copy the template from the qaskills repo's `.agents/qa-project-context.md`
3. Walk through each section interactively using the discovery questions below
4. Write the completed file

### If `.agents/qa-project-context.md` Already Exists

1. Read the existing file
2. Identify sections that still contain `[bracketed placeholders]` or are empty
3. Ask the user about unfilled sections only
4. Ask if anything has changed since the file was last updated (stack migrations, new tools, team changes)
5. Update the file with new information

### General Approach

- Ask questions **section by section**, not all at once
- Start with Product and Tech Stack (these inform everything else)
- For each section, provide smart defaults based on what you already know
- If the user says "I don't know" or "we don't have that yet," record it as-is and move on
- After completing all sections, read the file back and confirm

## Discovery Questions

Walk through these in order. Skip any question already answered by existing context.

### Product Discovery

- What is the product called, and what does it do in one sentence?
- What type of product is it? (SaaS, e-commerce, media site, mobile app, API service, internal tool)
- What are the URLs for production, staging, and development?
- What are the 5-10 most critical user journeys? (Think: "If this breaks, we get paged at 2am.")

### Tech Stack Discovery

- What frontend framework and language do you use?
- What backend framework, language, and API style? (REST, GraphQL, tRPC)
- What database, cache layer, and ORM?
- Where is it hosted, and what CDN and monitoring tools do you use?

### Test Stack Discovery

- Do you have E2E tests today? If yes, what framework and where do they live?
- Do you have unit tests? What framework, and where do they live?
- Do you do API testing separately from E2E?
- Do you do visual regression testing or performance testing?
- If you have no test framework yet: recommend **Playwright** for E2E and **Vitest** for unit tests as modern defaults. Both have excellent TypeScript support, fast execution, and active communities.

### CI/CD Discovery

- What CI/CD platform do you use?
- When do tests run? (Every push, PR only, nightly, manual)
- Do you use parallelism or sharding for test execution?
- What artifacts do you save? (Screenshots, reports, coverage)
- How does deployment work? (Auto-deploy to staging, manual promotion to production)

### Environment Discovery

- How many environments do you have, and what are their URLs?
- How close is staging to production? (Same infra, same data shape, same third-party integrations?)
- Do you use mock services in development or connect to real APIs?

### Quality Goals Discovery

- Do you have coverage targets today? If not, suggest realistic starting points:
  - **Early-stage startup:** 60% unit coverage on business logic, E2E for the top 5 critical flows
  - **Growth-stage:** 80% unit coverage, E2E for all critical paths, <3% flakiness
  - **Enterprise:** 90%+ unit coverage, comprehensive E2E, <1% flakiness, performance budgets
- What is your tolerance for flaky tests? (Suggested threshold: <2%)
- How long should your test suites take? (Suggested: unit <3 min, E2E <15 min)
- What quality metrics do you track or want to track?

### Risk Areas Discovery

- Which parts of the system cause the most production incidents?
- Which integrations are flakiest? (Payment gateways, email services, third-party APIs)
- Are there areas of the codebase with high churn and low test coverage?
- Use the **Impact x Likelihood** framework to prioritize:
  - **Critical risk (test first):** High impact + high likelihood (e.g., payment flow with known edge cases)
  - **Important risk:** High impact + low likelihood (e.g., auth system -- catastrophic if broken, but rarely changes)
  - **Monitor:** Low impact + high likelihood (e.g., notification formatting -- breaks often, low severity)
  - **Backlog:** Low impact + low likelihood (e.g., admin settings page -- stable, rarely used)

### Team Discovery

- How many QA engineers do you have, and what are their specializations?
- What is the developer-to-QA ratio?
- What development methodology do you follow? (Scrum, Kanban, Shape Up)
- When does QA get involved? (Shift-left: during spec writing, or traditional: after development)
- This affects automation strategy:
  - **High dev/QA ratio (8:1+):** Developers must write tests. QA focuses on strategy, critical path automation, and exploratory testing.
  - **Balanced ratio (4:1):** QA owns E2E automation, developers own unit tests. Shared responsibility for integration tests.
  - **QA-heavy (<3:1):** Dedicated automation engineers, comprehensive regression suites, manual exploratory testing cadence.

### Conventions Discovery

- What is your test file naming pattern? (e.g., `*.spec.ts` for E2E, `*.test.ts` for unit)
- Are tests co-located with source code or in a separate directory?
- What selector strategy do you use for E2E tests? (Recommended: `data-testid` attributes for stability, ARIA roles for accessibility-aware testing)
- What is your branching strategy and PR requirements?
- How do you handle test data? (Factories, fixtures, seeded databases, API-generated per test)

## Template Sections Reference

The context file `.agents/qa-project-context.md` contains these sections. Each section is described here with guidance on what makes a good entry.

### Product

Captures what you are building and who uses it. The key user flows list is especially important -- this is what every test-related skill uses to prioritize automation coverage.

Good key user flows are specific and testable:
- "User signs up with email, verifies account, completes onboarding wizard"
- "Buyer searches products, adds to cart, checks out with Stripe, receives confirmation email"
- "Editor creates article, adds media, previews, publishes, verifies it appears on the public site"

Bad key user flows are vague:
- "User uses the app"
- "Things work correctly"

### Tech Stack

Determines which test frameworks and patterns are compatible with your project. A Next.js app on Vercel gets different test configuration advice than a Django app on AWS.

Record frontend, backend, database, and hosting separately. Include specific versions if they matter (e.g., "Next.js 14 with App Router" vs. "Next.js 12 with Pages Router" leads to very different testing approaches).

### Test Stack

What testing tools you already use (or plan to use). For each tool, record:
- The framework name and version
- The config file location
- The test directory

If you have no testing infrastructure yet, that is a valid answer. The skill will recommend a modern starting stack and other skills like `playwright-automation` and `unit-testing` will help you set it up.

### CI/CD

How and when tests execute in your pipeline. Key questions other skills need answered:
- What blocks a deploy? (All tests must pass? Only unit tests? Nothing?)
- How fast is feedback? (Tests on every push vs. nightly runs)
- What evidence is preserved? (Screenshots, video, coverage reports, Allure reports)

### Environments

Where your application runs and how environments differ. Environment parity directly affects test reliability -- if staging uses a different database engine than production, tests that pass in staging may fail in production.

### Quality Goals

Concrete, measurable targets. Avoid aspirational statements like "we want great quality." Instead:
- "80% line coverage for unit tests measured by Istanbul"
- "E2E tests cover all 8 critical user flows"
- "Test suite flake rate below 2% measured over a rolling 30-day window"
- "Full E2E suite completes in under 15 minutes with 4 shards"

### Risk Areas

Use the risk table format with columns for Area, Risk Level, Business Impact, and Notes. This is the input for `test-strategy` when building a prioritized test plan.

### Team

Team size and process directly affect what kind of QA strategy is realistic. A solo developer cannot maintain 500 E2E tests. A team with no QA engineers needs a developer-first testing culture.

### Conventions

Consistency rules that keep the test suite maintainable as it grows. Selector strategy is especially important for E2E stability -- skills like `playwright-automation` and `self-healing-tests` read this to generate selectors that match your conventions.

## Example: SaaS Product Context

```markdown
# QA Project Context

## Product
- **Name:** InvoiceCloud
- **Type:** SaaS
- **Description:** Invoicing and payment platform for freelancers and small businesses
- **URLs:**
  - Production: https://invoicecloud.io
  - Staging: https://staging.invoicecloud.io
  - Development: http://localhost:3000
- **Key User Flows:**
  - Sign up with email, verify account, complete onboarding
  - Create invoice, add line items, send to client
  - Client receives invoice email, views invoice, pays with Stripe
  - Connect bank account for payouts via Plaid
  - Generate monthly revenue report, export as PDF

## Tech Stack
### Frontend
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State Management:** Zustand + React Query

### Backend
- **Framework:** Next.js API routes + tRPC
- **Language:** TypeScript
- **API Style:** tRPC (internal), REST webhooks (Stripe, Plaid)

### Database
- **Primary:** PostgreSQL 15 on Supabase
- **Cache:** Redis (Upstash)
- **ORM:** Drizzle

### Hosting
- **Platform:** Vercel
- **CDN:** Vercel Edge
- **Monitoring:** Sentry (errors), Vercel Analytics (performance)

## Test Stack
### E2E / Integration
- **Framework:** Playwright 1.42
- **Config Location:** playwright.config.ts
- **Test Directory:** tests/e2e/

### Unit / Component
- **Framework:** Vitest 1.3
- **Config Location:** vitest.config.ts
- **Test Directory:** src/__tests__/

### API Testing
- **Framework:** Playwright API testing (shared with E2E)
- **Test Directory:** tests/api/

### Visual Testing
- **Tool:** Playwright screenshot comparisons
- **Baseline Location:** tests/e2e/__screenshots__/

### Performance
- **Tool:** Lighthouse CI
- **Test Directory:** N/A (runs in CI only)

## CI/CD
- **Platform:** GitHub Actions
- **Config Location:** .github/workflows/
- **Test Pipeline:**
  - Unit tests run on: every push
  - E2E tests run on: PR to main
  - Parallelism: 3 Playwright shards
  - Artifacts: screenshots on failure, coverage report, Playwright HTML report
- **Deployment:**
  - Staging: auto-deploy on merge to develop
  - Production: auto-deploy on merge to main (with required CI checks)

## Environments
### Development
- **URL:** http://localhost:3000
- **Characteristics:** Local Supabase, Stripe test mode, mock Plaid

### Staging
- **URL:** https://staging.invoicecloud.io
- **Characteristics:** Supabase staging project, Stripe test mode, Plaid sandbox

### Production
- **URL:** https://invoicecloud.io
- **Characteristics:** Production Supabase, Stripe live mode, Plaid production

## Quality Goals
- **Unit Test Coverage Target:** 80%
- **E2E Coverage:** All 5 critical user flows + payment edge cases
- **Flakiness Threshold:** <2%
- **Max Test Suite Duration:**
  - Unit: 2 minutes
  - E2E: 12 minutes (3 shards)
- **Key Metrics:**
  - Test pass rate > 98%
  - Zero P0 payment bugs in production per quarter
  - Mean time to detect regression < 30 minutes

## Risk Areas
| Area | Risk Level | Business Impact | Notes |
|------|-----------|----------------|-------|
| Stripe payment flow | Critical | Revenue loss, compliance | Currency edge cases, webhook reliability |
| Plaid bank connection | High | User onboarding blocked | Third-party sandbox differs from production |
| Invoice PDF generation | Medium | Client trust | Large invoices (100+ line items) can timeout |
| Email delivery | Medium | User engagement | Relies on Resend, template rendering edge cases |

## Team
- **QA Engineers:** 1 (automation-focused)
- **Total Developers:** 4
- **Dev/QA Ratio:** 4:1
- **Process:** Kanban with weekly releases
- **QA Involvement:** Shift-left -- QA reviews specs and writes E2E for critical paths, devs own unit tests

## Conventions
### Test Files
- **Naming Pattern:** *.spec.ts for E2E, *.test.ts for unit
- **Co-located or Separate:** Unit tests co-located in src/__tests__/, E2E in tests/e2e/

### Selectors (E2E)
- **Strategy:** data-testid attributes for interactive elements, ARIA roles for navigation
- **Naming Convention:** data-testid="invoice-create-button" (kebab-case, descriptive)

### Branching
- **Strategy:** Feature branches -> develop -> main
- **PR Requirements:** All CI checks pass, 1 code review, QA sign-off for payment-related changes

### Test Data
- **Strategy:** Factory functions using @faker-js/faker, API-generated per test
- **Cleanup:** Each test creates its own data via API, no shared state between tests
```

## Example: Media Site Context

A condensed example showing how the same template works for a different product type.

```markdown
# QA Project Context

## Product
- **Name:** PulseMedia Network
- **Type:** Media (multi-site publisher)
- **Description:** Network of 4 news and lifestyle sites serving 12M monthly visitors
- **URLs:**
  - Production: https://pulsemedia.com (+ techpulse.com, lifepulse.com, sportspulse.com)
  - Staging: https://staging.pulsemedia.com
- **Key User Flows:**
  - Reader lands from Google, reads article, scrolls to related content
  - Editor creates article in CMS, adds images and embeds, previews, publishes
  - Ad manager configures placements, verifies rendering across breakpoints

## Tech Stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, multi-tenant routing
- **Backend:** Next.js API routes + headless WordPress, REST + GraphQL
- **Database:** MySQL 8 (WordPress), PostgreSQL (analytics), Redis (cache)
- **Hosting:** AWS (ECS, RDS, S3), CloudFront CDN, Datadog + Sentry monitoring

## Test Stack
- **E2E:** Playwright 1.42 (tests/e2e/, per-site subdirectories)
- **Unit:** Vitest 1.3 (src/__tests__/)
- **Visual:** Chromatic (Storybook) + Playwright screenshots (full pages)
- **Performance:** Lighthouse CI + k6 (tests/performance/)

## CI/CD
- **Platform:** GitHub Actions
- **Pipeline:** Unit on every push, E2E on PR to main + nightly, visual on PR (Chromatic), perf weekly
- **Parallelism:** 6 Playwright shards (one per site + cross-site)
- **Deploy:** Auto to staging on merge to develop, manual promotion to production

## Environments
- **Dev:** localhost:3000 -- local WordPress, mock ad server, content fixtures
- **Staging:** staging.pulsemedia.com -- production content snapshot (weekly refresh), sandbox ads
- **Production:** pulsemedia.com -- live WordPress, live ads, CDN caching (5-min TTL)

## Quality Goals
- **Coverage:** 75% unit (business logic), critical reader flows on all 4 sites
- **Flakiness:** <3% (ad-related tests excluded from flake tracking)
- **Speed:** Unit <3 min, E2E <20 min (6 shards)
- **Key Metrics:** Core Web Vitals pass rate >90%, zero broken article pages, ad viewability >70%

## Risk Areas
| Area | Risk Level | Business Impact | Notes |
|------|-----------|----------------|-------|
| Article rendering | Critical | SEO rankings | Rich embeds break frequently |
| Ad placements | High | Revenue ($400K/mo) | Third-party scripts cause layout shift |
| CMS publish flow | High | Editorial velocity | WordPress API + ISR cache invalidation |
| Cross-site navigation | Medium | Reader engagement | Multi-tenant routing edge cases |

## Team
- **QA:** 3 (1 automation lead, 1 manual/exploratory, 1 performance), 12 devs (4:1 ratio)
- **Process:** Scrum (2-week sprints), mixed shift-left approach

## Conventions
- **Test files:** *.spec.ts (E2E), *.test.ts (unit), E2E organized by site in tests/e2e/{site}/
- **Selectors:** data-testid for interactive, semantic selectors (article, nav) for content
- **Branching:** Feature -> develop -> main, QA sign-off for ad and CMS changes
- **Test data:** WordPress fixtures via WP-CLI, staging reset weekly from production
```

## Workflow: Creating the Context File

When an agent activates this skill, follow this sequence:

1. **Check for existing context:** Look for `.agents/qa-project-context.md` in the user's project root.

2. **If it does not exist:**
   - Create `.agents/` directory if needed
   - Copy the template from the qaskills repo
   - Begin the discovery questions, starting with Product
   - Fill in each section as the user provides answers
   - Write the completed file

3. **If it exists but has placeholders:**
   - Read the file and identify unfilled sections
   - Tell the user which sections are complete and which need input
   - Ask discovery questions only for unfilled sections
   - Update the file

4. **If it exists and is fully filled in:**
   - Read the file and summarize the current context
   - Ask if anything has changed (new tools, team changes, shifted goals)
   - Update only what has changed

5. **After completion:**
   - Confirm the file is saved at `.agents/qa-project-context.md`
   - Suggest which skill to use next based on the context (e.g., if no E2E tests exist, suggest `playwright-automation`; if no strategy document, suggest `test-strategy`)

## Anti-Patterns

- **Do not ask all questions at once.** Walk through section by section. Dumping 30 questions is overwhelming.
- **Do not leave placeholders in the final file.** If the user does not have an answer, record the actual state (e.g., "None -- no E2E framework selected yet") rather than leaving `[brackets]`.
- **Do not invent information.** If you can detect the tech stack from `package.json`, `requirements.txt`, or config files, use that. But confirm with the user before writing.
- **Do not skip risk areas.** This is the most valuable section for downstream skills. Push the user to identify at least 3-4 risk areas even if they say "everything is fine."
- **Do not recommend tools in this skill.** This skill captures current state. Tool recommendations come from `playwright-automation`, `unit-testing`, and other specialized skills.
  - Exception: if the user has zero test infrastructure, briefly suggest Playwright + Vitest as starting defaults and note it in the Test Stack section.

## Codebase Detection

Before asking about tech stack, scan the project for common configuration files to pre-fill answers:

| File | Indicates |
|------|-----------|
| `package.json` | Node.js project, check `dependencies` for framework |
| `next.config.*` | Next.js |
| `nuxt.config.*` | Nuxt/Vue |
| `angular.json` | Angular |
| `requirements.txt` / `pyproject.toml` | Python project |
| `go.mod` | Go project |
| `playwright.config.*` | Playwright is set up |
| `cypress.config.*` | Cypress is set up |
| `vitest.config.*` / `jest.config.*` | Unit test framework |
| `.github/workflows/` | GitHub Actions CI |
| `.gitlab-ci.yml` | GitLab CI |
| `Jenkinsfile` | Jenkins |
| `docker-compose.*` | Docker-based environments |
| `wrangler.*` | Cloudflare Workers |
| `vercel.json` | Vercel hosting |

Present detected values to the user for confirmation rather than asking from scratch.

## Done When

- `.agents/qa-project-context.md` exists in the project root with no `[bracketed placeholders]` remaining
- All sections are filled with real values: product name, URLs, key user flows, tech stack, test stack, CI/CD config, environments, and quality goals
- The Team section reflects actual headcount, dev/QA ratio, and QA involvement model
- The Risk Areas section contains at least 3 risk entries scored by impact and likelihood
- The Test Stack section names the actual frameworks in use (or explicitly states "none selected yet" with a recommendation noted)

## Related Skills

- Every other skill in this collection reads `.agents/qa-project-context.md` as its first step
- For setting up Playwright after filling in context, see `playwright-automation`
- For setting up unit tests, see `unit-testing`
- For building a test strategy based on this context, see `test-strategy`
- For CI/CD pipeline configuration, see `ci-cd-integration`
- For defining and tracking quality metrics, see `qa-metrics`
