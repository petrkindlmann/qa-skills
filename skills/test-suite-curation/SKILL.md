---
name: test-suite-curation
description: >-
  Audit a whole regression suite and prune/restructure it with evidence: per-test
  coverage fingerprinting, AST near-duplicate clustering, CI-history mining for
  never-failing and flaky tests, prune decision rules (redundant/obsolete/low-value/keep),
  smoke/core/extended tiering by risk and defect-detection history, and a defensible
  "what we deleted and why" record. Deletion is destructive — quarantine and human
  sign-off are mandatory. Use when: "audit the test suite," "prune redundant tests,"
  "find duplicate tests," "which tests can we delete," "restructure into smoke/core/extended,"
  "is this test pulling its weight," "shrink the regression suite."
  Not for: Judging whether an individual test is WELL-WRITTEN (smells, assertions) — that
  is ai-qa-review. Healing one flaky test at runtime — that is test-reliability. Bulk
  selector regeneration after a UI refactor — that is selector-drift-recovery.
  Related: ai-qa-review, coverage-analysis, test-reliability, risk-based-testing, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: process
---

<objective>
Test A and Test B cover the exact same lines, so a tired engineer deletes B — and three weeks later a production defect slips through because B was the only test that asserted the rounding was correct. Coverage equality is not redundancy. This skill audits an entire regression suite as a corpus (the redundancy analysis no human does by hand), prunes it on evidence rather than vibes, and treats every deletion as a destructive change that requires a quarantine grace period, human sign-off, and a record you can defend to an auditor.
</objective>

## Quick Route

| You want to... | Go to |
|----------------|-------|
| Find which lines/branches each test uniquely covers | [Coverage Fingerprinting](#1-coverage-fingerprinting-per-test) |
| Decide if "same coverage" means "delete one" | [The Coverage-Equality Trap](#2-the-coverage-equality-trap-the-load-bearing-rule) |
| Surface copy-pasted near-duplicate tests | [Near-Duplicate Clustering](#3-near-duplicate-clustering) |
| Find never-failing and always-flaky tests | [Mining CI History](#4-mining-ci-history) |
| Decide redundant vs obsolete vs low-value vs keep | [Prune Decision Rules](#5-prune-decision-rules) |
| Split a flat suite into smoke/core/extended | [Tiering](#6-tiering-smokecoreextended) |
| Safely delete the tests you flagged | [Destructive Safety](#7-destructive-safety-the-grace-period) |
| Produce the "what we deleted and why" record | [The Audit Record](#8-the-audit-record) |

## Discovery Questions

First, check `.agents/qa-project-context.md` in the project root and skip anything it already answers. Then clarify:

- **Which language/runner?** pytest+coverage.py, Jest/Vitest+Istanbul, Go, JUnit — the per-test context mechanism differs per stack (and so does the mutation tool).
- **Is there CI test-result history, and how far back?** No JUnit/Datadog/Trunk history means you cannot mine never-failing or flaky signals — you only have coverage and clustering.
- **What is the suite size and current wall-clock time?** This sizes the tiering target (e.g. smoke under 5 min) and whether per-test coverage is feasible in one run or must be sharded.
- **What is the business risk map / critical paths?** Tiering and the "keep" disposition both depend on it. If absent, run `risk-based-testing` first.
- **Who signs off on deletions, and is there a CODEOWNERS file?** Deletion is destructive; you need a named approver before this skill removes anything.
- **What is the acceptable observation window?** How long the team will run quarantined tests as skipped before permanent removal (default: 2 sprints / 2 releases).

---

## Core Principles

1. **Coverage equality is not redundancy.** Two tests hitting the same lines can assert completely different things — different oracles, inputs, edge cases. Line/branch coverage tells you what code *ran*, never what was *checked*. The only evidence that one test subsumes another is that the survivor catches the same faults, which you prove with mutation testing, not a coverage diff.

2. **The agent's edge is whole-corpus analysis, not deletion authority.** An agent can fingerprint 4,000 tests, cluster near-duplicates, and cross-reference CI history in minutes — work no human does by hand. That is the entire value. But the agent *proposes*; a human *approves*. Never let the corpus-scale analysis become corpus-scale auto-deletion.

3. **Deletion is destructive and must be reversible in practice.** "It's in git history" is not a recovery plan. Quarantine first (skip/xfail, or move to a deprecated suite), observe for a defined window, watch for escaped defects, then delete with sign-off. The grace period is the safety net, not the commit log.

4. **Every disposition is differentiated.** Redundant, obsolete, and low-value are three different states with three different actions. Collapsing them into one "delete" bucket is how you lose real coverage. A test that never failed is not the same as a test that cannot fail.

5. **Evidence over intuition, recorded per test.** Each removal carries its own row: category, the test that supersedes it, the coverage delta, who approved, and how to restore. If you cannot fill the row, you cannot delete the test.

---

## 1. Coverage Fingerprinting (per-test)

The wrong answer is a single combined `--cov` report that tells you per-*file* percentages. That cannot tell you which *test* covered which line, so it cannot tell you which tests overlap. You need **per-test (dynamic) contexts**.

**pytest / coverage.py** — record which test hit each line with dynamic contexts, and turn on branch coverage:

```bash
pytest --cov=src --cov-branch --cov-context=test
```

`--cov-context=test` makes coverage.py call `switch_context()` around each test, tagging every measured line with the test that ran it. Add `--cov-branch` so a test that takes the `if` and one that takes the `else` are not treated as covering "the same line." The result is written into the `.coverage` SQLite database, in the `context` and `line_bits`/`arc` tables.

Then read the **contexts table out of the `.coverage` SQLite DB** to build a per-test fingerprint: for each test, the exact set of `(file, line)` and `(file, branch-arc)` pairs it covered. From those sets you compute:

- **Uniquely covered lines** — lines/branches that *only one test* covers. Lose that test and you lose that coverage outright. These tests are pulling their weight; protect them.
- **Subsumption** — test A's covered set is a superset of test B's. A *candidate* for redundancy (but see §2 — it is not proof).

See `references/coverage-fingerprinting.md` for the SQL to pull contexts from `.coverage`, the Python that builds per-test line/branch sets and computes uniquely-covered and subsumption relations, and the JS/Vitest+Istanbul `--coverage` equivalent (`coverage-final.json` with per-test reporters).

Do **not** rank tests by line count per test file, and do **not** delete tests merely for having a low overall coverage percentage — a one-line test can be the only thing guarding a critical branch.

---

## 2. The Coverage-Equality Trap (the load-bearing rule)

This is the single most important rule in the skill. When per-test data shows **Test A and Test B cover exactly the same lines**, the naive conclusion is "redundant, delete one." That is wrong, and here is the gotcha:

> **Coverage equality does not prove the tests have the same assertions, the same inputs, or the same oracle.** Two tests can cover identical lines while one asserts the HTTP status and the other asserts the response body, or while they pass different edge-case inputs. One covers same lines but asserts different values; the other covers same lines but checks different state. Coverage measures execution, not verification.

To find out whether B is *actually* redundant — whether A truly subsumes B's fault-detection — run **mutation testing**:

- **mutmut** (3.6.0+) or **cosmic-ray** for Python, **StrykerJS** (9.x) for JS/TS, **PIT** for Java/JVM, **cargo-mutants** for Rust.
- Mutation testing injects faults (mutants) into the covered code. A test "kills" a mutant if it fails on the mutated code. If A kills every mutant that B kills, A genuinely subsumes B's fault detection and B is a defensible delete candidate. If B kills a mutant A misses, B catches a defect class A does not — **keep B**, even though coverage was identical.

**Decision:** identical coverage → flag as a *candidate* → confirm with mutation testing → only then propose deletion. When assertions differ and mutation results differ, **retain both, do not delete**. See `references/mutation-confirmation.md` for the mutmut/Stryker config that scopes mutation runs to the suspect lines and the kill-set comparison.

---

## 3. Near-Duplicate Clustering

Goal: surface copy-pasted tests without flagging every test in the same file. **Grouping tests by filename is not clustering** — it tells you nothing about similarity. Two defensible signals, combined:

1. **AST (abstract syntax tree) similarity.** Parse each test into an AST, normalize away identifier names and literals, then compare structure. Use a token/tree **similarity** metric (Jaccard over normalized token shingles, cosine over AST n-grams, or tree edit distance). AST-based comparison ignores formatting and variable-name noise that defeats exact string matching or raw `diff`. Never use raw line numbers as a similarity signal.

2. **Coverage-profile signature.** From §1, each test already has a covered-line/branch set — its **execution profile**. Tests with near-identical coverage signatures *and* near-identical ASTs are strong near-duplicate candidates; either signal alone is weak.

Cluster with a **tunable similarity threshold** (e.g. agglomerative/hierarchical clustering, cut at a configurable cutoff — start ~0.85, tune to your false-positive tolerance). Output clusters, never deletions.

**Every cluster is routed to human review.** The agent does not delete a whole cluster automatically — copy-paste tests frequently diverge in one assertion that matters. Present each cluster with its members, the pairwise similarity, and the coverage-profile overlap, and let a human confirm which (if any) collapse.

See `references/clustering.md` for the AST normalization, the shingle/Jaccard and tree-edit similarity functions, and the agglomerative clustering with the tunable threshold.

---

## 4. Mining CI History

Parse your **test-result history** — JUnit XML archives, or a platform that already stores it: **Datadog Test Optimization**, **Trunk Flaky Tests**, **BuildPulse**, **CircleCI test insights**. For each test compute pass rate / fail rate and the **flip rate** (how often consecutive runs transition pass↔fail). Two findings, two very different meanings:

**Never-failing tests** (zero failures / 100% pass over the window). The naive move is to delete any test that has never once failed. Wrong — **never-failing does not mean delete or useless**. A test most often never fails because it guards **low-churn, low-risk, stable code** — exactly the code nobody touches, so the test never trips. That is low *defect-detection* signal in *this* window, not zero value. Disposition: **investigate, do not delete** — check churn and risk of the code under test. If it covers a critical path that simply has not regressed, it stays.

**Always-flaky tests.** Flakiness is **not** decided by a single run. The real definition is **different results on the same SHA / same commit** — the same code produced a pass and a fail. Detect that by grouping runs by commit SHA and finding tests with both outcomes on one SHA (Trunk and BuildPulse do this natively). The naive move is "delete flaky tests to clean up CI." Wrong: a flaky test may still be your only coverage of a real path. Disposition: **quarantine and fix the flake, never delete to clean up CI**. Quarantine de-noises CI immediately; the root cause still gets fixed. See `test-reliability` for runtime quarantine and self-healing of an individual flaky test.

See `references/ci-history-mining.md` for the JUnit-XML aggregation script, the same-SHA flake query, and the Datadog/Trunk API pulls.

---

## 5. Prune Decision Rules

Stop deleting everything that "looks redundant." The three failure-categories are distinct states, and each gets a **different disposition**:

| Category | Definition (the test is...) | Disposition |
|----------|------------------------------|-------------|
| **Redundant** | subsumed by another test — covers the same lines AND the survivor kills the same mutants (§2) | **merge or delete — but only after the mutation-kill check confirms subsumption**; quarantine first |
| **Obsolete** | testing a feature that was removed / dead code / a path that no longer exists | **delete** — the code it tested is gone; verify the target truly no longer exists, then remove |
| **Low-value** | never failed AND trivial (a getter, a no-op, no meaningful assertion) | **quarantine / route to review** — low value is not zero value; confirm before removal |
| **Keep** | covers something uniquely, catches defects (positive defect-detection history), or guards a high-risk path | **keep** — protected regardless of coverage overlap |

The discipline: **a different action per category.** `redundant => merge/delete-after-mutation-check`, `obsolete => delete`, `low-value => quarantine/review`, `keep => keep`. Applying a single blanket rule to every flagged test is the anti-pattern that loses coverage. Note that "redundant" and "low-value" both route through quarantine, not straight to `rm`.

---

## 6. Tiering (smoke / core / extended)

Restructuring a flat suite into tiers is not sorting by speed. **Smoke is not the first N tests in file order**, it is not a random sample, and you must **not** tier solely on how fast each test runs. Tier on two evidence inputs:

1. **Business risk / critical path** — from the risk map (`risk-based-testing`). Tests guarding revenue, auth, data integrity, and the top user journeys are smoke/core regardless of speed.
2. **Defect-detection history** — tests that have actually **caught real bugs** (mine CI history + linked bug tickets for tests that failed on a commit that fixed a defect). A test with a track record of catching regressions earns a high tier on merit.

| Tier | Goal | Selection evidence |
|------|------|--------------------|
| **Smoke** | fast, runs on every push, a few minutes, critical paths only | highest-risk paths + proven defect-catchers; fast enough to gate every commit |
| **Core** | per-PR / merge gate | all critical + high-risk coverage, broader than smoke |
| **Extended** | full / nightly / slow / pre-release | everything else — exhaustive, long-running, edge cases |

**Execution time as a tiering input is allowed — but only as a secondary tiebreaker, not the primary axis.** Runtime and duration break ties; they never set the tier. Among equally-risky tests, prefer the faster ones for smoke. Encode tiers as **markers/tags** — `@pytest.mark.smoke` / `@pytest.mark.extended`, Jest/Vitest tag, or a JUnit category — so `pytest -m smoke` selects a tier without moving files. See `references/tiering.md` for the marker scheme and the defect-detection-history query.

---

## 7. Destructive Safety (the grace period)

Asked to delete 600 tests, the naive agent opens one PR that `rm`s 600 files. **Never remove the whole cohort in a single PR, and do not `rm` the test files.** Deletion is destructive; gate it:

1. **Quarantine before delete — never delete directly.** Mark the flagged tests skipped (`@pytest.mark.skip(reason="curation-2026-Q2, see audit row")`, `xfail`, Jest `.skip`), or move them to a `quarantine/`/`deprecated/` suite that still lives in the repo. They stop running but stay visible and instantly restorable.
2. **Human sign-off is required.** A named approver — via **CODEOWNERS** on the test directories, or an explicit reviewer on the PR — must approve. No "redundant tests need no review." Redundancy was a *hypothesis* until §2 confirmed it.
3. **Define an observation window.** Run the suite with the cohort quarantined for a **grace period** — default **2 sprints / 2 releases** — and **monitor for escaped defects**: watch production incidents and bug tickets for anything the quarantined tests would have caught. An escaped defect in the window means a test was *not* redundant; restore it.
4. **Only then delete, in small batches**, each linked to its audit row (§8).
5. **Keep it restorable.** Record the quarantine location and the commit so any test can be **restored/reverted** in one step. Git history is the floor, not the recovery plan.

See `references/destructive-safety.md` for the quarantine markers, a CODEOWNERS snippet for test paths, and the escaped-defect watch checklist.

---

## 8. The Audit Record

The deliverable that makes every removal defensible to a future engineer or an auditor is **not a count of deleted tests**. It is a **per-test record — one row per deleted test** — with a real justification each. A bare "we removed 600 redundant tests" is unauditable.

Each row carries:

- **Test id / path** — what was removed.
- **Category & reason** — redundant / obsolete / low-value, with the specific justification ("subsumed; survivor kills identical mutant set").
- **Superseded by** — the surviving (superseding) test id that covers/replaces it (for redundant): it is covered by the test that subsumes it, or replaced by the test that supersedes it.
- **Coverage delta** — lines/branches no longer covered after removal (before/after); ideally zero net loss, proven by §1.
- **Approval** — approver name, the PR/commit **SHA**, and the **date** signed off.
- **Restore path** — quarantine location and the one-line command to recover/revert it.

Store it as a committed CSV/Markdown table (e.g. `docs/test-curation-log.md`) so it is versioned alongside the deletions. See `references/audit-record.md` for the full column schema and a worked example row.

---

## Anti-Patterns

### 1. "Same coverage, delete one"
The single most damaging mistake. Identical line coverage proves the lines *ran*, not that the assertions match. Confirm subsumption with mutation testing (§2) before proposing any deletion.

### 2. Two green signals read as a green light
A test that has never failed in 18 months AND is fully covered (same lines) by another is the classic "surely safe to delete" case. It is **not sufficient on its own** — still verify, do not delete automatically. A test that **never failed may mean stable code not worthless** code — it often means low risk and low change, not that the test is redundant. A **different oracle could still be unique** to this test (a different assertion, input, or edge case it alone checks). Ask the mutation question: does the OTHER test assert/catch/kill what this one does? Only after that, quarantine and observe for a grace period, then delete. Both signals are necessary-not-sufficient (§9 below / §2 / §7).

### 3. One merged coverage run with no per-test context
`--cov=src` with no context gives per-file percentages and cannot identify per-test overlap. Use `--cov-context=test` and read per-test contexts from the `.coverage` DB.

### 4. Grouping near-duplicates by filename
Filename proximity is not similarity. Cluster on AST similarity + coverage-profile signature with a tunable threshold (§3), and route clusters to humans — never auto-delete a whole cluster.

### 5. Deleting never-failing or flaky tests
Never-failing → investigate (likely low-churn code), do not delete. Flaky → quarantine and fix, do not delete to clean up CI. Flakiness is same-SHA divergence, not a single failed run.

### 6. One disposition for all flagged tests
Redundant, obsolete, and low-value need different actions (§5). Collapsing them into one "delete" bucket loses real coverage.

### 7. Tiering by speed (or "first N") alone
Smoke is risk + defect-detection history, not the fastest or first N tests. Runtime is a tiebreaker, not the axis (§6).

### 8. Big-bang deletion PR
600 tests `rm`'d in one PR with no quarantine, no sign-off, no observation window. Always quarantine → sign-off → observe → delete in batches (§7).

### 9. "It's in git history, just delete it"
Git history is not a recovery plan — nobody watches for the defect the deleted test would have caught. The quarantine grace period plus escaped-defect monitoring is the actual safety net.

---

## Verification

Prove the audit actually holds before anyone deletes anything, smallest check first:

- **Per-test contexts were captured, not a flat report.** `sqlite3 .coverage "SELECT COUNT(*) FROM context WHERE context != '';"` returns a count roughly equal to your test count (not 0/1). Zero means `--cov-context=test` did not run.
- **No deletion rests on coverage equality alone.** For every `redundant` row, the audit log's `mutation_check` column is filled (`yes` + run id). `grep -c 'redundant' docs/test-curation-log.md` equals the number of rows whose `mutation_check` is non-blank.
- **Quarantine, not removal, hit the repo first.** `git log --diff-filter=D --name-only -- tests/ | grep test_` shows no test files deleted in the quarantine PR; the flagged tests are skipped/xfail or moved under `tests/quarantine/`, still collectible (`pytest --collect-only -m skip` or equivalent lists them).
- **Tiers select correctly.** `pytest -m smoke --collect-only` returns only the risk/defect-catcher cohort and runs under the smoke budget; `pytest -m "smoke or core or extended" --collect-only` accounts for every test (no test is untagged).
- **The audit record is complete.** No `redundant` row has a blank `superseded_by`, `coverage_delta`, or `mutation_check`; `coverage_delta` is `0 lines / 0 branches` for every removal claiming zero net loss.

---

## Done When

- A per-test coverage fingerprint exists for the suite (built with `--cov-context=test`/`--cov-branch` or the Istanbul per-test equivalent), and uniquely-covered lines per test are computed.
- Every "redundant" candidate has a mutation-testing result attached proving the survivor kills the same mutants — no deletion proposed on coverage equality alone.
- Near-duplicate clusters were produced from AST + coverage-profile similarity at a stated threshold and routed to human review; no cluster was auto-deleted.
- CI history was mined for never-failing (disposition: investigate) and same-SHA flaky tests (disposition: quarantine/fix) — neither category deleted on those signals.
- Each flagged test has exactly one of {redundant, obsolete, low-value, keep} with the matching disposition applied.
- Tiers (smoke/core/extended) are assigned via markers/tags using risk + defect-detection history as inputs; `pytest -m smoke` (or equivalent) selects a tier.
- No test was deleted without: a quarantine period served, a named approver / CODEOWNERS sign-off recorded, and the observation window completed with no escaped defect.
- A committed per-test audit record exists with one row per deletion containing category, superseded-by, coverage delta, approver+SHA+date, and restore path.

---

## Related Skills

- **ai-qa-review** — Judges whether an individual test is *well-written* (smells, weak assertions, testability). This skill decides whether a test should *exist at all*; ai-qa-review decides whether an existing one is good. Run ai-qa-review on the survivors after curation.
- **coverage-analysis** — Owns coverage thresholds, gap analysis, and the mutation-testing setup at the project level. This skill consumes per-test coverage for redundancy decisions; go there for ratchets and CI gating.
- **test-reliability** — Runtime self-healing and quarantine of a *single* flaky test as it fails. This skill *finds* the flaky cohort across CI history; test-reliability *fixes* one at a time.
- **risk-based-testing** — Produces the risk matrix this skill's "keep" disposition and tiering depend on. Run it first if no risk map exists.
- **qa-project-context** — Universal dependency: stack, runner, risk map, and ownership that drive every decision here.

## Reference Files (in `references/`)

- **coverage-fingerprinting.md** — `.coverage` SQLite context queries, per-test line/branch set construction, uniquely-covered + subsumption computation, and the JS/Istanbul per-test equivalent.
- **mutation-confirmation.md** — mutmut/cosmic-ray/StrykerJS config scoped to suspect lines and the kill-set comparison that confirms subsumption.
- **clustering.md** — AST normalization, Jaccard/cosine/tree-edit similarity, and agglomerative clustering with a tunable threshold.
- **ci-history-mining.md** — JUnit-XML aggregation, same-SHA flake detection query, and Datadog/Trunk API pulls.
- **tiering.md** — Marker/tag scheme for smoke/core/extended and the defect-detection-history query.
- **destructive-safety.md** — Quarantine markers, CODEOWNERS for test paths, and the escaped-defect watch checklist.
- **audit-record.md** — Full column schema for the deletion log and a worked example row.
