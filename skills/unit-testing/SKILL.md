---
name: unit-testing
description: >-
  Write effective unit tests with Jest, Vitest, or pytest. Covers mocking strategies
  (stubs, spies, mocks, fakes), coverage configuration and meaningful thresholds,
  snapshot testing, mutation testing with Stryker/mutmut, test doubles taxonomy,
  and the Arrange-Act-Assert pattern. Use when: "unit test," "Jest," "Vitest,"
  "pytest," "mock," "coverage," "test doubles," "mutation testing."
  Related: coverage-analysis, ci-cd-integration, ai-test-generation, shift-left-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Write effective, maintainable unit tests using Jest, Vitest, or pytest.
</objective>

---

## Discovery Questions

1. **Framework:** Jest, Vitest, or pytest? Check `package.json` or `pyproject.toml`.
2. **Coverage tooling:** Already configured? Look for `jest.config.*`, `vitest.config.*`, `.nycrc`, `[tool.coverage]`.
3. **Mocking strategy:** Manual mocks, auto-mocking, or dependency injection? Check for `__mocks__/` dirs or DI containers.
4. **Existing conventions:** Check `.agents/qa-project-context.md` first for project-specific guidelines.

---

## Core Principles

**1. Test behavior, not implementation.** Verify *what* code does, not *how*. Refactoring internals should not break tests.

```typescript
// Bad — implementation detail        // Good — observable behavior
expect(svc._cache.size).toBe(3);      expect(svc.getUser("abc")).toEqual({ id: "abc", name: "Alice" });
```

**2. Fast, isolated, deterministic.** No network/disk/DB. No shared mutable state. No uncontrolled `Date.now()` or `Math.random()`.

**3. Arrange-Act-Assert.**

```typescript
it("should apply discount for orders over $100", () => {
  // Arrange
  const order = createOrder({ subtotal: 150 });
  const svc = new DiscountService(0.1);
  // Act
  const result = svc.apply(order);
  // Assert
  expect(result.total).toBe(135);
});
```

**4. One assertion concept per test** (multiple `expect` calls are fine if they verify the same concept).

**5. Descriptive test names:** `"should [behavior] when [condition]"`, not `"test calculateTotal"`.

---

## Framework-Specific Patterns

### Jest

**describe/it structure with setup/teardown:**

```typescript
describe("UserService", () => {
  let service: UserService;
  let mockRepo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockRepo = { findById: jest.fn(), save: jest.fn() } as jest.Mocked<UserRepository>;
    service = new UserService(mockRepo);
  });
  afterEach(() => jest.restoreAllMocks());

  it("should return user when found", async () => {
    mockRepo.findById.mockResolvedValue({ id: "1", name: "Alice" });
    const result = await service.getUser("1");
    expect(result).toEqual({ id: "1", name: "Alice" });
  });

  it("should throw when user not found", async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(service.getUser("999")).rejects.toThrow(NotFoundError);
  });
});
```

**Module mocking (`jest.mock`):**

```typescript
jest.mock("./email-client", () => ({
  sendEmail: jest.fn().mockResolvedValue({ sent: true }),
}));
// Partial mock — keep original, override one export
jest.mock("./utils", () => ({ ...jest.requireActual("./utils"), generateId: jest.fn(() => "fixed") }));
```

**Spying (`jest.spyOn`):** wraps real method, records calls.

```typescript
const spy = jest.spyOn(console, "warn").mockImplementation();
service.deprecatedMethod();
expect(spy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
```

**Timer mocking:**

```typescript
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("should debounce", () => {
  const fn = jest.fn();
  const debounced = debounce(fn, 300);
  debounced();
  expect(fn).not.toHaveBeenCalled();
  jest.advanceTimersByTime(300);
  expect(fn).toHaveBeenCalledTimes(1);
});
```

**Async:** `await expect(fn()).resolves.toEqual(...)` / `await expect(fn()).rejects.toThrow(...)`.

---

### Vitest

Same API as Jest but Vite-native. Key differences:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: { provider: "v8", reporter: ["text", "html", "lcov"] },
  },
});
```

**Mocking with `vi`:**

```typescript
vi.mock("./email-client", () => ({ sendConfirmation: vi.fn().mockResolvedValue(true) }));
const spy = vi.spyOn(repository, "save");
```

**In-source testing** (useful for utilities):

```typescript
export function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}
if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;
  it("clamps below", () => expect(clamp(-5, 0, 10)).toBe(0));
  it("clamps above", () => expect(clamp(15, 0, 10)).toBe(10));
}
```

Enable: `test: { includeSource: ["src/**/*.ts"] }` and `define: { "import.meta.vitest": "undefined" }`.

**Monorepo workspaces:**

```typescript
// vitest.workspace.ts
export default ["packages/*/vitest.config.ts"];
```

---

### pytest

**Fixtures and conftest.py:**

```python
# conftest.py
@pytest.fixture
def db():
    database = Database(":memory:")
    database.migrate()
    yield database
    database.close()

@pytest.fixture
def user_service(db):
    return UserService(db)
```

```python
class TestUserService:
    def test_create_returns_id(self, user_service):
        uid = user_service.create({"name": "Alice"})
        assert uid is not None

    def test_get_nonexistent_raises(self, user_service):
        with pytest.raises(UserNotFoundError):
            user_service.get("nonexistent")
```

**Parametrize for data-driven tests:**

```python
@pytest.mark.parametrize("input_val,expected", [
    ("hello world", "Hello World"), ("", ""), ("CAPS", "Caps"),
])
def test_title_case(input_val, expected):
    assert title_case(input_val) == expected
```

**Monkeypatch for mocking:**

```python
def test_uses_env(monkeypatch):
    monkeypatch.setenv("APP_URL", "https://test.local")
    assert fetch_config()["source"] == "https://test.local"

def test_retry(monkeypatch):
    calls = {"n": 0}
    def fake(url):
        calls["n"] += 1
        if calls["n"] < 3: raise ConnectionError
        return {"ok": True}
    monkeypatch.setattr("app.client.http_request", fake)
    assert fetch_with_retry("https://api.test") == {"ok": True}
```

**Markers:** `@pytest.mark.slow`, then run `pytest -m "not slow"`. Use `-k "test_create"` for name matching.

---

## Mocking Taxonomy

| Double | What it does | When to use |
|--------|-------------|-------------|
| **Stub** | Returns canned data, no verification | Control dependency return values |
| **Spy** | Wraps real impl, records calls | Verify calls without changing behavior |
| **Mock** | Replaces impl + records calls | Control return AND verify interaction |
| **Fake** | Simplified working impl (in-memory DB) | Complex stateful dependencies |

```typescript
// Stub — just a return value
const pricing = { getPrice: () => 9.99 };

// Spy — real behavior, tracked
const spy = vi.spyOn(logger, "info");

// Mock — replaced + verified
const notifier = { send: vi.fn().mockResolvedValue(true) };
expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }));

// Fake — working substitute
class FakeRepo implements UserRepository {
  private data = new Map<string, User>();
  async findById(id: string) { return this.data.get(id) ?? null; }
  async save(u: User) { this.data.set(u.id, { ...u }); }
}
```

**Rule of thumb:** Use the simplest double. Prefer stubs over mocks. Reserve fakes for stateful dependencies. Never call real external APIs in unit tests.

---

## Coverage

### Configuration

**Jest:**

```javascript
// jest.config.js
module.exports = {
  coverageProvider: "v8",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.{d,test,stories}.ts", "!src/**/index.ts"],
  coverageThresholds: { global: { branches: 80, functions: 80, lines: 80, statements: 80 } },
};
```

**Vitest:** set `test.coverage` in `vitest.config.ts` with `provider: "v8"`, `thresholds: { branches: 80, ... }`.

**pytest:**

```toml
# pyproject.toml
[tool.coverage.run]
source = ["src"]
omit = ["src/**/test_*.py", "src/**/conftest.py"]
[tool.coverage.report]
fail_under = 80
show_missing = true
exclude_lines = ["pragma: no cover", "if TYPE_CHECKING:"]
```

### Coverage Types

| Type | Measures | Blind spots |
|------|----------|-------------|
| **Branch** | Every if/else path taken? | Misses value combinations |
| **Line** | Each line executed? | Misses untested branches in one line |
| **Statement** | Each statement executed? | Similar to line |
| **Function** | Each function called? | Nothing about correctness |

**Priority:** Branch > Line > Statement > Function.

### Meaningful Thresholds

- **80% line coverage** as baseline gate, not a vanity target.
- Branch coverage matters more than line coverage.
- Focus on: business logic, transformations, error paths, edge cases.
- Skip: generated code, type definitions, barrel exports, trivial getters, framework boilerplate.

### CI Gate

```yaml
# Jest/Vitest exit non-zero when thresholds fail. For pytest:
- run: pytest --cov=src --cov-fail-under=80
```

---

## Mutation Testing

Coverage tells you what code *ran*. Mutation testing tells you if tests would *catch a bug*.

It works by making small source changes (e.g., `>` to `>=`, `true` to `false`), running tests against each mutant. If tests still pass, the mutant **survived** -- your tests missed that logic.

### Stryker (JS/TS)

```bash
npm i -D @stryker-mutator/core @stryker-mutator/jest-runner  # or vitest-runner
```

```javascript
// stryker.config.mjs
export default {
  testRunner: "jest",
  coverageAnalysis: "perTest",
  mutate: ["src/**/*.ts", "!src/**/*.test.ts"],
  thresholds: { high: 80, low: 60, break: 50 },
  reporters: ["html", "clear-text", "progress"],
};
```

Run: `npx stryker run`

### mutmut (Python)

```bash
pip install mutmut
mutmut run --paths-to-mutate=src/
mutmut results           # summary
mutmut show 42           # inspect surviving mutant #42
```

### Interpreting Scores

| Score | Meaning |
|-------|---------|
| 90%+ | Strong -- catching most logic changes |
| 70-89% | Decent -- review survivors in critical paths |
| <70% | Tests execute code but do not verify behavior |

Run mutation testing on critical business logic, not entire codebases. Ignore equivalent mutants (logically identical code).

---

## Snapshot Testing

### When to Use

- UI component render output, serialized data structures, CLI formatting
- Output where exact structure matters and is hard to assert field-by-field

### When NOT to Use

- Frequently changing output (snapshot fatigue, rubber-stamp reviews)
- Large snapshots (hard to review), implementation details (CSS classes, internal IDs)
- As substitute for targeted assertions when specific values matter

### File vs Inline Snapshots

```typescript
// File snapshot — stored in __snapshots__/*.snap
expect(tree).toMatchSnapshot();

// Inline snapshot — stored in the test file, auto-updated
expect(tree).toMatchInlineSnapshot(`<header><h1>Dashboard</h1></header>`);
```

Prefer inline for small output (<20 lines). Use property matchers for dynamic values:

```typescript
expect(user).toMatchSnapshot({ id: expect.any(String), createdAt: expect.any(Date) });
```

---

## Anti-Patterns (with Fixes)

**Testing private methods** -- Test through the public API instead. If a private method needs its own tests, extract it to its own module.

**Mocking everything** -- Only mock external boundaries (network, filesystem, DB, time). Let fast, deterministic internal collaborators use real implementations.

**Snapshot overuse** -- Use `expect(x).toBe("active")` for specific values. Reserve snapshots for structured output.

**Non-descriptive names** -- Replace `"works"` with `"should return empty array when no items match the filter"`.

**Shared mutable state** -- Initialize in `beforeEach`, not at module scope:

```typescript
// Bad: shared mutation               // Good: fresh per test
const items = [];                     let items: string[];
it("A", () => items.push("a"));      beforeEach(() => { items = []; });
it("B", () => {                      it("A", () => { items.push("a"); expect(items).toHaveLength(1); });
  items.push("b");                   it("B", () => { items.push("b"); expect(items).toHaveLength(1); });
  expect(items).toHaveLength(1); // FAILS
});
```

---

## Done When

- Coverage thresholds configured in `jest.config.*`, `vitest.config.*`, or `pyproject.toml` and enforced as a CI gate (non-zero exit on failure)
- Test files follow the project's co-location or `__tests__` directory convention consistently — no test files in ad-hoc locations
- Mocking strategy documented (in `qa-project-context.md` or inline): which boundaries get mocked (HTTP, DB, time) and which internal collaborators use real implementations
- No test reaches outside the process boundary — no real HTTP calls, no real database, no filesystem writes to shared state
- All snapshot tests are intentional and reviewed: no auto-accepted snapshots with `--updateSnapshot` in CI

## Related Skills

- **coverage-analysis** -- Interpreting coverage reports, identifying meaningful gaps, CI integration.
- **ci-cd-integration** -- Test stages in pipelines, parallelization, caching, deployment gating.
- **ai-test-generation** -- AI-assisted test generation, edge case discovery, legacy code bootstrapping.
- **shift-left-testing** -- Pre-commit hooks, IDE integration, developer workflow optimization.
