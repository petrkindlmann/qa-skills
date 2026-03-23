---
name: release-readiness
description: >-
  Validate release readiness with evidence-based go/no-go decisions. Covers go/no-go
  checklists, smoke test suite design, staged rollout validation, rollback criteria
  and procedures, and post-deployment verification. Ensures release confidence comes
  from data, not feelings. Use when: "release ready," "go/no-go," "smoke test,"
  "release checklist," "rollback plan," "staged rollout," "canary deploy."
  Related: test-strategy, risk-based-testing, qa-metrics, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: process
---

# Release Readiness

A framework for evidence-based release decisions. Every section provides concrete criteria, checklists, and procedures so that "ready to ship" means something measurable.

---

## Discovery Questions

Ask these before designing a release process. The answers shape everything that follows.

**Release cadence and process:**
- How often do you release? (Continuous, daily, weekly, bi-weekly, monthly, quarterly)
- Who makes the go/no-go decision? (Engineering lead, QA lead, release manager, committee)
- Is there a release train schedule or is it ad-hoc?
- How many environments exist between dev and production? (staging, pre-prod, canary)

**Current state:**
- What does the current go/no-go process look like? Is it documented?
- Has a release ever been rolled back? How long did it take?
- What was the last release incident? What was the root cause?
- Are there release-blocking bugs right now?

**Infrastructure and capabilities:**
- Do you have rollback capability? How long does a rollback take?
- Can you do staged/canary deployments?
- Do you have feature flags? How are they managed?
- What monitoring and alerting is in place?
- Are database migrations reversible?

**Team and communication:**
- Who is on-call during and after releases?
- How are stakeholders notified of releases?
- Is there a release communication channel?
- How are release notes generated?

---

## Core Principles

### 1. Release confidence comes from evidence, not feelings

"I think it's fine" is not a go/no-go criterion. Evidence means: all CI pipelines green, smoke tests pass on staging, performance budgets met, no open P0/P1 bugs. If you can't point to data, you're not ready.

### 2. Smoke tests are the last safety net, not the only safety net

Smoke tests catch catastrophic failures. They are not a substitute for thorough testing throughout the development cycle. If your smoke test suite is the only thing between you and production, you have a process problem upstream.

### 3. Staged rollouts reduce blast radius

Deploying to 100% of users simultaneously means 100% of users are affected by any bug. Staged rollouts (canary, percentage-based, ring-based) let you catch issues when they affect 1% of users instead of all of them.

### 4. Rollback criteria must be defined BEFORE release

If you wait until something is on fire to decide whether to roll back, you'll waste critical minutes debating. Define the criteria in advance: "If error rate exceeds 2x baseline within 15 minutes, we roll back. No discussion needed."

### 5. Every release is a learning opportunity

Post-deployment verification isn't just about catching bugs. Track what went well, what was slow, what was stressful. Improve the process continuously.

---

## Go/No-Go Checklist

Use this as a template. Adapt it to your context. Every item should be verifiable with evidence, not just "I checked."

### Automated Checks (Must Pass)

- [ ] **All CI pipelines green** — Unit tests, integration tests, E2E tests, type checking, linting
- [ ] **Smoke test suite passes on staging** — Critical user journeys verified in the staging environment
- [ ] **No open P0/P1 bugs for this release** — Check issue tracker, filter by milestone/label
- [ ] **Performance budgets met** — Lighthouse CI, API response times, bundle size within thresholds
- [ ] **Security scan clean** — No high/critical vulnerabilities in `npm audit` / Snyk / Dependabot
- [ ] **API contract tests pass** — No breaking changes to public APIs
- [ ] **Visual regression tests pass** — No unintended visual changes
- [ ] **Accessibility checks pass** — axe-core scan shows no new violations

### Manual Checks (Verify Before Go)

- [ ] **Feature flags reviewed** — Document which flags are enabled/disabled in this release; confirm flag states for production
- [ ] **Monitoring and alerts configured** — New features have corresponding alerts (error rate, latency, business metrics)
- [ ] **Rollback plan documented and tested** — Written procedure exists; rollback has been practiced on staging
- [ ] **Database migrations tested** — Tested forward migration; backward migration verified if schema change is reversible
- [ ] **Third-party dependency changes reviewed** — New or upgraded external dependencies checked for breaking changes
- [ ] **Release notes prepared** — Changelog updated, stakeholder-facing summary written
- [ ] **On-call engineer identified** — Named person is available and has context on the release contents
- [ ] **Communication plan ready** — Stakeholders know the release is happening; support team briefed on changes
- [ ] **No conflicting releases** — Other teams aren't deploying simultaneously
- [ ] **Deploy window confirmed** — Not deploying during peak traffic or before a weekend (unless continuous deployment)

### Risk Assessment

- [ ] **Change scope categorized** — Small (config change, copy update), Medium (new feature, refactor), Large (architecture change, migration)
- [ ] **Blast radius estimated** — What percentage of users could be affected if something goes wrong?
- [ ] **Revert complexity assessed** — Can this be reverted in <5 minutes? Does reverting require a data migration?

---

## Smoke Test Suite Design

### What to Include

Smoke tests cover **critical user journeys only**. If these fail, the application is fundamentally broken.

**Typical smoke test suite (5-8 tests):**

1. **Application health** — Homepage loads, returns 200, no JavaScript errors in console
2. **Authentication** — User can log in with valid credentials, session is established
3. **Core workflow** — The primary value-delivering action works (e.g., create a document, submit a form, add to cart)
4. **Data retrieval** — Key data loads correctly (dashboard populates, search returns results)
5. **Payment/transaction** (if applicable) — Payment flow completes with test credentials
6. **API health** — Primary API endpoints return valid responses with correct schemas
7. **Navigation** — Critical navigation paths work (deep links, redirects, menu items)
8. **Error handling** — Application shows a user-friendly error page for invalid routes (404)

### What NOT to Include

- Edge cases (those belong in regression tests)
- Visual perfection (that belongs in visual regression tests)
- Performance benchmarks (that belongs in performance tests)
- Exhaustive form validation (that belongs in unit/integration tests)

### Keeping It Fast

Target: **under 5 minutes** for the entire smoke suite.

- Run tests in parallel where possible
- Use API calls instead of UI interactions for setup (create test user via API, not through registration form)
- Skip non-critical assertions (don't check exact copy text, check that elements exist)
- Use a dedicated test account with pre-created data (don't create data from scratch each run)
- Avoid unnecessary waits — use smart waiting (wait for element, not `sleep(3000)`)

### Environment-Specific Smoke Tests

**Staging smoke tests:**
- Full smoke suite (all 5-8 tests)
- Can use test payment providers
- Can test with feature flags in upcoming release configuration
- Can test database migrations

**Production smoke tests:**
- Subset of staging smoke tests (3-5 tests)
- Use synthetic test accounts (clearly labeled, won't affect analytics)
- Never test with real payment transactions (use sandbox mode or skip)
- Focus on: app loads, auth works, core read operations work, API responds

**Post-deployment smoke tests:**
- Run immediately after deploy completes (within 60 seconds)
- Same as production smoke tests
- If any fail, trigger alert and begin rollback evaluation

---

## Staged Rollout Validation

### Rollout Stages

A typical staged rollout:

| Stage | Traffic % | Duration | Purpose |
|-------|-----------|----------|---------|
| Canary | 1% | 15-30 min | Catch crashes, exceptions, obvious failures |
| Early adopters | 10% | 1-2 hours | Validate error rates, latency, business metrics |
| Partial rollout | 50% | 2-4 hours | Confirm stability at scale |
| Full rollout | 100% | — | Monitor for 24 hours post-deployment |

### What to Monitor Between Stages

Before promoting to the next stage, verify **all** of these:

**Error metrics:**
- Error rate (HTTP 5xx) is not higher than baseline
- Exception count is not higher than baseline
- No new error types appearing in logs

**Performance metrics:**
- P50 and P95 latency are within acceptable range
- No increase in timeout errors
- Database query times are stable

**Business metrics:**
- Conversion rate is not dropping
- User engagement (page views, actions) is stable
- Revenue/transaction volume is normal (if applicable)

**Infrastructure metrics:**
- CPU and memory usage are normal
- No increase in queue depth or message backlog
- No disk space issues from new logging

### Automated Promotion Criteria

Define rules for automatic promotion between stages:

```
Promote from canary (1%) to 10% when:
  - Error rate < 0.5% for 15 minutes
  - P95 latency < 500ms
  - No new exception types
  - Zero crash reports

Promote from 10% to 50% when:
  - Error rate < 0.5% for 1 hour
  - P95 latency < 500ms
  - Conversion rate within 5% of baseline
  - No customer-reported issues

Promote from 50% to 100% when:
  - Error rate < 0.5% for 2 hours
  - All business metrics within expected range
  - No rollback signals from any monitoring system
```

### Feature Flag Gradual Rollout

An alternative to infrastructure-level canary deploys:

1. Deploy new code to 100% with the feature flag OFF
2. Enable the flag for internal users first (dogfooding)
3. Enable for 1% of users (canary equivalent)
4. Gradually increase: 10%, 25%, 50%, 100%
5. Remove the flag after full rollout is stable for 1 week

**Advantages:** Faster rollback (just flip the flag), no infrastructure changes, can target specific user segments.

**Disadvantages:** Code complexity (branching logic), stale flags become tech debt, doesn't catch infrastructure issues.

---

## Rollback Criteria and Process

### Automated Rollback Triggers

Define these thresholds BEFORE deployment. When any trigger fires, rollback begins automatically.

| Metric | Threshold | Action |
|--------|-----------|--------|
| Error rate (5xx) | >2x baseline for 5 min | Auto-rollback |
| P95 latency | >3x baseline for 5 min | Auto-rollback |
| Health check | 3 consecutive failures | Auto-rollback |
| Crash rate (mobile) | >0.5% | Auto-rollback |
| Error budget | >50% burned in 1 hour | Auto-rollback |

### Manual Rollback Triggers

These require human judgment but should have clear guidelines:

- **Customer-reported critical issue** — Multiple users reporting the same problem
- **Data integrity concern** — Evidence of corrupted or incorrect data
- **Security vulnerability discovered** — Active exploitation or high-severity CVE
- **Monitoring blind spots** — You realize you can't monitor a critical metric for the new feature
- **On-call engineer judgment** — The on-call engineer always has authority to trigger a rollback

### Rollback Procedure

**Step 1: Decide (< 2 minutes)**
- Is the trigger automated or manual?
- If manual: does the issue meet rollback criteria? If yes, proceed. Don't debate.

**Step 2: Execute rollback (< 5 minutes)**
- **Code rollback:** Revert to the previous deployment (re-deploy previous image/artifact)
- **Feature flag rollback:** Disable the feature flag (fastest option if available)
- **Database rollback:** Run backward migration if applicable. If migration is irreversible, skip this step and handle data separately
- **Cache invalidation:** Clear CDN and application caches if the old version would serve stale/incorrect data

**Step 3: Verify (< 5 minutes)**
- Run production smoke tests
- Verify error rate returns to baseline
- Check that the rolled-back version serves correctly

**Step 4: Communicate (< 10 minutes)**
- Notify the release channel: "Release X.Y.Z rolled back due to [reason]. Investigating."
- Update status page if user-facing impact occurred
- Brief the support team

**Step 5: Investigate (next business day)**
- Root cause analysis
- Write a regression test that would have caught the issue
- Update the go/no-go checklist if a check was missing
- Schedule the fix and re-release

### Data Considerations

When a migration can't be rolled back:

- **Forward-fix:** Deploy a fix on top of the current (broken) version instead of rolling back
- **Dual-write:** During migration, write to both old and new schemas; rollback drops the new writes
- **Shadow migration:** Migrate in the background, validate, then cut over. Rollback just stops the cutover
- **Point-in-time recovery:** Restore database from backup (last resort, causes data loss for changes since backup)

---

## Post-Deployment Verification

### Immediate (0-15 minutes)

- [ ] Production smoke tests pass
- [ ] Error rate is at or below pre-deployment baseline
- [ ] No new exception types in error tracker
- [ ] Health check endpoints return healthy
- [ ] Key pages load correctly (spot check 2-3 pages manually)

### Short-term (15 minutes - 2 hours)

- [ ] Synthetic monitoring confirms all critical paths working
- [ ] Error rate trend is flat or declining (not increasing)
- [ ] P50 and P95 latency are within expected range
- [ ] No increase in support ticket volume
- [ ] Business metrics (conversions, revenue, signups) are normal
- [ ] No memory leaks or resource exhaustion trends

### Medium-term (2-24 hours)

- [ ] Overnight batch jobs complete successfully (if applicable)
- [ ] No time-zone-dependent issues surfacing as other regions wake up
- [ ] Email/notification delivery is normal
- [ ] Third-party integrations are functioning
- [ ] No gradual performance degradation

### Verification Commands

Quick checks you can run right after deployment:

```bash
# Check application health
curl -s https://your-app.com/health | jq .

# Check response time
curl -o /dev/null -s -w "HTTP %{http_code} in %{time_total}s\n" https://your-app.com

# Check for new errors in the last 15 minutes (Sentry CLI example)
sentry-cli issues list --project your-project --query "firstSeen:>15m"

# Compare error counts (Datadog example)
# Before deploy: note the 5xx count
# After deploy: check if 5xx count increased
```

---

## Anti-Patterns

### "It worked on staging"

Staging is not production. Staging has different data volumes, different traffic patterns, different third-party configurations, and different infrastructure scale. Staging success is necessary but not sufficient evidence of readiness.

**Fix:** Use production smoke tests and staged rollouts in addition to staging verification.

### No rollback plan

"We'll figure it out if something goes wrong" means you'll figure it out under pressure, sleep-deprived, with users complaining. That's when mistakes happen.

**Fix:** Document the rollback procedure. Practice it quarterly. Time it. Make it a checklist, not tribal knowledge.

### Deploying on Friday afternoon

You deploy at 4 PM on Friday. An issue surfaces at 6 PM. Your team is at dinner. The issue grows overnight. Monday morning is chaos.

**Fix:** Deploy early in the week, early in the day, when the full team is available to monitor. If you must deploy on Friday, deploy before noon with extra monitoring.

### Skipping smoke tests because "the pipeline is green"

CI pipelines test against test data in test environments. Smoke tests verify the deployed application works with production configuration, production data, and production infrastructure.

**Fix:** Smoke tests are non-negotiable. If they're slow, make them faster. If they're flaky, fix them. Never skip them.

### Big-bang releases instead of incremental

Accumulating 6 weeks of changes into one mega-release means: more things can break, harder to identify which change caused the issue, higher risk, longer rollback time, more stress.

**Fix:** Release smaller, more frequently. If you can't do continuous deployment, aim for weekly or bi-weekly releases with small, well-understood changesets.

### No post-deployment verification

You deploy and move on to the next feature. An hour later, users are experiencing errors that nobody is watching for.

**Fix:** Assign someone to monitor dashboards for 30-60 minutes post-deploy. Set up automated alerts with appropriate thresholds. Run post-deployment smoke tests.

### Rollback aversion

"We're so close to fixing it, let's just push a hotfix forward." Meanwhile, users are affected for another 45 minutes while you debug under pressure.

**Fix:** Roll back first, investigate second. A working previous version is better than a broken current version. Your ego can recover; user trust is harder to rebuild.

### Feature flag accumulation

You use feature flags for safe rollouts (good!) but never remove them (bad). After a year, you have 200 flags, nobody knows which are active, and flag interactions cause mysterious bugs.

**Fix:** Every feature flag has an expiration date. After full rollout + 1 week of stability, remove the flag. Track flag age in your issue tracker.

---

## Templates

### Release Communication Template

```
Subject: [Release] v{version} — {date}

Status: DEPLOYING / DEPLOYED / ROLLED BACK

Changes:
- {Summary of changes, 3-5 bullet points}

Risk Level: LOW / MEDIUM / HIGH
Rollback Plan: {Revert deploy / Disable feature flag / etc.}
On-Call: {Name, contact}

Monitoring Dashboard: {link}
Release Notes: {link}
```

### Rollback Communication Template

```
Subject: [Rollback] v{version} — {date} {time}

Status: ROLLED BACK

Reason: {Brief description of the issue}
Impact: {Who was affected, for how long}
Current State: Running previous version v{prev_version}

Next Steps:
- Root cause investigation: {owner}
- Fix ETA: {estimate or "investigating"}
- Re-release plan: {TBD after investigation}
```

---

## Related Skills

| Skill | Relationship |
|-------|-------------|
| `test-strategy` | Release readiness is the final stage of your overall test strategy |
| `qa-metrics` | Use metrics (error rates, test pass rates) as evidence in go/no-go decisions |
| `ci-cd-integration` | CI pipeline must be green as a prerequisite for release |
| `playwright-automation` | Smoke tests are often implemented with Playwright |
| `qa-ideas` | Browse for additional release validation tactics |
| `shift-left-testing` | The earlier you catch issues, the less you rely on release-time catches |
| `api-testing` | API contract and health checks are part of smoke test suites |
| `bug-reporting` | Structured bug reports speed up investigation when rollbacks happen |
