# Quality Postmortem Templates

Copy-paste templates for the two heavy formats: the incident postmortem (for P0/P1
events) and the recurring quality retro. The SKILL.md body covers escaped-bug
classification, 5 Whys, and effort-estimate solutions inline — those are small enough
to live there. These two are not.

---

## Postmortem Template for Quality Incidents

Use this when a significant quality incident occurs (P0/P1 production bug, data loss,
security issue, extended outage caused by a code change). Fill it from evidence —
commit history, deploy logs, the bug tracker — not from memory.

```markdown
# Quality Incident Postmortem: [INCIDENT-ID]

## Summary
[One paragraph: what happened, who was affected, how it was resolved]

## Severity and Impact
- **Severity:** [P0 / P1 / P2]
- **Users affected:** [count or percentage]
- **Duration:** [from detection to resolution]
- **Business impact:** [revenue, reputation, compliance]

## Timeline (all times in UTC)
| Time | Event |
|------|-------|
| HH:MM | [Code change deployed / feature flag enabled] |
| HH:MM | [First user report / monitoring alert] |
| HH:MM | [Incident acknowledged by on-call] |
| HH:MM | [Root cause identified] |
| HH:MM | [Fix deployed / rollback completed] |
| HH:MM | [Incident resolved, monitoring confirms recovery] |

## Root Cause
[Technical description of what went wrong]

## 5 Whys
1. Why did [symptom]? Because [cause 1].
2. Why [cause 1]? Because [cause 2].
3. Why [cause 2]? Because [cause 3].
4. Why [cause 3]? Because [cause 4].
5. Why [cause 4]? Because [root cause].

## What Tests Existed
- [List relevant existing tests and why they did not catch this]

## What Tests Were Missing
- [Specific test scenarios that would have prevented this]

## Detection
- **How was it detected?** [User report / monitoring / internal testing]
- **Could it have been detected earlier?** [Yes/No — how?]
- **Time from deploy to detection:** [duration]

## Prevention Measures

### Immediate (this sprint)
| Action | Owner | Due | Status |
|--------|-------|-----|--------|
| [Write regression test for this specific scenario] | [name] | [date] | [ ] |
| [Add monitoring alert for this error pattern] | [name] | [date] | [ ] |

### Short-term (next 2 sprints)
| Action | Owner | Due | Status |
|--------|-------|-----|--------|
| [Add integration tests for related edge cases] | [name] | [date] | [ ] |
| [Update deployment checklist] | [name] | [date] | [ ] |

### Long-term (this quarter)
| Action | Owner | Due | Status |
|--------|-------|-----|--------|
| [Improve test coverage for entire area] | [name] | [date] | [ ] |
| [Process change to prevent similar gaps] | [name] | [date] | [ ] |

## Lessons Learned
- [What went well in detection and response]
- [What could have been better]
- [What systemic issue does this reveal]
```

If AI SRE tooling drafted the timeline (Rootly AI SRE, incident.io's auto-drafted
post-mortems), keep the AI draft as input and have the blameless RCA owner — not the
incident commander — author the 5 Whys and sign off on the action items.

---

## Retro Meeting Template

Use this format for regular quality retrospectives (as opposed to incident-specific
postmortems). Conduct per-sprint or monthly.

### Agenda (30-60 minutes)

```
Quality Retro: Sprint [N] / [Month Year]
═════════════════════════════════════════

1. Previous Action Items Review (5 min)
   - Review status of action items from last retro
   - Mark completed, carry forward incomplete, escalate blocked

2. Data Review (10 min)
   Present metrics since last retro:
   - Escaped bug count and classification
   - Flaky test rate trend
   - CI pass rate trend
   - Coverage change
   - Test suite duration change
   - Quarantine inventory

3. What Went Well (5 min)
   - Quality wins: bugs caught early, smooth releases, good test coverage
   - Process improvements that paid off

4. What Needs Improvement (10 min)
   - Quality pain points: escaped bugs, flaky tests, slow pipeline, gaps
   - Process friction: review bottlenecks, unclear ownership, tooling issues

5. Root Cause Discussion (10-15 min)
   - Pick the top 1-2 issues from "Needs Improvement"
   - Run 5 Whys or group brainstorming
   - Identify systemic causes

6. Action Items (5-10 min)
   - Define 1-3 specific, assigned, time-bound action items
   - Each item: what, who, when, how to verify
   - Add to team's work tracker with "retro-action" tag

7. Close (2 min)
   - Confirm next retro date
   - Thank participants
```

### Facilitator Notes

- **Prepare data in advance.** Do not spend meeting time pulling up dashboards. Have
  metrics ready in a shared doc.
- **Timebox strictly.** Quality retros expand to fill available time. 30 minutes is
  sufficient for a sprint retro. 60 minutes for monthly or incident-triggered.
- **Rotate facilitation.** Different facilitators bring different perspectives. Rotate
  among QA engineers, developers, and tech leads.
- **Follow up within 24 hours.** Send a summary with action items to the team channel.
  Link to tracker tickets. This signals that the retro was real work, not a talking
  exercise.
- **Review action items at the START of the next retro.** This is the accountability
  mechanism. If items are consistently incomplete, reduce the number of items or reduce
  their scope.

---

## Escaped Bug Analysis Template

For a single escaped defect, before you have enough volume to aggregate. Once you have
10+ analyzed, roll them up with the aggregation pattern in SKILL.md.

```
Escaped Bug Analysis: [BUG-ID] [Title]
═══════════════════════════════════════

Timeline:
  Introduced:    [commit/PR/date]
  Released:      [release version/date]
  Detected:      [date, by whom — user report, monitoring, internal]
  Resolved:      [date]
  Time to detect: [hours/days]
  Time to fix:    [hours]

Classification:
  Root cause:         [logic error / integration / data / race condition / ...]
  Should-catch level: [unit / integration / E2E / monitoring]
  Prevention:         [add test / improve test / add gate / improve spec / ...]

Existing Coverage:
  Were there tests for this area?    [yes / no / partial]
  If yes, why did they miss it?      [edge case not covered / wrong assertion / ...]
  If no, why not?                    [area not identified as risky / time pressure / ...]

Impact:
  Users affected:    [count or estimate]
  Revenue impact:    [none / minor / significant / critical]
  Brand impact:      [none / minor / significant / critical]

Action Items:
  1. [Action] — Owner: [name] — Due: [date]
  2. [Action] — Owner: [name] — Due: [date]
```
