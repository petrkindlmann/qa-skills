# Per-Test Coverage Fingerprinting

Per-test (dynamic) context capture and the analysis that turns a `.coverage` SQLite
database into per-test line/branch fingerprints. The decision rules live in `SKILL.md` §1.

## Capture per-test contexts (pytest / coverage.py)

```bash
# --cov-context=test tags every measured line with the test that ran it.
# --cov-branch records branch arcs so if/else on one line are distinct.
pytest --cov=src --cov-branch --cov-context=test
```

Equivalent in `.coveragerc` if you prefer config over flags:

```ini
[run]
branch = true
dynamic_context = test_function
```

Under the hood coverage.py calls `switch_context()` around each test (pytest-cov wires
this automatically). Results land in the `.coverage` SQLite DB.

## Read the contexts out of the .coverage SQLite DB

coverage.py exposes a stable Python API — prefer it over raw SQL so schema changes do
not break you. But the raw tables are `context`, `file`, `line_bits`, and `arc`.

```python
import coverage

cov = coverage.Coverage(data_file=".coverage")
cov.load()
data = cov.get_data()

# Per-test line sets: {test_context: {(file, line), ...}}
line_sets = {}
branch_sets = {}
for ctx in data.measured_contexts():
    if not ctx:                      # "" is the no-context bucket; skip it
        continue
    data.set_query_context(ctx)
    lset, bset = set(), set()
    for f in data.measured_files():
        for line in (data.lines(f) or []):
            lset.add((f, line))
        for arc in (data.arcs(f) or []):     # arcs present only with --cov-branch
            bset.add((f, arc))
    line_sets[ctx] = lset
    branch_sets[ctx] = bset
```

Raw SQL fallback (when you only have the file, no coverage.py installed):

```sql
-- contexts table maps context_id -> test name
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
