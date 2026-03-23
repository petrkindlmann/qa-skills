# Test Strategy Templates

Ready-to-adapt strategy document templates for different product types. Each template contains realistic values -- not placeholders -- so you can see what a strong strategy document looks like and modify it for your context.

---

## 1. SaaS Product Strategy Template

```markdown
# QA Strategy: ProjectBoard (B2B Project Management SaaS)
## Version 1.0 | Last Updated: 2026-03-15 | Owner: Sarah Chen, QA Lead

### Executive Summary
ProjectBoard serves 2,400 B2B customers managing $180M+ in projects annually. Our testing
strategy prioritizes payment and billing flows, workspace collaboration (real-time sync), and
data integrity for project/task CRUD operations. We target a defect escape rate under 5% with
CI feedback under 12 minutes. The strategy shifts our current ice-cream-cone test suite toward
a healthy pyramid over two quarters.

### Scope & Objectives
**In scope:** Web app (React/Next.js), REST API (Node.js), WebSocket real-time engine,
Stripe billing integration, SSO/SAML auth, PostgreSQL data layer, S3 file attachments.
**Out of scope:** Mobile app (separate strategy), marketing site, Salesforce integration
(owned by RevOps team, contract-tested only).

**Objectives:**
1. Reduce defect escape rate from 11% to under 5% by end of Q3 2026
2. Shift test pyramid from 25/15/60 (unit/integration/E2E) to 70/20/10 by end of Q4 2026
3. Reduce CI pipeline time from 38 minutes to under 12 minutes by end of Q3 2026
4. Achieve 85% unit coverage on billing and auth services by end of Q2 2026

### Test Levels

| Level | Framework | Current Count | Target Count | Run Time |
|-------|-----------|--------------|-------------|----------|
| Unit | Vitest | 312 | 1,400 | <2 min |
| Integration | Vitest + Supertest + Testcontainers | 187 | 400 | <5 min |
| E2E | Playwright | 743 | 200 (critical paths only) | <8 min (parallelized) |
| API Contract | Pact | 0 | 85 (per endpoint) | <1 min |
| Visual | Playwright screenshots | 0 | 30 (key pages) | nightly |
| Performance | k6 | 3 scripts | 12 scripts | weekly |
| Security | Snyk + OWASP ZAP | dependency scan only | full DAST | pre-release |
| Accessibility | axe-core | 0 | 15 (all user-facing pages) | per PR |

### Risk Assessment

| Feature | Impact | Likelihood | Score | Approach |
|---------|--------|------------|-------|----------|
| Stripe billing & invoicing | 5 | 3 | 15-CRIT | Unit + contract + E2E + synthetic monitoring |
| SSO/SAML authentication | 5 | 2 | 10-HIGH | Unit + integration + E2E for login flows |
| Real-time task sync (WebSocket) | 4 | 4 | 16-CRIT | Unit + integration + E2E multi-tab |
| Task CRUD operations | 3 | 3 | 9-MED | Unit + integration, E2E for create/complete |
| File attachment upload/download | 3 | 2 | 6-MED | Unit + integration with S3 mock |
| Dashboard charts & reporting | 2 | 3 | 6-MED | Unit for calculations, visual regression |
| User profile & preferences | 1 | 2 | 2-LOW | Manual verification during release |
| Notification preferences | 1 | 1 | 1-LOW | Manual only |

### Quality Gates

**PR Gate (required, <12 min):**
- Vitest unit + integration: all pass
- Coverage: no decrease (enforced via codecov)
- ESLint + Prettier: no errors
- axe-core a11y: no new violations
- Bundle size: <5% increase warning, >10% blocks merge

**Merge to main:**
- PR gate passes
- Playwright smoke suite (12 critical paths): all pass against preview deploy
- Pact contract verification: all consumer/provider contracts verified

**Deploy to production:**
- Full Playwright suite passes on staging
- k6 performance baseline: p95 < 800ms for API, p95 < 2s for page load
- ZAP security scan: no new high/critical findings
- Feature flags verified in staging

**Nightly:**
- Full Playwright suite including edge cases
- Visual regression comparison
- k6 load test (100 concurrent users, 10 min)
- Dependency vulnerability scan

### Metrics

| Metric | Current | Q2 Target | Q4 Target |
|--------|---------|-----------|-----------|
| Unit coverage (billing) | 34% | 85% | 90% |
| Unit coverage (overall) | 28% | 55% | 70% |
| Pyramid ratio (U/I/E) | 25/15/60 | 50/20/30 | 70/20/10 |
| Flakiness rate | 8.2% | <4% | <2% |
| CI duration (PR) | 38 min | 15 min | 12 min |
| Defect escape rate | 11% | 7% | 5% |
| MTTR (P0) | 6 hours | 4 hours | 2 hours |

### Timeline

**Phase 1 (Weeks 1-4): Foundation**
- Audit all 743 E2E tests, tag by risk level and what they actually validate
- Write unit tests for billing service (target: 85% coverage)
- Set up Pact for API contract testing between frontend and backend
- Establish baseline metrics dashboard (Grafana)

**Phase 2 (Weeks 5-10): Pyramid Correction**
- Decompose 400+ E2E tests into unit/integration equivalents
- Delete redundant E2E tests (expected reduction: 743 → ~200)
- Add integration tests for all API endpoints via Supertest
- Parallelize remaining E2E tests (target: 8 min total)

**Phase 3 (Weeks 11-14): Gates & Monitoring**
- Enable all quality gates (PR, merge, deploy, nightly)
- Set up synthetic monitoring for checkout and login flows
- Add visual regression testing for dashboard and settings pages
- First security audit with ZAP

**Phase 4 (Weeks 15-20): Optimization**
- Implement test impact analysis (only run affected tests per PR)
- Quarantine and fix flaky tests (target: <2%)
- Add load testing scenarios for WebSocket connections
- Conduct first quarterly strategy review and publish v1.1
```

---

## 2. E-Commerce Strategy Template

```markdown
# QA Strategy: FreshCart (D2C Grocery E-Commerce)
## Version 1.0 | Last Updated: 2026-03-10 | Owner: Marcus Rivera, Head of QA

### Executive Summary
FreshCart processes 45,000 orders/week with an AOV of $67. Downtime during peak hours (5-8 PM)
costs approximately $12,000/hour in lost revenue. Our strategy prioritizes the checkout funnel,
inventory sync, and delivery scheduling above all else. PCI-DSS compliance is mandatory for
payment processing. Mobile web accounts for 72% of traffic and receives proportional test coverage.

### Scope & Objectives
**In scope:** Storefront (Next.js), checkout flow, Stripe/Apple Pay/Google Pay payments,
inventory management API, delivery scheduling engine, search (Algolia), CMS-driven content pages.
**Out of scope:** Warehouse management system (third-party, contract-tested), driver app (separate team).

**Objectives:**
1. Zero payment-related defects escaping to production (currently 2-3 per quarter)
2. Checkout funnel E2E tests cover all payment methods, all device sizes
3. Inventory sync accuracy validated to 99.9% via automated reconciliation tests
4. Page load time validated: LCP < 2.5s on 4G connection for product and category pages

### Risk Assessment

| Feature | Impact | Likelihood | Score | Approach |
|---------|--------|------------|-------|----------|
| Checkout + payment processing | 5 | 3 | 15-CRIT | Full stack: unit + integration + E2E + synthetic + PCI scan |
| Inventory sync (real-time stock) | 5 | 4 | 20-CRIT | Integration tests + reconciliation job + alerting |
| Delivery slot scheduling | 4 | 3 | 12-HIGH | Unit (slot algorithm) + integration (capacity) + E2E |
| Product search & filtering | 3 | 2 | 6-MED | Unit + Algolia contract test |
| User accounts & order history | 3 | 2 | 6-MED | Unit + integration |
| Promo codes & discounts | 4 | 3 | 12-HIGH | Unit (calculation engine) + E2E (apply at checkout) |
| CMS content pages | 1 | 2 | 2-LOW | Visual regression only |
| Email notifications | 2 | 2 | 4-LOW | Integration test for trigger, manual for content |

### Test Levels

| Level | Count | Focus Areas |
|-------|-------|-------------|
| Unit (Vitest) | 890 | Price calculations, discount logic, slot availability algorithm, inventory thresholds |
| Integration (Supertest) | 210 | Stripe webhooks, Algolia sync, inventory API, delivery capacity |
| E2E (Playwright) | 85 | Checkout (6 payment methods x 3 viewports), search-to-cart, delivery booking |
| Performance (k6) | 8 | Product page load, checkout throughput, inventory API under load |
| Security (ZAP + Snyk) | Per release | PCI-DSS compliance, XSS in search, CSRF on checkout |
| Visual (Playwright) | 25 | Product cards, cart, checkout steps, order confirmation |
| Mobile-specific | 40 (E2E) | Touch interactions, viewport-specific layouts, Apple Pay/Google Pay |

### Quality Gates

**PR Gate:** Unit + integration pass, coverage no decrease, Lighthouse CI (LCP < 2.5s).
**Deploy Gate:** Full E2E on staging including all payment methods in Stripe test mode,
  performance benchmarks pass, PCI scan clean.
**Post-Deploy:** Synthetic monitoring places a test order every 5 minutes, alerts on failure.

### Key Metric Targets

| Metric | Target |
|--------|--------|
| Payment defect escapes | 0 per quarter |
| Checkout E2E pass rate | >99.5% |
| Inventory sync accuracy | >99.9% |
| Mobile LCP (4G) | <2.5s |
| CI pipeline (PR) | <10 min |
| Flakiness rate | <1.5% |
```

---

## 3. API-First Product Strategy Template

```markdown
# QA Strategy: DataPipe (Developer API Platform)
## Version 1.0 | Last Updated: 2026-03-12 | Owner: Aisha Okafor, Staff Engineer

### Executive Summary
DataPipe provides data transformation APIs consumed by 340 enterprise customers processing
18M API calls/day. Our users are developers; API reliability and backward compatibility are
existential concerns. A breaking change or unexpected downtime directly violates SLAs carrying
financial penalties. This strategy emphasizes contract testing, backward compatibility validation,
and performance under load. No UI testing needed -- the dashboard is a separate product with its
own strategy.

### Scope & Objectives
**In scope:** REST API (Go), GraphQL API (Go), webhook delivery system, rate limiting,
authentication (API keys + OAuth2), SDK generation (TypeScript, Python, Java), API documentation accuracy.
**Out of scope:** Admin dashboard (separate strategy), billing system (Stripe-managed).

**Objectives:**
1. Zero breaking changes shipped without major version bump (currently: 1-2 per quarter)
2. API p99 latency < 200ms for all endpoints under normal load
3. Webhook delivery success rate validated at >99.5%
4. 100% of public endpoints have contract tests and OpenAPI spec validation

### Test Levels

| Level | Framework | Count | Focus |
|-------|-----------|-------|-------|
| Unit (Go test) | stdlib + testify | 2,100 | Transform logic, validation, error handling, edge cases |
| Integration | testcontainers-go | 380 | Database queries, Redis caching, queue processing |
| Contract | Schemathesis + custom | 165 | OpenAPI spec compliance, backward compatibility |
| SDK | Jest/pytest/JUnit per SDK | 90 per SDK | Generated SDK correctness against live API |
| Load | k6 | 12 scenarios | Throughput, latency percentiles, rate limiting behavior |
| Security | gosec + ZAP | Per release | Auth bypass, injection, rate limit circumvention |

### Backward Compatibility Validation
Every PR runs:
1. OpenAPI spec diff -- any removal or type change in existing fields blocks merge
2. Contract tests run current tests against new code (consumer-driven)
3. SDK regeneration + SDK test suite (catches serialization/deserialization breaks)
4. Integration test with previous API version client (n-1 compatibility)

### Performance Testing Protocol
- **Baseline:** 1,000 req/s sustained for 10 minutes, p99 < 200ms
- **Stress:** Ramp to 5,000 req/s, measure degradation curve
- **Spike:** 0 to 3,000 req/s in 10 seconds, recovery within 30 seconds
- **Soak:** 500 req/s for 4 hours, memory/connection leak detection
- Run weekly + before every release + after infrastructure changes

### Key Metric Targets

| Metric | Target |
|--------|--------|
| Breaking changes escaped | 0 per quarter |
| API p99 latency | <200ms |
| Contract test coverage | 100% of public endpoints |
| Webhook success rate | >99.5% |
| Unit coverage | >85% |
| CI pipeline (PR) | <8 min |
```

---

## 4. Media/Content Site Strategy Template

```markdown
# QA Strategy: Streamline (Media Streaming & Editorial Platform)
## Version 1.0 | Last Updated: 2026-03-08 | Owner: Jake Torres, QA Manager

### Executive Summary
Streamline serves 890,000 MAU consuming video and editorial content. Revenue depends on
ad impressions (60%) and subscriptions (40%). Testing priorities: content delivery reliability,
video player functionality across devices, ad rendering accuracy, and Core Web Vitals for SEO.
The site is content-heavy with a relatively thin application layer, so visual regression and
performance testing are disproportionately important compared to typical SaaS.

### Scope & Objectives
**In scope:** Public site (Next.js SSR/ISR), video player (custom + HLS.js), ad integration
(Google Ad Manager), subscription/paywall logic, CMS content rendering, search, personalization engine.
**Out of scope:** CMS authoring interface (vendor-managed), CDN infrastructure (DevOps-owned).

**Objectives:**
1. Core Web Vitals pass rate >95% across all template types (currently 78%)
2. Video player error rate <0.1% across supported browsers/devices
3. Ad viewability score >70% (IAB standard, currently 62%)
4. Zero paywall bypass defects (subscription content accessible without auth)

### Risk Assessment

| Feature | Impact | Likelihood | Score | Approach |
|---------|--------|------------|-------|----------|
| Video player (playback, quality switching) | 5 | 3 | 15-CRIT | Unit + cross-browser E2E + real device lab |
| Paywall / subscription gate | 5 | 2 | 10-HIGH | Unit + integration + E2E + security audit |
| Ad rendering & viewability | 4 | 4 | 16-CRIT | Integration + visual + ad verification tool |
| Content rendering (articles, galleries) | 3 | 2 | 6-MED | Visual regression + CMS contract tests |
| Search & personalization | 2 | 3 | 6-MED | Unit + integration |
| Newsletter signup | 1 | 1 | 1-LOW | Manual only |

### Test Levels

| Level | Count | Focus |
|-------|-------|-------|
| Unit (Vitest) | 420 | Paywall logic, ad placement algorithm, personalization scoring, video state machine |
| Integration | 95 | CMS API contract, ad server integration, search index sync |
| E2E (Playwright) | 65 | Video playback (5 browsers), paywall enforcement, content rendering |
| Visual (Playwright + Percy) | 120 | All content templates, responsive breakpoints, dark mode, ad slots |
| Performance (Lighthouse CI + k6) | 15 | LCP/CLS/INP for all templates, video start time, TTFB |
| Cross-browser | Matrix | Chrome, Safari, Firefox, Edge, Samsung Internet, iOS Safari |
| Accessibility (axe-core) | All templates | WCAG 2.1 AA for all content pages |

### Performance Strategy
Content sites live and die by Core Web Vitals. Every PR runs Lighthouse CI against:
- Homepage
- Article page (text-heavy)
- Article page (video embed)
- Category/listing page
- Search results page

**Thresholds (block merge if exceeded):**
- LCP: >2.5s
- CLS: >0.1
- INP: >200ms
- Total bundle size increase: >10KB without justification

### Key Metric Targets

| Metric | Target |
|--------|--------|
| Core Web Vitals pass rate | >95% |
| Video player error rate | <0.1% |
| Visual regression false positive rate | <3% |
| Ad viewability score | >70% |
| Cross-browser E2E pass rate | >99% |
| Paywall bypass defects | 0 |
```

---

## Test Pyramid Analysis Worksheet

Use this worksheet to assess your current test suite shape and plan corrections.

### Step 1: Count Current Tests

```
Source command examples:
  Unit:        npx vitest --reporter=json 2>/dev/null | jq '.numTotalTests'
  Integration: find . -path "*/integration/*.test.*" | wc -l
  E2E:         find . -path "*/e2e/*.spec.*" | wc -l

Results:
  Unit tests:          _______ count
  Integration tests:   _______ count
  E2E tests:           _______ count
  Total:               _______ count
```

### Step 2: Calculate Ratios

```
  Unit %:         (unit count / total) x 100        = _______ %
  Integration %:  (integration count / total) x 100 = _______ %
  E2E %:          (E2E count / total) x 100         = _______ %
```

### Step 3: Identify Current Shape

```
  [ ] Healthy Pyramid    — Unit 60-80%, Integration 15-25%, E2E 5-15%
  [ ] Ice Cream Cone     — E2E > Unit (inverted, most common anti-pattern)
  [ ] Diamond            — Integration > Unit and Integration > E2E (heavy mocking)
  [ ] Hourglass          — Unit high, Integration low, E2E high (missing middle)
  [ ] Trophy             — Integration-heavy (Kent C. Dodds style, valid for some apps)
  [ ] No Shape           — Tests exist but with no intentional distribution
```

### Step 4: Define Target Ratios

```
  Target unit %:         _______ %  → need _______ more/fewer unit tests
  Target integration %:  _______ %  → need _______ more/fewer integration tests
  Target E2E %:          _______ %  → need _______ more/fewer E2E tests
```

### Step 5: Action Items

For each gap, list specific actions:

| Gap | Action | Owner | Due Date | Effort |
|-----|--------|-------|----------|--------|
| Unit tests too low | Add unit tests for [service] business logic | | | |
| E2E tests too high | Decompose E2E tests for [feature] into unit tests | | | |
| Integration tests missing | Add API contract tests for [service] boundaries | | | |
| Flaky E2E tests | Quarantine and rewrite top 10 flakiest tests | | | |

### Step 6: Track Progress Monthly

```
Month:    | Unit % | Int %  | E2E %  | Shape          | CI Time  | Flaky %
----------|--------|--------|--------|----------------|----------|--------
Baseline  |        |        |        |                |          |
Month 1   |        |        |        |                |          |
Month 2   |        |        |        |                |          |
Month 3   |        |        |        |                |          |
Month 4   |        |        |        |                |          |
Month 5   |        |        |        |                |          |
Month 6   |        |        |        |                |          |
```

---

## Risk Assessment Matrix Template

### Full 5x5 Matrix With Example Entries

```
                    Rare (1)        Unlikely (2)     Possible (3)     Likely (4)       Almost Certain (5)
                  ┌───────────────┬───────────────┬───────────────┬───────────────┬───────────────┐
Catastrophic (5)  │  5 - MEDIUM   │ 10 - HIGH     │ 15 - CRITICAL │ 20 - CRITICAL │ 25 - CRITICAL │
(data loss,       │               │ Auth bypass   │ Payment       │               │               │
 financial loss,  │               │               │ processing    │               │               │
 compliance)      │               │               │ errors        │               │               │
                  ├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
Major (4)         │  4 - LOW      │  8 - MEDIUM   │ 12 - HIGH     │ 16 - CRITICAL │ 20 - CRITICAL │
(feature broken,  │               │               │ Real-time     │ Search returns│               │
 significant UX   │               │               │ sync failures │ wrong results │               │
 degradation)     │               │               │               │               │               │
                  ├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
Moderate (3)      │  3 - LOW      │  6 - MEDIUM   │  9 - MEDIUM   │ 12 - HIGH     │ 15 - CRITICAL │
(partial feature  │               │ File upload   │ Dashboard     │ Form          │               │
 failure, UX      │               │ edge case     │ chart errors  │ validation    │               │
 issue)           │               │               │               │ gaps          │               │
                  ├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
Minor (2)         │  2 - LOW      │  4 - LOW      │  6 - MEDIUM   │  8 - MEDIUM   │ 10 - HIGH     │
(cosmetic,        │               │               │ Tooltip       │ CSS layout    │ Typos in      │
 minor UX)        │               │               │ positioning   │ shifts        │ dynamic       │
                  │               │               │               │               │ content       │
                  ├───────────────┼───────────────┼───────────────┼───────────────┼───────────────┤
Negligible (1)    │  1 - LOW      │  2 - LOW      │  3 - LOW      │  4 - LOW      │  5 - MEDIUM   │
(no user impact,  │ Legacy page   │ Admin-only    │               │ Console       │               │
 internal only)   │ styling       │ label         │               │ warnings      │               │
                  └───────────────┴───────────────┴───────────────┴───────────────┴───────────────┘
```

### How to Fill In the Matrix

1. **List all feature areas** of your product (aim for 15-30 entries)
2. **Score Impact (1-5):** What happens if this feature breaks in production?
   - 5: Revenue loss, data loss, compliance violation, security breach
   - 4: Major feature unusable, significant user frustration, support flood
   - 3: Feature partially broken, workaround exists, moderate user impact
   - 2: Cosmetic issue, minor inconvenience, few users affected
   - 1: No user-facing impact, internal tooling, already deprecated
3. **Score Likelihood (1-5):** How likely is a defect based on code complexity, change frequency, and history?
   - 5: Changes every sprint, complex logic, history of bugs
   - 4: Changes frequently, moderate complexity, occasional bugs
   - 3: Changes occasionally, some complexity
   - 2: Stable code, simple logic, rarely changes
   - 1: Static, trivial, or mature and battle-tested
4. **Multiply** to get the risk score
5. **Map to testing approach** using the Risk-to-Testing Action Map from the main SKILL.md

### Feature Inventory Template

| # | Feature Area | Impact (1-5) | Likelihood (1-5) | Risk Score | Risk Level | Testing Approach | Owner |
|---|-------------|-------------|-------------------|------------|------------|-----------------|-------|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |

Sort by Risk Score descending. The top entries get automated testing first.
