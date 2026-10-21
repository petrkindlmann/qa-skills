# Per-Test Coverage Fingerprinting

Per-test (dynamic) context capture and the analysis that turns a `.coverage` SQLite
database into per-test line/branch fingerprints. The decision rules live in `SKILL.md` §1.

## Capture per-test contexts (pytest / coverage.py)

```bash
# --cov-context=test records pytest test IDs plus setup/run/teardown phases.
# --cov-branch records branch arcs so if/else on one line are distinct.
pytest --cov=src --cov-branch --cov-context=test
```

To persist these pytest-cov flags, add them to `pytest.ini` (merge with existing `addopts`):

```ini
[pytest]
addopts = --cov=src --cov-branch --cov-context=test
```

[pytest-cov](https://pytest-cov.readthedocs.io/en/latest/contexts.html) calls coverage.py's
`switch_context()` with the pytest test ID and phase, separated by a final `|`, for example
`tests/test_price.py::test_price[USD]|run`. The phases are `setup`, `run`, and `teardown`;
parameterized cases have separate test IDs. Results land in the `.coverage` SQLite DB.

Coverage.py's [`dynamic_context = test_function`](https://coverage.readthedocs.io/en/latest/contexts.html)
starts contexts for Python functions whose names begin with `test`. It does **not** supply
pytest's parameter IDs or phase labels and is not an equivalent configuration. Use one
dynamic-context mechanism; leave that coverage.py setting unset when using pytest-cov's flag.

## Read the contexts out of the .coverage SQLite DB

coverage.py exposes a [supported Python API](https://coverage.readthedocs.io/en/latest/api_coveragedata.html)
for this. The example below assumes pytest-cov contexts without a static `[run] context`
prefix. It unions the three phases for each test; splitting at the final `|` preserves any
`|` inside a parameter ID. The raw tables are `context`, `file`, `line_bits`, and `arc`.

```python
from collections import defaultdict
import coverage

cov = coverage.Coverage(data_file=".coverage")
cov.load()
data = cov.get_data()

# Per-test sets: all phases combined, parameterized cases kept separate.
line_sets = defaultdict(set)
branch_sets = defaultdict(set)
for ctx in data.measured_contexts():
    test_id, separator, phase = ctx.rpartition("|")
    if not separator or phase not in {"setup", "run", "teardown"}:
        # Includes the empty startup/no-context bucket.
        continue
    data.set_query_context(ctx)
    for f in data.measured_files():
        for line in (data.lines(f) or []):
            line_sets[test_id].add((f, line))
        for arc in (data.arcs(f) or []):     # arcs present only with --cov-branch
            branch_sets[test_id].add((f, arc))
data.set_query_contexts(None)  # Clear the query filter for subsequent analysis.
```

Keep the original phase contexts when reviewing candidates. Shared or session-scoped
fixtures may be attributed to whichever test first triggers them; apparent unique setup
coverage can move when execution order changes. An absent fingerprint is not evidence
that a test is redundant: reconcile it with collection and the measured source scope.

Raw SQL fallback (when you only have the file, no coverage.py installed):

```sql
-- context table maps context_id -> raw test ID plus phase
SELECT context, c.id FROM context c;
-- line_bits maps (file_id, context_id) -> bitmap of covered lines
SELECT f.path, lb.context_id, lb.numbits
FROM line_bits lb JOIN file f ON f.id = lb.file_id;
```

## Uniquely-covered lines and subsumption

```python
from collections import Counter

# How many tests cover each (file, line)?
line_owner_count = Counter()
for lset in line_sets.values():
    for key in lset:
        line_owner_count[key] += 1

# Lines covered by exactly one test -> that test is load-bearing; protect it.
uniquely_covered = {
    test: {key for key in lset if line_owner_count[key] == 1}
    for test, lset in line_sets.items()
}

# Subsumption CANDIDATES: A's covered set ⊇ B's covered set.
# This is a candidate only — confirm with mutation testing (SKILL.md §2) before deletion.
def subsumption_candidates(line_sets):
    items = list(line_sets.items())
    out = []
    for a, sa in items:
        for b, sb in items:
            if a != b and sb and sb <= sa:
                out.append((a, b))   # A subsumes B's coverage
    return out
```

`uniquely_covered[test]` non-empty => deleting `test` drops coverage outright; never a
delete candidate. `subsumption_candidates` => feed each `(A, B)` pair to the mutation
confirmation step.

## JS / Vitest + Istanbul per-test equivalent

Istanbul does not record dynamic contexts the way coverage.py does. Two options:

1. **Per-test coverage via the runner**: run each test file in isolation with
   `vitest run --coverage --coverage.reporter=json` and key the resulting
   `coverage-final.json` by test file. Coarser than per-test but works for clustering.
2. **`@vitest/coverage-istanbul` with `coverage.all: true`** plus a custom reporter that
   resets coverage between tests (`beforeEach`/`afterEach` snapshot of
   `globalThis.__coverage__`) to approximate per-test contexts.

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      reporter: ['json'],          // coverage-final.json has per-file statement/branch maps
      all: true,
      branches: true,
    },
  },
})
```

Build the same `(file, statement)` and `(file, branch)` sets per test from
`coverage-final.json`'s `statementMap` / `branchMap`, then reuse the uniquely-covered and
subsumption logic above.
