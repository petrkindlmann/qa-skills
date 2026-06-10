---
name: release-readiness
description: >-
  Validate release readiness with evidence-based go/no-go decisions. Covers go/no-go
  checklists, smoke test suite design, staged rollout validation, rollback criteria
  and procedures, and post-deployment verification. Ensures release confidence comes
  from data, not feelings. Use when: "release ready," "go/no-go," "smoke test,"
  "release checklist," "rollback plan," "staged rollout," "canary deploy."
  Not for: safe-release techniques (flags, canary, dark launch) applied during the
  rollout itself — use testing-in-production; scheduled probes that run continuously
  after release — use synthetic-monitoring; designing new tests from prod telemetry —
  use observability-driven-testing.
  Related: testing-in-production, qa-metrics, ci-cd-integration, ai-system-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: process
---

<objective>
"I think it's fine" ships the bug that the rollback you never practiced can't undo at 6 PM on a Friday. This skill turns "ready to ship" into something measurable: a go/no-go checklist with evidence for each item, a sub-5-minute smoke suite, a staged rollout with metric-gated promotion, rollback thresholds defined before deploy, and post-deployment verification. Every section gives concrete criteria, not aspirations.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything answered there. Then ask only what's missing.

**Release cadence and process:**
- How often do you release, and who makes the go/no-go call? (Continuous/daily/weekly vs engineering lead/QA lead/release manager — sets how heavyweight the checklist should be.)
- Is there a release train schedule or is it ad-hoc?
- How many environments exist between dev and production? (staging, pre-prod, canary)

**Current state:**
- What does the current go/no-go process look like, and is it documented?
- Has a release ever been rolled back? How long did it take? (Reveals whether rollback is real or aspirational.)
- What was the last release incident and its root cause? Any release-blocking bugs right now?

**Infrastructure and capabilities:**
- Do you have rollback capability, and how long does a rollback take?
- Can you do staged/canary deployments?
- Do you have feature flags, and how are they managed? (Decides flag-based vs infra-level rollout.)
- What monitoring and alerting is in place? Are database migrations reversible?

**Team and communication:**
- Who is on-call during and after releases?
- How are stakeholders notified, and is there a release communication channel?
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
If you wait until something is on fire to decide whether to roll back, you'll waste critical minutes debating. Define the criteria in advance, relative to baseline: "If error rate exceeds 2x baseline within 15 minutes, we roll back. No discussion needed." Tie the trigger to your DORA targets — a release whose error rate would push you past your change-failure-rate target, or whose recovery would blow your MTTR target, is one the rollback rule exists to stop.

### 5. Every release is a learning opportunity
Post-deployment verification isn't just about catching bugs. Track what went well, what was slow, what was stressful. Improve the process continuously.

---

## Go/No-Go Checklist

Use this as a template. Adapt it to your context. Every item should be verifiable with evidence, not just "I checked." Store the completed checklist as a versioned artifact (e.g. `RELEASE-<version>.md` or a tracked issue) so sign-off is auditable.

### Automated Checks (Must Pass)

- [ ] **All CI pipelines green** — Unit tests, integration tests, E2E tests, type checking, linting
- [ ] **Smoke test suite passes on staging** — Critical user journeys verified in the staging environment
- [ ] **No open P0/P1 bugs for this release** — Check issue tracker, filter by milestone/label
- [ ] **Performance budgets met** — API response times and bundle size within thresholds; Lighthouse CI for frontend releases (skip Lighthouse for API/backend-only releases — it measures page load, not service health)
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
3. **Core workflow** — The primary value-delivering action works (e.g., create a document, submit a form, add to cart or complete a purchase flow)
4. **Data retrieval** — Key data loads correctly (dashboard populates, search returns results, product page loads)
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
- Avoid unnecessary waits — use smart waiting (wait for element, not `sleep(3000)` / `waitForTimeout`)

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

Staging is not production: it has different data volumes, traffic patterns, third-party configurations, and infrastructure scale. That gap is exactly why production and post-deployment smoke tests exist on top of staging verification.

---

## Staged Rollout Validation

### Rollout Stages

A typical staged rollout. The same ladder expressed for flag-based rollouts adds a 25% step (see below):

| Stage | Traffic % | Duration | Purpose |
|-------|-----------|----------|---------|
| Canary | 1% | 15-30 min | Catch crashes, exceptions, obvious failures |
| Early adopters | 10% | 1-2 hours | Validate error rates, latency, business metrics |
| Partial rollout | 25-50% | 2-4 hours | Confirm stability at scale |
| Full rollout | 100% | — | Monitor for 24 hours post-deployment |

### What to Monitor Between Stages

Before promoting to the next stage, verify **all** of these:

**Error metrics:**
- Error rate (HTTP 5xx) is not higher than baseline
- Exception count is not higher than baseline
- No new error types appearing in logs

**Performance metrics:**
- P50 and P95 latency are within acceptable range (relative to baseline, not an absolute ceiling)
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

Define rules for automatic promotion between stages. Each gate combines an error-rate ceiling, a latency ceiling expressed **relative to baseline**, a stability window, and (at higher stages) business-metric guardrails. See `references/rollout-automation.md` for the full canary→10%→50%→100% promotion ruleset.

### Feature Flag Gradual Rollout

An alternative to infrastructure-level canary deploys:

1. Deploy new code to 100% with the feature flag OFF
2. Enable the flag for internal users first (dogfooding)
3. Enable for 1% of users (canary equivalent)
4. Gradually increase: 10%, 25%, 50%, 100%
5. Remove the flag after full rollout is stable for 1 week

**Advantages:** Faster rollback (just flip the flag), no infrastructure changes, can target specific user segments.

**Disadvantages:** Code complexity (branching logic), stale flags become tech debt, doesn't catch infrastructure issues.

#### Tooling

| Platform | Best at | Notes |
|----------|---------|-------|
| **LaunchDarkly** | Enterprise scale; Guarded Rollouts (auto-canary analysis, GA since May 2025); AI Configs for prompt/model rollouts; agent graphs | Acquired Highlight.io in 2025 — also offers observability tied to flags |
| **Statsig** | Experiment-first culture; Switchback experiments (Feb 2026 update) for two-sided marketplaces; auto-tune | Acquired by OpenAI Sept 2025; still operates independently as of mid-2026, but weigh acquisition/roadmap risk before a multi-year infrastructure bet |
| **GrowthBook** | OSS-first; stale-flag detection with code-reference scanning; SQL-based experimentation | Strong fit when you want to self-host and avoid vendor lock-in |
| **Unleash** | OSS, GitOps-style flag definition, environment scoping | Apache 2 license; Enterprise tier for SSO/audit |
| **Flagsmith** | Kill switches as first-class concept; canary alerts; OSS option | Published "what is a kill switch" + "release testing" guides 2026 |
| **Harness FME** (formerly Split) | Targeted rollouts + monitoring tied to deploy pipelines; warehouse-native experimentation + flag archiving (2026) | Rebranded after Harness acquisition |

Vendor-native canary analysis (LaunchDarkly Guarded Rollouts, Statsig Auto-tune, Flagger) is now common — if your platform offers it, prefer it over hand-rolled rollout-policy YAML. Given the vendor churn this table documents (Statsig→OpenAI, Split→Harness FME), prefer OpenFeature-compatible SDKs (CNCF spec; Harness FME and others now standardize on it) so flag tooling stays swappable.

#### Rolling Out AI/LLM Features

AI features need a distinct rollout pattern: prompt versions and model IDs are configurable separately from code, and a kill switch is mandatory.

1. Pin the prompt template version and model ID in your AI Configs platform (LaunchDarkly AI Configs, custom dataset, or feature-flag JSON).
2. Roll out the prompt/model combo behind a flag — internal first, then 1%, 10%, etc.
3. Watch eval metrics (hallucination rate, jailbreak success rate, cost per request) per cohort, not just error rate.
4. Cost guardrail: a budget circuit breaker that fails the feature open (graceful fallback) when a model's per-request cost spikes.
5. Kill switch: a single flag that disables the AI path and routes to a deterministic fallback or a "feature unavailable" state — testable in staging before launch.

See `ai-system-testing` for prompt-level eval test patterns and `testing-in-production` for canary metric design.

---

## Rollback Criteria and Process

### Automated Rollback Triggers

Define these thresholds BEFORE deployment. When any trigger fires, rollback begins automatically. All thresholds are relative to the measured baseline, not absolute ceilings.

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
- **Kill switch (fastest, prefer if available):** Flip the dedicated kill-switch flag for the affected feature. Distinct from a full code rollback — disables one capability without redeploy. Test the kill switch in staging before every release; an untested switch is not a switch.
- **Feature flag rollback:** Disable the feature flag for the new code path. Slower than a kill switch when both exist (rollout flag vs kill switch are different concerns).
- **Code rollback:** Revert to the previous deployment (re-deploy previous image/artifact). Use when the issue is not contained to a single flagged feature.
- **Database rollback:** Run backward migration if applicable. If migration is irreversible, skip this step and handle data separately.
- **Cache invalidation:** Clear CDN and application caches if the old version would serve stale/incorrect data.

**Step 3: Verify (< 5 minutes)**
- Run production smoke tests
- Verify error rate returns to baseline
- Check that the rolled-back version serves correctly

**Step 4: Communicate (< 10 minutes)**
- Notify the release channel using the rollback skeleton below
- Update status page if user-facing impact occurred
- Brief the support team

**Step 5: Investigate (next business day)**
- Root cause analysis
- Write a regression test that would have caught the issue
- Update the go/no-go checklist if a check was missing
- Schedule the fix and re-release

#### Rollback announcement skeleton

Drop this in the release channel during Step 4. For the full release + rollback templates, see `references/communication-templates.md`.

```
Subject: [Rollback] v{version} — {date} {time}
Status: ROLLED BACK
Reason: {one line — e.g. error rate 4x baseline within 8 min}
Impact: {who was affected, for how long}
Current state: Running previous version v{prev_version}
Next steps:
- Root cause investigation: {owner}
- Fix ETA: {estimate or "investigating"}
```

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

---

## Verification

Run these immediately after the deploy completes, smallest check first. Expand the error-tracker queries in `references/rollout-automation.md`.

```bash
# Health endpoint returns healthy
curl -s https://your-app.com/health | jq .

# Response time + status in one shot
curl -o /dev/null -s -w "HTTP %{http_code} in %{time_total}s\n" https://your-app.com

# New errors since deploy (Sentry CLI) — should be empty
sentry-cli issues list --project your-project --query "firstSeen:>15m"

# Datadog: compare 5xx count for the service before vs after deploy — must not increase
```

Pass criteria: health returns `healthy`, status is `200` within your latency budget, the Sentry query returns no new issues, and the post-deploy 5xx count is at or below the pre-deploy baseline.

---

## Anti-Patterns

### "It worked on staging"
Staging is not production — different data volumes, traffic patterns, third-party configurations, and infrastructure scale. Staging success is necessary but not sufficient evidence of readiness.
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
**Fix:** 2026 best practice is platform-level stale detection, not calendar reminders. Use GrowthBook stale-flag detection (code references), LaunchDarkly archive flow, or Flagsmith's flag age telemetry to surface flags whose code paths haven't been touched in N weeks. Pair with a quarterly review where flags older than the threshold are either archived or get a documented owner + reason to keep. Calendar dates rot; code-reference scans don't.

### Canary alerts that lie
Auto-rollback wired to a metric that's noisy, late-arriving, or partially aggregated. The alert fires (or doesn't) at the wrong time, and the team learns to mistrust it — so when the real incident arrives, the signal is ignored.
**Fix:** Treat the canary alert like any other test — it has a false-positive rate and a false-negative rate, and you measure both. Run a "shadow" period where the alert publishes its decision but doesn't actually rollback; compare its calls to ground truth for two weeks. Promote to auto-rollback only after the false-positive rate is below your tolerance. Reference: https://www.flagsmith.com/blog/when-canary-alerts-go-wrong

### Switchback experiments for two-sided systems
Standard A/B fails on marketplaces, ride-share, ad auctions, and other systems where the treatment group affects the control group through shared state. Splitting traffic 50/50 doesn't isolate the experiment — both sides see the same warped market.
**Fix:** Use a switchback design — alternate the entire system between control and treatment over short windows (minutes to hours). Statsig's Switchback experiments (Feb 2026) automate this for the common cases. Don't block release on a corrupted A/B test result; rerun with the right design. Reference: https://www.statsig.com/updates

---

## Done When

- Go/no-go checklist completed with evidence for each item and stored as a versioned artifact (e.g. `RELEASE-<version>.md` or a tracked issue), signed off by the named approver with a timestamp
- Smoke test suite run against the release candidate in staging — all tests pass (exit code 0)
- Rollback criteria documented as specific baseline-relative thresholds, and the rollback procedure practiced on staging at least once
- Staged rollout plan defined with traffic percentages, per-stage promotion criteria, and guardrail metrics for each stage
- Post-deployment verification commands run and passing (health 200, no new Sentry issues, 5xx count at or below baseline)

## Reference Files (in `references/`)

- **rollout-automation.md** — Automated canary→10%→50%→100% promotion criteria (baseline-relative) and post-deployment verification command snippets.
- **communication-templates.md** — Load when writing a release or rollback announcement: fill-in-the-blank release and rollback templates.

## Related Skills

- `testing-in-production` — Overlaps directly with progressive rollout. Go there for the safe-release *techniques* (flags, canary, dark launch, guardrail metrics) applied while shipping; come here for the go/no-go *decision* that gates the release.
- `synthetic-monitoring` — Scheduled probes that run continuously after release. Release-readiness covers the one-shot post-deploy verification window; synthetic-monitoring covers ongoing SLA validation.
- `qa-metrics` — Source of the DORA evidence (change failure rate, MTTR) and error/pass-rate numbers you cite in go/no-go decisions and rollback thresholds.
- `ci-cd-integration` — The CI pipeline must be green as a prerequisite; go there to build the pipeline, come here to gate on it.
- `ai-system-testing` — When releasing AI/LLM features: prompt-version eval tests and kill-switch design. The rollout pattern here points at it.
- `compliance-testing` — EU AI Act / EAA / GDPR requirements that may legally gate a release before go/no-go.
- `playwright-automation` — Smoke tests are often implemented here; go there for the test structure, come here for which journeys are smoke-critical.
- `quality-postmortem` — When a release goes wrong, the postmortem feeds the missing check back into this go/no-go checklist.
