# Session Templates

Charter examples, setup checklists, session-flow timings, debrief template, and the note-taking session-log format for SBTM. The principles and quality criteria live in `SKILL.md`.

## Charter Template

A charter is a one-sentence mission statement following this pattern:

```
Explore [target]
  with [resources]
  to discover [information]
```

**Examples:**

```
Explore the checkout flow
  with multiple payment methods and expired cards
  to discover how the system handles payment failures and edge cases

Explore the user profile page
  with slow network conditions (Chrome DevTools throttling)
  to discover how the UI handles latency, timeouts, and partial loads

Explore the search functionality
  with special characters, Unicode, and SQL injection strings
  to discover input validation gaps and error handling behavior

Explore the data export feature
  with datasets of 0, 1, 1000, and 100000 records
  to discover performance boundaries and data integrity issues

Explore the multi-user collaboration flow
  with two browser sessions logged in as different users
  to discover race conditions, conflict resolution, and real-time sync behavior
```

## Session Setup

**Before the session:**

1. Read the charter and understand the target area
2. Prepare the environment (deploy the right version, seed test data, set up monitoring)
3. Prepare tools (browser DevTools open, screen recorder running if capturing evidence, note-taking template ready)
4. Set a timer for the session duration
5. Clear distractions (close Slack, mute notifications)

**Environment preparation checklist:**

```
[ ] Correct build/version deployed
[ ] Test data seeded (relevant states: empty, typical, large)
[ ] Test accounts ready (roles: admin, standard user, guest)
[ ] DevTools open: Console, Network, Performance tabs
[ ] Screen recorder running (optional but recommended)
[ ] Note-taking template open
[ ] Timer set: ___ minutes
```

## During the Session

Explore the target area guided by the charter. Use heuristics (see `references/heuristics-and-automation.md`) as thinking prompts. Follow interesting leads even if they deviate slightly from the charter -- document the deviation.

**Session flow:**

```
0:00 - 0:05   Orient: Navigate to the target area, understand the current state
0:05 - 0:15   Survey: Perform the happy path to establish baseline behavior
0:15 - 0:55   Explore: Apply heuristics, probe boundaries, follow anomalies
0:55 - 1:00   Wrap up: Review notes, capture final observations
1:00 - 1:15   Debrief: Summarize findings, identify follow-up actions
```

**When you find something interesting:**

1. Stop and observe -- do not rush past anomalies
2. Reproduce it -- can you make it happen again?
3. Vary the conditions -- does it happen with different data, users, or browsers?
4. Document it -- screenshot, console log, network trace
5. Assess severity -- is this a bug, a design question, or a test idea?
6. Decide: investigate deeper now, or note it and continue exploring?

## Debrief

After every session, conduct a structured debrief (even if it is just self-reflection for a solo tester).

**Debrief template:**

```
Session Debrief
Charter: [charter text]
Tester: [name]
Duration: [planned] → [actual]
Date: [date]
Build: [version/commit]

Coverage:
  What percentage of the charter was covered? [%]
  What areas were explored that were NOT in the charter?
  What areas in the charter were NOT explored? Why?

Findings:
  Bugs: [count] (list with IDs if filed)
  Issues: [count] (not bugs, but concerns -- performance, UX, design questions)
  Test ideas: [count] (ideas for new automated tests)

Observations:
  What surprised you?
  What was harder than expected?
  What areas need deeper exploration in a follow-up session?

Follow-up Actions:
  [ ] File bug reports for findings
  [ ] Create automated tests for reproducible bugs
  [ ] Schedule follow-up session for unexplored areas
  [ ] Update risk assessment based on findings
```

## Note-Taking Template

Use this during the session. Capture observations in real time.

### Session Log Format

```
Session: [charter summary]
Date: [date]  |  Tester: [name]  |  Build: [version]  |  Duration: [minutes]

| Time  | Action / Input           | Observation                  | Bug? | Follow-up      |
|-------|--------------------------|------------------------------|------|----------------|
| 0:03  | Navigate to /checkout    | Page loads in 1.2s           | No   |                |
| 0:05  | Add item, proceed        | Happy path works             | No   |                |
| 0:08  | Enter expired card       | Error: "Card declined" ✓     | No   |                |
| 0:10  | Enter card with spaces   | Error: "Invalid card number" | ?    | Spaces should   |
|       |                          | but many cards have spaces   |      | be stripped     |
| 0:14  | Paste card with dashes   | Accepted and processed ✓     | No   | Inconsistent    |
|       |                          |                              |      | with spaces     |
| 0:18  | Submit with empty email  | No validation, order created | YES  | BUG: required   |
|       |                          | without email                |      | field not       |
|       |                          |                              |      | validated       |
| 0:22  | Network offline mid-pay  | Spinner forever, no timeout  | YES  | BUG: no timeout |
|       |                          |                              |      | handling        |
```

### Tagging Observations

Use consistent tags for post-session analysis:

- **BUG** -- Definite defect, file a report
- **QUESTION** -- Unclear whether this is intended behavior; ask product
- **IDEA** -- Test case idea for automation
- **RISK** -- Potential issue that needs investigation
- **NOTE** -- Interesting observation, not actionable yet
