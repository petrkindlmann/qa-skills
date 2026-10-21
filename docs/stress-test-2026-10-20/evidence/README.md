# Evidence map

Start with [the campaign report](../../STRESS-TEST-2026-10-20.md) and
[verification.json](verification.json). The report distinguishes executed fixtures,
generated responses, lexical checks and integrations that were not run.

## Final integrated run

- `final-python.log`: all 127 Python regressions.
- `final-node.log`: all 71 JavaScript example regressions.
- `final-browser.log`: all 79 browser regressions on Chrome 156.0.8078.47.
- `final-structure.log`, `final-index.log`, `final-scanner.log`: repository checks.
- `final-static.log` and `static-final.json`: 481/513 lexical matches, 32 flags and
  811 deferred semantic criteria. A 90% aggregate threshold passed.
- `final-checks.json`: commands, exit codes and timings for the repository checks.
- `verification.json`: final results, runtime and source/evidence hashes.
- `verification-summary.txt`: short command/result summary.

## Before/after experiments

Files without the `final-` prefix retain the output of focused experiments. Their
smaller counts describe earlier scopes and must not be added to the final totals.
Expected failures in `before` logs are counterexamples to the original code, not
failures suppressed from a final run. Some filenames and absolute temporary paths
inside historical logs describe the original execution environment. Baseline source
is recoverable from commit `b3bb61bd268b147476252c6ed5a0440c87b97441`.

`analytics-before.log`, `analytics-after.log` and `analytics-evidence.json` record the
last capture/observer experiment. `analytics-contract-before.json` records the
separate typed-payload validator counterexamples. Older `analytics-after.txt` and
`ga4-payment-email-after.txt` cover earlier, narrower helpers.

`environment-*` includes the runner, healthcheck and coverage-context evidence.
Docker commands and CoverageData records use controlled adapters. The healthcheck
also ran against actual local HTTP 200 and 503 responses. The manifest discloses
these boundaries; no Docker/database integration is claimed.

The consent, email, payment, selector, MSW, scanner, structure and evaluator files
are described in the campaign report. Initial browser logs use Chrome 155.0.8059.84;
the final integrated run and last analytics experiment use Chrome 156.0.8078.47.

## Response exercises

`request-responses.json` retains one representative request for each of the 50
skills, its unchanged response and literal-checker results under both rubrics.
Thirty responses inherited task history and twenty used fresh agents. Cases in the
same ten-request batch shared context. These are not end-to-end application runs.

`heldout-responses.json` retains four new responses for writing, release review and
project context. Their bounded manual review is reported separately from automated
checks. `static-original.json` preserves the original 471/512 content result; changes
to rubrics and deferred-criterion accounting prevent a direct reliability comparison.
