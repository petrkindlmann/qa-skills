---
name: agentic-browser-testing
description: >-
  Goal-driven E2E testing where a browser agent (Playwright MCP / computer-use) reads a
  natural-language goal and explores the app via the accessibility tree to assert outcomes —
  no pre-written script. Covers when intent-driven beats scripted, making agent runs
  deterministic (pinned model, temperature 0, seeded data, bounded steps, explicit success
  assertion, snapshot-not-pixel), cost/latency control, the accessibility-tree-first
  interaction model, CI gating, and graduating a stable run into a scripted Playwright test.
  Use when: "agentic browser test," "goal-driven browser test," "let an agent explore the app,"
  "natural-language E2E," "browser agent smoke test," "Playwright MCP test."
  Not for: Writing/maintaining deterministic scripted Playwright tests — that is
  playwright-automation. Testing your product's OWN LLM features — that is ai-system-testing.
  Related: playwright-automation, ai-system-testing, exploratory-testing, test-reliability, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: ai-qa
---

<objective>
A scripted Playwright test breaks the moment a button moves or a class renames; writing one
for a dashboard that changes weekly is a maintenance treadmill. This skill stands up a
goal-driven browser agent instead: it reads a natural-language goal, explores the app via the
accessibility tree (Playwright MCP `browser_snapshot`), and asserts the outcome against an
explicit oracle. The failure mode it prevents is the one that makes teams distrust agents — an
agent that reports "success" while stuck on the login page because nothing forced it to prove
where it landed. You leave with a deterministic, CI-gated agent run and a graduation path to a
durable scripted test once the flow stabilizes.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Stand up a goal-driven run from scratch | Discovery + `references/setup.md` |
| Decide agentic vs scripted for a given flow | Fit: Intent-Driven vs Scripted |
| Agent passes one run, fails the next | Determinism |
| "How does it click without screenshots?" | Interaction Model |
| Runs are slow / burning tokens | Cost and Latency |
| Agent reports false success | Success Assertion (the Oracle) |
| Flow is stable — make it permanent | Graduation → `references/graduation-and-ci.md` |
| Block a merge on the goal | CI Gating → `references/graduation-and-ci.md` |
| Canvas / no accessibility tree | Canvas Fallback → `references/graduation-and-ci.md` |

## Discovery Questions

First, check `.agents/qa-project-context.md` in the project root and skip anything it already
answers (stack, environments, seed/reset tooling, model access).

1. **Which flow, and how often does its UI change?** Fast-changing/experimental UI favors
   intent-driven; a stable critical path (login) favors scripted. This decides the whole approach.
2. **Is there a seeded fixture and a way to reset state?** Determinism is impossible without
   seeded data and a per-run reset. If neither exists, that is step zero.
3. **Can you deep-link past auth to a seeded entry point?** Re-driving login every run is the
   biggest avoidable cost; a seeded entry URL scopes the goal and cuts steps.
4. **What is the unambiguous success oracle?** Specific account text, a `/dashboard` URL, an
   order number — plus a forbidden state. "No error" is not an oracle.
5. **Does the target render to canvas / WebGL?** No accessibility tree means snapshot-first
   won't work; plan the vision fallback or instrument the canvas with ARIA.
6. **Which model and budget?** Pin a model id and a step budget up front; tier cheap steps to
   Haiku 4.5 / Sonnet 4.6 and reserve Opus 4.8 for genuinely ambiguous flows.

---

## Core Principles

1. **Intent, not instructions — but only where churn earns it.** The agent reads a goal and
   finds its own path through the accessibility tree, so it survives a moved button or renamed
   class that would break a selector. That resilience costs 2-5x the time and money of a
   scripted run, so spend it on fast-changing UI and hard-to-locate flows, not on stable
   critical paths.

2. **An agent run is untrustworthy until it is deterministic.** Same goal, same seeded app
   must produce the same verdict. That requires temperature 0, a pinned model id, seeded data
   with a reset, a bounded step budget, and an explicit pass/fail assertion. Without these you
   have a coin flip, not a test.

3. **The oracle lives outside the agent.** Never let the LLM self-grade "looks good." Success
   is a checkable assertion against the final `browser_snapshot` — specific expected text, a
   URL, AND a forbidden-state negative check — evaluated by your harness, not the model.

4. **Accessibility tree first, pixels last.** `browser_snapshot` returns roles, refs, and
   accessible names (~200-400 tokens) and is deterministic and cheap. Screenshots, pixel
   coordinates, vision, and OCR are a scoped last resort for canvas only, never the default.

5. **Graduation is the goal, not perpetual agent runs.** Once a flow is stable, promote the
   run to a durable scripted `tests/*.spec.ts` with role-based locators. An agent that has
   been green for two weeks should become a fast, free regression test — keep the agent for
   exploration, not for guarding a settled path.

---

## Fit: Intent-Driven vs Scripted

The decision is per-flow, not per-project. Run `risk-based-testing` first if you need the
risk map; this table is the routing rule once you have it.

| Flow characteristic | Use | Why |
|---------------------|-----|-----|
| Stable, high-frequency critical path (login, payment) | **Scripted + pinned** (`playwright-automation`) | Runs every PR; must be fast, free, and deterministic. No upside to re-exploring it. |
| Fast-changing / experimental UI (a dashboard that churns weekly, a redesign in flight) | **Agentic / intent-driven** | Selectors would break constantly; a goal survives layout churn. |
| Hard-to-locate flow you can't reliably select | **Agentic** | The agent finds the control by role/name instead of you reverse-engineering a selector. |
| Exploratory smoke / "does the happy path still work at all" | **Agentic** | One NL goal covers a lot of ground without a maintained script. |
| Anything in CI that must never falsely pass | Scripted, OR agentic **with a hard oracle** | Non-determinism is a false-pass risk you must actively cap. |

**The rule, stated plainly:** keep stable critical paths scripted and pinned; point
intent-driven agents at fast-changing UI and exploratory smoke. Do not move everything to the
agent — it is slower, costlier, and non-deterministic, and not every test should be agentic.

---

## The Interaction Model (accessibility-tree-first)

Playwright MCP is **not** computer-use with screenshots and pixel coordinates. It is
accessibility-tree-first:

1. `browser_navigate` to the seeded entry URL.
2. `browser_snapshot` returns the **accessibility tree** — each interactive element as a
   `role`, a stable `ref`, and its `accessible name` (from ARIA/labels). ~200-400 tokens.
3. The agent picks an element by `ref` and calls `browser_click` or `browser_type`.
4. `browser_wait_for` waits on text appearing/disappearing — never a fixed sleep.
5. Re-`browser_snapshot` after the DOM changes; assert against that tree.

Why not screenshots: the snapshot is **token-efficient** (thousands of tokens cheaper than an
image), **deterministic** (text refs, not fuzzy pixel matching), and needs no vision model or
OCR. Feeding screenshots as the primary input makes the run slower, pricier, and flakier.
`browser_take_screenshot` is for human evidence only, never as the assertion input.

See `references/setup.md` for the MCP registration, the full tool table, and the goal prompt.

---

## Determinism: making a run trustworthy in CI

A run that passes once and fails the next with no app change is not yet a test. The fix is
never "just retry" or bumping temperature for "smarter" exploration — that adds variance. Pin
the variables instead:

| Lever | Setting |
|-------|---------|
| Model | **Pinned model id** (e.g. `claude-haiku-4-5-20251001`), never `latest` |
| Sampling | **temperature 0** — no creative wandering in CI |
| Data | **Seeded fixture + reset/seed the database** before every run |
| Scope | **Bounded step budget** (`maxSteps`), e.g. 18 — exceeding it FAILS, never auto-retries |
| Oracle | **Explicit pass/fail verdict** asserted against the snapshot |
| Evidence | Assert on the **accessibility tree**, never a screenshot diff |

Avoid: `temperature: 0.7` or `1` for exploration, retry-until-pass loops,
`waitForTimeout` sleeps, and screenshot-based assertions. Each one hides flakiness rather than
removing it. Full harness config in `references/setup.md`.

---

## Success Assertion: the Oracle (where agents fail silently)

This is the sharpest failure mode: the agent reports success while stuck on the login page,
because "page loaded / no error / looks good" was accepted as success and the LLM was allowed
to self-grade. Force an explicit oracle the harness checks — never the agent.

For the goal *"sign in as an existing user and confirm the dashboard shows the right account name"*:

```text
SUCCESS (all must hold — assert against the final browser_snapshot):
  - URL matches /dashboard
  - Snapshot contains the specific expected account name text, e.g. "Acme Corp — Jane R."
NEGATIVE / forbidden state (fail fast if any is true):
  - Still on a URL matching /login  → FAIL
  - Snapshot contains role="alert" with "invalid credentials"  → FAIL
VERDICT: harness emits {"passed": true|false}; the LLM does not decide.
```

The positive checks (specific account name + `/dashboard` URL) prove where it landed; the
**negative check** (must NOT be on the login page) is what kills the false pass. "No error,"
"didn't crash," "screenshot looks correct," and "trust the agent" are not success criteria.

---

## Cost and Latency

Agent runs are 2-5x slower and pricier than scripted tests — a step is an LLM round-trip, the
dominant cost. Cut spend without losing coverage by going *smaller*, not *bigger*:

- **Step budget** — keep `maxSteps` low and enforced; fewer round-trips, less drift.
- **Model tiering** — Haiku 4.5 / Sonnet 4.6 for cheap navigation steps; reserve Opus 4.8 for
  genuinely ambiguous exploration. Don't run the biggest model on every step.
- **Prompt caching** — cache the static system prompt, tool schemas, and goal; they repeat
  every run.
- **Scope via a seeded entry point** — one narrow goal per run, deep-linked past login instead
  of re-driving it each time.
- **Snapshot over screenshots** — the a11y snapshot is ~200-400 tokens; a full-page screenshot
  is thousands. Default to snapshot.

Backwards moves to reject: "use a bigger model / Opus 4.8 for every step," "raise the step
limit," "screenshot every step," and running with no budget at all. See `references/setup.md`.

---

## Graduation and CI Gating

Promote a stabilized goal into a durable scripted test, and gate merges on the verdict. Both
are detailed in `references/graduation-and-ci.md`; the essentials:

- **Graduate** with **Playwright Test Agents** (planner / generator / healer, shipped in
  Playwright **v1.56.0**). `npx playwright init-agents --loop=claude`. The **planner** writes a
  Markdown test plan to `specs/<flow>.md`; the **generator** turns it into `tests/<flow>.spec.ts`
  with **role-based locators** (`getByRole`, `getByLabel`, `getByText`) verified against the live
  DOM; the **healer** repairs broken locators. This is the promotion path — not "keep running it
  as an agent," not recorded clicks, not `page.locator('xpath=...')`, not data-testid-only.
- **Gate CI** so a failed goal exits **non-zero** and emits a **machine-readable** verdict
  (`{"passed": true|false}` in `result.json`); the GitHub Actions job parses the boolean and
  `exit 1`s on false. State is seeded/ephemeral and reset per run, with a step budget and a
  timeout cap. Never `continue-on-error: true`, never "always exit 0," never a prose verdict a
  human reads.
- **Canvas with no accessibility tree:** prefer instrumenting the canvas with ARIA; as a scoped
  last resort enable `--caps=vision` to unlock `browser_mouse_click_xy` for that flow only.
  `browser_snapshot` will not work on a raw canvas, but don't make coordinates the default and
  don't abandon agentic testing.

---

## Migrating a brittle script to a goal (honest tradeoffs)

Converting an 80-line script that re-types login and walks 6 hardcoded steps into a single NL
**goal** with an **explicit success assertion** is a real win for a churning flow — but state
the downsides honestly:

- **Non-determinism / false-pass risk** — the run could pass falsely; that's why the hard
  oracle and the negative check are non-negotiable.
- **Cost/latency** — 2-5x slower; bound it with a **step budget** and a seeded entry point.
- **Not every test should be agentic** — keep stable paths scripted, and plan to **graduate**
  this one back to a scripted test once it stabilizes.

Reject the over-promise: it is **not** "strictly better with no downsides," do **not** "migrate
everything," and never drop the assertions to make it pass.

---

## Anti-Patterns

### 1. Reflexively writing a scripted Playwright test
"Browser test" pattern-matches to codegen, so the default is `page.goto` / `page.locator` /
`await expect(page...)` / hunting `data-testid`. That misses the entire point. A goal-driven
agent reads NL intent and explores via `browser_snapshot` — no pre-written selectors.

### 2. "Use the agent for everything"
Over-selling the new toy. The agent is 2-5x slower and non-deterministic. Stable critical paths
(login) stay scripted and pinned; intent-driven wins on fast-changing UI. Never "always use the
agent" or "agents replace all scripted tests."

### 3. Fixing flakiness with retries or higher temperature
"Just retry" and bumping temperature for "smarter" exploration both add variance. The real
levers are temperature 0, a pinned model, seeded data, a bounded step budget, and an explicit
verdict.

### 4. Assuming computer-use = screenshots + pixel coordinates
Playwright MCP is accessibility-tree-first. Defaulting to vision, screenshots, OCR, or
`mouse_click_xy` is slower, costlier, and flakier. Pixels are a canvas-only last resort.

### 5. "No error = success" (the false pass)
Accepting "page loaded / didn't crash / looks good" and letting the LLM self-grade is exactly
why the agent reports success while stuck on login. Require specific expected text, a URL, and
a forbidden-state negative check, evaluated by the harness.

### 6. Bigger model / more steps to go faster
Backwards. Opus 4.8 on every step and raising `maxSteps` raise cost and latency without buying
reliability. Smaller models, tighter budgets, caching, and tighter scope are the fix.

### 7. Running an agent forever instead of graduating
A goal green for two weeks on a now-stable flow should become a scripted `tests/*.spec.ts` via
Playwright Test Agents. "Keep running it as an agent," recording clicks, and xpath locators are
all wrong promotions.

### 8. Prose verdict in CI
Returning a paragraph for a human to read, or `continue-on-error: true`, lets a failed goal
merge. The run must exit non-zero on failure with a machine-readable boolean.

---

## Done When

- Goal prompt exists as natural-language intent (no `page.locator` / `page.goto` /
  `data-testid` in the goal) with a START seeded entry URL.
- An explicit success oracle is defined: specific expected text AND a URL check AND a
  forbidden-state negative check, asserted against `browser_snapshot` — not a screenshot.
- Run config pins a model id, sets `temperature: 0`, a `maxSteps` budget, and a seed; no
  `waitForTimeout`, no retry-until-pass.
- Interaction is snapshot-first: `browser_navigate` / `browser_snapshot` /
  `browser_click` / `browser_type` / `browser_wait_for`; screenshots used only for evidence.
- The runner emits `result.json` with `{"passed": true|false}` and `exit 1`s on false; the CI
  job gates the merge on the boolean (no `continue-on-error`, no `always exit 0`).
- CI seeds/resets ephemeral state per run and enforces a step budget and a timeout cap.
- A graduation trigger is recorded (e.g. "green for 2 weeks → run `init-agents`, generate
  `tests/<flow>.spec.ts` with `getByRole` locators").
- If any target is canvas/WebGL, the vision fallback (`--caps=vision` +
  `browser_mouse_click_xy`) is scoped to that flow only, or the canvas is instrumented with ARIA.

---

## Related Skills

- **playwright-automation** — Writing and maintaining deterministic scripted Playwright tests
  and Page Objects. Go there to author the durable test; this skill graduates an agent run into one.
- **ai-system-testing** — Testing your product's OWN LLM/AI features (prompt regression, model
  output quality). This skill tests any app *using* an agent; it does not test your AI feature.
- **exploratory-testing** — Human SBTM exploration and bug hunting. The agentic smoke goal is
  the automated cousin; use exploratory-testing for charter-driven manual sessions.
- **test-reliability** — Self-healing locators and quarantine for *scripted* flaky tests at
  runtime. Complements the determinism levers here once a test has graduated.
- **qa-project-context** — The universal dependency; supplies stack, environments, seed/reset
  tooling, and model access that every question above depends on.

## Reference Files (in `references/`)

- **setup.md** — Playwright MCP registration (`.mcp.json`), the snapshot tool table, the
  natural-language goal prompt with success/negative assertions, the determinism harness
  config (pinned model, temperature 0, maxSteps, seed, prompt cache), and cost/latency levers.
- **graduation-and-ci.md** — Playwright Test Agents promotion pipeline (planner → `specs/*.md`,
  generator → `tests/*.spec.ts` with role-based locators, healer), the GitHub Actions gating
  workflow with a machine-readable boolean verdict, and the canvas `--caps=vision` fallback.
