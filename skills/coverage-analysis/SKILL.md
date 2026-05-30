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

<objective>
Measure coverage to find gaps, not to chase numbers.
</objective>

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

> **Node baseline:** `c8` v11 and `nyc` v18 (both released 2026-02-22) require **Node 20 || >= 22**. If your project still runs on Node 18, pin `c8@^10` / `nyc@^17` until you can upgrade. New projects should standardize on Node 20+ and the current majors.

Three provider choices:

- **V8 / c8 (Node.js built-in)** — faster because it does not instrument source. Default for Vitest. Recommended for new Node projects.
- **Istanbul / nyc** — instruments source, slower but more widely compatible. Use when V8 maps poorly to your transpiled output.
- **coverage.py (Python)** — `pytest-cov` wrapper. coverage.py 7.13+ supports a standalone `.coveragerc.toml`.

See `references/tool-config.md` for the full provider configs (Vitest `coverage` block, `.nycrc.json`, Jest `coverageThreshold`, and `pyproject.toml` / `.coveragerc.toml`), install commands, and the run invocations.

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

Show coverage change per PR so reviewers see the impact of each change. The standard approach is `davelosert/vitest-coverage-report-action@v2` reading the JSON summary, or `marocchino/sticky-pull-request-comment@v2` with a script that filters to changed files (via `git diff --name-only origin/main...HEAD`) and renders a markdown table.

See `references/ci-gating.md` for the full coverage-diff workflow.

---

## Coverage as CI Gate

### Threshold Configuration

Set a **global threshold** as the project minimum, then layer **per-directory thresholds** that are stricter for critical code (payments, auth) than for utilities. Both Vitest (`thresholds` with glob keys) and Jest (`coverageThreshold` with path keys) support per-path overrides.

See `references/ci-gating.md` for the global, per-directory, and Jest per-file threshold config.

### Ratchet Pattern

Never let coverage decrease. Record the current level as the minimum and update it upward when coverage improves. A ratchet script reads `coverage-summary.json`, compares each metric against a committed `.coverage-ratchet.json`, fails the build on any regression, and floors-up the baseline when coverage improves.

Commit `.coverage-ratchet.json` to the repo (e.g., `{ "lines": 82, "branches": 78, ... }`). In CI, run the ratchet script after tests. On main branch merges, auto-commit the updated ratchet file if coverage improved.

See `references/ci-gating.md` for the full `coverage-ratchet.ts` script.

### PR Diff Coverage Gate

Require that new code in a PR meets a higher threshold (e.g., 90%) than the project baseline. In CI, use `git diff --numstat origin/main...HEAD` to identify changed files, then check their coverage from `coverage-summary.json`. Fail the pipeline if the average coverage of changed files falls below the threshold. This prevents coverage decay without demanding a rewrite of legacy code.

**Hosted alternatives:** **Codecov**, **Coveralls**, and **Trunk Coverage** all ship first-class differential PR coverage with merge-blocking gates and inline annotations. Most teams prefer these over hand-rolled diff scripts — pick one if you don't already have a coverage host. Codecov + GitHub: `codecov/codecov-action@v5` reads `lcov.info` and posts a PR comment with diff coverage automatically.

---

## Mutation Testing

Mutation testing measures *assertion quality*, not just code execution. With Stryker JS v9.6+ and Vitest 4.1+, the cost is low enough to make mutation score realistic on PR-changed files. See `references/mutation-testing.md` for the Stryker config (`stryker.config.json`, run on changed files only) and mutmut (Python) invocation.

### Targeting

Mutation testing is expensive on whole codebases. Restrict to:
- Pure business logic (validators, calculators, transformers)
- Critical paths (payment, auth, data integrity)
- Code with low confidence in test quality (look at branch-coverage > 90% but few assertion variants)

Skip on UI rendering code, glue code, and generated code.

### Reading the score

A mutation score of 80% means 80% of mutated bugs were caught by your tests. Lower than your coverage % is normal — many mutations land in untested branches the coverage report already flagged. The interesting gap is **high coverage + low mutation score**: code is executed but assertions don't constrain it.

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

## Done When

- Coverage is instrumented and running automatically in CI on every push (no manual steps to generate the report).
- Coverage threshold is enforced in CI configuration (build fails when line or branch coverage drops below the defined minimum).
- Coverage report is published as a CI artifact (HTML report and `json-summary`) and linked from PR comments showing per-PR coverage delta.
- Meaningful vs. vanity coverage distinction is documented for the codebase: excluded paths are listed and justified (generated code, barrel exports, type definitions), and per-directory thresholds are set higher for critical paths such as payments and auth.
- Coverage-as-ratchet is configured so the threshold only goes up: `.coverage-ratchet.json` is committed, the ratchet script runs in CI, and the build fails if coverage regresses from the recorded baseline.

## Reference Files (in `references/`)

- **tool-config.md** — Full provider configs for V8/c8 (Vitest), Istanbul/nyc, Jest, and coverage.py (Python), with install and run commands.
- **ci-gating.md** — PR coverage-diff workflow, global/per-directory/per-file thresholds, and the `coverage-ratchet.ts` script.
- **mutation-testing.md** — Stryker (`stryker.config.json`) and mutmut configuration for measuring assertion quality.

## Related Skills

- **unit-testing** -- Test writing patterns, mocking strategies, framework-specific coverage configuration, and Vitest 4 `coverage.changed` for changed-files-only coverage in CI.
- **ci-cd-integration** -- Pipeline configuration for coverage gates, artifact storage, and PR comments.
- **qa-metrics** -- Quality KPIs including coverage trends, mutation scores, defect escape rates, and Test Impact Analysis as a coverage-driven CI lever.
- **ai-qa-review** -- AI-assisted identification of coverage gaps and undertested code paths; Vitest browser mode for component coverage parity.
