# Evidence index

The parent [workflow report](../../REAL-WORKFLOWS-2026-10-21.md) explains scope and results.
Raw failures are intentionally retained; a negative-control failure is not a healthy
application pass.

- `metrics.json`: exact counts and runner timings.
- `final-python-permitted.log`, `final-javascript-permitted.log`, `final-browser.log`:
  final passing repository suites. Earlier sandbox-limited logs remain separately named.
- `final-structure.log`, `final-index.log`, `final-scanner.log`, `static-final.json`:
  structural, generated-index, scanner and lexical-content evidence.
- `playwright-recipes-before.log` and `playwright-recipes-after.log`: immutable baseline
  and repaired actual Markdown examples. `recipe-harness-initial.log` preserves the
  root harness's own initial URL assertion error.
- `matrix/`: first ten-defect campaign, including the redundant discovery-probe count
  mismatch. This was an exploratory harness run, not a green final gate.
- `review-baseline/`: unchanged original acceptance suites against review counterexamples.
  Three Shop faults escaped; the shared Todo deletion fault was already detected.
- `final-matrix/`: all 25 cases over healthy plus 14 faulty configurations, 375 attempts.
- `final-matrix-strict-review.json`: reclassification with the repaired final gate and
  source-hash comparison; no executed application/test sources changed.
- `gate-integration/`: actual fresh healthy and ownership-fault runs through the final
  process supervisor and strict gate.
- `gate-before.json`, `gate-after.json`, `expected-failure-report.json`, `stale-cli.log`:
  actual expected-failure and pre-reporter CLI error evidence.
- `process-group-before.json`, `gate-after-permitted.log`: inherited-pipe reproduction
  and all 14 passing gate/process regression cases.
- `narrow-repeat.json`: 25 cases, two repetitions, four workers, 390×844 viewport.
- `mailpit/`: actual SMTP tests, repeat run, wrong-subject control and lifecycle evidence.
- `shop-review-controls.json`: independent application controls for logout, compensating
  prices and raw-byte signature verification. Developer smoke files establish fixture
  behavior and are not counted as skill-use quality results.

Fresh tasks, complete agent outputs and source are under `tests/workflows/generated/`
and `tests/workflows/mailpit/`. Official TodoMVC source hashes, original licenses and
independent fault probes are under `tests/workflows/upstream-todomvc/`.

Raw evidence and pinned upstream files retain their original whitespace. First-party
source passes the staged whitespace checks.
