---
name: ai-qa-review
description: >-
  QA-focused code review for test quality. Detects test smells across readability,
  reliability, diagnostic value, design, and coverage dimensions. Analyzes testability
  of application code and identifies coverage gaps. Based on xUnit Test Patterns
  and modern test smell research. Use when: "review tests," "test quality," "test code
  review," "test smells," "testability analysis," "coverage gaps."
  Related: unit-testing, shift-left-testing, coverage-analysis, ai-test-generation.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: ai-qa
---

<objective>
QA-focused code review that detects test smells, analyzes testability of application code, and identifies coverage gaps.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains test framework conventions, naming patterns, and project-specific quality standards that calibrate review feedback.
</objective>

---

## Discovery Questions

1. **Review scope:** Reviewing test code for quality, application code for testability, or both? Each triggers different analysis patterns.
2. **Framework conventions:** What test framework (Jest, Vitest, Playwright, pytest)? Conventions differ -- `describe/it` nesting, fixture usage, assertion style.
3. **PR review or batch audit?** A PR review focuses on changed files. A batch audit scans the entire test suite for systemic patterns.
4. **Existing quality standards:** Does the team have documented test conventions? Check for `.eslintrc` test rules, `CONTRIBUTING.md` test guidelines, or a test style guide.
5. **Known pain points:** Are there recurring problems -- flaky tests, slow suites, unclear failures? These prioritize which smells to focus on first.

---

## Core Principles

1. **Test code is production code.** Apply the same quality standards: readability, maintainability, single responsibility. Test code that is hard to read is hard to trust.

2. **Testability review prevents test debt.** Reviewing application code for testability catches design problems before they force awkward test workarounds. If code is hard to test, it is usually hard to maintain.

3. **Codify patterns, not just knowledge.** Turn recurring review feedback into lint rules, custom ESLint plugins, or shared fixtures. Reviews that repeat the same feedback indicate missing automation.

4. **Smells are symptoms, not verdicts.** A test smell indicates a potential problem. Context determines whether it is actually harmful. A long test for a complex workflow may be appropriate. A mock-heavy test for a boundary may be correct.

5. **Actionable feedback only.** Every review comment must include what is wrong, why it matters, and how to fix it. "This test is bad" is not actionable. "This test uses sleep-based waiting which causes flakiness -- replace with explicit wait condition" is.

---

## Test Smell Buckets

Each smell is categorized by the dimension it affects. Each links to a specific review action.

### Readability Smells

Problems that make tests hard to understand at a glance.

#### Obscure Setup

**What it looks like:** 30+ lines of object construction with irrelevant fields drowning the test intent. The reader cannot tell which fields matter for the assertion.

**Fix:** Extract to factories. Only test-relevant data should appear in the test body: `buildOrder({ items: [buildItem({ weight: 2.5, quantity: 2 })] })` instead of constructing full user/product/order objects inline.

**Review action:** Request factory extraction.

#### Mystery Guest

**What it looks like:** `loadFixture('report.json')` -- the test depends on external data the reader cannot see. They must open another file to understand the assertion.

**Fix:** Inline the test-relevant data or use descriptively named fixtures. The reader should understand the test without opening other files.

**Review action:** Request inline data or descriptive fixture names.

#### Duplicate Assertions

**What it looks like:** Multiple tests assert the same behavior with varying specificity (`toBe('Alice')`, `toHaveProperty('name')`, `toBeDefined()`). Three tests, one behavior.

**Review action:** Request consolidation. Keep the most specific assertion. Redundant tests increase maintenance cost without increasing confidence.

---

### Reliability Smells

Problems that cause tests to fail intermittently or in unexpected environments.

#### Sleep-Based Waiting

**What it looks like:** `setTimeout`, `sleep()`, `waitForTimeout()` used for synchronization.

```typescript
// SMELL: Slow on fast machines, flaky on slow ones
it('should show notification after save', async () => {
  await page.click('#save');
  await page.waitForTimeout(3000);
  expect(await page.isVisible('.notification')).toBe(true);
});

// FIX: Wait for the specific condition
it('should show notification after save', async () => {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
```

**Review action:** Reject. Sleep-based waiting is never acceptable. Require explicit wait conditions.

#### Order Dependency

**What it looks like:** Tests pass when run together but fail in isolation or different order.

```typescript
// SMELL: Test B depends on Test A's side effects
describe('user management', () => {
  it('A: should create a user', async () => {
    await api.post('/users', { name: 'Alice' });
  });
  it('B: should list users', async () => {
    const users = await api.get('/users');
    expect(users).toContainEqual({ name: 'Alice' }); // Fails if A didn't run first
  });
});

// FIX: Each test sets up its own state
describe('user management', () => {
  it('should create a user', async () => {
    const response = await api.post('/users', { name: 'Alice' });
    expect(response.status).toBe(201);
  });
  it('should list users including recently created', async () => {
    await api.post('/users', { name: 'Bob' }); // Own setup
    const users = await api.get('/users');
    expect(users).toContainEqual({ name: 'Bob' });
  });
});
```

**Review action:** Request data isolation. Each test must create its own preconditions.

#### External Service Coupling

**What it looks like:** Tests call real external APIs (payment gateways, email providers, third-party services).

```typescript
// SMELL: Fails when Stripe is down, rate-limited, or returns different data
it('should process payment', async () => {
  const result = await stripe.charges.create({ amount: 2000, currency: 'usd' });
  expect(result.status).toBe('succeeded');
});

// FIX: Mock the boundary
it('should process payment', async () => {
  const mockStripe = { charges: { create: vi.fn().mockResolvedValue({ status: 'succeeded' }) } };
  const service = new PaymentService(mockStripe);
  const result = await service.charge(2000, 'usd');
  expect(result.status).toBe('succeeded');
});
```

**Review action:** Request mock or fake at the service boundary. External calls belong in integration/contract tests, not unit tests.

---

### Diagnostic Smells

Problems that make test failures hard to understand and debug.

#### Weak Assertion Messages

**What it looks like:** Assertion fails with no context about what was expected or why.

```typescript
// SMELL: Failure message: "Expected false to be true" -- useless
it('should validate the form', () => {
  expect(isValid(form)).toBe(true);
});

// FIX: Use specific assertions that produce clear failure messages
it('should accept form with valid email and non-empty name', () => {
  const result = validate(form);
  expect(result.isValid).toBe(true);
  expect(result.errors).toEqual([]);
  // Failure: "Expected errors to equal [] but received [{ field: 'email', message: 'invalid format' }]"
});
```

**Review action:** Request stronger assertions with diagnostic value. The failure message should explain the problem without reading the test source.

#### Multiple Failure Causes Per Test

**What it looks like:** A single test covers multiple independent behaviors. When it fails, you do not know which behavior broke.

```typescript
// SMELL: If this fails, is it the creation, the update, or the deletion?
it('should handle user lifecycle', async () => {
  const user = await service.create({ name: 'Alice' });
  expect(user.id).toBeDefined();

  await service.update(user.id, { name: 'Bob' });
  const updated = await service.get(user.id);
  expect(updated.name).toBe('Bob');

  await service.delete(user.id);
  await expect(service.get(user.id)).rejects.toThrow(NotFoundError);
});

// FIX: One behavior per test
it('should create user with generated id', async () => {
  const user = await service.create({ name: 'Alice' });
  expect(user.id).toBeDefined();
});

it('should update user name', async () => {
  const user = await service.create({ name: 'Alice' });
  await service.update(user.id, { name: 'Bob' });
  expect((await service.get(user.id)).name).toBe('Bob');
});

it('should delete user so they cannot be retrieved', async () => {
  const user = await service.create({ name: 'Alice' });
  await service.delete(user.id);
  await expect(service.get(user.id)).rejects.toThrow(NotFoundError);
});
```

**Review action:** Request test splitting. Each test should have one reason to fail.

---

### Design Smells

Problems in test architecture that increase maintenance cost.

#### Conditional Test Logic

**What it looks like:** `if/else`, `switch`, or ternaries inside test bodies.

```typescript
// SMELL: Test logic that can take different paths is itself untested
it('should handle all user roles', () => {
  for (const role of ['admin', 'user', 'guest']) {
    const result = getPermissions(role);
    if (role === 'admin') {
      expect(result).toContain('delete');
    } else if (role === 'user') {
      expect(result).toContain('read');
      expect(result).not.toContain('delete');
    } else {
      expect(result).toEqual(['read']);
    }
  }
});

// FIX: Use parameterized tests (test.each / it.each)
it.each([
  ['admin', ['read', 'write', 'delete']],
  ['user', ['read', 'write']],
  ['guest', ['read']],
])('role "%s" should have permissions %j', (role, expected) => {
  expect(getPermissions(role)).toEqual(expected);
});
```

**Review action:** Request parameterized tests. Conditional logic in tests hides which cases are actually verified.

#### Giant Fixtures

**What it looks like:** A `beforeEach` or fixture that sets up 20+ objects for every test, even though each test uses 2-3 of them.

```typescript
// SMELL: Every test pays the setup cost for data it doesn't use
beforeEach(async () => {
  await createUser(pool, { id: 'u1', role: 'admin' });
  await createUser(pool, { id: 'u2', role: 'user' });
  await createUser(pool, { id: 'u3', role: 'guest' });
  await createProduct(pool, { id: 'p1', stock: 100 });
  await createProduct(pool, { id: 'p2', stock: 0 });
  await createOrder(pool, { id: 'o1', userId: 'u2' });
  await createOrder(pool, { id: 'o2', userId: 'u2' });
  // ... 15 more objects
});

// FIX: Each test creates only what it needs
it('should prevent guest from deleting products', async () => {
  const guest = await createUser(pool, { role: 'guest' });
  const product = await createProduct(pool, { stock: 50 });
  await expect(productService.delete(product.id, guest.id)).rejects.toThrow(ForbiddenError);
});
```

**Review action:** Request inline setup. Move shared setup to factories, not monolithic `beforeEach` blocks.

#### Over-Mocking

**What it looks like:** Every collaborator is mocked, including simple value objects and pure functions.

```typescript
// SMELL: Mocking the thing you are testing
it('should format price', () => {
  const mockFormatter = vi.fn().mockReturnValue('$29.99');
  const result = mockFormatter(29.99);
  expect(mockFormatter).toHaveBeenCalledWith(29.99);
  expect(result).toBe('$29.99');
  // This test verifies nothing about the real formatPrice function
});

// FIX: Only mock external boundaries (network, DB, filesystem, time)
it('should format price with currency symbol', () => {
  expect(formatPrice(29.99, 'USD')).toBe('$29.99');
  expect(formatPrice(29.99, 'EUR')).toBe('29,99 EUR');
});
```

**Review action:** Request removal of unnecessary mocks. Mock boundaries, not internals.

---

### Coverage Smells

Problems that leave gaps in what is verified.

#### Happy Path Only

**What it looks like:** Every test provides valid input and expects success. No error paths tested.

```typescript
// SMELL: What happens with invalid input? Empty input? Null? Boundary values?
describe('calculateDiscount', () => {
  it('should apply 10% discount', () => {
    expect(calculateDiscount(100, 0.1)).toBe(90);
  });
  it('should apply 20% discount', () => {
    expect(calculateDiscount(200, 0.2)).toBe(160);
  });
});

// FIX: Add boundary, negative, and error cases
describe('calculateDiscount', () => {
  it('should apply percentage discount', () => {
    expect(calculateDiscount(100, 0.1)).toBe(90);
  });
  it('should handle zero discount', () => {
    expect(calculateDiscount(100, 0)).toBe(100);
  });
  it('should handle 100% discount', () => {
    expect(calculateDiscount(100, 1.0)).toBe(0);
  });
  it('should reject negative discount', () => {
    expect(() => calculateDiscount(100, -0.1)).toThrow('Discount must be between 0 and 1');
  });
  it('should reject discount over 100%', () => {
    expect(() => calculateDiscount(100, 1.5)).toThrow('Discount must be between 0 and 1');
  });
  it('should handle zero price', () => {
    expect(calculateDiscount(0, 0.1)).toBe(0);
  });
});
```

**Review action:** Request missing scenarios. Use the BOUNDARY framework: Boundary values, Null/empty, Duplicates, Ordering, Range limits.

#### Missing Boundary Cases

**What it looks like:** Tests for "normal" values (5 items) but not for 0, 1, max, or max+1. Use `it.each` to cover boundaries explicitly: empty collection, single item, exact page size, one over, large set.

**Review action:** Request boundary tests. Every numeric parameter, string length, and collection size has boundaries to test.

#### Missing Error/Negative Cases

**What it looks like:** No tests for what happens when things go wrong -- network failures, invalid input, permission denied, concurrent modification.

**Review action:** For each happy path test, ask: "What is the corresponding failure mode?" Request tests for the failure.

---

## Testability Analysis

When reviewing application code, assess whether it is structured for testability.

### Dependency Injection

Flag classes that instantiate dependencies directly (`new PostgresDatabase()`, `new StripeClient()` inside methods). Suggest constructor injection so tests can substitute mocks/fakes.

```typescript
// HARD TO TEST                          // TESTABLE
class OrderService {                     class OrderService {
  async create(data: OrderInput) {         constructor(
    const db = new PostgresDB();             private readonly db: Database,
    const email = new SendGrid();            private readonly email: EmailClient,
  }                                        ) {}
}                                        }
```

### Side Effect Isolation

Flag functions that mix pure calculation with I/O (email, logging, analytics). Suggest extracting the calculation as a pure function, then calling it from the side-effectful orchestrator.

### Pure Function Extraction

Look for validation, transformation, and business rules buried inside request handlers. If logic is inline in `app.post('/api/orders', ...)`, it cannot be unit-tested without spinning up an HTTP server. Extract it as a standalone function.

### Interface Segregation

Flag classes that depend on broad interfaces (entire `PrismaClient`) when they only use 2-3 methods. Suggest defining a narrow interface with only the methods actually used, making test doubles trivial to implement.

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
- [ ] No conditional logic (if/else/switch) in test bodies?
- [ ] Fixtures/setup proportional to what each test needs?
- [ ] Mocking limited to external boundaries?
- [ ] Parameterized tests used for data-driven scenarios?

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
5. **Automate:** For each common smell, determine if an ESLint rule or custom plugin can catch it automatically.
6. **Report:** Document findings with specific examples, suggested fixes, and estimated effort.

---

## Prompt Templates

Three prompt patterns for AI-assisted review:

1. **Review test quality:** "Check this test file for readability, reliability, diagnostics, design, and coverage smells. For each issue: name the smell, cite the line, explain why it matters, and provide a fix."

2. **Identify coverage gaps:** "Given this application code and its existing tests, identify missing scenarios across happy path, error handling, boundaries, edge cases, concurrency, and security. Prioritize as P0/P1/P2."

3. **Testability improvements:** "Review this application code for hard-coded dependencies, mixed side effects, extractable pure functions, and overly broad interfaces. Show current vs. refactored code."

---

## Anti-Patterns

**Reviewing test code with production code standards only.** Test code has additional quality dimensions (reliability, diagnostics, coverage) that production code linters do not check. Apply the smell buckets above, not just "clean code" principles.

**Flagging every smell without context.** A 50-line test for a complex state machine is not obscure setup -- it is necessary complexity. Evaluate smells against the behavior being tested.

**Suggesting mocks for everything.** Over-mocking is a smell. Do not recommend mocking pure functions, value objects, or fast in-process collaborators. Mock boundaries: network, database, filesystem, clock.

**Focusing on coverage percentage over coverage quality.** 95% line coverage with only happy-path tests is worse than 75% coverage that includes error paths and boundaries. Review what is asserted, not just what is executed.

**Reviewing without running.** Static analysis misses runtime issues. Run the tests. Check for flakiness (run 3x). Check execution time. A passing test suite that takes 20 minutes has a performance smell.

**One-time review without follow-up.** Test quality degrades over time. Establish recurring review cadence or automated quality gates that catch regression.

---

## Done When

- All five smell dimensions reviewed: coverage gaps, assertion quality, test independence, maintainability, and anti-patterns
- Findings report created with severity ratings (high/medium/low) for each identified issue
- High-severity issues have actionable remediation steps, not just descriptions of the problem
- Review findings fed back into the team's Definition of Done to prevent recurrence

---

## Related Skills

- **unit-testing** -- Framework-specific patterns (Jest, Vitest, pytest) that inform what "good" looks like for each framework.
- **shift-left-testing** -- Pre-commit hooks and IDE integration that catch test smells before review.
- **coverage-analysis** -- Interpreting coverage reports to find meaningful gaps, not just percentage targets.
- **ai-test-generation** -- Generated tests need review too. Apply these smell checks to AI-generated test code.
- **test-reliability** -- Reliability smells (sleep-based waits, order dependency) overlap with flaky test patterns.
