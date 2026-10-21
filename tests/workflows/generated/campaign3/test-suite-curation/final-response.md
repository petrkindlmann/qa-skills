# test-suite-curation against the generated corpus: what ran, what the skill got right, where its recipes broke

Workspace `/Users/petr/projects/qa-skills`, branch main, candidate commit 958fcc0, Node 26.0.0, Playwright 1.62.1, Chromium, 2 workers, retries 0, 2026-10-21. Everything I wrote is under `tests/workflows/generated/campaign3/test-suite-curation/`; `git status` outside that folder shows only the pre-existing modification of `experiment/with-1/task-prompt.txt` that was there when I started. No commits, no dependencies, no agents.

## What actually ran

| step | command (see `execution.log` for the full form and trimmed output) | result |
|---|---|---|
| inventory | `playwright test --list --reporter=json` over `generated/` with a positional regex excluding my own folder | 90 tests, 22 spec files, 11 suites |
| before, run 1 | full original corpus, healthy Shop + TodoMVC | 89 passed, 1 skipped (opt-in detector), 0 failed, 0 flaky; reporter 32.8 s, shell 34 s |
| fingerprint run | same corpus with `--trace on` | 89 passed, 1 skipped; 79 s; 90 traces, 87 with a request set |
| static analysis | `tools/analyze.mjs` (lexer, normaliser, helper inlining, clustering, assertion metrics, orphan exports) | 9 clusters at 0.85 with the skill's normalisation, 9 with member names kept; 12 never-imported files; 8 over-exported names |
| dynamic fingerprint | `tools/traces.mjs` (request set per test from the trace zips) | 42 distinct request keys; 9 tests with a unique request; 62 subsumption candidates in 1070 pairs |
| decisions | `tools/check-decisions.mjs` over `tools/decisions.mjs` | 90 rows matched 1:1 to the inventory; 58 clauses guarded before, 0 lost after; no clause unguarded |
| build | `tools/build-curated.mjs` + `node --check` + `--list` | 66 files copied, 9 `test.skip` insertions, every module parses, 81 tests collected in 21 files |
| after, run 1 | `curated/` on healthy apps | 71 passed, 10 skipped (9 quarantined + 1 opt-in), 0 failed, 0 flaky; reporter 38.5 s, shell 40 s |
| after, run 2 | same | 71 passed, 10 skipped, 0 failed, 0 flaky; 40.1 s / 42 s |
| before, run 2 | original corpus again, for variance | 89 passed, 1 skipped; 55.4 s / 58 s |

Total Playwright execution about 4.5 minutes across six runs. Deliverables: `curation.md` (inventory, duplicate analysis, weak assertions, orphans, decisions, tiers, behaviour map, audit rows, numbers, unknowns), `curated/` with `MANIFEST.md`, `analysis/` (raw cluster, fingerprint, assertion and orphan outputs plus the generated tables), `tools/` (the five scripts), `task-prompt.txt`, `execution.log`, this file.

## Outcome in numbers

- Original: 90 tests in 22 files; 89 execute. Curated: 72 kept tests in 21 files; 81 collected (9 quarantined in place as `test.skip`), 71 execute.
- Dispositions: keep 62, merge 9 (the baseline-todo spec with the selector-drift helper), rewrite 1 (kept as-is, conditional oracle flagged), quarantine-redundant 18, one obsolete non-test file (`baseline-shop/probe.mjs`) not copied. Nothing deleted anywhere.
- The 18: the 9-test byte-identical copy in `campaign3/selector-drift-recovery/`, 6 of 7 migrated Cypress tests in `campaign3/test-migration/`, `review-followup` copied-session logout, and 2 of 3 `bug-reproduction` idempotency tests. Each has a superseding test, a stated residual risk and a restore path.
- Behaviour map: 35 Shop clauses, 10 TodoMVC clauses, 13 extra behaviours; all 58 guarded before and after.
- Wall clock: original 32.8 s and 55.4 s, curated 38.5 s and 40.1 s. The machine's run-to-run variance (70 % between the two original runs) swamps a 20 % test-count reduction whose dropped tests average 0.5-0.7 s each; the expected saving by summed test time is about 11.6 s of 58.1 s.

## What the skill got right

- The load-bearing rule (SKILL.md:55, §2) paid off twice in a corpus of 90: `test-migration:16` has the same coverage as `baseline-todo:6` and a stricter oracle (raw `textContent` vs whitespace-normalising `toHaveText`), and `review-followup:33` is a request-set subset of three tests that never check what it checks (unit prices, quantity 10). A coverage-only prune would have dropped both.
- "Never-failing is not a delete signal" (§4): the entire corpus has never failed on a healthy build; the rule stopped that from becoming an argument.
- Differentiated dispositions (§5) and the one-row-per-removal record (§8) forced a superseding test and a risk statement for each of the 18, which is where the two medium-risk cases surfaced (mark-all via the native checkbox vs its label; bob's different basket under alice's used key).
- Quarantine before delete (§7): `test.skip` with the row id keeps the nine partially-kept rows visible in `--list` and in the run report (they show as SKIPPED), exactly as the verification bullet at SKILL.md:241 wants.
- The warning that AST similarity flags structurally similar tests of different behaviours (§3, clustering.md:55) was accurate; see the difficulties for how often.
- The dynamic request-set profile, used as the fingerprint stand-in, reproduced the §1 vocabulary usefully: nine tests make requests nobody else makes and are protected on that basis.

## Recipe difficulties, with the lines

1. SKILL.md:44 (discovery: "pytest+coverage.py, Jest/Vitest+Istanbul, Go, JUnit") and §1, SKILL.md:74 (`pytest --cov=src --cov-branch --cov-context=test`), SKILL.md:84 (read the `.coverage` contexts table), coverage-fingerprinting.md:113-118 (Istanbul: run each Vitest file in isolation, or a custom reporter resetting `__coverage__`). All of them instrument the code under test. This corpus is Playwright E2E against two applications that may not be read or instrumented. What I did: a per-test HTTP request set read from a `--trace on` run (`tools/traces.mjs`), fed to the same uniquely-covered and subsumption computations, plus a static behaviour fingerprint of the test body with helpers inlined. What it showed: the request set is blind for the localStorage TodoMVC (29 tests, one request each, all mutually subsuming) and coarse for the Shop (62 of 90 tests are "subsumed"). The skill has no section for black-box E2E suites, which is where this corpus lives.
2. clustering.md:15-29 (`ast.NodeTransformer` Normalizer, "for JS/TS use `@babel/parser` or `ts-morph`"): neither package resolves from the repo root and no dependency could be added. I wrote a lexer and the same normalisation by hand. With the normalisation as written (every identifier -> VAR, every literal -> CONST) the 0.85 cut produced 9 clusters holding 34 tests, and most members are false positives: a 7-member and a 9-member Todo cluster mixing create, complete and delete tests (0.87-0.98), all five monitoring probes (1.0 between health and storefront), the 429/500 virtualized-ui pair (0.88). The normalisation discards the tokens that carry a Playwright test's meaning (which matcher, which action). Keeping member names after `.` brought the 0.85 clusters down to the real baseline/drift pairs plus the probes and a parametrised loop.
3. clustering.md:55 ("Require both signals, AST near-identical AND coverage profile near-identical"): for the probes both signals agree and are both wrong, because the specs are three-line wrappers around `probes.mjs` and the request sets overlap. Nothing in the recipe handles helper-heavy specs; inlining helpers into the profile (my adaptation) is what separated them. For the three `filter view:` visual tests the 1.0 score is one body in a `for` loop, which the recipe cannot know.
4. clustering.md:69-70 (`scipy.cluster.hierarchy.linkage` / `fcluster`): Python only. Implemented average-linkage agglomeration in JS (`cluster()` in `tools/analyze.mjs`); same cut semantics.
5. SKILL.md:103 and mutation-confirmation.md:21 (StrykerJS 9.x for JS/TS) and the §2 decision "identical coverage -> candidate -> confirm with mutation testing": no mutation tool can mutate a Python server or a pinned upstream build that are off limits, and the project's own analogue (the fault matrix behind the `oracle()` ids in the specs) was out of bounds for this run. Consequence, following SKILL.md:240 and audit-record.md:51-52 to the letter: every one of the 18 rows has `mutation_check: not run; by reading`, so none may be deleted; all are quarantines. The skill's "Done When" bullet at SKILL.md:250 cannot be met on this corpus by anyone without those tools.
6. SKILL.md:128 and ci-history-mining.md:8 (JUnit archives, Datadog, Trunk, BuildPulse, CircleCI): no history exists. The only records are each folder's authoring logs (one or two green runs per suite, one authoring-time locator failure in baseline-todo, nine intentional failures in the drift run on the redesigned build). §4 and the `defect_catchers` query (ci-history-mining.md:79) produced nothing; I used the `oracle()` ids as the only visible proxy for "designated defect catcher" and said so.
7. SKILL.md:166 and tiering.md:27, 49 (`@pytest.mark.smoke`; "JS/Vitest equivalent: tag with `test.concurrent`/custom tags or filename suffixes"): the JS line names Vitest mechanisms that do not exist in Playwright, whose mechanism is `test(title, { tag: '@smoke' }, fn)` with `--grep @smoke`. Applying it would edit 72 test declarations in copies that must stay diff-able against their originals; the tiers are a table in `curation.md` §7 instead. SKILL.md:242's `pytest -m smoke --collect-only` check therefore has no equivalent in this run.
8. destructive-safety.md:25 (`test.skip('legacy discount rounding [curation-2026-Q2, audit R-0142]', ...)`): appending the audit row to the title changes the test id in every report. Playwright's `test.skip(title, { annotation: { type, description } }, fn)` keeps the title and carries the row; that is what `tools/build-curated.mjs` inserts.
9. SKILL.md:241 (`git log --diff-filter=D -- tests/ | grep test_`, `pytest --collect-only -m skip`): adapted to `git status` (nothing outside my folder changed) and `playwright test --list` on `curated/` (81 collected, the 9 quarantined rows listed and reported as SKIPPED in both runs).
10. audit-record.md:11-23 columns `approver`, `approval_sha`, `window_closed`, and destructive-safety.md step 2 (CODEOWNERS): there is no CODEOWNERS file in the repository and nobody is named as approver anywhere in the supplied context; the columns are empty by necessity and the rows cannot be closed by this run. `coverage_delta` is stated against the behaviour map (0 clauses lost) because line coverage does not exist.
11. Discovery step "check `.agents/qa-project-context.md`": the file is the unfilled template (every field is a bracketed placeholder), so there is no risk map and no owner; SKILL.md §6 says to run `risk-based-testing` first, which was out of scope, so the contract's own emphasis served as the risk map.
12. An observation rather than a failure: SKILL.md:112 ("grouping tests by filename is not clustering") is right in general, but the only exact duplicates in this corpus are whole-file copies that one `diff` finds; the clustering machinery confirmed them and otherwise produced candidates that had to be read one by one. The time went into reading assertions, not into the fingerprint.

## What I could not verify

- That any quarantined test would catch a fault its survivor misses. The subset arguments are readings of assertions; the two residual risks called medium are where a surprise would sit.
- Long-run flakiness: four green corpus runs plus the authoring logs is the whole record.
- Whether the merged drift helper's text-based counter locator stays unique on builds other than the two it has been run on (it passed 9/9 in both curated runs on the default build).
- Whether the probes' 3 s / 5 s / 5 s / 10 s budgets are the team's numbers; only the 500 ms health budget is in the contract.
- The lab fault matrix's actual kill results for the `oracle()` ids.
- Who signs off: no approver, no CODEOWNERS, no observation window started.

## Before / after

Before: 90 tests collected, 89 executed, 22 spec files, 11 suites, 32.8 s and 55.4 s reporter wall clock over two runs (34 s / 58 s shell).
After: 72 tests kept (81 collected with 9 quarantined `test.skip`, 71 executed), 21 spec files, 10 suites, 38.5 s and 40.1 s over two consecutive passing runs (40 s / 42 s shell); 0 failed, 0 flaky in all runs; 58 of 58 guarded behaviours still guarded.

## Skill difficulties (short list)

1. §1 fingerprinting (SKILL.md:44, 74, 84; coverage-fingerprinting.md:113-118) assumes instrumentable source; replaced by trace-derived request sets, which are blind for a localStorage app.
2. clustering.md:15-29 Python `ast` / `@babel/parser` not available; hand-written lexer; the recipe's normalisation yields mostly false-positive clusters on Playwright specs.
3. clustering.md:55 "both signals" does not separate wrapper-style specs (probes) or loop-generated tests.
4. clustering.md:69-70 scipy; reimplemented average linkage in JS.
5. SKILL.md:103 / mutation-confirmation.md:21 mutation testing impossible on black-box apps; by SKILL.md:240 and audit-record.md:51-52 no deletion can be finalised, only 18 quarantines.
6. SKILL.md:128 / ci-history-mining.md:8, 79 no CI history exists; §4 yielded nothing.
7. SKILL.md:166 / tiering.md:27, 49 markers are pytest/Vitest-shaped; Playwright uses `{ tag }` + `--grep`; tiers delivered as a table.
8. destructive-safety.md:25 title-suffix skip changes test ids; used Playwright's `test.skip(title, { annotation }, fn)`.
9. SKILL.md:241 pytest-only verification commands; adapted to `git status` and `--list`.
10. audit-record.md approver/SHA/window columns unfillable: no CODEOWNERS, no approver, no window.
11. `.agents/qa-project-context.md` is an unfilled template; no risk map.
12. The only exact duplicates were whole-file copies that `diff` finds directly.

## Post-authoring check with the fault matrix

The agent could not run the project's fault matrix (out of bounds for a blind run) and said
so under "What I could not verify". The orchestrator ran it afterwards on `curated/` without
changing any file in this folder: the matrix gained a `skipped` declaration (a run is complete
only when it carries exactly the declared number of quarantined `test.skip` tests and no
other skip) and an `oracleId` field (a case may designate an oracle that lives in a copied
spec). With the visual detector check enabled, the curated corpus ran healthy (81 collected,
72 executed, 9 quarantined) and under six faults spanning both applications:
`cross_user_order_read`, `idempotency_payload_conflict`, `filter-state-error`,
`wrong_currency_event`, `slow_health` and `catalog_currency_missing`. Every fault was
detected by the designated surviving assertion. The idempotency case matters most: the
two bug-reproduction tests that guarded it were quarantined as subsets, and the
baseline-shop survivor (`shop-key-conflict`) caught the fault as the curation claimed.
This is kill-set evidence for those six behaviours only, not for all 58 clauses in the map.
