---
name: qa-report-humanizer
description: >-
  Remove AI-generated patterns from QA reports, bug reports, test summaries,
  status updates, and quality communications. Detects and rewrites robotic
  test-result language, template-sounding status updates, inflated severity
  descriptions, and generic stakeholder reports — without inventing facts.
  Makes QA writing sound like a real engineer wrote it.
  Use when: "humanize report," "rewrite QA summary," "fix test report,"
  "make this sound human," "clean up status update."
  Not for: general prose, blog, or marketing-copy cleanup — use the global
  humanizer skill. Not for: classifying or routing CI failures — use ai-bug-triage.
  Related: ai-bug-triage, qa-metrics, qa-dashboard, quality-postmortem.
license: MIT
metadata:
  author: kindlmann
  version: "2.1"
  category: process
---

<objective>
A polished QA report that says nothing is worse than a rough one that says what broke.
"A critical defect was identified in the authentication module" passes every grammar
check and tells the reader nothing. This skill rewrites QA reports, bug reports, test
summaries, and status updates so a real engineer can act on them. Preserve the source's
facts and uncertainty; compare the rewrite with the source before delivering it.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — it carries the team's tone, the tracker, and
severity conventions; skip anything answered there. Then clarify only what changes the rewrite:

- **Who reads this — an engineer, an exec, or a customer?** An engineer wants the failing
  selector and the repro; an exec wants ship/no-ship and open blockers; a customer wants
  impact and timeline. The register and what you cut differ for each.
- **What channel — Slack, PR comment, or a formal report?** Slack gets 2-3 lines and a
  link; a PR comment gets the specific code/selector fix; a report gets structure. Length
  and formatting follow the channel.
- **Is any information deliberately excluded from this audience?** Otherwise keep every
  supplied count, percentage, severity, identifier, result, and material qualification.
  These are locked by default; do not ask permission to preserve them. Name relevant
  missing evidence instead of inventing it (see Core Principle 5).

## Core Principles

1. **Specific beats comprehensive.** "Login fails when the email has a plus sign" beats
   "Various authentication edge cases were identified." The reader fixes the first and learns
   nothing from the second. Name the behavior, the trigger, and the scope when supplied.
   When they are absent, identify the missing details without inventing a better story.

2. **Say what happened, not what category it falls into.** "Authentication module" is a
   bucket; "login with plus-sign emails" is a bug. Categories let the writer sound thorough
   while hiding that they don't know the specifics. Use concrete details from the source;
   a vague source may need a short statement of what is still unknown.

3. **If the reader can't tell what broke or what to do, the report failed.** Write for the
   person who has to fix it at 4pm on a Friday. Lead with what's broken or risky, then what
   they should do about it. Skip the parts nobody reads.

4. **Preserve facts and uncertainty.** The rewrite changes the prose, never the data.
   Keep exact numbers, severities, error strings, test names, commit IDs, and timestamps
   attached to the same result and environment. Do not round percentages or infer failure
   counts from a rounded pass rate. Preserve "suspected," "not reproduced," "not run,"
   and "not approved": these describe evidence, not filler. A prior build's passing run
   does not establish the current candidate's status. A recommendation is not approval.

5. **Never invent the specifics you're asked to add.** "Make it specific" tempts the model
   to manufacture an exact percentage, an incident count, or a repro it never saw. Do not.
   If the source is vague and the number isn't verifiable, the honest rewrite names the gap
   ("user impact not measured") instead of writing "8% of users." A fabricated metric is a
   worse failure than a vague one.

## QA-specific AI patterns to detect and fix

Each rewrite below uses only facts in its draft. A missing detail remains missing.

### 1. The template opener

Draft: "Test execution was completed successfully for Sprint 47. A total of 342 test cases
were executed across 5 test suites, achieving a 97.4% pass rate."

Rewrite: "Sprint 47: 342 tests run across 5 suites; reported pass rate 97.4%. The draft
does not give the failure count, affected suites, or whether failures are new or known."

The rounded rate cannot establish an exact failure breakdown. Do not invent checkout
failures or flaky tests to make the report more useful.

### 2. Inflated severity language

Draft: "A critical defect was identified in the authentication module that could
potentially impact the user experience across multiple touchpoints."

Rewrite: "A critical authentication defect was reported. The broken behavior,
reproduction steps, and affected users are not specified."

Keep the reported severity without independently confirming it. Plus-sign emails and
an affected-user percentage belong here only when the source supplies them.

### 3. The pass-rate obsession

Draft: "The overall pass rate increased from 94.2% to 97.1%, demonstrating significant
improvement and showcasing the team's commitment to quality."

Rewrite: "Pass rate increased from 94.2% to 97.1%. The cause of the change and which
tests changed are not given."

Keep exact percentages. Do not attribute the change to repairs, flakiness, or fewer
product defects without evidence. If causes are supplied, lead with them.

### 4. Generic risk language

Draft: "Several high-risk areas have been identified that require careful monitoring.
The team recommends continued vigilance and proactive testing."

Rewrite: "The draft reports high-risk areas but does not identify them or the proposed
checks. Name the areas and evidence before setting priorities."

This is an information request, not a claim that payment coverage or incidents exist.

### 5. Synonym cycling for test results

Draft: "The authentication tests passed successfully. The login verification suite
completed without issues. The credential validation checks returned positive results.
The sign-in workflow tests executed as expected."

Rewrite: "The reported authentication checks passed: login, credential validation,
and the sign-in workflow."

Collapse repetition without adding registration, password reset, or SSO coverage.

### 6. The vague closer

Draft: "Despite several challenges encountered during the testing phase, the team
successfully completed all planned test activities. Moving forward, the focus will be
on continuous improvement."

Rewrite: "The team reports that all planned test activities are complete. The draft
does not specify the challenges, results, or next steps."

Do not turn a completed plan into invented skipped mobile tests or a carry-forward plan.

### 7. Vague stakeholder updates

Draft: "Quality metrics continue to trend positively. The team is aligned on priorities
and committed to delivering a high-quality release."

Rewrite: "The draft gives no test results, open blockers, or release decision to assess
readiness. Add that evidence before describing the release as ready."

Reported optimism is not evidence that smoke tests passed or that approval was granted.

### 8. PR review comments that say nothing

Draft: "Great work on this implementation! I noticed a few potential areas for
improvement that might enhance the overall test coverage and robustness."

Rewrite: "The comment raises possible coverage gaps without identifying a test or
missing scenario. Which case needs an assertion?"

Do not claim the code has a brittle CSS selector, a missing 429 case, or only a happy
path unless the supplied code or review actually shows it.

### 9. Bug report padding with supplied evidence

Draft: "While conducting regression testing, we discovered that deleting a user does
not revoke their API tokens. Repro: create a user, mint a token, DELETE /api/users/{id},
then GET /api/me with that token. Actual: 200 OK with user data. Expected: 401 Unauthorized."

Rewrite: "Deleting a user leaves their API tokens usable. Repro: create a user, mint
a token, `DELETE /api/users/{id}`, then `GET /api/me` with that token. Actual: `200 OK`
with user data. Expected: `401 Unauthorized`."

The source supplies this behavior and repro. A source saying only "a user-management
defect was found" does not justify any of these details.

### 10. The rule-of-three summary

Draft: "This sprint we improved quality, velocity, and confidence. The team demonstrated
strong collaboration, technical excellence, and customer focus."

Rewrite: "The draft gives no specific work or measurements for this sprint. Add the
completed changes and their results."

Do not invent a 12% to <1% flakiness change or new export coverage.

## How to rewrite

1. **Inventory the facts.** Note results, counts, percentages, errors, severities, owners,
   IDs, dates, evidence links, unknowns, and proposed actions. Keep each with its subject.
2. **Lead with what matters.** What broke? What's risky? What should someone do? That goes first.
3. **Use supplied specifics.** Replace categories only when the source identifies their
   behavior. Name missing information when it affects the reader's decision.
4. **Cut filler.** Use `references/filler-blocklist.md` as an editing aid. Preserve exact
   quoted errors, UI labels, test names, and evidence even if they contain a listed phrase.
5. **Add what's useful — without inventing it.** What should the reader do next? What's the risk if they don't? How confident are you (be honest — "I'm not sure this is stable yet" is fine)? If a number to back a claim isn't in the source, say so; don't manufacture one.
6. **Read it out loud.** If you wouldn't say it in standup, rewrite it.

## Format-specific guidance

| Format | Lead with | Skip | Also include |
|---|---|---|---|
| **Test execution summary** | Supplied failures and their status | Template opener and duplicate wording | Exact counts and percentages, unrun checks, build identity |
| **Bug report** | What breaks, how to reproduce it, who's affected | "while performing comprehensive testing…" | Actual error message, status code, screenshot, or console output |
| **Sprint update (stakeholders)** | Release readiness (yes/no/conditional), open blockers | Methodology, process, team-morale lines | What you'd want to know if you were deciding whether to ship |
| **Slack message** | The result in 2-3 lines + a link | Greetings, "I wanted to share…" | — |
| **Postmortem** | What broke, when, how long, who was affected | "This postmortem aims to provide…" | An honest account of what you missed and why |

Slack example with supplied facts: "Hello team, I wanted to share that the E2E run has
2 dashboard timeout failures under investigation. Full report: [link]."
Rewrite: "E2E: 2 dashboard timeout failures under investigation. Full report: [link]."
Do not call failures flaky, known, or passed before the source establishes that status.

## Anti-Patterns

- **Inventing the specifics you were asked to add.** Rewriting a vague draft into a precise-sounding one by manufacturing a percentage, an incident count, or a repro that wasn't in the source. Name the gap instead.
- **Opening with "Test execution was completed successfully" when tests failed.** The opener contradicts the body. Lead with the failures.
- **Turning uncertainty into certainty.** Keep potential impact as potential when the
  source is uncertain. Say what is known and what is unmeasured without guessing either.
- **Writing "the team is aligned" in any context.** It conveys zero information and is a pure AI tell.
- **Padding 3 bullets into 12 by rewording the same thing.** Synonym cycling. One outcome, one statement.
- **Closing with optimistic statements that add no information.** "Moving forward, the focus will be on continuous improvement" — delete it.
- **Passive voice to avoid naming what broke.** "An issue was identified" hides the subject. Name what broke and where.
- **Starting a bug report with the testing session instead of the bug.** Nobody needs "while conducting regression testing of the module." Start with the broken behavior.

## Verification

Check the source and rewrite side by side. A numeric set comparison cannot establish
fact preservation: it misses omitted facts, switched build IDs, and reversed outcomes.

1. **Compare an evidence ledger.** For each material source fact, check its exact value,
   subject, environment, date, and status in the output. Check both directions: nothing
   invented in the output and nothing silently omitted from the source. Preserve exact
   numbers; do not allow rounding unless the user explicitly asks for it.
2. **Check relationships and uncertainty.** Failed is not skipped; a passing retry does
   not erase the first failure. A suspected cause is not confirmed. A run on an earlier
   commit is not evidence for a later candidate. Proposed release is not approved release.
   Missing evidence remains unknown. Label suggested next actions as suggestions.
3. **Review language.** Check the filler blocklist in the reference and deduplicate
   repeated statements. A match inside an exact error string or required quotation is
   preserved. If the global `humanizer` or `avoid-ai-writing` skill is available, it may
   supply a second opinion; otherwise perform this review directly. Its absence does not
   block the rewrite. Recheck the evidence ledger after any stylistic changes.

## Done When

- Material source facts survive with their exact values and associations; each factual
  assertion in the output is supported by the source (Verification step 1).
- Unknowns, unrun checks, retries, build identity, and approval status retain their meaning
  (Verification step 2). A missing fact is not filled from an example in this skill.
- Filler is removed outside exact evidence strings and required quotations (Verification step 3).
- No synonym cycling: each distinct test outcome is stated once (no "passed / completed without issues / returned positive results" chains).
- The deliverable is the rewritten version in the requested language and channel. Do not
  delete or archive the user's original file unless that file action was requested.

## Related Skills

- **`ai-bug-triage`** — Bug-report templates and the severity/priority matrix. Triage decides *what* a bug is and how to classify it; this skill rewrites the prose of an already-classified report.
- **`qa-metrics`** — What to actually track. Use it when the report should cite real metrics; this skill makes sure those metrics are stated with context, not as vanity numbers.
- **`qa-dashboard`** — Dashboard setup and stakeholder report layout. This skill humanizes the narrative that accompanies the dashboard.
- **`quality-postmortem`** — Postmortem structure and root-cause analysis. Build the postmortem there; humanize the writeup here.

## External Skills

These live in the global Claude skill set, **not** in this repo's `skills/` directory:

- **`humanizer`** / **`avoid-ai-writing`** — General-purpose anti-AI-writing engines. When both
  apply and the skill is available, use it for language-level cleanup (em-dash overuse, tricolon, vague
  attribution) and this skill for QA-specific structure and fact preservation. If an engineer's
  real standup/Slack voice is available, feed a sample to the global humanizer's voice mode so
  the rewrite matches that person rather than a generic "human" register.

## Reference Files (in `references/`)

- **filler-blocklist.md** — Copy-paste blocklist of banned filler phrases, the grep-ready
  regex for optional language screening, synonym-cycling tells, and passive-voice "who broke it" dodges.
