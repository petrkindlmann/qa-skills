---
name: ai-qa-review
description: >-
  Review EXISTING test code for quality, smells, and testability issues. Detects
  test smells across six dimensions — readability, reliability, diagnostic value,
  design, AI-generated, and coverage — analyzes testability of application code,
  and backs the qualitative smells with mutation testing.
  Use when: "review my tests," "test quality audit," "test smells," "testability
  analysis," "are these tests any good." Not for: generating new tests — use
  `ai-test-generation`. Not for: testing AI features in your product — use
  `ai-system-testing`.
  Related: unit-testing, shift-left-testing, coverage-analysis, ai-test-generation.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: ai-qa
---

<objective>
QA-focused code review that detects test smells, analyzes testability of application code, and identifies coverage gaps. A test that asserts `toBe(true)` and a 95%-coverage suite that only feeds happy-path input both look green and both hide bugs — this skill names the smell, cites the line, and converts "looks fine" into a mutation-score gate.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains test framework conventions, naming patterns, and project-specific quality standards that calibrate review feedback.
</objective>

---

## Quick Route

Three distinct entry paths. Pick the row, then jump to the named section.

| Situation | Path | Jump to |
|-----------|------|---------|
| PR with changed test files | Run the changed files, score them, check the diff against the PR checklist | **Verification** → **PR Review Checklist** |
| Whole suite needs a health pass | Quantify, sample, find the 3-5 systemic smells, propose lint/mutation gates | **Batch Audit Process** |
| Application code, "why is this hard to test?" | Flag DI / side-effect / pure-function / interface problems with before/after | **Testability Analysis** |

All three share the same smell vocabulary (the six buckets below) and the same Verification commands.

---

## Discovery Questions

First, read `.agents/qa-project-context.md` if present and skip any question it already answers.

1. **Review scope:** Reviewing test code for quality, application code for testability, or both? Each triggers a different Quick Route path.
2. **Framework conventions:** What test framework (Jest, Vitest, Playwright, pytest)? Conventions differ — `describe/it` nesting, fixture usage, assertion style — and the Verification commands are per-framework.
3. **PR review or batch audit?** A PR review runs and scores only the changed files. A batch audit scans the entire suite for systemic patterns.
4. **Existing quality standards:** Does the team have documented test conventions? Check for `.eslintrc` test rules, `CONTRIBUTING.md` test guidelines, or a test style guide.
5. **Known pain points:** Recurring flaky tests, slow suites, unclear failures? These prioritize which smells to focus on first.

---

## Core Principles

1. **Test code is production code.** Apply the same quality standards: readability, maintainability, single responsibility. Test code that is hard to read is hard to trust.

2. **Review what is asserted, not just what is executed.** Coverage proves a line ran; it says nothing about whether a wrong value would be caught. A 95%-coverage suite of `toBeTruthy` assertions catches almost nothing. Mutation score (see **Verification**) measures the thing coverage can't.

3. **Testability review prevents test debt.** Reviewing application code for testability catches design problems before they force awkward test workarounds. If code is hard to test, it is usually hard to maintain.

4. **Codify patterns, not just knowledge.** Turn recurring review feedback into lint rules, custom ESLint plugins, or shared fixtures. Reviews that repeat the same feedback indicate missing automation.

5. **Smells are symptoms, not verdicts.** A test smell indicates a potential problem; context decides whether it is actually harmful. A long test for a complex workflow may be appropriate. A mock-heavy test for a boundary may be correct.

6. **Actionable feedback only.** Every review comment must include what is wrong, why it matters, and how to fix it. "This test is bad" is not actionable. "This test uses sleep-based waiting which causes flakiness — replace with an explicit wait condition" is.

---

## Test Smell Buckets

Six dimensions. Each smell is categorized by the dimension it affects and links to a specific review action. Full SMELL/FIX code for every catalogued smell lives in `references/smell-examples.md` — keep the inline pointers prominent; the before/after code is the load-bearing part.

### Readability Smells

Problems that make tests hard to understand at a glance.

#### Obscure Setup

**What it looks like:** 30+ lines of object construction with irrelevant fields drowning the test intent. The reader cannot tell which fields matter for the assertion.

**Fix:** Extract to factories. Only test-relevant data should appear in the test body: `buildOrder({ items: [buildItem({ weight: 2.5, quantity: 2 })] })` instead of constructing full user/product/order objects inline.

**Review action:** Request factory extraction.

#### Mystery Guest

**What it looks like:** `loadFixture('report.json')` — the test depends on external data the reader cannot see. They must open another file to understand the assertion.

**Fix:** Inline the test-relevant data or use descriptively named fixtures. The reader should understand the test without opening other files.

**Review action:** Request inline data or descriptive fixture names.

#### Duplicate Assertions

**What it looks like:** Multiple tests assert the same behavior with varying specificity (`toBe('Alice')`, `toHaveProperty('name')`, `toBeDefined()`). Three tests, one behavior.

**Review action:** Request consolidation. Keep the most specific assertion. Redundant tests increase maintenance cost without increasing confidence.

---

### Reliability Smells

Problems that cause tests to fail intermittently or in unexpected environments.

#### Sleep-Based Waiting

**What it looks like:** `setTimeout`, `sleep()`, `waitForTimeout()` used for synchronization. See `references/smell-examples.md` for the SMELL/FIX pair (replace `waitForTimeout` with an explicit `toBeVisible` wait).

**Review action:** Reject. Sleep-based waiting is never acceptable. Require explicit wait conditions.

#### Order Dependency

**What it looks like:** Tests pass when run together but fail in isolation or different order. See `references/smell-examples.md` for the SMELL/FIX pair (each test creating its own preconditions).

**Review action:** Request data isolation. Each test must create its own preconditions.

#### External Service Coupling

**What it looks like:** Tests call real external APIs (payment gateways, email providers, third-party services). See `references/smell-examples.md` for the SMELL/FIX pair (mocking the service boundary).

**Review action:** Request mock or fake at the service boundary. External calls belong in integration/contract tests, not unit tests.

---

### Diagnostic Smells

Problems that make test failures hard to understand and debug.

#### Weak Assertion Messages

**What it looks like:** Assertion fails with no context about what was expected or why. See `references/smell-examples.md` for the SMELL/FIX pair (replacing `toBe(true)` with specific assertions like `expect(result.errors).toEqual([])` that surface the offending value).

**Review action:** Request stronger assertions with diagnostic value. The failure message should explain the problem without reading the test source.

#### Multiple Failure Causes Per Test

**What it looks like:** A single test covers multiple independent behaviors. When it fails, you do not know which behavior broke. See `references/smell-examples.md` for the SMELL/FIX pair (splitting a lifecycle test into one-behavior-per-test).

**Review action:** Request test splitting. Each test should have one reason to fail.

---

### Design Smells

Problems in test architecture that increase maintenance cost.

#### Conditional Test Logic

**What it looks like:** `if/else`, `switch`, ternaries, or `for` loops inside test bodies. Branching logic in a test is itself untested — you cannot tell which cases actually ran. See `references/smell-examples.md` for the SMELL/FIX pair (converting a branching loop into `it.each`).

**Review action:** Request parameterized tests (`it.each` / `test.each`). Conditional logic in tests hides which cases are actually verified.

#### Giant Fixtures

**What it looks like:** A `beforeEach` or fixture that sets up 20+ objects for every test, even though each test uses 2-3 of them. See `references/smell-examples.md` for the SMELL/FIX pair (replacing a monolithic `beforeEach` with per-test inline setup).

**Review action:** Request inline setup. Move shared setup to factories, not monolithic `beforeEach` blocks.

#### Over-Mocking

**What it looks like:** Every collaborator is mocked, including simple value objects and pure functions. See `references/smell-examples.md` for the SMELL/FIX pair (dropping a mock of the very function under test).

**Review action:** Request removal of unnecessary mocks. Mock boundaries, not internals.

---

### AI-Generated Test Smells

When the test code came from a coding agent (Claude Code, Codex, Cursor, Copilot), the smell taxonomy is the same — but a few signature failures recur often enough to deserve their own pass.

| Smell | Detection |
|-------|-----------|
| **Hallucinated locator** | Run the test against a real page once. If the locator never matches, the LLM invented a `data-testid` that doesn't exist. |
| **Fabricated import** | Static-check every imported symbol — does the file or package actually export it? LLMs invent plausible APIs (`@testing-library/something-that-doesnt-exist`). |
| **Generic test data** | `example.com`, `test@test.com`, `Lorem ipsum`, `John Doe` — boilerplate the agent generated because it had no project-specific factory. Replace with the project's data factory. |
| **Closed AI loop** | Both implementation *and* tests authored by the same agent in the same session. The tests just describe what the agent produced; they don't constrain it. Pair the agent's tests with at least one human-authored boundary test, or use TDD (test-first) per `shift-left-testing`. A low mutation score (see **Verification**) is the objective tell. |
| **Project-convention drift** | Page Object, fixture, naming, or assertion style different from the rest of the suite. AI-generated code rarely matches local conventions out of the box. |

For first-time test generation patterns and the Step-7 review checklist, cross-link `ai-test-generation`. For AI-system *eval suites* (the equivalent of ESLint for prompts), wire each tool's CLI runner — `promptfoo eval`, `deepeval test run` (Apache 2.0), Ragas `ragas evaluate` / experiments (Apache 2.0) — as quality gates parallel to your test runner.

> **Promptfoo ownership note:** Promptfoo was acquired by OpenAI (announced 9 Mar 2026). The core stays MIT-licensed, open source, and model-agnostic; red-team capabilities are being folded into OpenAI Frontier. `promptfoo eval` is still the correct quality-gate command — just expect the vendor to be OpenAI going forward.

### Coverage Smells

Problems that leave gaps in what is verified.

#### Happy Path Only

**What it looks like:** Every test provides valid input and expects success. No error paths tested. See `references/smell-examples.md` for the SMELL/FIX pair (adding zero, max, negative, and boundary cases to a discount calculator).

**Review action:** Request missing scenarios. Use the BOUNDARY framework: Boundary values, Null/empty, Duplicates, Ordering, Range limits.

#### Missing Boundary Cases

**What it looks like:** Tests for "normal" values (5 items) but not for 0, 1, max, or max+1. Use `it.each` to cover boundaries explicitly: empty collection, single item, exact page size, one over, large set.

**Review action:** Request boundary tests. Every numeric parameter, string length, and collection size has boundaries to test.

#### Missing Error/Negative Cases

**What it looks like:** No tests for what happens when things go wrong — network failures, invalid input, permission denied, concurrent modification.

**Review action:** For each happy path test, ask: "What is the corresponding failure mode?" Request tests for the failure.

---

## Testability Analysis

When reviewing application code, assess whether it is structured for testability. Each subsection has a hard-to-test vs. testable before/after in `references/testability-refactors.md`.

### Dependency Injection

Flag classes that instantiate dependencies directly (`new PostgresDatabase()`, `new StripeClient()` inside methods). Suggest constructor injection so tests can substitute mocks/fakes. See `references/testability-refactors.md`.

### Side Effect Isolation

Flag functions that mix pure calculation with I/O (email, logging, analytics). Extract the calculation as a pure function, then call it from the side-effectful orchestrator. See the `calcTotal` before/after in `references/testability-refactors.md`.

### Pure Function Extraction

Look for validation, transformation, and business rules buried inside request handlers. If logic is inline in `app.post('/api/orders', ...)`, it cannot be unit-tested without spinning up an HTTP server. Extract it as a standalone function. See the `shippingFor` before/after in `references/testability-refactors.md`.

### Interface Segregation

Flag classes that depend on broad interfaces (entire `PrismaClient`) when they only use 2-3 methods. Suggest a narrow interface with only the methods actually used, making test doubles trivial to implement. See `references/testability-refactors.md`.

---

## Review Workflow

### PR Review Checklist

For each test file in a PR, check systematically:

```markdown
## Test Quality Review

### Readability
- [ ] Can I understand what each test verifies in under 10 seconds?
- [ ] Is setup minimal and test-relevant?
- [ ] Are test names descriptive: "should [behavior] when [condition]"?

### Reliability
- [ ] No sleep/waitForTimeout/setTimeout for synchronization?
- [ ] No shared mutable state between tests?
- [ ] No dependency on test execution order?
- [ ] No calls to real external services?

### Diagnostic Value
- [ ] Will failures produce messages that identify the problem?
- [ ] Does each test have one reason to fail?
- [ ] Are assertions specific (not toBeTruthy/toBeDefined)?

### Design
- [ ] No conditional logic (if/else/switch/for) in test bodies?
- [ ] Fixtures/setup proportional to what each test needs?
- [ ] Mocking limited to external boundaries?
- [ ] Parameterized tests (it.each) used for data-driven scenarios?

### AI-Generated (if applicable)
- [ ] Locators verified against a real page (no hallucinated data-testid)?
- [ ] Imports resolve (no fabricated APIs)?
- [ ] Project data factory used, not test@test.com / John Doe?

### Coverage
- [ ] Happy path AND error/negative paths tested?
- [ ] Boundary values tested (0, 1, max, max+1)?
- [ ] Edge cases: empty, null, duplicate, concurrent?
```

### Batch Audit Process

For a full test suite audit:

1. **Quantify:** Count tests by type (unit/integration/E2E), framework, and directory.
2. **Sample:** Review 10-20% of test files, prioritizing the largest and most recently changed.
3. **Pattern:** Identify the 3-5 most common smells across the sample.
4. **Prioritize:** Rank by impact: reliability smells > diagnostic smells > design smells > readability smells.
5. **Automate:** For each common smell, determine if an ESLint rule or a mutation-score gate can catch it automatically.
6. **Report:** Document findings (one row per file reviewed) with specific examples, suggested fixes, severity (high/medium/low), and estimated effort.

---

## Prompt Templates

Three prompt patterns for AI-assisted review:

1. **Review test quality:** "Check this test file for readability, reliability, diagnostic, design, AI-generated, and coverage smells. For each issue: name the smell, cite the line, explain why it matters, and provide a fix."

2. **Identify coverage gaps:** "Given this application code and its existing tests, identify missing scenarios across happy path, error handling, boundaries, edge cases, concurrency, and security. Prioritize as P0/P1/P2."

3. **Testability improvements:** "Review this application code for hard-coded dependencies, mixed side effects, extractable pure functions, and overly broad interfaces. Show current vs. refactored code."

---

## Anti-Patterns

1. **Reviewing test code with production-code standards only.** Test code has additional quality dimensions (reliability, diagnostics, coverage) that production-code linters do not check. Apply the six smell buckets, not just "clean code" principles.

2. **Flagging every smell without context.** A 50-line test for a complex state machine is not obscure setup — it is necessary complexity. Evaluate smells against the behavior being tested.

3. **Suggesting mocks for everything.** Over-mocking is itself a smell. Do not recommend mocking pure functions, value objects, or fast in-process collaborators. Mock boundaries: network, database, filesystem, clock.

4. **Focusing on coverage percentage over coverage quality.** 95% line coverage with only happy-path tests is worse than 75% coverage that includes error paths and boundaries. Review what is asserted, not just what is executed — and back it with mutation score.

5. **Reviewing without running.** Static analysis misses runtime issues. Run the suite (see **Verification**), check for flakiness with repeated runs, and check execution time. A passing suite that takes 20 minutes has a performance smell.

6. **One-time review without follow-up.** Test quality degrades over time. Establish a recurring review cadence or automated quality gates (lint rule, mutation threshold) that catch regression.

---

## Verification

Run before you start commenting — these are the runtime checks the skill insists on, made concrete. Scope them to the PR's changed test files in PR review; run the whole suite in a batch audit.

1. **Run the suite once.** Confirm it is green before reviewing — never review red or skipped tests as if they pass.
   - Vitest: `npx vitest run <files>` · Jest: `npx jest <files>` · Playwright: `npx playwright test <files>` · pytest: `pytest <files>`
2. **Repeat to surface flakiness.** A test that passes once and fails on the next run is the reliability smell, not a fluke.
   - Vitest: `npx vitest run --retry=0 <files>` looped, or `for i in 1 2 3; do npx vitest run <files> || break; done`
   - Jest: `npx jest <files> && npx jest <files> && npx jest <files>` (or `jest-circus` repeat)
   - Playwright: `npx playwright test --repeat-each=3 <files>`
   - pytest: `pytest --count=3 <files>` (pytest-repeat) or `pytest -p no:randomly` vs random order to catch order dependency
3. **Capture per-test timing.** A 20-minute suite has a performance smell.
   - Vitest: `--reporter=verbose` (prints per-test duration) · Jest: `--verbose` · Playwright: `--reporter=list` · pytest: `--durations=10`
4. **Mutation score — the objective backstop.** For the qualitative smells you can't eyeball at scale (Closed AI loop, weak assertions), run a mutation runner and read the score. AI-generated tests under ~60% mutation score are not constraining the implementation. Full tooling, thresholds, and config in `references/mutation-testing.md`.
   - JS/TS: `npx stryker run` · Java: PIT `mvn ... mutationCoverage` · Rust: `cargo mutants` · Python: `mutmut run`

Output of steps 1-3 plus the mutation score is the evidence behind every "reliability"/"diagnostic" finding in the report.

---

## Done When

- The findings artifact exists with one row per reviewed file, each row carrying a severity rating (high/medium/low). (file exists, row count == files reviewed)
- Every smell dimension that applies to the reviewed code is covered: readability, reliability, diagnostic, design, AI-generated, coverage. (six headings present in the report; "N/A" allowed, blank not)
- Each high-severity finding has an actionable remediation step (what + why + fix), not just a description.
- Verification ran: the suite executed at least 3x green (no flaky failures) and per-test timing captured; for AI-generated suites, a mutation score is recorded.
- At least one recurring smell was converted to an automated gate — an ESLint rule, a CI check, or a mutation-score threshold committed — or the report explicitly states none was warranted.

---

## Reference Files (in `references/`)

- **smell-examples.md** — Full SMELL/FIX code for every catalogued smell across reliability, diagnostic, design, and coverage dimensions.
- **testability-refactors.md** — Hard-to-test vs. testable before/after for all four testability subsections: dependency injection, side effect isolation, pure function extraction, interface segregation.
- **mutation-testing.md** — Tooling (Stryker/PIT/cargo-mutants/mutmut), thresholds, Stryker config, and the AI-loop / weak-assertion gate.

---

## Related Skills

- **unit-testing** — Framework-specific patterns (Jest, Vitest, pytest) that inform what "good" looks like for each framework.
- **shift-left-testing** — Pre-commit hooks and IDE integration that catch test smells before review.
- **coverage-analysis** — Interpreting coverage reports to find meaningful gaps, not just percentage targets.
- **ai-test-generation** — Generated tests need review too. Apply these smell checks to AI-generated test code.
- **test-reliability** — Reliability smells (sleep-based waits, order dependency) overlap with flaky test patterns.
