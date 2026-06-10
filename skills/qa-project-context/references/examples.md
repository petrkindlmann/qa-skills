# qa-project-context — Filled Examples

Two complete `.agents/qa-project-context.md` files for different product types. Copy the
structure, not the version pins — verify your own framework versions against `package.json`.

---

## Example: SaaS Product

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
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **State Management:** Zustand + React Query

### Backend
- **Framework:** Next.js API routes + tRPC
- **Language:** TypeScript
- **API Style:** tRPC (internal), REST webhooks (Stripe, Plaid)

### Database
- **Primary:** PostgreSQL 16 on Supabase
- **Cache:** Redis (Upstash)
- **ORM:** Drizzle

### Hosting
- **Platform:** Vercel
- **CDN:** Vercel Edge
- **Monitoring:** Sentry (errors), Vercel Analytics (performance)

## Test Stack
### E2E / Integration
- **Framework:** Playwright 1.60
- **Config Location:** playwright.config.ts
- **Test Directory:** tests/e2e/

### Unit / Component
- **Framework:** Vitest 4
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

---

## Example: Media Site (multi-tenant publisher)

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
- **Frontend:** Next.js 16 (App Router), TypeScript, Tailwind CSS, multi-tenant routing
- **Backend:** Next.js API routes + headless WordPress, REST + GraphQL
- **Database:** MySQL 8 (WordPress), PostgreSQL (analytics), Redis (cache)
- **Hosting:** AWS (ECS, RDS, S3), CloudFront CDN, Datadog + Sentry monitoring

## Test Stack
- **E2E:** Playwright 1.60 (tests/e2e/, per-site subdirectories)
- **Unit:** Vitest 4 (src/__tests__/)
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

---

## Monorepo structure

When the project is a monorepo (detected via `turbo.json`, `pnpm-workspace.yaml`, or
`nx.json`), represent each frontend app separately and keep the shared API as one entry:

```markdown
## Tech Stack
### Frontend — apps/admin
- **Framework:** Next.js 16, TypeScript
### Frontend — apps/storefront
- **Framework:** Remix (React Router 7), TypeScript
### Backend — packages/api (shared)
- **Framework:** Fastify, REST + tRPC

## Test Stack
### E2E
- **apps/admin:** Playwright 1.60, apps/admin/tests/e2e/
- **apps/storefront:** Playwright 1.60, apps/storefront/tests/e2e/
- **Shared API:** Playwright API tests, packages/api/tests/
```

Shard E2E per app rather than across the whole monorepo: each app's suite runs and shards
independently so a change in `apps/admin` doesn't trigger `apps/storefront` E2E. Note in the
CI/CD section which path filters gate which app's suite (e.g. `apps/admin/**` → admin E2E).
