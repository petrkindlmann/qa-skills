# Mutation Testing — the objective backstop for qualitative smells

Coverage tells you a line *ran*. Mutation testing tells you whether the test would have *caught a bug* in that line. The runner introduces small faults (mutants) — flips a `>` to `>=`, returns `null`, deletes a statement — and reruns the suite. A mutant the tests still pass on "survived": no assertion constrained that behavior. The mutation score is killed / total.

Use it to convert two SKILL smells from eye-judgement into a measurable gate:

- **Closed AI loop** (tests mirror implementation). Tests that just echo what the agent wrote rarely kill mutants — they assert the produced value, not the contract. A low score on AI-authored tests is the signal.
- **Weak / redundant assertions** (`toBeTruthy`, duplicate assertions). Surviving mutants point at exactly the assertions that don't pin behavior down.

## Tools (verified current, mid-2026)

| Stack | Runner | Command |
|-------|--------|---------|
| JS / TS | StrykerJS (supports Jest, Vitest, Mocha) | `npx stryker run` |
| Java | PIT (pitest) | `mvn org.pitest:pitest-maven:mutationCoverage` |
| Rust | cargo-mutants | `cargo mutants` |
| Python | mutmut | `mutmut run` |

## Thresholds (2026 guidance)

- AI-generated tests scoring **< 60%** mutation score signal tests not independent of the implementation — treat as the Closed-AI-loop / weak-assertion smell and require human-authored boundary tests before trusting the suite.
- Hand-tuned production code: 70% on critical paths, 50% standard, 30% experimental. A score above 80% is a strong test-quality indicator.

## Minimal StrykerJS config

```jsonc
// stryker.config.json
{
  "testRunner": "vitest",
  "coverageAnalysis": "perTest",
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts"],
  "thresholds": { "high": 80, "low": 60, "break": 60 }
}
```

`"break": 60` fails CI under 60% — wire it as a quality gate parallel to the test runner, the same way ESLint catches static smells. Scope it to changed files in PR review (`--mutate "$(git diff --name-only main...HEAD | grep '\.ts$' | tr '\n' ',')"`) so a full-suite mutation run (slow) only happens in scheduled audits.

Surviving mutants double as a test-generation feedback loop: feed them back to the agent and ask it to write the assertion that kills each one.
