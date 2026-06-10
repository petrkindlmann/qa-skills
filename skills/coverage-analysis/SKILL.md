---
name: coverage-analysis
description: >-
  Measure and improve test coverage meaningfully. Covers Istanbul/V8/coverage.py
  configuration, coverage gap analysis by risk, coverage-as-ratchet in CI (never let
  it decrease), PR coverage diff checks, mutation testing for assertion quality, and
  distinguishing meaningful from vanity coverage. Use when: "code coverage," "coverage
  gap," "Istanbul," "coverage threshold," "coverage report," "branch coverage."
  Not for: writing the tests that raise coverage — use unit-testing; coverage as a
  tracked KPI trend over time — use qa-metrics.
  Related: unit-testing, ci-cd-integration, qa-metrics, ai-qa-review.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: metrics
---

<objective>
A suite at 90% line coverage with assertion-free tests catches zero bugs — line coverage
proves code ran, not that a regression would be caught. This skill measures the right
things (branch coverage, mutation score, critical-path coverage), gates them in CI with a
ratchet so coverage can only go up, and surfaces gaps by risk instead of chasing a vanity
number. It prevents the classic failure: a green coverage badge over a test suite that
never asserts anything meaningful, while the payment module sits at 30%.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Pick and configure a coverage provider | Coverage Tools → `references/tool-config.md` |
| Decide where to write tests next | Gap Analysis |
| Stop coverage from regressing in CI | Coverage as CI Gate → Ratchet Pattern |
| Show per-PR coverage to reviewers | Coverage as CI Gate → PR Diff |
| Tests run code but don't assert | Mutation Testing |
| Decide what to exclude / what target to set | Meaningful vs Vanity Coverage |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there. Then:

1. **What test runner and coverage tooling is configured?** Check for `vitest.config.*` (coverage block), `jest.config.*` (coverageProvider), `.nycrc`, `c8` in scripts, or `[tool.coverage]` in `pyproject.toml`. The runner decides the install — Vitest pulls `@vitest/coverage-v8`, not c8 (see Coverage Tools).
2. **What is the current coverage level?** Run the existing coverage command and note line, branch, and function percentages. This is the baseline for the ratchet.
3. **Is coverage gated in CI?** Check GitHub Actions / GitLab CI for `--coverage`, `coverageThreshold`, `fail_under`, or `--cov-fail-under`. No gate means coverage is decorative.
4. **What is the target, and who set it?** A target without rationale ("the VP said 80%") leads to gaming. Targets should reflect risk tolerance and codebase maturity, not a round number.

---

## Core Principles

**1. Coverage measures breadth, not depth.** A line being executed does not mean it is tested correctly. `expect(true).toBe(true)` executes the function but asserts nothing. Coverage tells you what code ran, not whether the tests would catch a bug — that is what mutation testing measures.

**2. Branch coverage matters more than line coverage.** A ternary `condition ? a : b` on one line counts as fully covered in line coverage even if only one branch ran. Line coverage does not guarantee branch coverage. Gate on branches, not just lines:

```typescript
function discount(price: number, isPremium: boolean): number {
  return isPremium ? price * 0.8 : price;
}

// Line coverage: 100% (the line executed). Branch coverage: 50% (only the true branch ran).
expect(discount(100, true)).toBe(80);

// Fix — assert BOTH paths so branch coverage reaches 100%:
expect(discount(100, true)).toBe(80);
expect(discount(100, false)).toBe(100);
```

**3. Ratchet pattern: never decrease, only increase.** Record current coverage as the minimum threshold. Every PR must meet or exceed it. Coverage climbs over time without forcing an artificial target up front.

**4. Focus on gaps by risk, not on the number.** A project at 85% is not automatically "better" than one at 75%. What matters is whether the untested slice contains payment, auth, or data-integrity logic. Analyze gaps by risk.

**5. New code has a higher bar than legacy code.** Require 90%+ on new code in PRs even if the project sits at 65%. This stops coverage decay without demanding a rewrite of legacy code.

---

## Coverage Tools

Pick the provider by **test runner first**, then by how cleanly it maps to your build output.

| Runner / context | Install | Provider |
|---|---|---|
| **Vitest** | `@vitest/coverage-v8` (default) or `@vitest/coverage-istanbul` | `coverage.provider: 'v8'` / `'istanbul'` |
| **Jest** | bundled (`coverageProvider: 'v8'` or `'babel'`) | V8 or Istanbul/babel |
| **Non-Vitest Node** (`node:test`, plain mocha) | `c8` CLI | V8 via `c8 <command>` |
| **Legacy Istanbul CLI** | `nyc` | Istanbul instrumentation |
| **Python** | `pytest-cov` (wraps coverage.py) | coverage.py |

Two engines underneath:

- **V8 coverage** — built into the V8 engine, so it does not instrument source: faster, no Babel transform. For Vitest, install `@vitest/coverage-v8` (NOT `c8` — that is the standalone CLI for non-Vitest runners). For a plain `node:test` or mocha project, `c8` is the CLI wrapper around the same V8 data. Default for new Node/Vitest projects.
- **Istanbul** — instruments source code; slower but maps more reliably through transpilers and bundlers. Switch to it (`@vitest/coverage-istanbul`, or `nyc`) when V8 maps poorly. **Symptom that V8 maps poorly:** reported uncovered lines land on blank lines, closing braces, or decorators, or whole covered functions show as red — that means the source map is misattributing lines (common with certain TS bundlers / SWC configs). When you see that, flip to the Istanbul provider.

> **Node baseline:** `c8` 10.x and `nyc` 18.x are current. c8 10.x supports Node >=12; nyc 18 requires **Node 20 || >= 22**. If you must stay on Node 18, pin `nyc@^17`. New projects should standardize on Node 20+.

See `references/tool-config.md` for the full provider configs (Vitest `coverage` block, `.nycrc.json`, Jest `coverageThreshold`, `pyproject.toml` / `.coveragerc.toml`), install commands, and run invocations.

### Merging coverage across test types

Unit, integration, and E2E runs each produce partial coverage. Combine them so a line covered only by an integration test isn't reported as a gap:

- **Vitest** — run as multiple projects/configs and let Vitest merge, or merge `coverage-final.json` outputs.
- **nyc** — `nyc merge .nyc_output merged.json && nyc report -t merged` combines `.json` files from separate runs.
- **coverage.py** — `coverage combine` after running each suite with `coverage run -p`.

Merge first, gate on the merged total. Don't gate each suite's coverage in isolation.

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

Coverage reports show which lines and branches did not run. Not all gaps are equal — prioritize by risk.

**Step 1: Generate the report.**

```bash
npm run test:coverage
# Open coverage/index.html in a browser
```

**Step 2: Sort files by uncovered lines.** Parse `coverage-summary.json`, sort files by `(total - covered)` descending, focus on the top 20. A small script that reads the JSON summary and outputs file / line% / branch% / uncovered-count makes this repeatable.

**Step 3: Map gaps to risk.**

| Gap Location | Risk Level | Action |
|-------------|-----------|--------|
| Payment processing | Critical | Write tests immediately |
| Auth/permissions | Critical | Write tests immediately |
| Data validation | High | Add to next sprint |
| Error handling paths | High | Add to next sprint |
| Utility functions | Medium | Cover when modifying |
| UI formatting | Low | Skip unless regression-prone |
| Generated code | None | Exclude from coverage |

Include branch coverage in the sort, not just lines — a file at 100% line / 50% branch hides untested paths a line-only sort would rank as "done."

---

## Coverage as CI Gate

### Threshold Configuration

Set a **global threshold** as the project minimum, then layer **per-directory thresholds** stricter for critical code (payments, auth) than for utilities. Vitest uses glob keys under `thresholds` (e.g. `"src/payments/**": { lines: 95, branches: 90 }`); Jest uses path keys under `coverageThreshold`. Both support per-path overrides.

See `references/ci-gating.md` for the global, per-directory, and Jest per-file threshold config.

### Ratchet Pattern

Never let coverage decrease. Record the current level as the minimum and floor it upward when coverage improves. A ratchet script reads `coverage-summary.json`, compares each metric against a committed `.coverage-ratchet.json`, fails the build on any regression, and updates the baseline when coverage improves.

Commit `.coverage-ratchet.json` (e.g. `{ "lines": 82, "branches": 78, ... }`). In CI, run the ratchet script after tests. On main-branch merges, auto-commit the updated ratchet file if coverage improved.

See `references/ci-gating.md` for the full `coverage-ratchet.ts` script.

### PR Diff Coverage Gate

Require new code in a PR to meet a higher threshold (e.g. 90%) than the project baseline. In CI, use `git diff --name-only origin/main...HEAD` to identify changed files, then check their coverage from `coverage-summary.json`. Fail the pipeline if changed-file coverage falls below the threshold. This stops decay without rewriting legacy code.

Surface the diff to reviewers with `davelosert/vitest-coverage-report-action@v2` (reads the JSON summary) or `marocchino/sticky-pull-request-comment@v2` with a script that filters to changed files. See `references/ci-gating.md` for the full PR workflow.

**Hosted alternatives:** **Codecov**, **Coveralls**, and **Trunk Coverage** ship first-class differential PR coverage with merge-blocking gates and inline annotations. Most teams prefer these over hand-rolled diff scripts — pick one if you don't already have a coverage host. Codecov + GitHub: `codecov/codecov-action@v5` reads `lcov.info` and posts a PR diff comment automatically.

---

## Mutation Testing

Mutation testing measures *assertion quality*, not just code execution. It mutates your source (flips a `>` to `>=`, deletes a line) and checks whether a test fails. A surviving mutant means a real bug your tests would miss. With **Stryker JS v9.6+** and **Vitest 4.1+** the cost is low enough to run on PR-changed files; **mutmut 3.x** covers Python.

### Targeting

Mutation testing is expensive on whole codebases — run it **incrementally**. Stryker's `incremental: true` (JSON cache) plus `--mutate` scoped to the git diff re-mutates only touched files; mutmut similarly mutates per path. Restrict to:

- Pure business logic (validators, calculators, transformers)
- Critical paths (payment, auth, data integrity)
- Code with high line coverage but suspect assertions (branch coverage > 90% but few assertion variants)

Skip UI rendering, glue code, and generated code.

See `references/mutation-testing.md` for the Stryker config (`stryker.config.json`, incremental, run on changed files only) and the mutmut invocation.

### Reading the score

A mutation score of 80% means 80% of injected bugs were caught. Lower than your coverage % is normal — many mutants land in untested branches the coverage report already flagged. The interesting signal is **high coverage + low mutation score**: code executes but assertions don't constrain it.

---

## Meaningful vs Vanity Coverage

### Why 100% Coverage Is Usually Wrong

100% requires testing every branch of every line, including:
- Error handling for impossible states
- Default cases in exhaustive switches
- Framework lifecycle methods never called directly
- Defensive checks against corrupted data

Tests written to hit 100% are often trivial, brittle, and catch no real bugs.

### Diminishing Returns

| Coverage Range | Value | Effort |
|---------------|-------|--------|
| 0% to 60% | High — main paths, obvious regressions | Low |
| 60% to 80% | Medium — error paths, edge cases | Medium |
| 80% to 90% | Lower — unusual combinations, defensive code | High |
| 90% to 100% | Minimal — unreachable code, framework internals | Very high |

The sweet spot is **75–85%** for most projects. Critical paths (payments, auth) aim higher (**90%+**). Set the global threshold in the sweet spot and per-directory thresholds at 90%+ for payment/auth.

### What NOT to Cover

Exclude these — they inflate the denominator without adding value. Document each exclusion's justification in a CONTRIBUTING/coverage note so the exclude list can't quietly hide real gaps.

```typescript
// vitest.config.ts / jest.config.js — exclude patterns
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

| Indicator | What It Measures | How to Get It |
|-----------|-----------------|---------------|
| **Mutation score** | Would tests catch a real bug? | Stryker / mutmut |
| **Branch coverage** | Are all conditional paths tested? | V8/Istanbul with branch reporting |
| **Critical path coverage** | Are payment/auth/data flows fully covered? | Per-directory thresholds |
| **Defect escape rate** | Do production bugs occur in tested code? | Post-incident analysis |
| **Coverage delta** | Is coverage improving or declining? | Ratchet pattern tracking |

---

## Anti-Patterns

### 1. Treating coverage as proof of quality
"We have 90% coverage so we're well-tested" is dangerous. Coverage says code executed, not that behavior was verified. **Fix:** pair the percentage with a mutation score on critical modules; a test with no assertions should drop the mutation score even at 100% line coverage.

### 2. Excluding files to inflate numbers
Adding hard-to-test files (error handlers, integration modules) to the exclude list hides the most important gaps. **Fix:** only exclude genuinely untestable code — generated files, type definitions, barrel exports — and justify each exclusion in writing.

### 3. Writing trivial tests to hit targets
`it("should exist", () => expect(MyClass).toBeDefined())` adds coverage without value. **Fix:** every test verifies a behavior that, if broken, affects users; mutation testing flags these no-op tests.

### 4. Global threshold without per-module analysis
An 80% global threshold passes even if payments sits at 30%, as long as utilities inflate the average. **Fix:** per-directory thresholds at 90%+ for payment/auth.

### 5. Coverage threshold set once, never adjusted
A team stuck at 78% for six months isn't improving. **Fix:** the ratchet floors upward automatically; review it quarterly and investigate stagnation.

### 6. Ignoring branch coverage
Line coverage reports 100% on `const r = cond ? a : b` even if one branch never runs. **Fix:** always report and gate on `branches` alongside `lines`.

### 7. Coverage from E2E tests only
A single E2E test touches 60% of the codebase without testing any edge case — broad and shallow. **Fix:** measure unit/integration coverage separately from E2E and gate on the unit/integration total; E2E coverage is a bonus signal, not the gate.

---

## Verification

Prove the gate actually fails on regression — a green build with no enforcement is worthless.

1. **Threshold fires:** temporarily lower one committed metric below current (or delete one passing test), run `npm run test:coverage` (or `pytest --cov=src --cov-fail-under=80`), and confirm a **non-zero exit code**. Restore afterward.
2. **Ratchet fires:** with `.coverage-ratchet.json` committed, drop a test so coverage regresses, run the ratchet script, and confirm it prints `FAIL: ... coverage dropped` and exits 1.
3. **Branch gate is on:** confirm the report shows a `branches` column and that `branches` appears in the threshold config — not just `lines`.
4. **PR diff renders:** open a draft PR touching one source file and confirm the coverage-diff comment posts with the changed file's numbers.

If step 1 exits 0 after you lowered coverage, the gate is not wired — fix that before claiming Done.

---

## Done When

- Coverage runs automatically in CI on every push (no manual step to generate the report).
- Coverage threshold is enforced in CI: the build exits non-zero when line **or branch** coverage drops below the defined minimum (verified per Verification step 1).
- Coverage report is published as a CI artifact (HTML + `json-summary`) and a per-PR coverage delta posts to PR comments.
- The coverage config contains an exclude list and per-directory thresholds (90%+ for payments/auth), and a CONTRIBUTING/coverage doc lists each exclusion's justification.
- Ratchet is wired: `.coverage-ratchet.json` is committed, the ratchet script runs in CI, and the build fails on regression from the recorded baseline (verified per Verification step 2).

## Reference Files (in `references/`)

- **tool-config.md** — Full provider configs for Vitest (`@vitest/coverage-v8` / `-istanbul`), the c8 CLI for non-Vitest runners, nyc, Jest, and coverage.py, with install and run commands.
- **ci-gating.md** — PR coverage-diff workflow, global/per-directory/per-file thresholds, and the `coverage-ratchet.ts` script.
- **mutation-testing.md** — Stryker (`stryker.config.json`, incremental) and mutmut configuration for measuring assertion quality.

## Related Skills

- **unit-testing** — Writing the tests that raise coverage: mocking strategies, framework-specific config, and Vitest `coverage.changed` for changed-files-only coverage in CI. Go there to author tests; this skill measures and gates them.
- **ci-cd-integration** — Pipeline wiring for coverage gates, artifact storage, and PR comments.
- **qa-metrics** — Coverage as a tracked KPI trend over time alongside mutation score and defect escape rate. Go there for dashboards and trends; this skill is per-repo configuration and gating.
- **ai-qa-review** — AI-assisted identification of undertested paths and Vitest browser mode for component coverage parity.
