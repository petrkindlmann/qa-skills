---
name: ai-bug-triage
description: >-
  Hybrid fingerprint + LLM pipeline for bug classification, deduplication, and ticket
  generation. Normalizes CI logs, creates stable fingerprints, clusters near-duplicates,
  then uses LLM for severity classification and ticket writing. Includes bug reporting
  templates and severity/priority matrix. Use when: "bug triage," "classify bugs,"
  "failure analysis," "auto-classify," "CI failures," "bug report," "defect template."
  Related: qa-metrics, qa-dashboard, ci-cd-integration, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: ai-qa
---

<objective>
A hybrid pipeline for bug classification, deduplication, and ticket generation. Deterministic fingerprinting handles deduplication (what LLMs are bad at); LLM handles explanation, severity assessment, and ticket writing (what LLMs are good at).

**Key reframe:** The LLM is best at explaining and routing, not deduplication. Teach agents to DESIGN the pipeline, not BE the pipeline.
</objective>

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains tech stack, component mapping, and known flaky areas that improve classification accuracy.

---

## Discovery Questions

Before building or using a triage pipeline, clarify:

1. **What is the failure source?**
   - CI pipeline logs (GitHub Actions, GitLab CI, Jenkins, CircleCI)
   - Test framework output (Playwright, Jest, pytest, Vitest)
   - Production error monitoring (Sentry, Datadog, Bugsnag)
   - Manual bug reports from QA or users

2. **What is the ticket destination?**
   - Jira, Linear, GitHub Issues, Azure DevOps, Shortcut
   - What fields are required? (component, severity, priority, labels)
   - What workflows exist? (triage board, auto-assignment rules)

3. **What is the deduplication scope?**
   - Same test run? Same sprint? Same release? All time?
   - Do you already have fingerprinting? What is the current duplicate rate?

4. **What approval workflow is needed?**
   - Auto-create tickets with human review?
   - Suggest tickets for human approval before creation?
   - Auto-close duplicates? (dangerous -- require approval)

5. **What historical data exists?**
   - Past bug reports with resolution data?
   - Flaky test history? Known environment issues?
   - Component ownership mapping?

---

## Core Principles

1. **Deterministic first, LLM second.** Use stable, reproducible fingerprinting for deduplication and clustering. Use LLM only for tasks requiring understanding: severity classification, root cause hypothesis, and human-readable ticket writing.

2. **Normalize before comparing.** Raw CI logs are full of timestamps, port numbers, process IDs, and random suffixes that make identical failures look different. Strip all noise before fingerprinting.

3. **Fingerprints are anchored to stable elements.** Exception type, top stack frames, test name, error message template, and URL pattern are stable. Timestamps, request IDs, and ephemeral ports are not.

4. **Human approval before destructive actions.** Auto-closing a ticket as duplicate or auto-merging reports requires human confirmation. False deduplication wastes more time than manual triage.

5. **Classification drives routing.** The value of triage is not the label itself but the routing decision it enables: which team, what priority, what SLA.

6. **Track triage accuracy.** Measure how often auto-classification matches human judgment. Below 85% accuracy, the pipeline needs tuning.

---

## The Pipeline

```
CI Log / Error Report
  │
  ▼
Step 1: NORMALIZE
  Strip timestamps, process IDs, ports, random suffixes, ANSI codes
  │
  ▼
Step 2: EXTRACT STABLE ANCHORS
  Exception type, top N stack frames, test name, error message template, URL pattern
  │
  ▼
Step 3: HASH CANONICAL FORM
  Deterministic fingerprint from ordered anchors
  │
  ▼
Step 4: CLUSTER NEAR-DUPLICATES
  Similarity scoring for non-identical but related failures
  │
  ▼
Step 5: LLM CLASSIFY
  Severity, component, suspected root cause, failure category
  │
  ▼
Step 6: LLM GENERATE TICKET
  Title, description, repro steps, evidence, suggested assignee
  │
  ▼
Step 7: HUMAN APPROVAL
  Review before create/close/merge
```

### Step 1: Normalize

Strip noise that makes identical failures look different.

**Normalization rules (apply in order):**

```
1. Strip ANSI color codes:        \x1b\[[0-9;]*m → ""
2. Strip timestamps:              \d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*Z? → "<TIMESTAMP>"
3. Strip UUIDs:                   [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} → "<UUID>"
4. Strip process IDs:             pid[=: ]\d+ → "pid=<PID>"
5. Strip port numbers:            :\d{4,5}(?=[\s/]) → ":<PORT>"
6. Strip temp file paths:         /tmp/[^\s]+ → "<TMPPATH>"
7. Strip memory addresses:        0x[0-9a-f]{8,16} → "<ADDR>"
8. Strip random suffixes:         [-_][a-z0-9]{6,8}(?=\.) → "<RAND>"
9. Strip request IDs:             (?:request[_-]?id|trace[_-]?id|correlation[_-]?id)[=: ]["']?[a-zA-Z0-9-]+ → "<REQ_ID>"
10. Collapse whitespace:          \s+ → " "
```

**Example:**

```
Before: 2025-03-22T14:32:01.456Z [pid=42891] Error: Connection refused at 127.0.0.1:54321
        request_id=abc-123-def-456
After:  <TIMESTAMP> [pid=<PID>] Error: Connection refused at 127.0.0.1:<PORT>
        <REQ_ID>
```

### Step 2: Extract Stable Anchors

From the normalized log, extract elements that identify the failure regardless of environment or timing.

**Anchor types (in priority order):**

| Anchor | Example | Stability |
|--------|---------|-----------|
| Exception type | `TypeError`, `AssertionError`, `HTTP 500` | Very high |
| Error message template | `Cannot read property 'X' of undefined` | High |
| Top 3 stack frames | `at processOrder (order.ts:142)` | High |
| Test name | `checkout.spec.ts > completes payment` | Very high |
| URL pattern | `POST /api/orders` | High |
| HTTP status code | `500`, `429`, `503` | Very high |
| Exit code | `exit code 1`, `SIGKILL` | High |
| Assertion diff | `Expected: 200, Received: 500` | Medium |

**Extraction rules:**
- Keep function names but strip line numbers (they change with edits)
- Keep URL paths but strip query parameters and IDs in paths (`/api/orders/<ID>`)
- Keep error message structure but replace dynamic values with placeholders
- Keep test file and test name exactly as-is

### Step 3: Hash Canonical Form

Create a deterministic fingerprint from the extracted anchors.

**Algorithm:**

```
1. Sort anchors alphabetically by type
2. Concatenate: exception_type + "|" + message_template + "|" + top_frames + "|" + test_name
3. SHA-256 hash the concatenated string
4. Take first 16 hex characters as fingerprint
```

**Fingerprint properties:**
- Same failure always produces same fingerprint (deterministic)
- Different failures produce different fingerprints (collision-resistant)
- Minor log format changes do not change fingerprint (stable)
- Fingerprint is short enough for Jira labels and GitHub tags

**Example:**

```
Anchors:
  exception_type: "TypeError"
  message_template: "Cannot read property 'vendorId' of undefined"
  top_frames: "processOrder|groupByVendor|checkout"
  test_name: "checkout.spec.ts > multi-vendor checkout"

Canonical: "TypeError|Cannot read property 'vendorId' of undefined|processOrder|groupByVendor|checkout|checkout.spec.ts > multi-vendor checkout"
Fingerprint: a3f8b2c1e9d04567
```

### Step 4: Cluster Near-Duplicates

Exact fingerprint matching catches identical failures. Similarity scoring catches related failures that differ slightly (same root cause, different manifestation).

**Similarity dimensions:**

| Dimension | Weight | Match Criteria |
|-----------|--------|---------------|
| Exception type | 0.30 | Exact match |
| Error message | 0.25 | Levenshtein distance < 20% of message length |
| Stack frames | 0.25 | Jaccard similarity of top 5 frames > 0.6 |
| Component/file | 0.10 | Same directory or module |
| Test name | 0.10 | Same describe block or test file |

**Clustering threshold:** similarity score > 0.75 = likely duplicate, suggest merge.

**Human review required for:**
- Scores between 0.60 and 0.75 (ambiguous)
- First occurrence of a new fingerprint (no history to compare)
- Failures in components with known intermittent issues

### Step 5: LLM Classify

After deterministic fingerprinting and clustering, use LLM to classify the failure.

**LLM classification prompt:**

```
Given this normalized failure:

Exception: [TYPE]
Message: [MESSAGE]
Stack trace (top 5 frames): [FRAMES]
Test name: [TEST]
CI context: [branch, commit, runner OS]

Classify this failure:

1. **Failure category:** test bug | application bug | environment issue | flaky test | build failure
2. **Severity:** critical | major | minor | trivial (see severity matrix below)
3. **Component:** [infer from stack trace and file paths]
4. **Suspected root cause:** [1-2 sentence hypothesis]
5. **Confidence:** high | medium | low

If confidence is low, explain what additional information would help.
```

**Failure categories (see references/ci-failure-analysis.md for detail):**

| Category | Description | Typical Action |
|----------|-------------|---------------|
| Application bug | The app is broken | File bug ticket, assign to owning team |
| Test bug | The test is wrong | Fix the test, no app change needed |
| Environment issue | CI infra / network / service down | Retry, notify infra team |
| Flaky test | Intermittent, non-deterministic | Quarantine, investigate root cause |
| Build failure | Compilation, dependency, config | Fix build, usually blocking |

### Step 6: LLM Generate Ticket

Once classified, use LLM to generate a human-quality bug ticket.

**Ticket generation prompt:**

```
Generate a bug ticket from this classified failure:

Failure category: [CATEGORY]
Severity: [SEVERITY]
Component: [COMPONENT]
Fingerprint: [HASH]
Suspected root cause: [HYPOTHESIS]

Normalized error:
[NORMALIZED ERROR WITH CONTEXT]

Original log excerpt (last 30 lines before failure):
[LOG EXCERPT]

Related failures (same cluster):
[LIST OF SIMILAR FINGERPRINTS WITH DATES]

Generate:
1. **Title:** concise, searchable, includes component name (under 80 chars)
2. **Description:** what happened, in plain language
3. **Steps to reproduce:** derived from test name and log context
4. **Evidence:** relevant log lines, assertion diffs, screenshots if available
5. **Suggested labels:** [component, severity, failure-category]
6. **Suggested assignee:** based on component ownership (if known)
```

### Step 7: Human Approval

**No automated action without review.** The pipeline suggests; humans decide.

**Approval decisions:**
- **Create ticket** — New failure, clear root cause, assign to team
- **Merge into existing** — Duplicate of known issue, add evidence to existing ticket
- **Quarantine test** — Flaky test, not an app bug, quarantine and schedule investigation
- **Retry and monitor** — Environment issue, retry CI, alert if persists
- **Dismiss** — Known issue already fixed in pending deploy, or test bug with obvious fix

---

## Severity/Priority Matrix

Severity measures impact. Priority measures urgency. They are independent dimensions.

### Severity Definitions

| Severity | Definition | Examples |
|----------|-----------|---------|
| **Critical** | System unusable, data loss, security breach, no workaround | Payment processing fails, user data exposed, app crashes on launch |
| **Major** | Core feature broken, degraded experience, workaround exists | Search returns wrong results, checkout requires page reload, form data lost on back-button |
| **Minor** | Non-core feature affected, cosmetic with functional impact | Sorting does not persist, tooltip clipped on mobile, secondary action fails |
| **Trivial** | Cosmetic only, no functional impact | Typo in label, 1px alignment, inconsistent capitalization |

### Priority Definitions

| Priority | Definition | SLA (example) |
|----------|-----------|---------------|
| **P0** | Fix immediately, blocks release or production | Same day |
| **P1** | Fix this sprint, significant user impact | This sprint |
| **P2** | Fix next sprint, moderate impact | Next sprint |
| **P3** | Fix when convenient, low impact | Backlog |

### Severity x Priority Decision Guide

| | Critical | Major | Minor | Trivial |
|---|---------|-------|-------|---------|
| **Affects all users** | P0 | P0 | P1 | P2 |
| **Affects segment (>10%)** | P0 | P1 | P2 | P3 |
| **Affects few users (<10%)** | P1 | P1 | P2 | P3 |
| **Edge case only** | P1 | P2 | P3 | P3 |

---

## Bug Report Template

Use this template for any bug report, whether auto-generated or human-written.

```markdown
## [Component] Brief description of the defect

**Severity:** Critical | Major | Minor | Trivial
**Priority:** P0 | P1 | P2 | P3
**Component:** [module/service/page]
**Environment:** [OS, browser, deploy environment]
**Fingerprint:** [if auto-generated: hash ID]
**Reporter:** [person or "auto-triage pipeline"]

### Description
[1-3 sentences: what is broken, who is affected, what is the business impact]

### Steps to Reproduce
1. [Precondition: user role, data state]
2. [Navigate to / call endpoint]
3. [Perform action]
4. [Observe failure]

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens — include error messages verbatim]

### Evidence
- **Error log:** [relevant lines]
- **Screenshot:** [if applicable]
- **Assertion diff:** [expected vs actual values]
- **Trace/request ID:** [for distributed tracing]

### Frequency
- [Always | Intermittent (N/M runs) | Once observed]
- First seen: [date/commit]
- Last seen: [date/commit]

### Suggested Root Cause
[Hypothesis based on evidence — helps developer investigation]

### Related Issues
- [Links to similar/duplicate tickets]
- [Links to related PRs or deployments]
```

---

## Deduplication Patterns

| Pattern | Detection | Action |
|---------|-----------|--------|
| **Exact duplicate** | Same fingerprint | Merge into existing ticket, add evidence |
| **Near-duplicate** | Same cluster (similarity > 0.75) | Link tickets, suggest merge for human review |
| **Same root cause, different symptom** | Same exception type + overlapping frames in different tests | Create parent ticket linking symptom tickets |
| **Regression of fixed bug** | Fingerprint matches closed ticket | Reopen ticket, flag as regression, increase priority |
| **Flaky recurrence** | Same fingerprint intermittently across CI runs | Tag as flaky, quarantine if rate > 10% |

---

## CI Failure Analysis

See `references/ci-failure-analysis.md` for comprehensive patterns. Key decision: consistent failure = test bug or app bug; intermittent failure = flaky test or environment; multiple failures at once = environment or shared component; build failure = code or dependency issue.

---

## Integration Patterns

### GitHub Issues

```bash
# Create issue with labels from pipeline output
gh issue create \
  --title "[Checkout] Payment fails for multi-vendor carts" \
  --body "$(cat ticket-body.md)" \
  --label "bug,severity:critical,component:checkout" \
  --assignee "@me"

# Check for duplicate by fingerprint
gh issue list --label "fingerprint:a3f8b2c1" --state all
```

### CI Pipeline Integration

```yaml
# GitHub Actions: run triage on test failure
- name: Triage failures
  if: failure()
  run: |
    node scripts/extract-failures.js test-results/
    node scripts/triage-pipeline.js --input failures.json --output tickets/
    for ticket in tickets/*.json; do
      gh issue create --title "$(jq -r .title $ticket)" \
        --body "$(jq -r .body $ticket)" \
        --label "$(jq -r '.labels | join(",")' $ticket)"
    done
```

For Jira, Linear, and Azure DevOps integration, use their respective REST/GraphQL APIs with the same ticket data generated by Step 6. The pipeline output is tracker-agnostic -- it produces title, description, labels, severity, and component that map to any tracker's fields.

### Buy vs Build

Before implementing the full pipeline, check whether a hosted platform already covers the work you'd be doing. Several tools now ship AI-driven test triage that overlaps directly with Steps 4-6.

| Platform | Covers | Notes |
|----------|--------|-------|
| **Trunk Flaky Tests** | Fingerprinting, clustering, severity routing, native PR comments + webhooks | Dedicated Agents feature for triage; documented Quarantining workflow — the closest off-the-shelf analog to this skill's pipeline |
| **CloudBees Smart Tests** | Fingerprinting, ML-based prioritization, Test Impact Analysis | Formerly **Launchable** — agents searching old docs may find the old name |
| **Datadog Test Optimization** | Flaky Test Management (Auto Retries, Early Flake Detection, Failed Test Replay), Test Impact Analysis | Pairs with Datadog APM if you're already on Datadog |
| **Sealights** | Quality intelligence and test-impact gating | Enterprise; strongest in regulated industries |

Use the in-skill pipeline when (a) you need on-prem or air-gapped deployment, (b) your tracker integration is exotic, or (c) you want an explicit AI-prompt audit trail for compliance. Otherwise, buying is usually cheaper than rebuilding fingerprinting + clustering.

### Model selection cost note

Use Sonnet 4.6 / Haiku 4.5 for classification (Step 5) — it's cheap and capable enough. Escalate to Opus 4.7 only when the cluster is novel, the failure is ambiguous, or the suggested root cause has low confidence. Burning Opus on every triage is wasteful.

---

## Anti-Patterns

### 1. Using LLM for Deduplication

LLMs are non-deterministic. The same two errors compared twice may get different similarity scores. Use deterministic fingerprinting for deduplication; use LLM only for explaining and classifying.

### 2. Auto-Closing Without Review

Automatically closing a ticket as "duplicate" based on fingerprint matching can merge distinct issues. Always require human confirmation for close/merge actions.

### 3. Over-Classifying Severity

If everything is "critical," nothing is. Follow the severity matrix strictly. A cosmetic typo is trivial even if it annoys someone.

### 4. Ignoring Environment Failures

Labeling all failures as "app bug" when many are CI infrastructure issues (Docker OOM, network timeout, disk full). Classify environment issues separately -- they need different remediation.

### 5. No Feedback Loop

Building the pipeline once and never measuring accuracy. Track: auto-classification accuracy, false duplicate rate, ticket quality ratings from developers.

### 6. Raw Logs in Tickets

Pasting 500 lines of raw CI output into a bug ticket. Normalize, extract relevant lines, and present the 5-10 lines that matter.

### 7. Fingerprinting Without Normalization

Hashing raw log lines produces unstable fingerprints that change every run. Normalization (Step 1) is mandatory before fingerprinting.

### 8. No Component Ownership Mapping

Classification without routing is useless. Maintain a component-to-team mapping so that classified bugs reach the right people.

---

## Done When

- Each triaged bug has severity, component, and root cause labels assigned
- Duplicates merged or linked with references to the canonical ticket
- CI failure analysis report generated summarizing failure categories and counts
- Actionable tickets created for all P0 and P1 issues with assigned owners
- Triage session findings summarized and shared with the team

---

## Related Skills

- **`qa-metrics`** — Track triage accuracy, duplicate rates, mean time to classification, and defect escape rates.
- **`ci-cd-integration`** — Pipeline configuration for running triage on test failures, parallel execution, and reporting.
- **`test-reliability`** — Flaky test classification, quarantine management, and root cause analysis.
- **`qa-project-context`** — Project context that improves classification accuracy: component map, known issues, ownership.
- **`ai-test-generation`** — Generate regression tests from triaged bug reports.

---

## References

- `references/classification-taxonomy.md` — Bug categories, severity definitions, component mapping rules, and root cause categories.
- `references/ci-failure-analysis.md` — CI log parsing patterns, failure category decision tree, fingerprinting algorithm detail.
