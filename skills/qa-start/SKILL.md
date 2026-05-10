---
name: qa-start
description: >-
  QA onboarding launcher for new projects. Chains qa-project-context → test-strategy → test-planning
  in one guided sequence. Use when: "set up QA", "onboard QA", "new project QA", "QA from scratch", "/qa-start".
  Related: qa-project-context, test-strategy, test-planning, qa-project-bootstrap.
license: MIT
compatibility: Cross-tool. Tested with Claude Code, Codex, Cursor, Gemini CLI. Reads/writes the user's project root; no network access required.
metadata:
  author: kindlmann
  version: "1.0"
  category: foundation
  argument-hint: "optional path to existing repo (e.g. './apps/web') if running from a monorepo root"
---

<objective>
This skill is a sequenced launcher. It does not contain QA guidance itself — it chains three skills in the right order so you don't have to figure out where to begin. The three skills are `qa-project-context`, `test-strategy`, and `test-planning`. Run them in sequence and you will have a complete QA foundation for a new project.

Without this launcher, engineers often jump to writing tests before defining what to test or why. This skill prevents that.
</objective>

## When to Use This

- Starting QA on a brand-new project with no existing test infrastructure
- Joining an existing codebase that has no QA setup at all
- Onboarding a QA engineer to a project where quality work has never been formalized
- Rebooting QA after a period of neglect (tests deleted, coverage collapsed, no strategy)
- Any situation where the answer to "where do we start?" is unclear

## Step 1: Capture Project Context

**Skill:** `qa-project-context`

This step creates `.agents/qa-project-context.md` in your project root. That file records your tech stack, test frameworks, CI/CD pipeline, environments, coverage goals, risk areas, and team structure. Every subsequent skill reads it to avoid asking you the same questions repeatedly.

**What to do:** Invoke `qa-project-context` and work through the discovery questions. The skill will walk you through each section interactively and write the file.

**Done when:** `.agents/qa-project-context.md` exists in your project root and all sections are filled in. The file is the source of truth for everything that follows.

## Step 2: Create the Test Strategy

**Skill:** `test-strategy`

This step produces a strategy document that defines how your project approaches quality. It covers the test pyramid (what proportion of unit, integration, and E2E tests makes sense for your product), entry and exit criteria, tool selection, environment coverage, and quality gates for CI and release.

**What to do:** Invoke `test-strategy` once Step 1 is complete. The skill reads your context file automatically — it will not ask questions already answered there.

**Done when:** You have a strategy document covering: test pyramid rationale, tool choices with justification, quality gates for CI and release, entry/exit criteria per test type. This does not have to be a long document. A single page of clear decisions is better than a sprawling template.

## Step 3: Build the First Test Plan

**Skill:** `test-planning`

This step translates the strategy into an actionable plan for the first sprint or release. It maps features to test cases, assigns effort, and identifies what gets covered first versus deferred.

**What to do:** Invoke `test-planning` after Step 2. It consumes the strategy from Step 2 and your project context from Step 1. Provide the feature list or sprint scope when prompted.

**Done when:** You have a test plan with features mapped to test cases, coverage priorities set, effort estimated, and scope boundaries clear. This is the artifact your team executes against.

## After Step 3

You now have the foundation: context, strategy, and a first plan. The next actions depend on your stack:

- **First automated tests:** Use `playwright-automation` or `cypress-automation` to write the first E2E tests against your highest-risk flows.
- **CI integration:** Use `ci-cd-integration` to get tests running on every pull request.
- **Tracking quality:** Use `qa-metrics` once the suite is running to define what health looks like and how to measure it over time.

## Quick Start (Skip Ahead)

> Re-run anytime from the Claude Code `/skills` menu. To pin this skill as a manual command (no model-driven activation), add `disable-model-invocation: true` to the frontmatter or use `skillOverrides` in `.claude/settings.local.json`.

If you already have a populated `.agents/qa-project-context.md`, skip Step 1 and go directly to Step 2.

If you already have a test strategy document, skip Steps 1 and 2 and go directly to Step 3. Tell `test-planning` where your strategy lives so it can reference the tool choices and quality gates you have already decided.

If all three are complete and you are looking for a deeper onboarding plan — team processes, ramp-up timeline, audit of existing tests — see `qa-project-bootstrap` instead.

## Related Skills

- `qa-project-context` — Step 1: capture project setup, tech stack, and quality goals
- `test-strategy` — Step 2: define the testing approach, pyramid, tools, and quality gates
- `test-planning` — Step 3: build the first test plan with features mapped to test cases
- `qa-project-bootstrap` — deeper 30-day onboarding plan for QA engineers joining an existing team
- `playwright-automation` — next step after the strategy: write the first E2E tests
