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
  version: "2.0"
  category: process
---

<objective>
A polished QA report that says nothing is worse than a rough one that says what broke.
"A critical defect was identified in the authentication module" passes every grammar
check and tells the reader nothing. This skill rewrites QA reports, bug reports, test
summaries, and status updates so a real engineer can act on them — and guarantees the
rewrite invents no numbers, errors, or severities that were not in the source.
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
- **Are the numbers and severities locked facts that must survive verbatim?** If the source
  says "9 failed" and "P1," those carry through unchanged. If a figure is missing, you name
  the gap — you do not invent one (see Core Principle 5).

## Core Principles

1. **Specific beats comprehensive.** "Login fails when the email has a plus sign" beats
   "Various authentication edge cases were identified." The reader fixes the first and learns
   nothing from the second. Name the behavior, the trigger, and the scope.

2. **Say what happened, not what category it falls into.** "Authentication module" is a
   bucket; "login with plus-sign emails" is a bug. Categories let the writer sound thorough
   while hiding that they don't know the specifics. Replace every category with the concrete
   thing inside it.

3. **If the reader can't tell what broke or what to do, the report failed.** Write for the
   person who has to fix it at 4pm on a Friday. Lead with what's broken or risky, then what
   they should do about it. Skip the parts nobody reads.

4. **Preserve every fact; cut every adjective.** The rewrite changes the prose, never the
   data. No number, error string, severity, bug description, or test result may shift. The
   only things you delete are filler, hedging, and synonym cycling — not information.

5. **Never invent the specifics you're asked to add.** "Make it specific" tempts the model
   to manufacture an exact percentage, an incident count, or a repro it never saw. Do not.
   If the source is vague and the number isn't verifiable, the honest rewrite names the gap
   ("user impact not measured") instead of writing "8% of users." A fabricated metric is a
   worse failure than a vague one.

## QA-specific AI patterns to detect and fix

For each: the BAD draft, the rewrite, and why. The single most damaging one — the template
opener — is shown in full; the rest are compact.

### 1. The template opener (the worst offender)

Bad:
> Test execution was completed successfully for Sprint 47. A total of 342 test cases were executed across 5 test suites, achieving a 97.4% pass rate. The following sections provide detailed results.

Better:
> Sprint 47: 342 tests run, 9 failed. 6 of the failures are in checkout (payment form validation). The other 3 are flaky timing issues we've seen before.

Why: the first version buries the signal under throat-clearing. The second tells you what
happened and where to look in one line.

### 2. Inflated severity language

Bad: "A critical defect was identified in the authentication module that could potentially impact the user experience across multiple touchpoints."
Better: "Login breaks if your email has a `+` in it. We've checked analytics — about 8% of our users have plus-sign emails. Needs a fix before release."

Why: a "critical defect in the authentication module" is a category; "login breaks if your email has a plus sign" is something you can fix. (The 8% here is from the source's own analytics — don't add a figure the source doesn't have.)

### 3. The pass-rate obsession

Bad: "The overall pass rate increased from 94.2% to 97.1%, demonstrating significant improvement and showcasing the team's commitment to quality."
Better: "Pass rate went from 94% to 97%. Most of that was fixing the 3 flaky Playwright tests that kept timing out on the dashboard load. Real bugs found: 2 (both in the new export feature)."

Why: pass rates are vanity metrics without context. Say what actually changed.

### 4. Generic risk language

Bad: "Several high-risk areas have been identified that require careful monitoring. The team recommends continued vigilance and proactive testing."
Better: "The payment flow has no E2E coverage for 3D Secure cards. We've had two production incidents from this in the past 6 months. I'd prioritize this over the admin panel work."

Why: "high-risk areas" and "continued vigilance" mean nothing. Name the area, name the risk, say what to do.

### 5. Synonym cycling for test results

Bad: "The authentication tests passed successfully. The login verification suite completed without issues. The credential validation checks returned positive results. The sign-in workflow tests executed as expected."
Better: "All auth tests passed (login, registration, password reset, SSO)."

Why: four ways to say "auth tests passed" is four times too many. One outcome gets one verb.

### 6. The "despite challenges" closer

Bad: "Despite several challenges encountered during the testing phase, the team successfully completed all planned test activities. Moving forward, the focus will be on continuous improvement."
Better: "We didn't get to the mobile browser tests this sprint — ran out of time after the checkout regression. Carrying those to next sprint. Everything else is done."

Why: name the gap and the reason, then the carry-forward plan. Drop the "despite challenges" framing.

### 7. Vague stakeholder updates

Bad: "Quality metrics continue to trend positively. The team is aligned on priorities and committed to delivering a high-quality release."
Better: "The release looks fine. 4 bugs open, all P2 or lower. The login plus-sign bug (P1) was fixed yesterday. Smoke tests pass on staging."

Why: lead with ship/no-ship and the open blockers. That's the decision the reader is making.

### 8. PR review comments that say nothing

Bad: "Great work on this implementation! I noticed a few potential areas for improvement that might enhance the overall test coverage and robustness."
Better: "This test only checks the happy path. What happens when the API returns a 429? And the selector `.btn-submit` will break if anyone changes the CSS class — use `getByRole('button', { name: 'Submit' })` instead."

Why: name the missing scenario and the brittle line, then the concrete fix. `getByRole` is
Playwright's recommended user-facing locator — prefer it over CSS-class selectors.

### 9. Bug report padding (with repro and evidence)

Bad: "While conducting comprehensive regression testing of the user management module, a significant defect was discovered that impacts the core functionality of the system."
Better:
> Deleting a user doesn't revoke their API tokens — they can still call the API after deletion.
> Repro: create a user, mint a token, `DELETE /api/users/{id}`, then `GET /api/me` with that token.
> Returns `200 OK` with the user's data instead of `401 Unauthorized`. Found in the user-management API.

Why: lead with the broken behavior, give a 2-line repro and the actual error/status so the
fixer can reproduce it in seconds. Drop the passive "was discovered" and the testing-session preamble.

### 10. The rule-of-three summary

Bad: "This sprint we improved quality, velocity, and confidence. The team demonstrated strong collaboration, technical excellence, and customer focus."
Better: "This sprint we fixed the checkout flakiness (was failing 12% of the time, now <1%) and added E2E coverage for the new export feature."

Why: three generic virtues in a tricolon is the loudest AI tell in a sprint summary. Replace with the two things that actually happened.

## How to rewrite

1. **Cut the opening paragraph.** Most intros are throat-clearing. Delete everything before the first useful fact.
2. **Lead with what matters.** What broke? What's risky? What should someone do? That goes first.
3. **Replace categories with specifics.** "Authentication module" → "login with plus-sign emails." "Performance degradation" → "dashboard takes 8s to load (was 2)." "Several edge cases" → "empty cart, expired coupon, currency mismatch."
4. **Kill the filler.** Remove every phrase in `references/filler-blocklist.md` — "It is worth noting that," "Moving forward," "Despite challenges," "The team is committed to," "Stakeholders can feel confident," and the rest.
5. **Add what's useful — without inventing it.** What should the reader do next? What's the risk if they don't? How confident are you (be honest — "I'm not sure this is stable yet" is fine)? If a number to back a claim isn't in the source, say so; don't manufacture one.
6. **Read it out loud.** If you wouldn't say it in standup, rewrite it.

## Format-specific guidance

| Format | Lead with | Skip | Also include |
|---|---|---|---|
| **Test execution summary** | Failure count, where they are, whether they're new | Total counts, pass % (unless asked) | What's not covered yet, what to watch |
| **Bug report** | What breaks, how to reproduce it, who's affected | "while performing comprehensive testing…" | Actual error message, status code, screenshot, or console output |
| **Sprint update (stakeholders)** | Release readiness (yes/no/conditional), open blockers | Methodology, process, team-morale lines | What you'd want to know if you were deciding whether to ship |
| **Slack message** | The result in 2-3 lines + a link | Greetings, "I wanted to share…" | — |
| **Postmortem** | What broke, when, how long, who was affected | "This postmortem aims to provide…" | An honest account of what you missed and why |

Slack example — Bad: "Hello team, I wanted to share the results of our latest test execution…"
Better: "E2E run passed. 2 flaky failures (both dashboard timeout, known issue). Full report: [link]"

## Anti-Patterns

- **Inventing the specifics you were asked to add.** Rewriting a vague draft into a precise-sounding one by manufacturing a percentage, an incident count, or a repro that wasn't in the source. This breaks the fact-preservation guarantee — name the gap instead.
- **Opening with "Test execution was completed successfully" when tests failed.** The opener contradicts the body. Lead with the failures.
- **"Potential impact" instead of the actual impact.** If you know the impact, state it; if you don't, say it's unmeasured. "Potential" is a hedge that hides which one you mean.
- **Writing "the team is aligned" in any context.** It conveys zero information and is a pure AI tell.
- **Padding 3 bullets into 12 by rewording the same thing.** Synonym cycling. One outcome, one statement.
- **Closing with optimistic statements that add no information.** "Moving forward, the focus will be on continuous improvement" — delete it.
- **Passive voice to avoid naming what broke.** "An issue was identified" hides the subject. Name what broke and where.
- **Starting a bug report with the testing session instead of the bug.** Nobody needs "while conducting regression testing of the module." Start with the broken behavior.

## Verification

The fact-preservation promise (Core Principle 4) is the load-bearing claim — prove it
mechanically, smallest check first:

1. **Numbers and severities preserved.** Extract every figure from input and output and
   diff the sets. The output set must be a subset of the input set — anything in the output
   that isn't in the input is a fabricated fact:
   ```bash
   grep -oE '[0-9]+(\.[0-9]+)?%?|P[0-3]|[0-9]{3}' input.md  | sort -u > /tmp/in.txt
   grep -oE '[0-9]+(\.[0-9]+)?%?|P[0-3]|[0-9]{3}' output.md | sort -u > /tmp/out.txt
   comm -13 /tmp/in.txt /tmp/out.txt   # must be empty (allow only obvious rounding, e.g. 97.4 -> 97)
   ```
2. **Filler blocklist returns zero matches.** Copy the "Grep-ready regex" line from
   `references/filler-blocklist.md` into `BLOCKLIST` and grep the output:
   ```bash
   BLOCKLIST='it('\''?s)? worth noting|moving forward|in conclusion|despite (several )?challenges|the team is (committed|aligned)|stakeholders can feel confident'
   grep -iE "$BLOCKLIST" output.md   # expect no output; extend BLOCKLIST with the full regex from the reference
   ```
   Any hit is a surviving AI tell — rewrite that line.
3. **Second-pass clean.** Run the output through the global `humanizer` (or `avoid-ai-writing`)
   skill in detect mode. It should flag no remaining em-dash overuse, tricolon, or vague
   attribution. If it flags something QA-specific that this skill missed, fix it here too.

## Done When

- Every number, severity, error string, and bug description in the output also appears in the input (the `comm -13` diff in Verification step 1 is empty, rounding aside).
- The filler blocklist regex returns zero matches against the output (Verification step 2).
- No synonym cycling: each distinct test outcome is stated once (no "passed / completed without issues / returned positive results" chains).
- The output passes the global humanizer/avoid-ai-writing pass with no flagged patterns (Verification step 3).
- The deliverable is the rewritten version; the original draft is archived or discarded, not shipped alongside.

## Related Skills

- **`ai-bug-triage`** — Bug-report templates and the severity/priority matrix. Triage decides *what* a bug is and how to classify it; this skill rewrites the prose of an already-classified report.
- **`qa-metrics`** — What to actually track. Use it when the report should cite real metrics; this skill makes sure those metrics are stated with context, not as vanity numbers.
- **`qa-dashboard`** — Dashboard setup and stakeholder report layout. This skill humanizes the narrative that accompanies the dashboard.
- **`quality-postmortem`** — Postmortem structure and root-cause analysis. Build the postmortem there; humanize the writeup here.

## External Skills

These live in the global Claude skill set, **not** in this repo's `skills/` directory:

- **`humanizer`** / **`avoid-ai-writing`** — General-purpose anti-AI-writing engines. When both
  apply, run the global skill for language-level cleanup (em-dash overuse, tricolon, vague
  attribution) and this skill for QA-specific structure and fact preservation. If an engineer's
  real standup/Slack voice is available, feed a sample to the global humanizer's voice mode so
  the rewrite matches that person rather than a generic "human" register.

## Reference Files (in `references/`)

- **filler-blocklist.md** — Copy-paste blocklist of banned filler phrases, the grep-ready
  regex used in Verification, synonym-cycling tells, and passive-voice "who broke it" dodges.
