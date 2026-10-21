## Summary

Several QA recipes could pass broken behavior or lose evidence, including consent
tests that supplied missing application defaults, incomplete analytics captures,
premature payment receipts and selector reports that omitted unresolved work. The
repository checks also accepted malformed inputs or returned misleading results.

This change repairs those paths across 14 skills and adds 277 executable regression
cases. Tests load actual documented helpers and exercise healthy controls alongside
known broken, missing, delayed, duplicated and malformed inputs.

## Changes

- Repair consent, analytics/tracking contracts, email, payment retry handling,
  selector recovery, MSW scenarios, trace status handling and reporting examples.
- Repair environment startup/cleanup/healthchecks and coverage context attribution.
- Preserve source facts, unknowns, retries and candidate identity in writing,
  release review and project context.
- Strengthen YAML/index validation, evaluator error handling and injection-scanner
  normalization while retaining their explicit limits.
- Add pinned test dependencies and CI gates for Python, JavaScript and browser
  examples; retain static flags and deferred semantic criteria as artifacts.
- Retain before/after logs, 50 representative responses, four fresh held-out
  responses, runtime information and source/evidence hashes in the campaign report.

## Verification

| Local check | Result |
|---|---|
| Python regressions | 127 passed |
| JavaScript example regressions | 71 passed |
| Browser example regressions | 79 passed |
| Structure | 50 skills, 0 errors |
| Generated index | In sync |
| Injection scanner selftest | All 10 expected rules fired |
| Static lexical content | 481/513 matched; 32 flags; 811 semantic criteria deferred |

All 277 executable tests pass with no skipped cases. The 90% static content threshold
passes separately; lexical matches are not a measurement of skill reliability.

## Scope and review notes

See [the complete report](STRESS-TEST-2026-10-20.md) for counterexamples and exact
commands. Controlled fixtures do not establish live vendor ingestion, real payment
transactions, Docker/database integration, SDK integrations or every browser/model.
Thirty of the 50 representative responses inherited task context; twenty used fresh
agents. The four new held-out responses met their stated bounded manual checks.

The initial local campaign used Chrome 155.0.8059.84; the final integrated run used
Chrome 156.0.8078.47. GitHub Actions results must be checked after publication.
