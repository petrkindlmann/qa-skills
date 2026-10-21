# Parcel Desk release review

**Recommendation: the repaired local fixture is ready for the documented flows exercised below.**
One reproducible pricing defect was repaired. The final QA runner observed **49 passing tests**, including **26 requests against a real loopback HTTP server**, with zero failures, skips, cancellations, or TODOs. This is a local readiness recommendation; deployment and an approver's release decision were not performed.

## Target and candidate identity

- App: `/tmp/qa-field-use/shipping` (`parcel-desk`).
- Requirements: the app's [README](../README.md); implementation and existing package/test scripts were inspected before changes.
- Environment: Node `v24.19.0`, Linux x64, UTC; no dependencies, external services, accounts, or credentials were required.
- Final execution: **2026-10-21 04:28:32–04:28:33 UTC**.
- The fixture has no Git commit. The final candidate's aggregate SHA-256 is `8451910680b6602257b23db8351e8782c354de356842f55b982beadc3deb6729`; [the manifest](source-after.sha256.json) contains each source/test/config hash and the aggregate construction method.
- [Original source archive](source-before.tar), [original source hashes](source-before.sha256.json), and [complete application source diff](source.diff) preserve the before/after states.
- `.agents/qa-project-context.md` was absent. The small README, manifest, implementation, and tests supplied the needed local context; its absence did not block execution.

## Confirmed defect and repair

**Standard shipping charged 500 cents when the subtotal was exactly 5,000 cents.** The README promises free standard shipping for amounts of 5,000 cents or more. The original comparison used `subtotal > 5000`, excluding the boundary.

| Reproduction | Expected | Observed before | Observed after |
|---|---|---|---|
| `POST /quote` with `{"subtotal":5000,"method":"standard"}` | HTTP 200, `{"subtotal":5000,"shipping":0,"total":5000}` | HTTP 200, `{"subtotal":5000,"shipping":500,"total":5500}` | Exact expected response |
| `quote(5000, 'standard')` | Shipping 0; total 5000 | Shipping 500; total 5500 | Shipping 0; total 5000 |
| HTTP quote with omitted method, preserving the existing standard default | Shipping 0; total 5000 | Shipping 500; total 5500 | Shipping 0; total 5000 |

The production fix changes one comparator in [quote.mjs](../quote.mjs) from `>` to `>=`. Express pricing, validation, routes, and server lifecycle code were not altered.

The failing assertions were authored and executed **before** the production fix: 46 passed and 3 failed, all tied to this boundary. After the fix, the same 49 assertions passed. A targeted verification temporarily removed the fix: the boundary assertion failed again while three standard-shipping controls passed. The fixed source was restored in a `finally` block, and the full final runner passed again. This demonstrates that the regression detects the repaired defect; no assertion was weakened, skipped, or retried to hide it.

Evidence: [red assertions and actual HTTP responses](regression-before.log), [first green run](regression-after.log), [temporary-revert result](regression-reverted.log), [restoration record](revert-restoration.json), [final structured result](qa-run-after/2026-10-21T04-28-32-992Z-8148e86e/result.json).

## Authored changes versus executed work

### Authored

- One production-code comparison repair in `quote.mjs`.
- **20 additional unit assertions** in `quote.test.mjs`, retaining the original three assertions.
- **26 HTTP assertions** in `server.test.mjs`. The suite launches the actual `server.mjs` process, waits for its readiness message, sends actual HTTP requests on an OS-selected loopback port, and stops the child with SIGTERM. Cleanup requires a successful exit; SIGKILL is a bounded fallback if shutdown stalls.
- `qa.config.json`, declaring the existing npm test script with an explicit TAP reporter and a 15-second deadline.
- README test instructions and evidence helpers for command capture and the targeted revert check.

### Executed

| Stage | Observed outcome | Evidence |
|---|---|---|
| Original existing suite, subprocess-capable environment | **3 passed**, exit 0 | [log](npm-before-escalated.log), [exact command/time](npm-before-escalated.json) |
| Authored regressions against original application code | **49 observed: 46 passed, 3 failed**, exit 1 | [log](regression-before.log), [command/time](regression-before.json) |
| QA runner against original code plus regressions | **49 observed: 46 passed, 3 failed**, runner exit 1 | [HTML report](qa-run-regression-before/2026-10-21T04-27-10-748Z-02405b26/report.html), [JSON](qa-run-regression-before/2026-10-21T04-27-10-748Z-02405b26/result.json) |
| Same regressions after the comparator repair | **49 passed**, exit 0 | [log](regression-after.log), [command/time](regression-after.json) |
| Temporary reversion of the comparator repair | **4 selected: 3 passed, boundary failed**, exit 1 as expected | [log](regression-reverted.log), [command/time](regression-reverted.json) |
| Final QA runner after restoring the repair | **49 passed; 0 failed/skipped/cancelled/TODO/retried**, runner exit 0 | [HTML report](qa-run-after/2026-10-21T04-28-32-992Z-8148e86e/report.html), [JSON](qa-run-after/2026-10-21T04-28-32-992Z-8148e86e/result.json) |

The final 49 assertions comprise 23 unit cases and 26 HTTP cases. Final `report.html` and `result.json` were both read and their results agreed. Each HTTP test writes its method, path, request body, status, and actual response into the retained TAP log. All spawned application servers finished through the suite's cleanup; no service was left running.

## Contract coverage

| Requirement or control | Executed coverage | Final result |
|---|---|---|
| Standard shipping costs 500 below 5000 | Subtotals 0 and 4999, unit and HTTP | Pass |
| Free standard shipping starts at 5000 | Subtotals 5000 and 5001, unit and HTTP | Pass |
| Express always costs 1200 | Subtotals 0, 4999, 5000, 5001 over HTTP and unit cases, plus original 6000-cent unit case | Pass |
| Total equals subtotal plus shipping | Exact response assertions for each quoted amount/method | Pass |
| Invalid amounts receive HTTP 400 | Negative, fractional, string, null, boolean, object, array, and missing subtotal | Pass |
| Unknown methods receive HTTP 400 | Unknown text, empty text, null, numeric method | Pass |
| Health endpoint returns ready | Before and after invalid requests | Pass |
| Existing default-method behavior | Omitted method uses standard pricing | Pass |
| Additional HTTP controls | Malformed JSON and null body return 400; unknown route returns 404; JSON content type checked | Pass |

There were no remaining blocked or skipped application assertions. Performance/load testing, numerical extremes, production deployment, remote CI, and post-deployment monitoring were outside this bounded review and were not executed. Browser/visual/accessibility checks do not apply to this API-only fixture. No general security or universal correctness claim is made.

## Runner observations, kept separate from application findings

1. The first sandboxed `npm test` exposed only one file-level result instead of the three inner assertions. That output is retained in [npm-before.log](npm-before.log) and is not accepted as the true baseline. Re-running with the authorized subprocess-capable environment observed all three assertions.
2. The auto-discovered runner initially expected TAP while Node 24 emitted the spec reporter. It correctly returned **INCOMPLETE**, even though the child exited 0. Both [initial](runner-before.log) and [subprocess-capable](runner-before-escalated.log) attempts are retained, with their full report directories.
3. A concurrent QA runner change initially duplicated an explicitly requested TAP reporter, causing Node to reject the command. The failure is preserved in [runner-before-tap.log](runner-before-tap.log) and its [command evidence](qa-run-before-tap/2026-10-21T04-25-45-695Z-7a3f8f3a/evidence/project-tests.log).
4. These runner issues were reported to the coordinating agent; this task made **no edits to the QA Skills checkout**. The runtime author corrected reporter handling. The explicit app configuration then correctly recorded the 49-test failing baseline and the 49-test passing final candidate.
5. `qa-do` initially referenced a missing `docs/QA-RUNNER.md`. The coordinator supplied that documentation during integration; it was read once available. Useful application checks continued in the meantime.

The `qa-do` plan selected **bug-reproduction** to establish red/green evidence and **release-readiness** to bind the recommendation to the tested candidate. Both workflows were applied. The plan also suggested coverage analysis as supporting guidance; no measured coverage percentage is claimed, and no third skill was needed for the bounded task. Planning itself executed no tests.

## Exact repeatable commands

Working directory for every application command:

```bash
cd /tmp/qa-field-use/shipping
```

Run the same direct suite used for the red and green observations:

```bash
npm test -- --test-reporter=tap
```

Run the configured QA runner that produced the final report:

```bash
node /workspace/scratch/db79cfa7c2bc/qa-skills-audit-2026-10-21/scripts/qa.mjs run --project /tmp/qa-field-use/shipping --goal 'Check documented shipping quote behavior for release, repair reproducible code defects, add useful regression coverage, and execute local HTTP checks with evidence.' --output evidence/qa-run-after
```

The final captured invocation was:

```bash
python3 evidence/run-command.py runner-after node /workspace/scratch/db79cfa7c2bc/qa-skills-audit-2026-10-21/scripts/qa.mjs run --project /tmp/qa-field-use/shipping --goal 'Check documented shipping quote behavior for release, repair reproducible code defects, add useful regression coverage, and execute local HTTP checks with evidence.' --output evidence/qa-run-after
```

The selected regression-validity command (executed against temporarily reverted source) was:

```bash
node --test --test-reporter=tap '--test-name-pattern=standard shipping' quote.test.mjs
```

`python3 evidence/revert-check.py` performs that temporary revert, captures the expected failure, and restores the fixed source. All original execution metadata JSON files include exact argv, working directory, start/end time, duration, exit code, and output byte count. Use a new capture label when repeating a command to retain the existing evidence; the QA runner already creates a unique run directory on each invocation.

## Release decision boundary

The local review is complete and its recommendation is limited to the tested fixture and candidate hashes above. No separate release authority was named, so no sign-off is inferred. If this fixture is deployed later, rerun the health and quote smoke checks against that deployed instance and retain the new results. That future deployment verification is proposed work, not an executed outcome in this report.
