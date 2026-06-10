# Coverage Tool Configuration

Full config for Vitest (V8/Istanbul), the c8 CLI (non-Vitest), nyc, Jest, and coverage.py. The decision prose and Node version notes live in `SKILL.md`.

## Vitest — V8 provider (default)

V8 coverage is built into the V8 engine and does not instrument source code, so it is faster than Istanbul. For a **Vitest** project install the provider package — `@vitest/coverage-v8` — NOT `c8`. (c8 is the standalone CLI for non-Vitest runners; see below.)

```bash
npm i -D @vitest/coverage-v8   # Node 20+ baseline
# Maps poorly through your bundler? swap to: npm i -D @vitest/coverage-istanbul
```

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",   // or "istanbul" — install @vitest/coverage-istanbul
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/**/*.d.ts",
        "src/**/index.ts",       // Barrel exports
        "src/**/types.ts",       // Type-only files
        "src/**/*.stories.ts",   // Storybook
        "src/generated/**",      // Generated code
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
```

## c8 CLI — for non-Vitest Node runners

For `node:test`, plain mocha, or any runner without its own coverage provider, `c8` wraps the same V8 coverage data as a CLI. Do NOT install c8 in a Vitest project — Vitest's V8 support comes from `@vitest/coverage-v8`.

```bash
npm i -D c8@^11   # current major; c8 11 supports Node >=12
```

```jsonc
// .c8rc.json (or "c8" key in package.json)
{
  "reporter": ["text", "html", "lcov", "json-summary"],
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/**/*.d.ts", "src/**/index.ts", "src/generated/**"],
  "check-coverage": true,
  "branches": 80,
  "lines": 80,
  "functions": 80,
  "statements": 80
}
```

```bash
c8 node --test            # run node:test under coverage
c8 mocha                  # or wrap any runner
```

## Istanbul / nyc (JavaScript/TypeScript)

Istanbul instruments source code for coverage tracking. Slower than V8 but maps more reliably through transpilers and bundlers.

```bash
npm i -D nyc@^18   # nyc 18 requires Node 20 || >= 22; pin nyc@^17 to stay on Node 18
```

```json
// .nycrc.json
{
  "all": true,
  "include": ["src/**/*.ts"],
  "exclude": [
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.d.ts",
    "src/**/index.ts",
    "src/generated/**"
  ],
  "reporter": ["text", "html", "lcov", "json-summary"],
  "report-dir": "./coverage",
  "check-coverage": true,
  "branches": 80,
  "lines": 80,
  "functions": 80,
  "statements": 80,
  "watermarks": {
    "lines": [70, 90],
    "functions": [70, 90],
    "branches": [70, 90],
    "statements": [70, 90]
  }
}
```

## Jest

Jest ships coverage built in — no extra install. Set `coverageProvider` to `"v8"` (faster, no Babel transform) or `"babel"` (Istanbul-based; use when V8 maps poorly through your transform).

```json
// package.json (with Jest)
{
  "scripts": {
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "coverageProvider": "v8",
    "collectCoverageFrom": [
      "src/**/*.ts",
      "!src/**/*.{test,spec,d}.ts",
      "!src/**/index.ts",
      "!src/generated/**"
    ],
    "coverageThreshold": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## coverage.py (Python)

```bash
pip install pytest-cov   # current coverage.py 7.14.x
```

> coverage.py 7.13.0 added `.coveragerc.toml` as a TOML-first standalone config — prefer it for new Python projects when you want config separated from `pyproject.toml`. 7.12.0 split statements vs branches totals in HTML and JSON reports.

```toml
# pyproject.toml (or .coveragerc.toml in 7.13+)
[tool.coverage.run]
source = ["src"]
branch = true
omit = [
    "src/**/test_*.py",
    "src/**/conftest.py",
    "src/**/__init__.py",
    "src/generated/*",
]

[tool.coverage.report]
fail_under = 80
show_missing = true
skip_covered = true
precision = 1
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "if __name__ == .__main__.",
    "raise NotImplementedError",
    "@overload",
    "\\.\\.\\.",     # Ellipsis in abstract methods
]

[tool.coverage.html]
directory = "coverage/html"

[tool.coverage.xml]
output = "coverage/coverage.xml"
```

```bash
# Run tests with coverage
pytest --cov=src --cov-report=term-missing --cov-report=html --cov-report=xml

# Fail if coverage drops below threshold
pytest --cov=src --cov-fail-under=80
```
