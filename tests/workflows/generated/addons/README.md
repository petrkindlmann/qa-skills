# Addon scenarios, 21 October 2026

Eleven acceptance cases that extend the campaign in `../baseline-shop`, `../baseline-todo`
and `../review-followup` to four skills the earlier rounds only checked statically:
`accessibility-testing`, `database-testing`, `security-testing` and `performance-testing`.

Provenance differs from the baseline suites and is stated here so nobody mistakes it for
a blind authoring run. These cases were written by Claude Fable 5.1 with the public
contracts, the shared runtime and the four skills open, after reading the earlier report.
The author also designed the matching fixture faults. They measure whether the recipes in
those skills execute against a real local application and whether their assertions catch
the designated regressions; they do not measure fresh-agent authoring.

| Spec | Skill exercised | Designated faults (matrix id) |
| --- | --- | --- |
| `accessibility.spec.mjs` | axe scan of every reachable state, keyboard-only journey, documented upstream gaps | `unlabeled_controls` (`shop-unlabeled-controls`) |
| `database.spec.mjs` | hashed credentials at rest, constraint test with rollback, orphan and integrity checks via `node:sqlite` | `plaintext_session_tokens`, `missing_idempotency_index` |
| `security.spec.mjs` | failed-login throttle with clock control, locked support routes, uniform reset under mail outage | `no_login_throttle`, `open_test_support`, `smtp_failure_503` |
| `performance.spec.mjs` | LCP and CLS lab budgets through `PerformanceObserver`, input-anchored layout | `delayed-render`, `layout-shift` |

Run healthy: `QA_WORKFLOW_SUITE=$PWD/tests/workflows/generated/addons npx playwright test --config tests/workflows/playwright.config.mjs`
(the suite path must be absolute; a relative one resolves against the config directory).
The matrix in `../../run-matrix.mjs` runs each fault against this suite and records which
assertion failed. Lab budgets are loopback numbers, not production targets.
