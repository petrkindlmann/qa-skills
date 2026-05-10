---
name: ai-test-generation
description: >-
  Staged pipeline for AI-assisted test generation: requirements extraction → risk
  analysis → coverage matrix → scenario generation → oracle design → test code →
  human review. Includes guardrails against common AI test generation failures.
  Use when: "generate tests," "AI tests," "tests from spec," "tests from PRD,"
  "tests from user story," "auto-generate test cases."
  Related: playwright-automation, unit-testing, api-testing, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: ai-qa
---

<objective>
A staged pipeline for generating tests with LLMs. The pipeline enforces structured intermediates at every step so that agents produce traceable, reviewable, high-quality tests instead of ad-hoc code.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains tech stack, test frameworks, naming conventions, and project-specific patterns that dramatically improve generated test quality.
</objective>

---

## Discovery Questions

Before generating tests, clarify:

1. **What is the input source?**
   - PRD / feature spec / design doc
   - User story with acceptance criteria
   - Code diff (PR or commit range)
   - Bug report / incident report
   - API schema (OpenAPI / GraphQL SDL)

2. **What is the target test framework?**
   - **E2E:** Playwright (preferred), Cypress
   - **Unit:** Jest, Vitest, pytest
   - **API:** Playwright API testing, supertest, requests
   - **AI/LLM features:** Promptfoo, DeepEval, Ragas, or Braintrust — generate eval datasets, not Playwright specs (cross-link `ai-system-testing`)

2a. **What agent integration mode?** (Playwright projects only)
   - **Playwright CLI + SKILLS** (recommended for Claude Code / Codex / Cursor): token-efficient, runs inside the agent's loop. `npx playwright init-agents --loop=claude` scaffolds the planner/generator/healer.
   - **Playwright MCP** (`@playwright/mcp@latest`): higher overhead but right when the agent needs to *drive* a live browser interactively over a long-running session.
   - **Neither** — hand-write tests using AI as a scratch-pad helper.

3. **What project context is available?**
   - Existing test patterns to match?
   - Page Object Models or test helpers?
   - Data factories or fixtures?
   - CI constraints (timeout, parallelism)?

4. **What is the review workflow?**
   - AI generates full pipeline artifacts -> human reviews -> merge (default)
   - AI generates scenarios only -> human writes code
   - AI generates code -> human refines iteratively

5. **What domain knowledge is needed?**
   - Regulated industry (healthcare, finance) with compliance requirements?
   - Domain-specific invariants (money never goes negative, appointments cannot overlap)?
   - Known risk areas from past incidents?

---

## Core Principles

1. **Pipeline before code.** Never generate test code before establishing what to test, why, and how to verify it. The seven-step pipeline exists to prevent premature code generation.

2. **Structured intermediates are the product.** The assumptions document, coverage matrix, and oracle definitions are more valuable than the test code itself. They are reviewable, traceable, and reusable.

3. **Separate what from how.** Scenario generation (what to test) and oracle design (how to verify) are distinct cognitive tasks. Mixing them produces weak scenarios with weak assertions.

4. **AI generates first draft; human reviews and refines.** Never ship AI-generated tests without human review. The AI accelerates -- it does not replace judgment.

5. **Context is everything.** Feed the LLM your project conventions, existing test patterns, selector strategies, and data setup patterns. The more context, the less cleanup.

6. **Quality over quantity.** More tests is not better. Each test has a maintenance cost. Focus on critical paths, complex logic, and known risk areas.

---

## The Pipeline

**Mandatory workflow -- agents MUST follow this order:**

```
Step 1: Extract   → Requirements, entities, business rules from input
Step 2: Analyze   → Risks, invariants, edge cases, ambiguities
Step 3: Map       → Coverage matrix (requirement → scenario → priority)
Step 4: Generate  → Candidate scenarios (happy + boundary + negative + security + a11y)
Step 5: Design    → Assertions and oracles SEPARATELY from scenarios
Step 6: Code      → Test code (only after all above exist)
Step 7: Review    → Human review with traceability back to source
```

### Step 1: Extract Requirements and Entities

Parse the input source (PRD, story, diff, schema, bug report) into structured elements.

**Output: Requirements Document**

```markdown
## Source: [PRD name / Story ID / PR #123 / Bug #456]

### Entities
- User (roles: admin, member, guest)
- Order (states: draft, confirmed, shipped, delivered, cancelled)
- Product (attributes: name, price, stock, category)

### Business Rules
1. Only admin users can cancel orders after shipment
2. Stock must be decremented at order confirmation, not at checkout start
3. Free shipping applies when order total exceeds $99 before tax

### Explicit Requirements
- [REQ-1] User can add items to cart
- [REQ-2] User can proceed to checkout with valid payment
- [REQ-3] Order confirmation email is sent within 30 seconds

### Implicit Requirements (inferred)
- [IMP-1] Cart persists across browser sessions (assumed from "seamless experience" language)
- [IMP-2] Concurrent cart modifications resolve without data loss
```

**Key rule:** Separate explicit requirements (stated in source) from implicit requirements (inferred). Flag implicit ones for human confirmation.

### Step 2: Risk Analysis and Invariants

Derive what can go wrong, what must always be true, and where ambiguities exist.

**Output: Risk and Invariants Document**

```markdown
## Risks
| Risk | Likelihood | Impact | Source Requirement |
|------|-----------|--------|-------------------|
| Race condition on stock decrement | High | High | REQ-2, Business Rule #2 |
| Email delivery delay > 30s | Medium | Medium | REQ-3 |
| Cart data lost on session expiry | Medium | High | IMP-1 |

## Invariants (must ALWAYS be true)
- Stock count >= 0 (never negative)
- Order total = sum(item prices * quantities) + tax + shipping
- Cancelled order restores stock to original count
- User can only see their own orders (not other users')

## Ambiguities (need human clarification)
- What happens when stock reaches 0 during checkout? Block checkout or allow backorder?
- Does "free shipping over $99" apply before or after discount codes?
- What is the session timeout for cart persistence?

## Edge Cases Derived from Risks
- Two users buy the last item simultaneously
- User adds item, item goes out of stock before checkout
- Payment succeeds but email service is down
```

### Step 3: Coverage Matrix

Map requirements to test scenarios with priority and category. This is the single most important artifact -- it prevents both gaps and duplicates.

**Output: Coverage Matrix**

```markdown
| Requirement | Scenario | Category | Priority | Oracle Type |
|-------------|----------|----------|----------|-------------|
| REQ-1 | Add single item to empty cart | Happy path | P0 | State: cart count = 1 |
| REQ-1 | Add item when already 99 items in cart | Boundary | P1 | State: cart count = 100 or error |
| REQ-1 | Add out-of-stock item | Negative | P0 | UI: error message, cart unchanged |
| REQ-2 | Complete checkout with valid card | Happy path | P0 | State: order created, stock decremented |
| REQ-2 | Checkout with expired card | Negative | P0 | UI: payment error, no order created |
| REQ-2 | Two users checkout last item | Race condition | P1 | One succeeds, one gets stock error |
| REQ-3 | Email sent after order confirmation | Happy path | P0 | Side effect: email in inbox < 30s |
| IMP-1 | Cart persists after browser restart | Implicit | P1 | State: same items on reload |
| INV-1 | Stock never goes negative | Invariant | P0 | Data: stock >= 0 after any operation |
```

**Coverage analysis:** After creating the matrix, check:
- Every requirement has at least one happy path and one negative scenario
- Every invariant has a direct test
- Every risk from Step 2 has a corresponding scenario
- No two scenarios test the exact same thing

### Step 4: Generate Candidate Scenarios

For each row in the coverage matrix, generate the full scenario specification.

**Output: Scenario Set**

Use Given/When/Then format with explicit test data requirements:

```markdown
## SC-001: Add single item to empty cart
- **Requirement:** REQ-1
- **Category:** Happy path
- **Priority:** P0
- **Given:** Authenticated user with empty cart; product "Wireless Mouse" in stock (qty: 50)
- **When:** User navigates to product page and clicks "Add to cart"
- **Then:** Cart badge shows "1"; cart page lists "Wireless Mouse" with quantity 1
- **Test data:** Product with known ID, sufficient stock
- **Notes:** Verify price displayed matches product price

## SC-002: Add item when cart has 99 items
- **Requirement:** REQ-1
- **Category:** Boundary
- **Priority:** P1
- **Given:** Authenticated user with 99 items in cart (maximum is 100)
- **When:** User adds one more item
- **Then:** Cart accepts the item (count = 100)
- **Test data:** Cart pre-seeded with 99 items via API
- **Notes:** Also test adding when at 100 (should show max cart error)
```

**Scenario categories to cover systematically:**

| Category | Description | Prompt Pattern |
|----------|-------------|---------------|
| Happy path | Normal successful flow | "The user does exactly what the feature is designed for" |
| Boundary | Edge of valid input ranges | Use BOUNDARIES framework (see reference) |
| Negative | Invalid inputs, unauthorized actions | "What happens when the user does it wrong?" |
| Security | Auth bypass, injection, privilege escalation | "How could a malicious user exploit this?" |
| Accessibility | Screen reader, keyboard-only, contrast | "Can every user type complete this flow?" |
| State transition | Moving between valid states | "What state transitions are valid and invalid?" |
| Concurrency | Simultaneous actions | "What if two users do this at the same time?" |

### Step 5: Design Assertions and Oracles

**This step is deliberately separate from scenario generation.** Scenarios describe behavior. Oracles describe how to verify it. Mixing them produces either weak scenarios (biased toward what is easy to assert) or weak assertions (tacked on as afterthoughts).

**Output: Oracle Definitions**

For each scenario, define the verification strategy:

```markdown
## SC-001: Add single item to empty cart

### UI State Oracles
- Cart badge text = "1"
- Cart page contains product name "Wireless Mouse"
- Cart page shows quantity = 1
- Cart page shows correct unit price

### Data Oracles
- GET /api/cart returns 1 item with correct product ID
- Cart total = product price (no tax/shipping yet)

### Negative Oracles (should NOT happen)
- No error toast visible
- No page reload or navigation away from product page (for async add-to-cart)

### Side Effect Oracles
- Analytics event "add_to_cart" fired with correct product ID
```

**Oracle quality rules:**
- Assert business outcomes, not implementation details
- Use the most specific assertion available (`toHaveText('$29.99')` not `toBeTruthy()`)
- Include negative assertions (what should NOT happen)
- Verify data integrity, not just UI state
- Assert accessibility: focus management, live region announcements

### Step 6: Generate Test Code

**Only after Steps 1-5 produce reviewed artifacts.**

The test code is a mechanical translation of scenarios + oracles into framework-specific syntax. Include traceability comments linking back to requirements and scenarios.

```typescript
/**
 * Scenario: SC-001 — Add single item to empty cart
 * Requirement: REQ-1 (User can add items to cart)
 * Priority: P0
 */
test('add single item to empty cart', async ({ page, testProduct }) => {
  // Given: authenticated user with empty cart
  await page.goto(`/products/${testProduct.id}`);

  // When: user clicks "Add to cart"
  await page.getByRole('button', { name: 'Add to cart' }).click();

  // Then: cart badge shows "1"
  await expect(page.getByTestId('cart-badge')).toHaveText('1');

  // Then: cart page lists the product
  await page.getByTestId('cart-badge').click();
  await expect(page.getByTestId('cart-item-name')).toHaveText('Wireless Mouse');
  await expect(page.getByTestId('cart-item-quantity')).toHaveText('1');
  await expect(page.getByTestId('cart-item-price')).toHaveText('$29.99');

  // Negative oracle: no error state
  await expect(page.getByTestId('error-toast')).not.toBeVisible();
});
```

**Code generation rules:**
- Match project conventions (from `qa-project-context.md`)
- Use existing Page Objects, fixtures, and data factories
- Include traceability comments (`Scenario: SC-XXX`, `Requirement: REQ-XX`)
- Follow the project's selector strategy
- Include setup and teardown via fixtures, not inline

### Step 7: Human Review

The review is not optional. It is a mandatory step in the pipeline.

**Review checklist for each generated test:**

- [ ] **Traces to requirement:** Can I follow the chain from test -> scenario -> coverage row -> requirement?
- [ ] **Tests behavior, not implementation:** Would this break on a harmless refactor?
- [ ] **Correct abstraction level:** Is this the right type of test (unit vs. integration vs. E2E)?
- [ ] **Realistic test data:** Are the values plausible, diverse, and using `example.com`?
- [ ] **Proper setup and teardown:** Does it create and clean up its own state?
- [ ] **Meaningful assertions:** Does it assert the right things from the oracle definition?
- [ ] **Matches project conventions:** Same naming, structure, selector strategy?
- [ ] **No flakiness risks:** Hardcoded timeouts? Race conditions? Order-dependent?
- [ ] **Edge cases included:** Does it go beyond the happy path?
- [ ] **Assumptions validated:** Were ambiguities from Step 2 resolved before coding?

**Review outcomes per test:**
- **KEEP** — Merge as-is
- **MODIFY** — Fix specific issues, then merge
- **REJECT** — Fundamental problem (wrong requirement, wrong abstraction level, hallucinated API)
- **DEFER** — Blocked on ambiguity resolution

---

## Guardrails

These are hard rules. Agents MUST follow them.

### Code-Before-Coverage Prevention

```
NEVER generate test code before producing:
1. Requirements extraction (Step 1)
2. Risk analysis with documented assumptions (Step 2)
3. Coverage matrix (Step 3)

If an agent skips to code: STOP. Go back. The intermediates exist to prevent
generating tests for the wrong things.
```

### Assertion Quality

```
NEVER assert implementation details instead of business outcomes.

BAD:  expect(component.state.isLoading).toBe(true)
GOOD: expect(screen.getByRole('progressbar')).toBeVisible()

BAD:  expect(store.dispatch).toHaveBeenCalledWith({ type: 'ADD_ITEM' })
GOOD: expect(page.getByTestId('cart-badge')).toHaveText('1')
```

### Separation of Concerns

```
ALWAYS generate scenarios (Step 4) BEFORE oracles (Step 5).

Scenario: WHAT happens (user action + expected outcome in plain language)
Oracle: HOW to verify it (specific assertions in framework syntax)

Mixing them produces scenarios biased toward what is easy to assert,
missing scenarios that require creative verification.
```

### Structured Intermediates

```
ALWAYS produce these artifacts (even in abbreviated form):
- Assumptions document (what was inferred, not stated)
- Uncovered ambiguities (questions that need human answers)
- Oracle candidates (before selecting final assertions)
- Traceability chain (test → scenario → requirement)
```

### Common Warnings

Agents MUST flag these when detected:

- **Hallucinated APIs:** Test code references endpoints, selectors, or methods that do not exist in the codebase. Always verify against actual code or project context.
- **Duplicate scenarios:** Two scenarios that test the same behavior with trivially different data. Consolidate or parametrize.
- **Low-value assertions:** `expect(response).toBeTruthy()` or `expect(page).toHaveURL(/.*/)`
- **Missing negative cases:** If every scenario is a happy path, the coverage matrix is incomplete.
- **Unrealistic test data:** `test@test.com`, `John Doe`, `password123` -- use diverse, plausible data.

---

## Input Formats

The pipeline handles five input types. Each requires different extraction in Step 1.

### PRD / Feature Spec

Richest input. Extract: entities, business rules, acceptance criteria, non-functional requirements, stated assumptions.

### User Story with Acceptance Criteria

```
As a [role], I want to [action], so that [benefit].

Acceptance Criteria:
- AC1: Given X, When Y, Then Z
- AC2: ...
```

Each acceptance criterion maps to at least one happy-path scenario and one negative scenario.

### Code Diff

```bash
git diff main...HEAD
```

Extract: new code paths, changed behavior, removed functionality, modified conditionals, updated error handling. Focus regression tests on changed code paths.

### Bug Report

Extract: reproduction steps, expected vs actual behavior, environment conditions. Generate a failing test that asserts the *expected* behavior (fails with bug present, passes after fix).

### API Schema (OpenAPI / GraphQL)

Extract: endpoints, request/response schemas, required fields, enum values, auth requirements. Generate tests for: success, validation errors, auth failures, edge cases per endpoint.

---

## Done When

- Coverage matrix document exists and was reviewed before any test code was written
- Generated tests reviewed by a human with intentional gaps noted in the review notes
- At least one round of refinement applied to fix hallucinated selectors or wrong assertions
- Tests run green in CI with no failures attributed to generation errors
- Generation prompt and model version documented for reproducibility — capture the exact model ID (e.g. `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`), input source hash, and the version of any skill / CLI / MCP server invoked
- All seven pipeline artifacts exist: requirements document, risk & invariants, coverage matrix, scenario set, oracle definitions, test code, and review notes with KEEP/MODIFY/REJECT decisions

---

## Anti-Patterns

### 1. Skipping to Code

The most common failure. An agent gets a PRD and immediately writes test code. Without the coverage matrix, it will miss scenarios and duplicate others. **The pipeline exists to prevent this.**

### 2. Asserting Implementation Instead of Behavior

```typescript
// BAD — tied to implementation
expect(component.state.isLoading).toBe(true);
// GOOD — tests behavior
expect(screen.getByRole('progressbar')).toBeVisible();
```

### 3. Mixing Scenarios and Assertions

Writing "test this thing and check this specific value" as one step. Separate thinking about *what to test* from *how to verify it*.

### 4. No Project Context in the Prompt

Without context, you get generic tests. Feed the LLM your conventions, existing patterns, and project-specific concerns. The `qa-project-context.md` file is designed for exactly this.

### 5. Over-Generating

AI will happily generate 50 tests for a simple function. Each test has a maintenance cost. Use the coverage matrix to limit generation to meaningful scenarios.

### 6. Copy-Paste Without Understanding

If you cannot explain what a generated test does and why, do not merge it. Tests you do not understand become tests you cannot debug when they fail.

### 7. Shipping Without Review

Step 7 is not optional. AI-generated tests frequently contain hallucinated APIs, wrong selectors, incorrect business logic, and flakiness risks that only human review catches.

### 8. Ignoring the Feedback Loop

When AI-generated tests catch real bugs, note the prompt patterns that produced them. When they produce false positives, note what went wrong. Build a library of what works for your project.

---

## Related Skills

- **`qa-project-context`** — Set up the project context file that makes AI test generation dramatically better. Always configure this first.
- **`playwright-automation`** — Deep Playwright patterns -- POM, fixtures, CI setup, plus Test Agents (`init-agents --loop=claude`) and `@playwright/mcp` for the agent integration mode chosen in Q2a. Use generated tests within this framework.
- **`unit-testing`** — Jest, Vitest, pytest patterns for unit-level AI-generated tests.
- **`api-testing`** — API test patterns for AI-generated endpoint tests from OpenAPI specs.
- **`test-strategy`** — Decide *what* to test and at which level before generating tests.
- **`test-reliability`** — Ensure generated tests are reliable: flake classification, healing patterns, agentic video receipts via `page.screencast`.
- **`ai-system-testing`** — When the input source is an LLM feature spec, generate eval datasets here (Promptfoo, DeepEval, Ragas, Braintrust) instead of Playwright specs.
- **`ai-qa-review`** — Mandatory Step-7 review for AI-generated tests: hallucinated locators, fabricated imports, generic test data, closed AI loops.
- **`ai-bug-triage`** — When generated tests find bugs, use the triage pipeline to classify and report them.

---

## References

- `references/prompt-patterns.md` — Prompt library aligned with the staged pipeline: extraction prompts, risk analysis prompts, scenario generation prompts, oracle design prompts, and code generation prompts.
