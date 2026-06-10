---
name: qa-start
description: >-
  Sequenced launcher that bootstraps QA on a project with no QA in place. Chains
  qa-project-context → test-strategy → test-planning in one guided run, then points
  you at automation. Use when: "set up QA on a new project," "QA from scratch," "no QA
  exists yet," "/qa-start." Not for: onboarding a QA engineer to an existing team with
  existing tests — use qa-project-bootstrap. Not for: "which skill do I use" with no
  clear match — use qa-do.
  Related: qa-project-context, test-strategy, test-planning, qa-project-bootstrap, qa-do.
license: MIT
compatibility: Cross-tool. Tested with Claude Code, Codex, Cursor, Gemini CLI. Reads/writes the user's project root; no network access required.
metadata:
  author: kindlmann
  version: "2.0"
  category: foundation
  argument-hint: "optional path to existing repo (e.g. './apps/web') if running from a monorepo root"
---

<objective>
A sequenced launcher for bootstrapping QA where none exists. It contains no QA guidance itself — it chains three skills in the correct order so engineers don't jump to writing tests before deciding what to test or why. Run `qa-project-context` → `test-strategy` → `test-planning` and you end with a context file, a strategy document, and a first test plan: a complete QA foundation.
</objective>

## When to Use This

Reach for `qa-start` whenever the answer to "where do we start with QA?" is unclear and no QA foundation exists yet:

- A brand-new project with no test infrastructure.
- Joining an existing codebase that has **no QA setup at all** — old code, but quality work was never formalized. Still `qa-start`, not `qa-project-bootstrap` (that one is for joining a team that *already has tests*).
- Rebooting QA after neglect — tests deleted, coverage collapsed, no strategy. You are rebooting QA from the foundation up.

If the codebase already has a real test suite and you are a QA engineer ramping onto the team, use `qa-project-bootstrap` instead.

## Quick Route

Pick your entry point — skip any step whose artifact already exists.

| Situation | Start at |
|-----------|----------|
| No QA at all (no context file, no strategy, no plan) | Step 1 |
| `.agents/qa-project-context.md` already populated | Skip Step 1 — invoke `test-strategy` (Step 2) |
| Context file AND strategy document both exist | Skip Steps 1 and 2 — invoke `test-planning` (Step 3) |
| All three done — what next? | After Step 3 |
| A QA engineer ramping onto an existing team with existing tests | Not this skill — see `qa-project-bootstrap` |

## Step 1: Capture Project Context

**Skill:** `qa-project-context`

Creates `.agents/qa-project-context.md` in your project root. That file records your tech stack, test frameworks, CI/CD pipeline, environments, coverage goals, risk areas, and team structure. Every later skill reads it, so it never asks you the same questions twice.

**What to do:** Invoke `qa-project-context` and work through its discovery questions. The skill walks each section interactively, discovers what it can from the repo, and writes the file.

**Done when:** `.agents/qa-project-context.md` exists in your project root with all sections filled in. It is the source of truth for everything that follows.

## Step 2: Create the Test Strategy

**Skill:** `test-strategy`

Produces a strategy document defining how the project approaches quality: the test pyramid (what proportion of unit, integration, and E2E tests fits your product), entry and exit criteria, tool selection, environment coverage, and quality gates for CI and release.

**What to do:** Invoke `test-strategy` once Step 1 is complete. It reads the context file automatically and will not re-ask anything answered there.

**Done when:** You have a strategy document (e.g. `strategy.md`) covering test-pyramid rationale, tool choices with justification, quality gates for CI and release, and entry/exit criteria per test type. One page of clear decisions beats a sprawling template.

## Step 3: Build the First Test Plan

**Skill:** `test-planning`

Translates the strategy into an actionable plan for the first sprint or release. Maps features to test cases, assigns effort, and decides what gets covered first versus deferred.

**What to do:** Invoke `test-planning` after Step 2. It consumes the strategy from Step 2 and the context from Step 1. Provide the feature list or sprint scope when prompted.

**Done when:** You have a test plan (e.g. `plan.md`) with features mapped to test cases, coverage priorities set, effort estimated, and scope boundaries clear. This is the artifact your team executes against.

## After Step 3

You now hold the foundation: context, strategy, and a first plan. Next actions depend on your stack — this launcher is not the final step.

- **First automated tests:** Use `playwright-automation` or `cypress-automation` to write the first E2E tests against your highest-risk flows.
- **CI integration:** Use `ci-cd-integration` to get tests running on every pull request.
- **Tracking quality:** Use `qa-metrics` once the suite runs to define what health looks like and how to measure it over time.

## qa-start vs qa-project-bootstrap vs qa-do

The single most common routing confusion, answered in one place:

- **`qa-start`** — bootstrap QA where **none exists**. New project, or QA was deleted and you are rebooting it. Sequence: context → strategy → first plan. Output is the QA *foundation*.
- **`qa-project-bootstrap`** — a 30-day ramp for a QA engineer **joining an existing team** with existing tests. Covers team processes, onboarding timeline, and an audit of the test suite already in place. Use it *after* a foundation exists, not to create one.
- **`qa-do`** — last-resort router for "which skill do I use?" when nothing clearly matches. If you already know you have no QA, skip it and run `qa-start`.

A brand-new project with no QA — even on an old codebase — is always `qa-start`, never `qa-project-bootstrap`.

## Pin as a Manual Command

Re-run anytime from the Claude Code `/skills` menu.

To pin this skill as a manual-only command, add `disable-model-invocation: true` to the frontmatter, or set it via `skillOverrides` in `.claude/settings.local.json`.

> Caveat: in some Claude Code builds `disable-model-invocation: true` also suppresses the manual slash command (ref anthropics/claude-code#26251). If you still want to invoke `/qa-start` by hand, set the `skillOverrides` state to `user-invocable-only` instead.

## Related Skills

- **qa-project-context** — Step 1. Captures project setup, tech stack, and quality goals into `.agents/qa-project-context.md`.
- **test-strategy** — Step 2. Defines the testing approach, pyramid, tools, and quality gates.
- **test-planning** — Step 3. Builds the first test plan with features mapped to test cases.
- **qa-project-bootstrap** — go here instead when a QA engineer is ramping onto an existing team with existing tests; this skill creates the foundation, bootstrap onboards onto one.
- **qa-do** — last-resort router when no skill clearly matches; not needed if you already know there is no QA.
- **playwright-automation / cypress-automation** — after the plan, write the first E2E tests against your highest-risk flows.
