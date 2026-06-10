---
name: unit-testing
description: >-
  Write effective unit tests with Jest, Vitest, or pytest. Covers the test-doubles
  taxonomy (stub/spy/mock/fake), Arrange-Act-Assert, coverage threshold configuration
  and CI gating, snapshot testing, fake timers, and mutation testing with Stryker/mutmut.
  Use when: "unit test," "Jest," "Vitest," "pytest," "mock," "coverage threshold,"
  "test doubles," "mutation testing," "fake timers," "snapshot test."
  Not for: interpreting coverage reports or finding coverage gaps — use coverage-analysis;
  AI generating the test code for you — use ai-test-generation; auditing existing tests
  for smells — use ai-qa-review; browser/component rendering assertions — use
  cypress-automation or visual-testing.
  Related: coverage-analysis, ci-cd-integration, ai-test-generation, shift-left-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
Write unit tests that fail when the code is wrong and pass when it is right — nothing
weaker. A test that mocks every collaborator stays green while the integration is
broken; the doubles taxonomy below stops that. A `coverageThreshold` typo (or the
plural `coverageThresholds`, which Jest silently ignores) lets 40%-covered code ship
on a green pipeline; the config and Verification sections below make the gate actually
fire. This skill covers Jest, Vitest, and pytest: doubles, coverage gating, snapshots,
fake timers, and mutation testing as a behavior check on top of coverage.
</objective>

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything answered there.

1. **Framework:** Jest, Vitest, or pytest? Check `package.json` or `pyproject.toml`. The runner decides config keys and mock APIs.
2. **Coverage tooling:** Already configured? Look for `jest.config.*`, `vitest.config.*`, `.nycrc`, `[tool.coverage]`. Determines whether you add the gate or just tune it.
3. **Mocking strategy:** Manual mocks, auto-mocking, or dependency injection? Check for `__mocks__/` dirs or DI containers — this sets which doubles you reach for.
4. **Conventions:** Co-location (`*.test.ts` next to source) or a `__tests__`/`tests/` tree? Match what exists; don't introduce a third location.

---

## Core Principles

**1. Test behavior, not implementation.** Verify *what* code does, not *how*. Refactoring internals should not break tests.

```typescript
// Bad — implementation detail        // Good — observable behavior
expect(svc._cache.size).toBe(3);      expect(svc.getUser("abc")).toEqual({ id: "abc", name: "Alice" });
```

**2. Fast, isolated, deterministic.** No network/disk/DB. No shared mutable state. No uncontrolled `Date.now()` or `Math.random()` — freeze them with fake timers and seeded values.

**3. Arrange-Act-Assert.** One clear shape per test.

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

**4. One assertion concept per test.** Multiple `expect` calls are fine when they verify the same concept.

**5. Descriptive names.** `"should [behavior] when [condition]"`, not `"test calculateTotal"`.

---

## Framework-Specific Patterns

The full setup/teardown, mocking, spying, timer, in-source, and monorepo examples for
each runner live in `references/patterns.md`. Below is what is current and what to
reach for; copy the code from the reference.

### Jest

Current is **Jest 30.x** (30.4.2, May 2026). Jest 30 added `--collect-tests`,
`jest.config.mts` support, Temporal-aware fake timers, and `clearMocksOnScope`. If the
code under test uses the Temporal API or time-zone logic, Jest 30's Temporal-aware fake
timers remove a class of brittle setup.

Reach for: `jest.mock()` for module boundaries (`jest.requireActual` for partial mocks),
`jest.spyOn()` to wrap a real method, `jest.Mocked<T>` for typed mocks, and
`jest.useFakeTimers()` for time. See `references/patterns.md` § Jest.

### Vitest

Same API as Jest, Vite-native. Stable: **Vitest 4.1.x** (June 2026); **5.0.0-beta** is
out (beta.3, May 2026). Vitest 4 added `coverage.changed` (changed-files-only coverage),
`mockThrow`/`mockThrowOnce`, and a stable browser mode. Vitest 5 beta **removes the
`sequential` option** and requires **Node 22 / Vite 6.4** — wait for stable before
adopting. Mock with `vi.mock`/`vi.spyOn`; the standout features are **in-source testing**
(`import.meta.vitest`) and **browser mode** for component rendering. See
`references/patterns.md` § Vitest.

### pytest

Use fixtures + `conftest.py` (with `yield` for teardown), `@pytest.mark.parametrize`
for data-driven cases, and `monkeypatch` for env/attr substitution. Prefer fixtures
over `setUp`/`tearDown` methods — fixtures compose and isolate per test. See
`references/patterns.md` § pytest.

### Bun / Deno

`bun test` (Jest-compatible, no extra config) and `deno test` (native TS, permission
flags) are reasonable defaults when your runtime is already Bun or Deno. Prefer
Vitest/Jest for Node projects with deeper plugin ecosystems.

---

## Mocking Taxonomy

Pick the simplest double that does the job. Most of the time that is a stub.

| Double | What it does | When to use |
|--------|-------------|-------------|
| **Stub** | Returns canned data, no verification | Control a dependency's return value |
| **Spy** | Wraps real impl, records calls | Verify calls without changing behavior |
| **Mock** | Replaces impl + records calls | Control return AND verify interaction |
| **Fake** | Simplified working impl (in-memory DB) | Complex stateful dependencies |

**Rule of thumb:** prefer stubs over mocks; reserve fakes for stateful dependencies;
never call a real external API in a unit test. Only mock the **external boundary**
(network, filesystem, DB, time) — let fast, deterministic internal collaborators run
for real, or you get a suite that is green while the integration is broken. The four
doubles in code: `references/patterns.md` § Test doubles.

---

## Coverage

### Configuration

**Jest** — the threshold key is **`coverageThreshold`** (singular). The plural
`coverageThresholds` is **not a Jest key**: Jest ignores it silently, the gate never
enforces, and CI stays green at 30% coverage. This is the single most common config bug.

```javascript
// jest.config.js
module.exports = {
  coverageProvider: "v8",
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.{d,test,stories}.ts", "!src/**/index.ts"],
  coverageThreshold: { global: { branches: 80, functions: 80, lines: 80, statements: 80 } },
};
```

**Vitest** — set `test.coverage.thresholds` in `vitest.config.ts` with `provider: "v8"`
(see `references/patterns.md` § Vitest for the full block).

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

### Coverage types and what to gate on

| Type | Measures | Blind spots |
|------|----------|-------------|
| **Branch** | Every if/else path taken? | Misses value combinations |
| **Line** | Each line executed? | Misses untested branches in one line |
| **Statement** | Each statement executed? | Similar to line |
| **Function** | Each function called? | Nothing about correctness |

**Priority:** Branch > Line > Statement > Function. Use **80% line as the baseline gate**,
not a vanity target, and weight branch coverage higher. Focus coverage on business logic,
transformations, error paths, and edge cases; skip generated code, type definitions,
barrel exports, trivial getters, and framework boilerplate.

> For interpreting *which* uncovered lines matter and doing gap analysis, that's
> `coverage-analysis`, not this skill.

### CI gate

Jest and Vitest exit non-zero when thresholds fail — that exit code IS the gate. pytest
needs the flag explicitly:

```yaml
- run: pytest --cov=src --cov-fail-under=80
```

---

## Mutation Testing

Coverage tells you what code *ran*. Mutation testing tells you whether the tests would
*catch a bug*. It makes small source changes (`>` → `>=`, `true` → `false`) and reruns
the suite against each mutant. If the suite still passes, the mutant **survived** — your
tests executed that logic but did not assert on it.

### Stryker (JS/TS)

```bash
npm i -D @stryker-mutator/core @stryker-mutator/jest-runner  # or vitest-runner
```

```javascript
// stryker.config.json  (Stryker's documented default; .mjs/.mts also load)
{
  "testRunner": "jest",
  "coverageAnalysis": "perTest",
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"],
  "thresholds": { "high": 80, "low": 60, "break": 50 },
  "reporters": ["html", "clear-text", "progress"]
}
```

Stryker's own defaults are `{ high: 80, low: 60, break: null }` — `break: null` means
no failing exit. Set `break` (e.g. 50) to make a low score fail CI. Run: `npx stryker run`.

### mutmut (Python) — mutmut 3.x

mutmut 3 dropped the old CLI surface. Configure paths in a `[mutmut]` block, run, then
review survivors in the TUI:

```ini
# setup.cfg  (or a [tool.mutmut] table in pyproject.toml)
[mutmut]
paths_to_mutate=src/
```

```bash
pip install mutmut          # 3.5.x
mutmut run                  # paths come from config, not a flag
mutmut browse               # interactive TUI: inspect and retest survivors
mutmut apply <mutant_id>    # write a survivor to disk to see what it changed
```

> **Avoid:** `mutmut run --paths-to-mutate=src/`, `mutmut results`, and `mutmut show 42`
> — that was the mutmut <3 surface. The `--paths-to-mutate` flag is gone (paths move to
> the `[mutmut]` config block) and `results`/`show` are replaced by `browse`/`apply`
> (mutmut 3.5.x, verified June 2026). Following the old commands errors out on a current install.

### Interpreting scores

| Score | Meaning |
|-------|---------|
| 90%+ | Strong — catching most logic changes |
| 70–89% | Decent — review survivors in critical paths |
| <70% | Tests execute code but do not verify behavior |

Run mutation testing on **critical business logic**, not the whole codebase (it is slow).
Ignore equivalent mutants — logically identical code where no test could ever tell the difference.

---

## Snapshot Testing

**Use for:** UI component render output, serialized data structures, CLI formatting —
output where exact structure matters and is tedious to assert field-by-field.

**Do not use for:** frequently changing output (snapshot fatigue → rubber-stamp reviews),
large snapshots (unreviewable), implementation details (CSS classes, internal IDs), or as
a substitute for a targeted assertion when one specific value is what matters.

Prefer **inline** snapshots for small output (<20 lines) and **property matchers**
(`expect.any(String)`) for dynamic fields like ids and timestamps. Always run CI with
`--ci` so an unknown snapshot **fails** instead of being silently written and committed.
Code: `references/patterns.md` § Snapshot testing.

---

## Anti-Patterns

**Testing private methods** — Test through the public API. If a private method really
needs its own tests, extract it to its own module with a public surface.

**Mocking everything** — Only mock external boundaries (network, filesystem, DB, time).
A suite where every collaborator is mocked passes while the wiring between them is broken.

**The plural `coverageThresholds`** — Jest ignores it; the gate never fires; CI is green
at any coverage. The key is `coverageThreshold` (singular). See Coverage above.

**Faking all timers blindly** — `jest.useFakeTimers()` / `vi.useFakeTimers()` with no
allowlist can deadlock code awaiting a real microtask. Fake only what the test needs
(`doNotFake` / `toFake`). See `references/patterns.md` § Jest timers.

**Async test without `await`** — a forgotten `await` makes the assertion never run and
the test passes vacuously. Add `expect.assertions(n)` / `expect.hasAssertions()` to async
tests so a missing assertion fails them.

**Snapshot overuse** — Use `expect(x).toBe("active")` for a specific value; reserve
snapshots for structured output you can't assert field-by-field.

**Non-descriptive names** — Replace `"works"` with `"should return empty array when no items match the filter"`.

**Shared mutable state** — Initialize in `beforeEach`, not at module scope:

```typescript
// Bad: shared mutation               // Good: fresh per test
const items = [];                     let items: string[];
it("A", () => items.push("a"));       beforeEach(() => { items = []; });
it("B", () => {                       it("A", () => { items.push("a"); expect(items).toHaveLength(1); });
  items.push("b");                    it("B", () => { items.push("b"); expect(items).toHaveLength(1); });
  expect(items).toHaveLength(1); // FAILS
});
```

---

## Verification

Prove the suite runs and the gate actually fails on under-coverage — the exact thing the
`coverageThreshold` typo silently disables.

1. **Tests run and pass:** `npx jest` (or `vitest run`, `pytest -q`) exits `0`.
2. **The gate bites.** Run coverage and confirm a non-zero exit when below threshold:
   ```bash
   npx jest --coverage --ci          # Jest/Vitest exit !=0 below coverageThreshold
   vitest run --coverage             # same for Vitest
   pytest --cov=src --cov-fail-under=80   # pytest exits !=0 below the floor
   ```
   Temporarily set a threshold above current coverage (e.g. 99) and confirm the command
   fails. If it exits `0`, your threshold key is wrong (likely the plural `coverageThresholds`).
3. **Snapshots are safe in CI:** the run uses `--ci`, so an unknown snapshot fails rather
   than being written. `git status` shows no new `*.snap` after a CI-mode run.

---

## Done When

- Coverage thresholds configured in `jest.config.*` (key `coverageThreshold`, singular), `vitest.config.*` (`coverage.thresholds`), or `pyproject.toml` (`fail_under`) AND verified to exit non-zero below threshold (Verification step 2)
- Test files all live in the project's single chosen location (co-located OR `__tests__`/`tests/`) — `git ls-files` shows no ad-hoc test paths
- External boundaries (HTTP, DB, time) are mocked and internal collaborators are not — `grep` finds no real network/DB clients constructed in test files
- No test reaches outside the process boundary — suite passes with the network disabled and no test DB running
- CI runs the test command with `--ci` (Jest/Vitest) so an unknown snapshot fails the build instead of being auto-written

## Reference Files (in `references/`)

- **patterns.md** — full runnable examples per framework: Jest setup/teardown, module/spy/timer mocks, async guards; Vitest config, in-source tests, concurrency, browser mode; pytest fixtures/parametrize/monkeypatch; Bun/Deno; the four test doubles; snapshot file/inline/property matchers.

## Related Skills

- **coverage-analysis** — interpreting coverage reports, finding meaningful gaps, mutation score as a first-class signal. Go there to read coverage; stay here to configure and gate it.
- **ci-cd-integration** — test stages in pipelines, parallelization, caching, deployment gating.
- **ai-test-generation** — when an AI writes the test code from a spec/PRD; this skill is for writing and structuring tests by hand.
- **ai-qa-review** — auditing existing tests for hallucinated APIs, fabricated imports, and closed-loop tests.
- **shift-left-testing** — pre-commit hooks, IDE integration, and TDD workflow around these tests.
