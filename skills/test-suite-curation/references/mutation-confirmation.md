# Mutation Confirmation of Redundancy

Confirming that one test genuinely subsumes another's fault detection. Coverage equality
is a candidate signal only; the mutation kill-set comparison is the proof. Decision rules
in `SKILL.md` §2.

## Why mutation testing here

A mutant is a small injected fault (flip `>` to `>=`, swap `+` for `-`, remove a call).
A test **kills** a mutant if it fails on the mutated code. If survivor A kills every
mutant that candidate B kills, A genuinely subsumes B and B is a defensible delete
candidate. If B kills a mutant A misses, B catches a fault class A does not — **keep B**,
even though their line coverage was identical.

## Tool per stack (current, mid-2026)

| Stack | Tool | Notes |
|-------|------|-------|
| Python | **mutmut 3.6.0+** | AST-based, fast; needs fork support (WSL on Windows). Default choice. |
| Python | **cosmic-ray** | More configurable, slower setup; use when you need build-tool integration. |
| JS/TS | **StrykerJS 9.x** (`@stryker-mutator/core`) | `coverageAnalysis: perTest` + `incremental`. |
| Java/JVM | **PIT (pitest)** | Mature; slower than mutmut but the JVM standard. |
| Rust | **cargo-mutants** | Native Rust mutation testing. |

## Scope the mutation run to the suspect lines

Do not mutate the whole codebase to compare two tests — scope to the lines the candidate
pair covers (you already have them from the coverage fingerprint).

```bash
# mutmut: limit to the file(s) the suspect pair covers
mutmut run --paths-to-mutate src/pricing.py
mutmut results        # list surviving/killed mutants
```

```jsonc
// stryker.config.json — scope mutate globs to the covered files
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "coverageAnalysis": "perTest",
  "mutate": ["src/pricing.ts"],
  "thresholds": { "high": 80, "low": 60, "break": 0 }
}
```

## Compare kill-sets

Run mutation testing once with the full suite and inspect, per mutant, which tests killed
it (StrykerJS reports the killing test in its JSON; for mutmut, run the suite filtered to
A then to B and diff surviving mutants).

```
kills(A) = {mutants test A kills}
kills(B) = {mutants test B kills}

if kills(B) ⊆ kills(A):   A subsumes B's fault detection -> B is a delete candidate
if kills(B) ⊄ kills(A):   B kills a mutant A misses        -> KEEP B (different oracle)
```

Even when `kills(B) ⊆ kills(A)`, B still goes through quarantine + sign-off (SKILL.md §7)
before removal — the mutation check authorizes the *proposal*, not the deletion.

## The combined-signals case (never-failed + same-coverage)

When a test never failed in CI *and* has identical coverage to another (SKILL.md §9
anti-pattern, eval tsc-009): the two green signals are still not sufficient. Run the
mutation check to ask "does the OTHER test kill what this one does?" A test can have a
different assertion, input, edge case, or oracle that makes it unique despite identical
coverage and a clean CI history. Never-failed may mean low-risk/stable code, not
worthless. Only after the mutation check confirms subsumption does it go to quarantine.
