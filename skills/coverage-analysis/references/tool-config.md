# Coverage Tool Configuration

Full config for V8/c8, Istanbul/nyc, and coverage.py. The decision prose and Node version notes live in `SKILL.md`.

## V8 / c8 (Node.js Built-in)

V8's built-in code coverage is faster than Istanbul because it does not instrument source code. Use `c8` as the CLI wrapper.

```bash
npm i -D c8@^11   # Node 20+ baseline
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
      provider: "v8",
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

## Istanbul / nyc (JavaScript/TypeScript)

Istanbul instruments source code for coverage tracking. Slower than V8 but more widely compatible.

```bash
npm i -D nyc@^18   # Node 20+ baseline
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
pip install pytest-cov   # current coverage.py 7.13.x
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
