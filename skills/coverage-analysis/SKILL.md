---
name: coverage-analysis
description: >-
  Measure and improve test coverage meaningfully. Covers Istanbul/V8/c8/coverage.py
  configuration, coverage gap analysis methodology, coverage-as-ratchet in CI (never
  let it decrease), PR coverage diff checks, and distinguishing meaningful from vanity
  coverage. Use when: "code coverage," "coverage gap," "Istanbul," "coverage threshold,"
  "coverage report," "branch coverage."
  Related: unit-testing, ci-cd-integration, qa-metrics, ai-qa-review.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: metrics
---

# Coverage Analysis

Measure coverage to find gaps, not to chase numbers.

---

## Discovery Questions

1. **What coverage tooling is configured?** Check for `jest.config.*` (coverageProvider), `vitest.config.*` (coverage), `.nycrc`, `c8` in scripts, or `[tool.coverage]` in `pyproject.toml`.
2. **What is the current coverage level?** Run the existing coverage command and note line, branch, and function percentages. This is the baseline for the ratchet.
3. **Is coverage gated in CI?** Check GitHub Actions or GitLab CI for `--coverage`, `coverageThreshold`, `fail_under`, or `--cov-fail-under` flags.
4. **What is the target, and who set it?** A target without rationale ("the VP said 80%") leads to gaming. Targets should reflect risk tolerance and codebase maturity.
5. **Check `.agents/qa-project-context.md` first.** Respect existing coverage conventions and thresholds.

---

## Core Principles

**1. Coverage measures breadth, not depth.** A line of code being executed does not mean it is tested correctly. `expect(true).toBe(true)` executes the function but asserts nothing meaningful. Coverage tells you what code ran, not whether the tests would catch a bug.

**2. Branch coverage matters more than line coverage.** A ternary `condition ? a : b` on one line counts as "covered" in line coverage even if only one branch executes. Branch coverage exposes untested paths.

```typescript
// Line coverage: 100% (the line executed)
// Branch coverage: 50% (only the 'true' branch ran)
function discount(price: number, isPremium: boolean): number {
  return isPremium ? price * 0.8 : price;
}

// Test only covers isPremium = true
expect(discount(100, true)).toBe(80);
// Missing: expect(discount(100, false)).toBe(100);
```

**3. Ratchet pattern: never decrease, only increase.** Record the current coverage as the minimum threshold. Every PR must meet or exceed it. Coverage goes up over time without forcing artificial targets.

**4. Focus on gaps, not numbers.** A project at 85% coverage is not "better" than one at 75%. What matters is whether the untested 15% or 25% contains critical business logic. Analyze gaps by risk, not by percentage.

**5. New code has a higher bar than legacy code.** Require 90%+ coverage on new code in PRs even if the overall project is at 65%. This prevents coverage decay without demanding a rewrite of legacy code.

---

## Coverage Tools

### V8 / c8 (Node.js Built-in)

V8's built-in code coverage is faster than Istanbul because it does not instrument source code. Use `c8` as the CLI wrapper.

```bash
npm i -D c8
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

### Istanbul / nyc (JavaScript/TypeScript)

Istanbul instruments source code for coverage tracking. Slower than V8 but more widely compatible.

```bash
npm i -D nyc
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

### coverage.py (Python)

```bash
pip install pytest-cov
```

```toml
# pyproject.toml
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

### Coverage Report Types

| Reporter | Output | Use Case |
|----------|--------|----------|
| `text` | Terminal table | Quick local check |
| `html` | Interactive HTML | Detailed local analysis, clicking through files |
| `lcov` | `lcov.info` file | SonarQube, Codecov, Coveralls integration |
| `json-summary` | `coverage-summary.json` | CI scripts, PR comments, dashboard metrics |
| `cobertura` | `cobertura-coverage.xml` | GitLab CI coverage visualization |

---

## Gap Analysis

### Identify Untested Code Paths

Coverage reports show which lines and branches are not executed. But not all gaps are equal. Prioritize by risk.

**Step 1: Generate the coverage report.**

```bash
npm run test:coverage
# Open coverage/index.html in a browser
```

**Step 2: Sort files by uncovered lines.** Parse `coverage-summary.json`, sort files by `(total - covered)` descending, and focus on the top 20. A script that reads the JSON summary and outputs a table of file, line%, branch%, and uncovered count makes this repeatable.

**Step 3: Map gaps to risk areas.**

| Gap Location | Risk Level | Action |
|-------------|-----------|--------|
| Payment processing | Critical | Write tests immediately |
| Auth/permissions | Critical | Write tests immediately |
| Data validation | High | Add to next sprint |
| Error handling paths | High | Add to next sprint |
| Utility functions | Medium | Cover when modifying |
| UI formatting | Low | Skip unless regression-prone |
| Generated code | None | Exclude from coverage |

### Coverage Diff on PRs

Show coverage change per PR so reviewers see the impact of each change.

```yaml
# GitHub Actions: coverage diff comment
- name: Run tests with coverage
  run: npm run test:coverage

- name: Coverage Report
  uses: davelosert/vitest-coverage-report-action@v2
  if: github.event_name == 'pull_request'
  with:
    json-summary-path: coverage/coverage-summary.json
    json-final-path: coverage/coverage-final.json
    vite-config-path: vitest.config.ts
```

Alternative: use `marocchino/sticky-pull-request-comment@v2` with a script that reads `coverage-summary.json`, filters to changed files (via `git diff --name-only origin/main...HEAD`), and renders a markdown table showing per-file line and branch coverage.

---

## Coverage as CI Gate

### Threshold Configuration

**Global threshold (minimum for the entire project):**

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    lines: 80,
    branches: 80,
    functions: 80,
    statements: 80,
  },
}
```

**Per-directory thresholds (stricter for critical code):**

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    // Global baseline
    lines: 75,
    branches: 75,

    // Stricter for critical paths
    "src/payments/**": { lines: 95, branches: 90 },
    "src/auth/**": { lines: 90, branches: 85 },
    "src/utils/**": { lines: 80, branches: 80 },
  },
}
```

**Jest per-file thresholds:**

```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    global: { branches: 75, functions: 75, lines: 75, statements: 75 },
    "./src/payments/": { branches: 90, functions: 90, lines: 95, statements: 95 },
    "./src/auth/": { branches: 85, functions: 85, lines: 90, statements: 90 },
  },
};
```

### Ratchet Pattern

Never let coverage decrease. Record the current level as the minimum and update it upward when coverage improves.

```typescript
// scripts/coverage-ratchet.ts
import fs from "fs";
import coverageSummary from "../coverage/coverage-summary.json";

const RATCHET_FILE = ".coverage-ratchet.json";

interface Ratchet {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  updatedAt: string;
}

// Read current ratchet or initialize
let ratchet: Ratchet;
try {
  ratchet = JSON.parse(fs.readFileSync(RATCHET_FILE, "utf-8"));
} catch {
  ratchet = { lines: 0, branches: 0, functions: 0, statements: 0, updatedAt: "" };
}

const current = (coverageSummary as any).total;
const metrics = ["lines", "branches", "functions", "statements"] as const;
let failed = false;

for (const metric of metrics) {
  const currentPct = current[metric].pct;
  const ratchetPct = ratchet[metric];

  if (currentPct < ratchetPct) {
    console.error(
      `FAIL: ${metric} coverage dropped from ${ratchetPct}% to ${currentPct}% (delta: ${(currentPct - ratchetPct).toFixed(1)}%)`
    );
    failed = true;
  } else if (currentPct > ratchetPct) {
    console.log(`IMPROVED: ${metric} coverage increased from ${ratchetPct}% to ${currentPct}%`);
    ratchet[metric] = Math.floor(currentPct); // Floor to avoid ratcheting on decimals
  } else {
    console.log(`STABLE: ${metric} coverage at ${currentPct}%`);
  }
}

if (failed) {
  console.error("\nCoverage ratchet failed. Coverage must not decrease.");
  console.error("If this is intentional (e.g., removing dead code), update .coverage-ratchet.json manually.");
  process.exit(1);
}

// Update ratchet file
ratchet.updatedAt = new Date().toISOString();
fs.writeFileSync(RATCHET_FILE, JSON.stringify(ratchet, null, 2) + "\n");
console.log(`\nRatchet updated: ${JSON.stringify(ratchet)}`);
```

Commit `.coverage-ratchet.json` to the repo (e.g., `{ "lines": 82, "branches": 78, ... }`). In CI, run the ratchet script after tests. On main branch merges, auto-commit the updated ratchet file if coverage improved.

### PR Diff Coverage Gate

Require that new code in a PR meets a higher threshold (e.g., 90%) than the project baseline. In CI, use `git diff --numstat origin/main...HEAD` to identify changed files, then check their coverage from `coverage-summary.json`. Fail the pipeline if the average coverage of changed files falls below the threshold. This prevents coverage decay without demanding a rewrite of legacy code.

---

## Meaningful vs Vanity Coverage

### Why 100% Coverage Is Usually Wrong

100% coverage requires testing every branch of every line, including:
- Error handling for impossible states
- Default cases in exhaustive switches
- Framework lifecycle methods that are never called directly
- Defensive checks against corrupted data

Tests written to hit 100% are often trivial, brittle, and do not catch real bugs.

### Diminishing Returns

| Coverage Range | Value | Effort |
|---------------|-------|--------|
| 0% to 60% | High -- covers main paths, catches obvious regressions | Low |
| 60% to 80% | Medium -- covers error paths, edge cases | Medium |
| 80% to 90% | Lower -- covers unusual combinations, defensive code | High |
| 90% to 100% | Minimal -- covers unreachable code, framework internals | Very high |

The sweet spot is 75-85% for most projects. Critical paths (payments, auth) should aim higher (90%+).

### What NOT to Cover

Exclude these from coverage calculations. They inflate the denominator without adding value.

```typescript
// vitest.config.ts or jest.config.js -- exclude patterns
exclude: [
  "**/*.d.ts",              // Type definitions
  "**/index.ts",            // Barrel exports (re-exports only)
  "**/*.stories.{ts,tsx}",  // Storybook stories
  "**/generated/**",        // Auto-generated code (GraphQL, Prisma)
  "**/migrations/**",       // Database migrations
  "**/__mocks__/**",        // Test mocks
  "**/types/**",            // Type-only modules
]
```

### Quality Indicators Beyond Percentage

Coverage percentage alone is insufficient. Combine it with:

| Indicator | What It Measures | How to Get It |
|-----------|-----------------|---------------|
| **Mutation score** | Would tests catch a real bug? | Stryker / mutmut |
| **Branch coverage** | Are all conditional paths tested? | V8/Istanbul with branch reporting |
| **Critical path coverage** | Are payment/auth/data flows fully covered? | Per-directory thresholds |
| **Defect escape rate** | Do production bugs occur in tested code? | Post-incident analysis |
| **Coverage delta** | Is coverage improving or declining? | Ratchet pattern tracking |

---

## Anti-Patterns

**Treating coverage as proof of quality.** "We have 90% coverage so we are well-tested" is a dangerous statement. Coverage says code executed, not that behavior was verified. A test with no assertions contributes to coverage but catches zero bugs.

**Excluding files to inflate numbers.** Adding files to the exclude list because they are hard to test (e.g., error handlers, integration modules) hides the most important gaps. Only exclude genuinely untestable code: generated files, type definitions, and barrel exports.

**Writing trivial tests to hit targets.** Tests like `it("should exist", () => { expect(MyClass).toBeDefined(); })` add coverage without value. Every test should verify a behavior that, if broken, would affect users.

**Global threshold without per-module analysis.** An 80% global threshold can pass even if the payment module is at 30% coverage -- as long as utility functions inflate the average. Use per-directory thresholds for critical paths.

**Coverage threshold set once, never adjusted.** The ratchet should increase over time. A team that has been at 78% for 6 months is not improving. Review the ratchet quarterly and investigate why it stagnates.

**Ignoring branch coverage.** Line coverage reports 100% on `const result = condition ? a : b` even if only one branch runs. Always report and gate on branch coverage alongside line coverage. Branch coverage is the more honest metric.

**Coverage in E2E tests only.** E2E tests execute many lines but cover broad, shallow paths. A single E2E test might touch 60% of the codebase without testing any edge case. Unit tests provide targeted, deep coverage of logic branches. Measure coverage from unit and integration tests separately from E2E.

---

## Related Skills

- **unit-testing** -- Test writing patterns, mocking strategies, and framework-specific coverage configuration.
- **ci-cd-integration** -- Pipeline configuration for coverage gates, artifact storage, and PR comments.
- **qa-metrics** -- Quality KPIs including coverage trends, mutation scores, and defect escape rates.
- **ai-qa-review** -- AI-assisted identification of coverage gaps and undertested code paths.
