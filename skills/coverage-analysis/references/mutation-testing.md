# Mutation Testing

Stryker (JS/TS) and mutmut (Python) configuration. The targeting strategy and how to read the score live in `SKILL.md`.

## Stryker (JS/TS)

```json
// stryker.config.json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "coverageAnalysis": "perTest",
  "incremental": true,
  "incrementalFile": ".stryker-tmp/incremental.json",
  "mutate": ["src/**/*.ts"],
  "thresholds": { "high": 80, "low": 60, "break": 50 }
}
```

Run on PR-changed files only with `--mutate '$(git diff --name-only origin/main...HEAD | grep "src/.*\.ts")'`. Pair `incremental: true` with the JSON cache so consecutive runs only re-mutate touched files.

## mutmut (Python)

```bash
mutmut run --paths-to-mutate=src/
mutmut results
```

mutmut 3.x is a from-scratch rewrite (still active 2026); pin via `pip install mutmut==3.*`.
