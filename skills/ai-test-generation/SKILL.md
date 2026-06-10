---
name: ai-test-generation
description: >-
  Use AI to write NEW test code from specs, PRDs, user stories, code diffs, bug
  reports, or OpenAPI specs. Staged pipeline: requirements extraction → risk
  analysis → coverage matrix → scenario generation → oracle design → test code →
  human review, with guardrails against hallucinated APIs and weak assertions.
  Use when: "generate tests from spec," "tests from PRD," "tests from user story,"
  "auto-generate test cases," "AI write tests for me."
  Not for: testing AI/LLM features in your product — use ai-system-testing.
  Not for: auditing a pre-existing test suite you did not just generate — use
  ai-qa-review (Step 7 here only reviews tests THIS pipeline produced).
  Related: playwright-automation, unit-testing, api-testing, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: ai-qa
---

<objective>
LLMs will happily emit fifty plausible-looking tests that assert nothing, target endpoints that do not exist, and duplicate each other. This skill is a staged pipeline that forces structured intermediates — assumptions, coverage matrix, oracle definitions — out of the model BEFORE any test code, so what you get is traceable, reviewable, and grounded in the real codebase instead of ad-hoc generated noise.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It carries tech stack, test frameworks, naming conventions, selector strategy, and known risk areas that dramatically improve generated test quality.
</objective>

## Quick Route

The pipeline is the same for every input; only the Step 1 extraction emphasis changes. Jump to the matching row, then run Steps 2-7 unchanged.

| Input type | Step 1 extracts | Watch for |
|------------|-----------------|-----------|
| PRD / feature spec | Entities, business rules, acceptance criteria, NFRs, stated assumptions | Implicit requirements inferred from "seamless"/"fast" language |
| User story + AC | Each AC → ≥1 happy + ≥1 negative scenario | ACs that hide multiple behaviors in one line |
| Code diff (`git diff main...HEAD`) | New/changed code paths, modified conditionals, removed behavior | Regression scope: test the changed paths, not the whole module |
| Bug report | Repro steps, expected vs actual, environment | Write a test asserting *expected* — fails now, passes after fix |
| OpenAPI / GraphQL SDL | Endpoints, schemas, required fields, enums, auth | Validation, auth-failure, and edge cases per endpoint, not just 200s |

Playwright projects also pick an agent integration mode — see Discovery Q2.

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there. Then clarify:

1. **What is the input source?** PRD / spec, user story + AC, code diff, bug report, or API schema. Determines Step 1 extraction emphasis (see Quick Route). For an LLM/AI feature spec, stop — generate eval datasets in `ai-system-testing`, not Playwright specs.

2. **What is the target test framework, and (for Playwright) which agent integration mode?**
   - **E2E:** Playwright (preferred), Cypress. **Unit:** Jest, Vitest, pytest. **API:** Playwright `APIRequestContext`, Supertest, requests.
   - **Playwright CLI + agents** (recommended for Claude Code / Codex / Cursor): `npx playwright init-agents --loop=claude` scaffolds planner/generator/healer agents into `.claude/agents/` as markdown. They are interactive dev tools that produce standard Playwright tests which run unchanged in CI. Token-efficient; runs inside the agent's loop.
   - **Playwright MCP** (`npx @playwright/mcp@latest`): higher overhead, right when the agent must *drive* a live browser interactively over a long session.
   - **Neither** — hand-write tests using AI as a scratch-pad helper.

3. **What project context is available?** Existing test patterns, Page Objects / helpers, data factories / fixtures, CI constraints (timeout, parallelism). More context = less cleanup.

4. **What is the review workflow?** Full pipeline → human review → merge (default); scenarios only → human writes code; or code → human refines iteratively.

5. **What domain knowledge is needed?** Regulated industry (healthcare, finance) compliance, domain invariants (money never negative, appointments cannot overlap), known risk areas from past incidents.

## Core Principles

1. **Pipeline before code.** Never generate test code before establishing what to test, why, and how to verify it. The seven-step pipeline exists to prevent premature code generation that targets the wrong things.

2. **Structured intermediates are the product.** The assumptions document, coverage matrix, and oracle definitions are more valuable than the test code itself. They are reviewable, traceable, and reusable.

3. **Separate what from how.** Scenario generation (what to test) and oracle design (how to verify) are distinct cognitive tasks. Mixing them produces scenarios biased toward what is easy to assert, with assertions tacked on as afterthoughts.

4. **AI generates the first draft; a human reviews and refines.** Never ship AI-generated tests without human review. The AI accelerates — it does not replace judgment.

5. **Context is everything.** Feed the LLM your conventions, existing patterns, selector strategy, and data setup. The more context, the less cleanup.

6. **Quality over quantity.** Each test has a maintenance cost. Focus on critical paths, complex logic, and known risk areas — not test count.

## The Pipeline

**Mandatory workflow — agents MUST follow this order:**

```
Step 1: Extract   → Requirements, entities, business rules from input
Step 2: Analyze   → Risks, invariants, edge cases, ambiguities
Step 3: Map       → Coverage matrix (requirement → scenario → priority)
Step 4: Generate  → Candidate scenarios (happy + boundary + negative + security + a11y)
Step 5: Design    → Assertions and oracles SEPARATELY from scenarios
Step 6: Code      → Test code (only after all above exist)
Step 7: Review    → Human review with traceability back to source
```

Full prompt templates for every step (extraction, risk analysis, scenario, oracle, code) live in `references/prompt-patterns.md`. Below is the shape of each step's output.

### Step 1: Extract Requirements and Entities

Parse the input into structured elements: **Entities** (with roles/states/attributes), **Business Rules** (numbered), **Explicit Requirements** (`[REQ-N]`, stated in source), and **Implicit Requirements** (`[IMP-N]`, inferred — flag every one for human confirmation). Separating explicit from inferred is the rule that prevents testing assumptions as if they were specifications.

### Step 2: Risk Analysis and Invariants

Derive what can go wrong, what must always be true, and where the source is silent.

- **Risks** — table of `Risk | Likelihood | Impact | Source Requirement` (e.g. race condition on stock decrement, email delay > 30s).
- **Invariants** (must ALWAYS hold) — `stock >= 0`, `order total = sum(items) + tax + shipping`, `user sees only their own orders`.
- **Ambiguities** (need human answers) — "Does free shipping apply before or after discount codes?" Capture these explicitly; do not silently pick one.
- **Edge cases derived from risks** — two users buy the last item, payment succeeds but email service is down.

### Step 3: Coverage Matrix

The single most important artifact — it prevents both gaps and duplicates. Map every requirement to scenarios with category, priority, and oracle type:

| Requirement | Scenario | Category | Priority | Oracle Type |
|-------------|----------|----------|----------|-------------|
| REQ-1 | Add single item to empty cart | Happy path | P0 | State: cart count = 1 |
| REQ-1 | Add out-of-stock item | Negative | P0 | UI: error message, cart unchanged |
| REQ-2 | Complete checkout with valid card | Happy path | P0 | State: order created, stock decremented |
| REQ-2 | Two users checkout last item | Race condition | P1 | One succeeds, one gets stock error |
| INV-1 | Stock never goes negative | Invariant | P0 | Data: stock >= 0 after any operation |

After building it, verify: every requirement has ≥1 happy and ≥1 negative scenario; every invariant has a direct test; every Step-2 risk has a scenario; no two rows test the same thing.

### Step 4: Generate Candidate Scenarios

For each matrix row, write the full scenario in Given/When/Then with explicit test-data requirements (`Given: user with 99 items in cart (max 100); When: adds one more; Then: count = 100`). Cover these categories systematically:

| Category | Description |
|----------|-------------|
| Happy path | The user does exactly what the feature is designed for |
| Boundary | Edge of valid input ranges — use the BOUNDARIES framework (`references/prompt-patterns.md`) |
| Negative | Invalid inputs, unauthorized actions |
| Security | Auth bypass, injection, privilege escalation |
| Accessibility | Screen reader, keyboard-only, contrast |
| State transition | Valid and invalid moves between states |
| Concurrency | Two users acting simultaneously |

### Step 5: Design Assertions and Oracles

**Deliberately separate from Step 4.** Scenarios describe behavior; oracles describe how to verify it. For each scenario, define oracles across categories — a single assertion is rarely enough to prove a behavior:

| Oracle category | Asserts | Example |
|-----------------|---------|---------|
| UI state | Visible text / element state | `cart badge toHaveText('1')` |
| Data | Persisted state via API/DB | `GET /api/cart` returns 1 item, correct total |
| Negative | What should NOT happen | no error toast; no navigation away |
| Side effect | Async/external outcomes | analytics `add_to_cart` fired; email in inbox < 30s |

**Oracle quality rules:** assert business outcomes not implementation details; use the most specific assertion available (`toHaveText('$29.99')`, not `toBeTruthy()`); include negative assertions; verify data integrity, not just UI; assert accessibility (focus management, live-region announcements).

### Step 6: Generate Test Code

**Only after Steps 1-5 produce reviewed artifacts.** Code is a mechanical translation of scenarios + oracles into framework syntax, with traceability comments linking back to the requirement and scenario:

```typescript
/**
 * Scenario: SC-001 — Add single item to empty cart
 * Requirement: REQ-1 (User can add items to cart)
 * Priority: P0
 */
test('add single item to empty cart', async ({ page, testProduct }) => {
  await page.goto(`/products/${testProduct.id}`);                       // Given
  await page.getByRole('button', { name: 'Add to cart' }).click();      // When
  await expect(page.getByTestId('cart-badge')).toHaveText('1');         // Then
  await expect(page.getByTestId('error-toast')).not.toBeVisible();      // Negative oracle
});
```

**Code generation rules:** match project conventions (from `qa-project-context.md`); reuse existing Page Objects, fixtures, and data factories; include traceability comments (`Scenario: SC-XXX`, `Requirement: REQ-XX`); follow the project's selector strategy; put setup/teardown in fixtures, not inline.

### Step 7: Human Review

Not optional — a mandatory pipeline step. This reviews **the tests this pipeline just generated**, before they merge. (To audit a pre-existing suite you did not just generate, use `ai-qa-review` instead.) Run every generated test against this checklist:

- [ ] **Traces to requirement:** test → scenario → coverage row → requirement is followable.
- [ ] **Tests behavior, not implementation:** survives a harmless refactor.
- [ ] **Correct abstraction level:** right test type (unit vs integration vs E2E).
- [ ] **Test naming and readability:** the test name states the behavior; a reader sees intent without decoding the body.
- [ ] **Test isolation / no shared state:** the test creates and cleans up its own data, holds no order dependency on sibling tests, and passes when run alone or in any order.
- [ ] **Realistic test data:** plausible, diverse, using `example.com`.
- [ ] **Meaningful assertions:** matches the oracle definition; specific, not `toBeTruthy()`.
- [ ] **Matches project conventions:** naming, structure, selector strategy.
- [ ] **No flakiness risks:** no hardcoded timeouts, race conditions, or order dependence.
- [ ] **Edge cases included:** goes beyond the happy path.
- [ ] **Assumptions validated:** Step-2 ambiguities were resolved before coding.

**Review outcome per test:** **KEEP** (merge as-is) · **MODIFY** (fix listed issues, then merge) · **REJECT** (wrong requirement, wrong abstraction, hallucinated API) · **DEFER** (blocked on ambiguity).

## Guardrails

Hard rules. Agents MUST follow them.

- **Code before coverage is forbidden.** Never emit test code before Steps 1-3 (requirements, risk analysis with documented assumptions, coverage matrix) exist. If an agent skips to code: STOP, go back.
- **Assert outcomes, not implementation.** `expect(screen.getByRole('progressbar')).toBeVisible()`, not `expect(component.state.isLoading).toBe(true)`. `expect(page.getByTestId('cart-badge')).toHaveText('1')`, not `expect(store.dispatch).toHaveBeenCalledWith(...)`.
- **Scenarios (Step 4) before oracles (Step 5), always.** Scenario = WHAT happens; oracle = HOW to verify. Mixing them biases scenarios toward easy assertions.
- **Always produce the intermediates** — assumptions document, uncovered ambiguities, oracle candidates, and the traceability chain — even in abbreviated form.

**Flag these when detected:**
- **Hallucinated APIs** — endpoints, selectors, methods, or imports that do not exist in the codebase. Verify mechanically (see Verification) before human review.
- **Duplicate scenarios** — same behavior, trivially different data. Consolidate or parametrize.
- **Low-value assertions** — `expect(response).toBeTruthy()`, `expect(page).toHaveURL(/.*/)`.
- **Missing negative cases** — if every scenario is a happy path, the coverage matrix is incomplete.
- **Unrealistic test data** — `test@test.com`, `John Doe`, `password123`. Use diverse, plausible data on `example.com`.

## Model selection per step

Route by difficulty, not habit. Use a cheap model for mechanical extraction (Step 1) and the coverage-matrix bookkeeping (Step 3) — **Haiku 4.5** or **Sonnet 4.6** are plenty. Escalate to **Opus 4.8** for oracle design (Step 5) and hallucination-sensitive code generation (Step 6), where a wrong inference is expensive; reach for **Fable 5** only on genuinely hard reasoning (subtle invariants, regulated-domain logic). Running the strongest model on every step is wasteful; running the cheapest on Step 6 produces fabricated APIs.

## Verification

Convert the "hallucinated APIs" warning into a mechanical gate. After Step 6, before human review:

1. **Resolve imports / types.** TypeScript: `npx tsc --noEmit` — fabricated imports and wrong signatures fail here. Python: `python -m pyflakes <files>` or `ruff check`.
2. **Grep generated selectors/endpoints against the codebase.** Confirm every `getByTestId('...')` id and every API path the test calls actually exists in source:
   ```bash
   grep -roE "getByTestId\('([^']+)'\)" generated/ | sed -E "s/.*'([^']+)'.*/\1/" | sort -u \
     | while read id; do grep -rq "$id" src/ || echo "MISSING testid: $id"; done
   ```
3. **Run the suite once.** Tests that reference nonexistent routes/selectors fail fast; quarantine those before review rather than reviewing dead code.

Any `MISSING` line or `tsc` error is a hallucination to fix before a human spends review time.

## Anti-Patterns

1. **Skipping to code.** The most common failure: an agent gets a PRD and immediately writes tests. Without the coverage matrix it misses scenarios and duplicates others. The pipeline exists to prevent this.
2. **Asserting implementation instead of behavior.** `expect(component.state.isLoading).toBe(true)` breaks on any refactor. Assert `expect(screen.getByRole('progressbar')).toBeVisible()` — what the user observes.
3. **Mixing scenarios and assertions.** Writing "test this thing and check this value" as one step. Separate *what to test* from *how to verify it*.
4. **No project context in the prompt.** Without conventions and existing patterns, you get generic tests. `qa-project-context.md` exists for exactly this.
5. **Over-generating.** AI will write 50 tests for a simple function. Each carries maintenance cost. Use the coverage matrix to bound generation to meaningful scenarios.
6. **Copy-paste without understanding.** If you cannot explain what a generated test does and why, do not merge it. Tests you do not understand become tests you cannot debug.
7. **Shipping without review.** Step 7 is not optional. AI tests routinely contain hallucinated APIs, wrong selectors, incorrect business logic, and flakiness only human review catches.
8. **Ignoring the feedback loop.** When AI tests catch real bugs, note the prompt patterns that worked; when they false-positive, note what went wrong. Build a project-specific library of what works.

## Done When

- All seven artifacts exist: requirements document, risk & invariants, coverage matrix, scenario set, oracle definitions, test code, and review notes with a KEEP/MODIFY/REJECT/DEFER decision per test.
- The coverage matrix was produced and reviewed before any test code file was written.
- Verification passed: `tsc --noEmit` (or language equivalent) exits 0 and the selector/endpoint grep reports zero `MISSING` lines.
- Each generated test has a recorded human review decision; no test is marked KEEP without one.
- The suite's CI job exits 0 (green).
- Reproducibility metadata recorded: the exact model ID (e.g. `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`), input source hash, and the version of any skill / CLI / MCP server invoked.

## Related Skills

- **qa-project-context** — Set up the context file that makes AI test generation dramatically better. Configure this first.
- **playwright-automation** — Deep Playwright patterns (POM, fixtures, CI), plus the Test Agents (`init-agents --loop=claude`, scaffolded into `.claude/agents/`) and `@playwright/mcp` modes chosen in Discovery Q2. Generated tests live inside this framework.
- **unit-testing** — Jest, Vitest, pytest patterns for unit-level generated tests.
- **api-testing** — Endpoint test patterns for tests generated from OpenAPI specs.
- **test-strategy** — Decide *what* to test and at which level before generating.
- **test-reliability** — Make generated tests reliable: flake classification, healing, video receipts.
- **ai-system-testing** — When the input is an LLM feature spec, generate eval datasets here (Promptfoo, DeepEval, Ragas, Braintrust) instead of Playwright specs.
- **ai-qa-review** — Audit a *pre-existing* suite you did not just generate (test smells, testability). Step 7 here only reviews this pipeline's own output.
- **ai-bug-triage** — When generated tests find bugs, classify and report them through the triage pipeline.

## Reference Files (in `references/`)

- **prompt-patterns.md** — Full prompt library aligned to the seven steps: extraction, risk analysis, scenario generation, oracle design, and code generation prompts, plus the BOUNDARIES edge-case framework used in Step 4.
