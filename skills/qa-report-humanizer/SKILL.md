---
name: qa-report-humanizer
description: >-
  Remove AI-generated patterns from QA reports, bug reports, test summaries,
  status updates, and quality communications. Detects and rewrites robotic
  test result language, template-sounding status updates, inflated severity
  descriptions, and generic stakeholder reports. Makes QA writing sound like
  a real engineer wrote it. Use when: "humanize report," "rewrite QA summary,"
  "fix test report," "make this sound human," "clean up status update."
  Related: bug-reporting, qa-metrics, qa-dashboard, quality-postmortem.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: process
---

<objective>
Make QA reports, bug reports, test summaries, and status updates sound like
a real QA engineer wrote them, not a template or an LLM.

Check for `.agents/qa-project-context.md` first.
</objective>

## When to use this

- Writing or editing test execution summaries
- Sprint/release quality reports for stakeholders
- Bug reports that need to be read and acted on
- Slack messages about test results or failures
- PR review comments from QA
- Postmortem and retrospective writeups
- Any QA communication that sounds robotic or generic

## Core principles

1. Specific beats comprehensive. "Login fails when email has a plus sign" beats "Various authentication edge cases were identified."
2. Say what actually happened, not what category it falls into.
3. If the reader can't tell what broke or what to do, the report failed.
4. Write for the person who has to fix it at 4pm on a Friday.
5. Skip the parts nobody reads.

## QA-specific AI patterns to detect and fix

### 1. The template opener

Every AI-generated test report starts the same way.

Bad:
> Test execution was completed successfully for Sprint 47. A total of 342 test cases were executed across 5 test suites, achieving a 97.4% pass rate. The following sections provide detailed results.

Better:
> Sprint 47: 342 tests run, 9 failed. 6 of the failures are in checkout (payment form validation). The other 3 are flaky timing issues we've seen before.

Why: the first version buries the signal. The second tells you what happened and where to look.

### 2. Inflated severity language

Bad:
> A critical defect was identified in the authentication module that could potentially impact the user experience across multiple touchpoints, underscoring the need for immediate remediation.

Better:
> Login breaks if your email has a "+" in it. Around 8% of our users have plus-sign emails (checked analytics). Needs a fix before release.

Why: "critical defect in the authentication module" is a category. "Login breaks if your email has a plus sign" is something you can fix.

### 3. The pass rate obsession

Bad:
> The overall pass rate increased from 94.2% to 97.1%, demonstrating significant improvement in test suite reliability and showcasing the team's commitment to quality.

Better:
> Pass rate went from 94% to 97%. Most of that was fixing the 3 flaky Playwright tests that kept timing out on the dashboard load. Real bugs found: 2 (both in the new export feature).

Why: pass rates are vanity metrics without context. What actually changed?

### 4. Generic risk language

Bad:
> Several high-risk areas have been identified that require careful monitoring. The team recommends continued vigilance and proactive testing to mitigate potential issues.

Better:
> The payment flow has no E2E coverage for 3D Secure cards. We've had two production incidents from this in the past 6 months. I'd prioritize this over the admin panel work.

Why: "high-risk areas" and "continued vigilance" mean nothing. Name the area, name the risk, say what to do about it.

### 5. Synonym cycling for test results

Bad:
> The authentication tests passed successfully. The login verification suite completed without issues. The credential validation checks returned positive results. The sign-in workflow tests executed as expected.

Better:
> All auth tests passed (login, registration, password reset, SSO).

Why: four ways to say "auth tests passed" is four times too many.

### 6. The "despite challenges" closer

Bad:
> Despite several challenges encountered during the testing phase, the team successfully completed all planned test activities. Moving forward, the focus will be on continuous improvement and enhanced test coverage.

Better:
> We didn't get to the mobile browser tests this sprint. Carry those to next sprint. Everything else is done.

### 7. Vague stakeholder updates

Bad:
> Quality metrics continue to trend positively. The team is aligned on priorities and committed to delivering a high-quality release. Stakeholders can feel confident in the current trajectory.

Better:
> The release looks fine. 4 bugs open, all P2 or lower. The login plus-sign bug (P1) was fixed yesterday. Smoke tests pass on staging.

### 8. PR review comments that say nothing

Bad:
> Great work on this implementation! I noticed a few potential areas for improvement that might enhance the overall test coverage and robustness of the test suite.

Better:
> This test only checks the happy path. What happens when the API returns a 429? And the selector `.btn-submit` will break if anyone changes the CSS class. Use `getByRole('button', { name: 'Submit' })` instead.

### 9. Bug report padding

Bad:
> While conducting comprehensive regression testing of the user management module, a significant defect was discovered that impacts the core functionality of the system. This issue has the potential to affect a substantial number of users.

Better:
> Deleting a user doesn't revoke their API tokens. They can still make requests after deletion. Found while testing the user management API.

### 10. The rule-of-three summary

Bad:
> This sprint we improved quality, velocity, and confidence. The team demonstrated strong collaboration, technical excellence, and customer focus.

Better:
> This sprint we fixed the checkout flakiness (was failing 12% of the time, now <1%) and added E2E coverage for the new export feature.

## How to rewrite QA reports

### Step 1: Cut the opening paragraph
Most test report intros are throat-clearing. Delete everything before the first useful fact.

### Step 2: Lead with what matters
What broke? What's risky? What should someone do? Put that first.

### Step 3: Replace categories with specifics
"Authentication module" → "login with plus-sign emails"
"Performance degradation" → "dashboard takes 8 seconds to load (was 2)"
"Several edge cases" → "empty cart, expired coupon, and currency mismatch"

### Step 4: Kill the filler
Remove: "It is worth noting that," "Moving forward," "In conclusion,"
"The team is committed to," "Stakeholders can feel confident,"
"Despite challenges," "This underscores the importance of"

### Step 5: Add what's actually useful
- What should the reader do next?
- What's the risk if they don't?
- How confident are you? (Be honest. "I'm not sure this is stable yet" is fine.)

### Step 6: Read it out loud
If you wouldn't say it in standup, rewrite it.

## Format-specific guidance

### Test execution summary
Lead with: failures count, where they are, whether they're new.
Skip: total counts, pass percentages (unless someone asked for them).
End with: what's not covered yet, what to watch.

### Bug report
Lead with: what breaks, how to reproduce it, who's affected.
Skip: "while performing comprehensive testing of the module..."
Include: actual error message, screenshot, or console output.

### Sprint quality update (for stakeholders)
Lead with: release readiness (yes/no/conditional), open blockers.
Skip: methodology, process descriptions, team morale statements.
End with: what you'd want to know if you were deciding whether to ship.

### Slack test result message
Keep it to 2-3 lines. Link to the full report.
Bad: "Hello team, I wanted to share the results of our latest test execution..."
Better: "E2E run passed. 2 flaky failures (both dashboard timeout, known issue). Full report: [link]"

### Postmortem writeup
Lead with: what broke, when, how long, who was affected.
Skip: "This postmortem aims to provide a comprehensive analysis..."
Be honest about what you missed and why.

## Anti-patterns

- Opening with "Test execution was completed successfully" when tests failed
- Using "potential impact" instead of describing the actual impact
- Writing "the team is aligned" in any context
- Padding 3 bullet points into 12 by rewording the same thing
- Closing with optimistic statements that add no information
- Using passive voice to avoid naming what broke ("an issue was identified")
- Starting bug reports with context about the testing session instead of the bug

## Done When

- AI-pattern checklist applied to the report (hedging language, passive voice, synonym cycling, template openers, and filler phrases removed)
- Report reviewed for natural flow and authentic voice — reads like a specific engineer wrote it, not a template
- Technical accuracy preserved: no facts, numbers, bug descriptions, or test results altered during the rewrite
- Output reviewed by a human before sending to stakeholders or submitting as a PR comment
- The version without AI patterns is the deliverable — the original draft is discarded or archived

## Related skills

- For bug report templates and severity matrices, see `bug-reporting`
- For QA metrics and what to track, see `qa-metrics`
- For dashboard setup and stakeholder reports, see `qa-dashboard`
- For postmortem structure and root cause analysis, see `quality-postmortem`
