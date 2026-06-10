# Unit Testing Patterns — full examples

Runnable, copy-ready examples for each framework. SKILL.md cites this file at the
relevant sections; nothing here is unique guidance, it is the code behind the prose.

---

## Jest

### describe/it with setup/teardown and a typed mock

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
    // Arrange
    mockRepo.findById.mockResolvedValue({ id: "1", name: "Alice" });
    // Act
    const result = await service.getUser("1");
    // Assert
    expect(result).toEqual({ id: "1", name: "Alice" });
  });

  it("should throw when user not found", async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(service.getUser("999")).rejects.toThrow(NotFoundError);
  });
});
```

### Module mocking (`jest.mock`)

```typescript
jest.mock("./email-client", () => ({
  sendEmail: jest.fn().mockResolvedValue({ sent: true }),
}));
// Partial mock — keep original, override one export
jest.mock("./utils", () => ({ ...jest.requireActual("./utils"), generateId: jest.fn(() => "fixed") }));
```

### Spying (`jest.spyOn`) — wraps the real method, records calls

```typescript
const spy = jest.spyOn(console, "warn").mockImplementation();
service.deprecatedMethod();
expect(spy).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
```

### Timer mocking

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

**Selective faking.** Faking *all* timers can deadlock code that awaits a real
microtask (e.g. an `await fetch` mocked to resolve). Fake only what you need:

```typescript
jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
// Vitest equivalent: vi.useFakeTimers({ toFake: ["setTimeout", "Date"] })
```

### Async — assert directly on the promise

```typescript
await expect(fn()).resolves.toEqual({ ok: true });
await expect(fn()).rejects.toThrow(ValidationError);
```

Guard async tests against vacuous passes (an `await` you forgot to write means the
assertion never runs and the test goes green):

```typescript
it("rejects bad input", async () => {
  expect.assertions(1); // fails the test if no assertion actually ran
  await expect(validate("")).rejects.toThrow();
});
```

---

## Vitest

Same API surface as Jest but Vite-native. Config:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      // changed: true,  // Vitest 4.1+: coverage only for files in the diff — big CI win on large repos
    },
  },
});
```

### Mocking with `vi`

```typescript
vi.mock("./email-client", () => ({ sendConfirmation: vi.fn().mockResolvedValue(true) }));
const spy = vi.spyOn(repository, "save");
```

### In-source testing (useful for small utilities)

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

Enable: `test: { includeSource: ["src/**/*.ts"] }` and
`define: { "import.meta.vitest": "undefined" }` (the `define` strips the block from
the production bundle).

### Monorepo workspaces

```typescript
// vitest.workspace.ts
export default ["packages/*/vitest.config.ts"];
```

### Concurrency and isolation

`describe.concurrent` / `it.concurrent` run sibling tests in parallel within a file.
Only use it for tests with no shared mutable state — concurrent tests that touch a
shared fixture race. **Vitest 5 beta removes the `sequential` option**, so the way to
force order is to drop `.concurrent`, not to flip a flag. Each concurrent test must
take `expect` from its local context (`it.concurrent("x", async ({ expect }) => …)`)
or assertions leak across tests.

### Browser mode (Vitest 4+)

Runs component-level tests in a real browser (Playwright/WebdriverIO) instead of
JSDOM. Use it when JSDOM gives false positives on layout, focus, or paint behavior;
it overlaps with Cypress component testing.

```typescript
// vitest.config.ts (browser mode)
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    browser: { enabled: true, provider: "playwright", name: "chromium" },
  },
});
```

---

## pytest

### Fixtures and conftest.py

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

### Parametrize for data-driven tests

```python
@pytest.mark.parametrize("input_val,expected", [
    ("hello world", "Hello World"), ("", ""), ("CAPS", "Caps"),
])
def test_title_case(input_val, expected):
    assert title_case(input_val) == expected
```

### Monkeypatch for mocking

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

**Markers:** `@pytest.mark.slow`, then run `pytest -m "not slow"`. Use `-k "test_create"`
for name matching.

---

## Bun test / Deno test

- **`bun test`** — stable enough for greenfield use on the Bun stack: Jest-compatible
  API, esbuild-fast, no separate runner config (`package.json` `scripts.test`).
- **`deno test`** — built-in for Deno projects: permission flags plus native TypeScript.

Both are reasonable defaults when your runtime is already Bun or Deno; prefer
Vitest/Jest for Node projects with deeper plugin ecosystems.

---

## Test doubles — the four kinds in code

```typescript
// Stub — just a return value, no verification
const pricing = { getPrice: () => 9.99 };

// Spy — real behavior, calls tracked
const spy = vi.spyOn(logger, "info");

// Mock — replaced impl + interaction verified
const notifier = { send: vi.fn().mockResolvedValue(true) };
expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ type: "done" }));

// Fake — working substitute (in-memory implementation)
class FakeRepo implements UserRepository {
  private data = new Map<string, User>();
  async findById(id: string) { return this.data.get(id) ?? null; }
  async save(u: User) { this.data.set(u.id, { ...u }); }
}
```

---

## Snapshot testing — file vs inline, property matchers

```typescript
// File snapshot — stored in __snapshots__/*.snap
expect(tree).toMatchSnapshot();

// Inline snapshot — stored in the test file, auto-updated on first run
expect(tree).toMatchInlineSnapshot(`<header><h1>Dashboard</h1></header>`);

// Property matchers for dynamic values — keeps the snapshot stable
expect(user).toMatchSnapshot({ id: expect.any(String), createdAt: expect.any(Date) });
```

Prefer inline for small output (<20 lines). Always run CI with `--ci` so an unknown
snapshot **fails** the run instead of being silently written and committed.
