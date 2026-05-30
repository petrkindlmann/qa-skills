---
name: exploratory-testing
description: >-
  Design and execute structured exploratory testing sessions. Covers Session-Based
  Test Management (SBTM), charter writing, heuristic-based exploration (HICCUPS,
  FEW HICCUPS), bug discovery patterns, note-taking templates, and conversion of
  findings to automated tests. Use when: "exploratory testing," "SBTM," "manual testing,"
  "bug hunting," "test charter," "heuristic testing."
  Related: test-planning, bug-reporting, risk-based-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: strategy
---

<objective>
Structured exploration that finds bugs scripted tests miss. Exploratory testing is simultaneous learning, test design, and execution -- the tester adapts in real time based on what the application reveals. This skill provides the frameworks to make that exploration systematic, repeatable, and documentable.
</objective>

---

## Discovery Questions

Before designing a session, gather context. Check `.agents/qa-project-context.md` first -- if it exists, use it as the foundation and skip questions already answered there.

### Target Area

- What feature, module, or flow is the exploration target?
- Is this a new feature (discovery mode) or existing feature (regression mode)?
- What is the most recent change to this area?
- Are there known risk areas or previous bug clusters here? (See `risk-based-testing` for risk data.)

### Hypotheses and Suspicions

- What do you think might break? (Hunches are valid starting points.)
- What did the developer say was tricky or uncertain?
- Are there areas the automated suite does not cover?
- Have users reported issues in this area before?

### Time and Scope

- How much time is available for this session? (45-90 minutes is optimal.)
- Is this a broad survey (casting a wide net) or deep dive (focused attack on one area)?
- What environments and data sets are available?
- Are there specific platforms, browsers, or device types to focus on?

### Team Context

- Who built the feature? (Pairing with the developer during exploration can be powerful.)
- Is there a tester who has domain expertise in this area?
- Who should receive the session report?

---

## Core Principles

### 1. Structured Freedom

Exploratory testing is not "click around and see what happens." It is guided by a charter that defines the target, resources, and information goal. Within that charter, the tester has freedom to follow leads, investigate anomalies, and change direction based on discoveries. The structure makes it repeatable; the freedom makes it effective.

### 2. Document As You Go

Observations not recorded are observations lost. Take notes during the session, not after. Record what you did, what you saw, and what questions arose. The session log is the deliverable -- it replaces a test script.

### 3. Heuristics Over Scripts

Heuristics are thinking tools that guide exploration without dictating exact steps. HICCUPS and FEW HICCUPS (below) provide systematic lenses for examining software. They help testers ask better questions and notice things they would otherwise miss.

### 4. Time-Boxed Sessions

Open-ended exploration suffers from diminishing returns. After 90 minutes, fatigue reduces bug-finding effectiveness. Time-box sessions to 45-90 minutes, then debrief. Short focused sessions outperform long unfocused ones.

### 5. Bugs Found Are the Beginning, Not the End

An exploratory session that finds a bug has only done half its job. The other half is: Could this bug have been caught by an automated test? If yes, write that test. Exploratory testing feeds the automation pipeline.

---

## Session-Based Test Management (SBTM)

SBTM gives exploratory testing a management layer: charters define intent, sessions are the unit of work, debriefs extract learnings.

> **Canonical references:**
> - SBTM PDF (Jon Bach / James Bach, satisfice.com) — https://www.satisfice.com/download/session-based-test-management
> - *Taking Testing Seriously: The Rapid Software Testing Approach* (Bach & Bolton, Wiley 2025) — current authoritative RST/SBTM book.
> - HTSM v6.3 (Bach, last updated Dec 2024) — emphasizes state-based testing and boundary heuristics. Pair with HICCUPS below.

### Charter Template

A charter is a one-sentence mission statement following this pattern:

```
Explore [target]
  with [resources]
  to discover [information]
```

**Charter quality checklist:**
- Target is specific enough to guide exploration (not "explore the app")
- Resources name specific tools, data, or conditions to use
- Information goal describes what you want to learn, not what you want to prove
- A single session can reasonably cover the charter in 45-90 minutes

See `references/session-templates.md` for five worked charter examples (checkout, profile, search, data export, multi-user collaboration).

### Session Setup, Flow, and Debrief

The full session lifecycle — pre-session setup steps, environment preparation checklist, the minute-by-minute session flow, the "when you find something interesting" loop, and the structured debrief template — lives in `references/session-templates.md`. Pull it up at the start of a session and keep it open.

Key timing guardrails to remember without opening the reference: orient and survey in the first 15 minutes, explore for ~40, wrap up and debrief at the end. Always debrief, even solo.

---

## Bug Discovery Heuristics

Heuristics are mental models that guide exploration. They are not checklists to exhaustively complete -- they are lenses to look through.

### HICCUPS

A mnemonic for seven oracles that reveal bugs. An oracle is a principle for recognizing problems.

| Letter | Oracle | What to Check | Example Questions |
|--------|--------|--------------|-------------------|
| **H** | History | Does current behavior match past behavior? | Did this work in the last release? Has the behavior changed subtly? |
| **I** | Image | Does it match the product's brand and quality bar? | Does this look polished? Does it feel consistent with the rest of the app? |
| **C** | Comparable | How do similar products handle this? | What does the competitor do here? What is the industry standard? |
| **C** | Claims | Does it match what was promised? | Does it match the spec? The marketing page? The tooltip text? |
| **U** | User expectations | Would a real user find this confusing or frustrating? | Would my mother understand this? Would a power user be annoyed by this? |
| **P** | Product | Is it consistent with other parts of the same product? | Does this error message match the style of other error messages? |
| **S** | Standards | Does it comply with applicable standards? | WCAG for accessibility, RFC for protocols, GDPR for data handling? |

### FEW HICCUPS (Extended)

Adds three lenses to the base HICCUPS model:

| Letter | Oracle | What to Check |
|--------|--------|--------------|
| **F** | Familiarity | Would a first-time user understand this without help? |
| **E** | Explainability | Can you explain the behavior to someone else? If not, it might be a bug. |
| **W** | World | Does it work in the real world? (different locales, time zones, network conditions, screen sizes) |

### Heuristic Test-Idea Banks

The detailed test-idea lists for boundary, state-transition, error-handling, and "what if" exploration are in `references/heuristics-and-automation.md`. Reach for them when you need concrete prompts:

- **Boundary heuristics** — numeric, string, time, and collection boundaries (zero/one/many, max±1, Unicode, DST, page-size edges).
- **State transition heuristics** — skipping steps, going backward, interrupting, repeating, concurrent transitions, post-error state.
- **Error handling heuristics** — network loss, malformed responses, rate limits, expired sessions, invalid uploads.
- **"What if" scenarios** — back button, duplicate tabs, ad blockers, pasted formatting, accessibility features, unfamiliar locales, hostile users.

---

## Note-Taking Template

Use a session log to capture observations in real time. The session-log table format and the observation tags (BUG, QUESTION, IDEA, RISK, NOTE) are in `references/session-templates.md`. Tag every observation consistently so the debrief can sort findings without re-reading the whole log.

---

## When to Explore vs. When to Automate

Not all testing should be exploratory, and not all testing should be automated. Use this decision framework:

### Explore When

- The feature is new and requirements are still evolving
- You are investigating a vague bug report ("sometimes it is slow")
- You want to assess the overall quality of an area (quality survey)
- The area is complex with many state combinations that are hard to script
- You need to evaluate subjective qualities (UX, intuitiveness, visual polish)
- You are trying to find bugs, not confirm behavior

### Automate When

- The behavior is stable and well-defined
- The test needs to run on every commit/PR (regression)
- The scenario has a clear pass/fail criterion
- The test involves data combinations that are tedious to explore manually
- You need cross-browser or cross-device coverage at scale
- You found a bug through exploration and want to prevent regression

### The Exploration-to-Automation Pipeline

Every reproducible bug found through exploration should become an automated regression test, so future sessions focus on new areas instead of re-checking old bugs. See `references/heuristics-and-automation.md` for the full pipeline diagram, the conversion steps, and a worked Playwright regression example (BUG-456 email validation).

---

## Session Planning by Context

| Context | Focus | Charter Pattern | Time Split |
|---------|-------|----------------|-----------|
| **New feature** | Learning, requirement gaps, UX | "Explore [feature] with various roles/data to discover requirement gaps and unexpected behaviors" | 15 min orient + 40 min heuristics + 20 min boundaries/errors + 15 min document |
| **Regression** | Changes and their side effects | "Explore [area] after [change] to discover regressions at integration points" | 10 min review diff + 20 min changed area + 20 min integrations + 15 min smoke + 15 min document |
| **Bug investigation** | Reproducing and minimizing | "Explore [area] with [reported conditions] to discover exact reproduction steps" | 10 min read report + 15 min reproduce + 20 min minimize + 15 min related areas + 15 min document |

---

## Assisted Exploration (LLM as Companion, Not Replacement)

CTAL-AT v2.0 (May 2026) formalizes "Assisted Testing" as a sibling to Exploratory Testing — a tester running a session with an LLM as oracle and idea-generator, while keeping critical-thinking ownership. Done well, an LLM expands your charter coverage; done badly, it replaces your judgment with confident-sounding hallucination.

**How to use an LLM during a session:**

- **As an idea generator before the session.** Paste the charter and ask for 10 edge cases the heuristics might miss. Pick 3 to actually try. Discard the rest — most will be generic or invented.
- **As an oracle for "is this correct?" mid-session.** When you find unexpected behavior, ask the agent to look up the spec / API / standard. Never trust the answer without verifying against the source it cites.
- **As a fact-checker on findings, not a writer of bug reports.** You write the bug; the LLM reviews for clarity. The reverse — LLM writes, you review — produces template-shaped reports that lose the specific details a human noticed.
- **For coverage gap suggestions during debrief.** "Given these notes, what charter should I run next?"

**The Productivity Paradox warning** (Bolton, 2026-01): AI tooling can make tester output *look* faster while quietly hollowing out the critical thinking that produced the value. If your debrief notes start sounding like an LLM wrote them, the LLM is now driving — stop and run the next session unassisted.

**What never to delegate to an LLM:**

- Choosing what to explore. The charter must come from your understanding of risk and stakeholder concerns.
- Deciding whether something is a bug. "The model says it looks fine" is not a debrief.
- Writing the testing story. Specific, situated detail is the point of exploratory testing — generic LLM prose is the opposite.

For testing AI features themselves (not just using AI to test), see `ai-system-testing`.

---

## Anti-Patterns

### Unchartered Exploration

Exploring without a charter. "I will just poke around and see what I find" produces inconsistent results, is not repeatable, and cannot be meaningfully debriefed. Always write a charter, even if it is one sentence.

### Session Too Long

Running 3-hour exploration sessions. Bug-finding effectiveness drops sharply after 90 minutes. Fatigue causes testers to miss issues and stop following leads. Break long testing efforts into multiple 60-90 minute sessions with breaks between them.

### No Notes During Session

Relying on memory to reconstruct what happened. By the time the session ends, half the observations are forgotten and the rest are vague. Take notes in real time using the template above.

### Exploring Only the Happy Path

Using exploratory testing only to verify that things work. This duplicates what automated tests already cover. Exploratory testing's strength is finding problems in paths nobody thought to script. Use heuristics to push into uncomfortable territory.

### No Conversion to Automation

Finding the same bug manually every release because nobody wrote an automated test for it. Every reproducible bug found through exploration should become an automated regression test. The exploration-to-automation pipeline must be active.

### Treating Exploration as "Not Real Testing"

Viewing exploratory testing as less rigorous than scripted testing. SBTM with charters, session logs, and debriefs produces documented, accountable testing. The documentation format is different from test scripts, but the rigor is equal.

---

## Done When

- Session charters are written for each target area, each following the "Explore [target] with [resources] to discover [information]" pattern
- All planned sessions have been executed and debriefed using the debrief template, with coverage percentage and unexplored areas noted
- Every bug found during sessions is logged with a reference to the originating charter and reproduction steps
- Session logs exist with time-stamped observations tagged as BUG, QUESTION, IDEA, RISK, or NOTE
- A findings summary captures total session count, bugs filed (by severity), test ideas identified, and follow-up sessions scheduled or explicitly deferred

## Tester Roles in Modern Teams

CTAL-AT v2.0 (May 2026) names several tester archetypes worth knowing for staffing and self-positioning conversations:

- **Embedded testers** ("Tissue Testers") — testers fully embedded inside delivery teams, contributing to development conversations end-to-end rather than acting as a separate gate. Most common 2026 model.
- **Specialist testers** — deep skills in a domain (security, accessibility, performance) called in across teams.
- **Coach testers** — senior testers who teach craft (heuristics, charter writing, exploratory thinking) to developers and junior testers; rarely test end-to-end themselves.

If your org is moving toward embedded testers, exploratory testing is one of the highest-leverage skills to demonstrate — it's hard for developers to pick up without coaching, and it's where the testing mindset shows up most clearly.

For background on the broader testing-vs-checking distinction and AI's role, see "What Is Testing? A Conversation with Bach and Bolton" (DevelopSense, Feb 2026): https://developsense.com/blog/2026/02/what-is-testing-a-conversation-with-james-bach-and-michael-bolton

## Reference Files (in `references/`)

- **session-templates.md** — Charter examples, environment-prep checklist, session-flow timings, debrief template, and the note-taking session-log format.
- **heuristics-and-automation.md** — Boundary/state/error/"what if" heuristic test-idea banks, the exploration-to-automation pipeline diagram, and a worked Playwright regression example.

## Related Skills

- **test-planning** -- Sprint test plans allocate time for exploratory sessions and reference charters.
- **risk-based-testing** -- Risk assessment identifies which areas deserve exploratory attention.
- **test-reliability** -- Flaky or unreliable areas identified through exploration feed into test reliability improvements.
- **qa-metrics** -- Track exploratory session counts, bug discovery rates, and charter coverage as QA metrics.
- **qa-project-context** -- The project context file identifies known risk areas and previous bug clusters that guide charter writing.
