---
name: risk-based-testing
description: >-
  Identify high-risk areas via failure mode analysis, prioritize tests by business
  impact x likelihood, generate risk heatmaps, and align test coverage to risk levels.
  Includes stakeholder interview frameworks and continuous risk reassessment.
  Use when: "risk assessment," "what could break," "critical paths," "risk matrix,"
  "failure modes," "test prioritization," "where to focus testing."
  Related: test-strategy, test-planning, release-readiness, qa-metrics.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: strategy
---

<objective>
Identify what matters most, test it first, and allocate effort proportional to business risk. This skill provides a systematic framework for discovering risk, quantifying it, mapping test coverage to risk levels, and keeping the assessment current as the product evolves.
</objective>

---

## Discovery Questions

Before building a risk model, gather context from stakeholders across engineering, product, and operations. Check `.agents/qa-project-context.md` first -- if it exists, use it as the foundation and skip questions already answered there.

### Revenue-Critical Flows

- Which user flows directly generate revenue? (checkout, subscription, billing, upgrades)
- What is the revenue impact per hour of downtime for each flow?
- Are there time-sensitive flows? (flash sales, market-hours trading, payroll deadlines)
- Which flows have contractual SLAs with financial penalties?

### Recent Failures

- What broke in the last 3 releases? What escaped to production?
- What were the root causes? (code defect, config error, third-party failure, data migration)
- What was the blast radius of each incident? (users affected, revenue lost, reputation impact)
- Were there near-misses caught late in testing that could have escaped?

### Fragile Areas

- Which parts of the codebase change most frequently? (high churn = high risk)
- Which modules have the lowest test coverage today?
- Which areas have the most complex business logic or the most conditional branches?
- Which code was written by engineers who have since left the team?

### Third-Party Dependencies

- Which external services does the product depend on? (payment processors, auth providers, CDNs, APIs)
- What is the historical reliability of each dependency?
- What happens when each dependency goes down? (graceful degradation or hard failure?)
- Are there single points of failure with no fallback?

### Compliance and Data

- What regulatory requirements apply? (GDPR, PCI-DSS, HIPAA, SOC2, SOX)
- What data is most sensitive? (PII, financial, health, credentials)
- What are the legal consequences of a data breach or compliance violation?
- Are there audit requirements that mandate specific testing evidence?

---

## Core Principles

### 1. Not All Features Are Equal

A bug in the checkout flow that prevents purchases is categorically different from a misaligned icon on a settings page. Testing effort must reflect this reality. Equal coverage across all features wastes resources on low-risk areas while leaving critical paths under-tested.

### 2. Risk = Impact x Probability

Risk is not a gut feeling. It is a product of two measurable dimensions: how bad is it if this fails (impact), and how likely is it to fail (probability). Both must be assessed independently and scored consistently across the product.

### 3. Risk Assessment Is Continuous

A risk model created once and never updated is dangerous because it creates false confidence. Risk changes when the product changes, when dependencies change, when the team changes, and after every production incident. Build reassessment into the development rhythm.

### 4. Near-Misses Are Data

A bug caught in staging that would have been catastrophic in production is not a success story -- it is a signal that the risk model underestimated that area. Track near-misses with the same rigor as production incidents.

### 5. Risk Informs Coverage, Not the Other Way Around

Do not start with "we need 80% coverage everywhere." Start with "where would a failure hurt most?" and let the risk model drive coverage targets per module.

---

## Workflow

```
1. Identify → 2. Classify → 3. Analyze → 4. Heatmap → 5. Coverage → 6. Reassess → (repeat)
                                 ↑
                       score ≥ 10 only; skip to 4 if no items reach threshold
```

### Phase 1: Risk Identification

Enumerate everything that could go wrong. Cast a wide net. Sources include:

- **Stakeholder interviews:** Product managers know business-critical flows. Engineers know fragile code. Support knows recurring user complaints.
- **Incident history:** Past failures predict future failures. Review post-mortems from the last 6-12 months.
- **Dependency mapping:** List every external service, database, message queue, and third-party API. Each is a risk vector.
- **Change analysis:** Areas with frequent code changes (use `git log --stat`) have higher defect probability.
- **Architecture review:** Shared databases, single points of failure, synchronous chains, and tightly coupled modules amplify blast radius.

Output: A raw list of risk items, each describing what could fail and what the consequence would be.

### Phase 2: Risk Classification

Categorize each risk item along two axes.

**Impact categories (how bad is it):**

| Score | Level | Definition | Examples |
|-------|-------|-----------|----------|
| 5 | Catastrophic | Revenue loss, data breach, legal action, user safety | Payment processing fails, PII exposed |
| 4 | Major | Significant user impact, SLA violation, major feature broken | Login broken for segment, data corruption |
| 3 | Moderate | Workflow disrupted, workaround exists | Search returns wrong results, export fails |
| 2 | Minor | Cosmetic or minor UX issue | Alignment bug, slow non-critical page |
| 1 | Negligible | No user impact, internal only | Admin tooltip wrong, log format issue |

**Probability categories (how likely is it):**

| Score | Level | Definition | Indicators |
|-------|-------|-----------|-----------|
| 5 | Frequent | Expected in most releases | High code churn, no tests, complex logic |
| 4 | Likely | Will probably happen within a quarter | Recent changes, partial coverage, known tech debt |
| 3 | Possible | Could happen, has happened before | Moderate complexity, some coverage |
| 2 | Unlikely | Improbable but not impossible | Stable code, good coverage, simple logic |
| 1 | Rare | Requires exceptional circumstances | Well-tested, rarely changed, simple |

### Phase 3: Failure Mode Analysis

For each high-risk item (score >= 10), perform a detailed failure mode analysis.

> **AI/LLM-specific failure classes** (from ISTQB CT-GenAI v1.1, April 2026):
> - **Hallucination / reasoning error** — Impact: moderate to major; Probability: high without explicit prompt-eval coverage. Detection: golden-dataset evals, fact-check assertions (see `ai-system-testing`).
> - **Bias** — Impact: catastrophic in regulated industries (finance, healthcare, hiring). Probability: dataset-dependent. Detection: counterfactual evals, demographic-parity checks.
> - **Prompt injection / jailbreak** — Impact: major (data exfiltration, prompt extraction). Probability: high for any externally-facing LLM feature. Detection: Garak, PyRIT, Promptfoo redteam.
> - **Privacy leak** — Impact: catastrophic under GDPR/CCPA/EU AI Act. Probability: dataset-dependent. Detection: PII scanning of training and prompts.
> - **AI Act / regulatory non-compliance** — Impact: catastrophic (fines, ban). Probability: high for EU-facing AI features. Detection: see `compliance-testing`.

For these classes, treat the existence of an automated eval suite as the mitigation, not a single test.

#### Reference Frameworks

- **HTSM v6.3** (Heuristic Test Strategy Model, Bach) — emphasizes state-based testing and boundary heuristics. Use as a Phase-1 lens when enumerating risks. https://www.satisfice.com/download/heuristic-test-strategy-model
- **CT-GenAI v1.1** (ISTQB, April 2026) — codifies the AI/LLM risk classes above.
- **WQR 2025-26** (Capgemini) — adoption-stage framing for AI risk planning.

**Failure Mode Analysis Template:**

```
Feature/Component: [name]
Risk Score: [impact x probability]

Failure Mode 1: [what specifically can fail]
  Trigger:          [what causes this failure]
  Blast Radius:     [users affected, systems affected, data affected]
  Detection Method: [how would we know this happened -- monitoring, user report, test]
  Current Mitigation: [existing tests, monitoring, feature flags, fallbacks]
  Gap:              [what is missing from current mitigation]

Failure Mode 2: ...
```

**Example -- E-commerce Checkout:**

```
Feature/Component: Checkout Flow
Risk Score: 20 (Impact: 5, Probability: 4)

Failure Mode 1: Payment charge succeeds but order not recorded
  Trigger:          Race condition between payment API callback and order write
  Blast Radius:     Individual users; money charged but no order confirmation
  Detection Method: Payment reconciliation job (runs hourly), user complaint
  Current Mitigation: Idempotency key on payment, retry on order write
  Gap:              No automated test for the race condition; reconciliation delay is 1 hour

Failure Mode 2: Discount code applies incorrect amount
  Trigger:          Percentage discount on already-discounted item
  Blast Radius:     All users with stacked discounts; revenue leakage
  Detection Method: Margin monitoring alert (>5% deviation)
  Current Mitigation: Unit tests for single discounts
  Gap:              No tests for discount stacking; no tests for rounding edge cases

Failure Mode 3: Inventory not reserved during checkout
  Trigger:          Concurrent purchases of last-stock item
  Blast Radius:     Oversold items, fulfillment failure, customer trust
  Detection Method: Fulfillment team discovers during packing
  Current Mitigation: Database-level stock check on order creation
  Gap:              No load test simulating concurrent last-item purchases
```

### Phase 4: Risk Heatmap

Visualize all risk items on a 5x5 matrix to communicate priorities to stakeholders and drive coverage decisions.

#### Risk Heatmap Template

```
                    PROBABILITY
                    Rare(1)   Unlikely(2)  Possible(3)  Likely(4)   Frequent(5)
                   +----------+-----------+-----------+----------+-----------+
  Catastrophic(5)  |  5  MED  | 10  HIGH  | 15  CRIT  | 20 CRIT  | 25  CRIT  |
                   +----------+-----------+-----------+----------+-----------+
  Major(4)         |  4  LOW  |  8  MED   | 12  HIGH  | 16 CRIT  | 20  CRIT  |
I                  +----------+-----------+-----------+----------+-----------+
M  Moderate(3)     |  3  LOW  |  6  MED   |  9  MED   | 12 HIGH  | 15  CRIT  |
P                  +----------+-----------+-----------+----------+-----------+
A  Minor(2)        |  2  LOW  |  4  LOW   |  6  MED   |  8 MED   | 10  HIGH  |
C                  +----------+-----------+-----------+----------+-----------+
T  Negligible(1)   |  1  LOW  |  2  LOW   |  3  LOW   |  4 LOW   |  5  MED   |
                   +----------+-----------+-----------+----------+-----------+
```

**Color coding and action mapping:**

| Zone | Score Range | Color | Testing Action |
|------|------------|-------|---------------|
| CRITICAL | 15-25 | Red | Automate fully + monitor in production + load test + manual exploratory |
| HIGH | 10-14 | Orange | Automate fully + periodic manual review |
| MEDIUM | 5-9 | Yellow | Automate happy path + key error cases |
| LOW | 1-4 | Green | Manual testing on release or skip entirely |

#### Populated Heatmap Example

```
                    Rare(1)   Unlikely(2)  Possible(3)  Likely(4)   Frequent(5)
                   +----------+-----------+-----------+----------+-----------+
  Catastrophic(5)  |          | Auth      | Payments  | Checkout |           |
                   |          | bypass    | fail      | crash    |           |
                   +----------+-----------+-----------+----------+-----------+
  Major(4)         |          |           | Data      | Search   | User      |
                   |          |           | export    | broken   | upload    |
                   +----------+-----------+-----------+----------+-----------+
  Moderate(3)      |          | Report    | Email     | Profile  |           |
                   |          | format    | delivery  | edit     |           |
                   +----------+-----------+-----------+----------+-----------+
  Minor(2)         | Footer   | Tooltip   | Theme     |          |           |
                   | link     | text      | switch    |          |           |
                   +----------+-----------+-----------+----------+-----------+
  Negligible(1)    | Admin    |           |           |          |           |
                   | label    |           |           |          |           |
                   +----------+-----------+-----------+----------+-----------+
```

### Phase 5: Test Coverage Alignment

Map test density to risk level. Every risk zone gets a prescribed testing approach.

#### Coverage Requirements by Risk Zone

| Risk Zone | Unit Tests | Integration Tests | E2E Tests | Manual Testing | Monitoring |
|-----------|-----------|------------------|-----------|---------------|-----------|
| CRITICAL (15-25) | 90%+ branch coverage | All service boundaries | Full user journey + error paths | Exploratory each release | Real-time alerts, synthetic checks |
| HIGH (10-14) | 80%+ branch coverage | Key interactions | Happy path + top 3 error paths | Spot checks | Dashboard + daily review |
| MEDIUM (5-9) | 70%+ branch coverage | Happy path only | Happy path only | On major changes | Weekly review |
| LOW (1-4) | Basic happy path | None required | None required | On initial build | None required |

#### Gap Identification

Compare current coverage against required coverage per risk zone:

```
Gap Analysis Worksheet:

Feature: [name]
Risk Zone: [CRITICAL / HIGH / MEDIUM / LOW]
Risk Score: [number]

Required Coverage:
  Unit:        [target %]     Current: [actual %]     Gap: [delta]
  Integration: [required?]    Current: [exists? y/n]  Gap: [missing scenarios]
  E2E:         [required?]    Current: [exists? y/n]  Gap: [missing flows]
  Monitoring:  [required?]    Current: [exists? y/n]  Gap: [missing alerts]

Priority: [P0 / P1 / P2 / P3]
Estimated Effort: [hours / story points]
Owner: [name]
Target Sprint: [sprint number]
```

### Phase 6: Monitoring and Reassessment

Risk assessment is not a one-time activity. Build reassessment into the team's rhythm.

**Reassessment triggers:**

- After every production incident (within 48 hours)
- When a new feature area is introduced
- When a critical dependency changes (API version, provider switch)
- When team composition changes significantly
- Quarterly at minimum, even without triggers

**Continuous risk signals to monitor:**

- **Code churn by module:** `git log --since="3 months ago" --format='' --name-only | sort | uniq -c | sort -rn | head -20`
- **Defect clustering:** Which modules produce the most bugs? Track with issue labels.
- **Near-miss frequency:** How often do staging/QA catches prevent production incidents?
- **Dependency health:** Monitor status pages and uptime of critical third-party services.
- **Coverage trends:** Is coverage increasing or decreasing in high-risk areas?

---

## Real-World Examples

### Example 1: E-commerce Checkout

**Risk profile:** Impact 5, Probability 4, Score 20 (CRITICAL)

**Failure modes identified:**
- Payment charged but order not created (race condition)
- Discount stacking applies incorrect total
- Inventory oversold under concurrent load
- Shipping calculator returns wrong rate for international addresses
- Tax calculation wrong for specific jurisdictions

**Test coverage prescribed:**
- Unit tests: discount calculation (all combinations), tax rules (per jurisdiction), inventory decrement logic
- Integration tests: payment gateway communication (success, failure, timeout, duplicate), order creation pipeline, inventory reservation under concurrency
- E2E tests: full checkout flow (guest + logged in), checkout with discount, checkout with international shipping, checkout retry after payment failure
- Load tests: 100 concurrent checkouts for last-stock item
- Monitoring: real-time order completion rate, payment-to-order reconciliation every 5 minutes, revenue anomaly detection

### Example 2: Content Loading (Media Platform)

**Risk profile:** Impact 4, Probability 3, Score 12 (HIGH)

**Failure modes identified:**
- CDN cache miss causes origin overload
- Video transcoding fails silently for specific codecs
- Thumbnail generation timeout leaves blank images
- Content recommendation engine returns stale or empty results

**Test coverage prescribed:**
- Unit tests: transcoding pipeline input validation, recommendation scoring algorithm
- Integration tests: CDN purge/refresh flow, transcoding job queue processing, thumbnail generation for each supported format
- E2E tests: content upload through playback, content discovery through recommendation click
- Monitoring: CDN hit ratio, transcoding failure rate, thumbnail generation latency p99

### Example 3: Third-Party API Integration

**Risk profile:** Impact 4, Probability 4, Score 16 (CRITICAL)

**Failure modes identified:**
- API rate limit exceeded during peak traffic
- API response schema changes without notice (breaking deserialization)
- API timeout causes cascade failure in synchronous call chain
- API returns 200 with error body (non-standard error handling)

**Test coverage prescribed:**
- Unit tests: response parser for all known response shapes including malformed responses, rate limit backoff calculation, circuit breaker state transitions
- Integration tests: API contract tests (validate response schema against expected shape), timeout handling, retry behavior, circuit breaker activation
- E2E tests: user flow when API is slow (degraded but functional), user flow when API is down (graceful fallback)
- Monitoring: API response time p50/p95/p99, error rate, rate limit proximity, circuit breaker state

### Example 4: Authentication Flows

**Risk profile:** Impact 5, Probability 2, Score 10 (HIGH)

**Failure modes identified:**
- Session token not invalidated on password change
- OAuth callback race condition allows account takeover
- MFA bypass through API endpoint that skips MFA check
- Rate limiting not enforced on login endpoint (brute force)

**Test coverage prescribed:**
- Unit tests: token generation and validation, password hashing, MFA code verification, rate limit counter logic
- Integration tests: full auth flow (register, login, logout, password reset), session invalidation on credential change, OAuth flow with all supported providers, MFA enrollment and verification
- E2E tests: login flow (valid credentials, invalid, locked account), password reset flow, MFA flow
- Security tests: brute force attempt (verify rate limiting), session fixation, token reuse after logout
- Monitoring: failed login rate spike, unusual session patterns, MFA bypass attempts

---

## Anti-Patterns

### Testing Everything Equally

Applying the same coverage targets and test density to every feature regardless of risk. A 90% coverage target on a settings page wastes effort that should go toward payment processing or authentication. Let the risk model drive allocation.

### One-Time Risk Assessment

Creating a risk matrix during planning and never updating it. The product, team, and dependencies all change continuously. A risk model from 6 months ago does not reflect today's reality. Schedule reassessment and enforce it.

### Ignoring Near-Misses

Treating bugs caught in staging or QA as pure successes. Near-misses are risk signals. If a critical bug was caught only by manual testing in staging, that means the automated safety net has a gap. Document near-misses and adjust the risk model.

### Risk Theater

Going through the motions of risk assessment (filling in matrices, creating heatmaps) without actually changing test allocation. If the risk heatmap exists but test coverage does not align to it, the exercise was wasted. Verify alignment quarterly.

### Anchoring on Historical Risk

Over-weighting past incidents and under-weighting new risk vectors. A module that failed 2 years ago and has since been rewritten may no longer be high risk. Conversely, a new integration with a third party has unknown risk that deserves attention.

### Confusing Severity with Priority

Severity measures how bad a failure is. Priority measures how urgently to test it. A catastrophic but extremely rare failure (earthquake destroys data center) might be lower priority than a moderate but frequent failure (search results occasionally wrong). The risk matrix accounts for both dimensions -- use the composite score, not impact alone.

---

## Done When

- A risk matrix exists with every in-scope feature scored on both impact (1-5) and probability (1-5) axes
- Each feature's composite risk score places it in a named zone (CRITICAL, HIGH, MEDIUM, or LOW) with a corresponding testing action assigned
- Features scoring 10+ have a completed failure mode analysis with blast radius, detection method, and coverage gap documented
- Test coverage requirements per risk zone are mapped against current coverage, with gaps explicitly listed and assigned to an owner and target sprint
- Reassessment triggers and cadence are documented (quarterly minimum, plus post-incident)

## Related Skills

- **test-strategy** -- The overall QA strategy document that risk-based testing feeds into; risk assessment is one component of a broader strategy.
- **test-planning** -- Sprint-level test planning uses risk priorities to decide what to test in each iteration.
- **release-readiness** -- Release go/no-go decisions should reference the risk heatmap to ensure critical areas are covered.
- **qa-metrics** -- Defect escape rate and defect clustering metrics feed back into risk reassessment.
- **qa-project-context** -- The project context file captures risk-relevant information (critical flows, known fragile areas, dependencies) that this skill consumes.
