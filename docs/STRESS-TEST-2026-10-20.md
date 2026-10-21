# QA skills stress test, 20–21 October 2026

## Outcome and scope

This campaign exercised repository tooling, documented executable examples, and one
representative request for each of the 50 skills. It reproduced concrete false passes,
false failures, lost evidence and API mismatches, then added regressions for the repaired
behavior. The source baseline is `b3bb61bd268b147476252c6ed5a0440c87b97441`.

The work makes the tested paths more dependable. It does not establish that every
skill works with every application, model, permission set, dependency version or future
change. An unknown result must remain unknown, and a local fixture pass must retain
its actual scope.

## Final local verification

<!-- FINAL_RESULTS_START -->
The final integrated run passed **277 executable regression tests** with no failures,
cancellations or skipped cases:

| Check | Final result | Evidence |
|---|---|---|
| Python regressions | 127 passed | [Full log](stress-test-2026-10-20/evidence/final-python.log) |
| JavaScript examples | 71 passed | [Full log](stress-test-2026-10-20/evidence/final-node.log) |
| Browser examples | 79 passed | [Full log](stress-test-2026-10-20/evidence/final-browser.log) |
| Repository structure | 50 skills, 0 errors | [Full log](stress-test-2026-10-20/evidence/final-structure.log) |
| Generated index | In sync | [Full log](stress-test-2026-10-20/evidence/final-index.log) |
| Injection scanner selftest | Passed, all 10 expected rules fired | [Full log](stress-test-2026-10-20/evidence/final-scanner.log) |
| Static content cases | 481/513 matched, 32 flags, 0 errors; 90% floor passed | [JSON](stress-test-2026-10-20/evidence/static-final.json) |

The static result is **93.8% lexical coverage**, with **811 semantic criteria deferred**
to judgment. Those deferred criteria were not passed by the checker. The 32 remaining
flags are retained in the evidence; the aggregate threshold does not certify each
skill. The four fresh held-out responses are reported separately below and are not
included in the 277 executable tests.

The [verification manifest](stress-test-2026-10-20/evidence/verification.json) records
commands, runtime, exit codes, file hashes and the tested source fingerprint.
<!-- FINAL_RESULTS_END -->

The detailed logs and machine-readable result manifest are retained in
[the evidence directory](stress-test-2026-10-20/evidence/). Logs from earlier focused
experiments retain their original counts and timestamps; they are not additional
independent samples to add to the final totals.

## How the campaign was designed

### Executable tests

Tests exercise the actual Markdown code fences rather than a second implementation
of the examples. Healthy controls accompany missing/empty/malformed input, duplicated
or delayed events, retry failures, ambiguous selectors, hostile filenames and supported
encoded injection markers. Python tests also exercise the real validation/evaluation
CLIs and their exit behavior. Controlled fake model executables test process handling;
they are not model-quality evaluations.

Browser cases use controlled fixtures with intercepted or blocked requests. A screen
capture is created from a real Locator, a cookie is an actual browser cookie, and the
healthcheck is run against real local HTTP 200 and 503 responses. External-service
adapters and fabricated application interfaces are labelled as such.

### Requests across all 50 skills

The first case in each original evaluation specification was selected systematically.
The [raw response record](stress-test-2026-10-20/evidence/request-responses.json)
contains the prompt, skill, baseline commit, unchanged response, and lexical results
under both original and revised rubrics. IDs repeat across skill files, so records
are identified by `(skill, case_id)`, not the short ID alone.

The requests were generated in five batches of ten. The first three batches inherited
parent task history and are exploratory. The last two batches used fresh agents with
no parent history. Requests within each batch shared the same agent context. Agents
received the request and skill text, not expected answer patterns. Many requests lack
an application or source file; their output is therefore a plan, an explicitly assumed
template or a request for necessary evidence. This was not 50 end-to-end application runs.

The response review found a concrete GA4 decoder defect: a POST with a query event
could create a phantom extra event. The repaired repository parser has a direct
regression for this case. Other responses sometimes corrected errors in the original
skill using primary documentation, including Allure configuration, MSW ordering and
PostgreSQL 18 storage. This is another reason a plausible answer cannot certify the
source instructions by itself.

### New requests after the writing and evidence changes

A fresh agent received four new prompts and the revised skills, without earlier
responses, evaluation files or expected answers. The [complete responses](stress-test-2026-10-20/evidence/heldout-responses.json)
were manually checked for the following requirements:

| Case | Observed result |
|---|---|
| Writing, short English summary | Preserved 186 tests, four suites and 93.7% to 96.2%; did not invent a cause for the change. |
| Writing, Czech candidate report | Preserved candidate/prior-build associations, exact counts, failed first retry, unrun second retry, suspected cause, missing screenshot, blocked payments and absent approval. |
| Release review | Kept the current candidate's two failures and blocked payments separate from an older green run and recommended NO-GO. |
| Project context | Distinguished a manifest version range from an unknown installed version; preserved links and selector brackets and left team, risk and goal facts unknown. |

All four met these bounded review checks. This is a small forward exercise, not a
statistical estimate of reliability or a multi-vendor model benchmark. The earlier
humanizer response in batch three was not blind to the task history.

## Defects reproduced and resulting behavior

| Area | Original defect | Resulting behavior |
|---|---|---|
| Structure and index | Invalid YAML/sections/references could pass; index comparison could miss wrong contents; blank version wrote an unusable index. | Shared schema parsing, duplicate-key checks, complete index comparison and rejection before invalid writes. |
| Evaluation harness | Missing specs, no checkable criteria, blank outputs and process errors could produce misleading results; pattern alternatives were mishandled. | Explicit errors, nonempty check requirements, grammar preflight, isolated response-only model invocation and retained stdout/stderr. |
| Injection scanner | Missed supported escaped/Unicode forms, unsafe filename handling in the shell recipe and excessive work on long nonmatches. | Bounded matching/normalization, original source offsets, safe argument passing and explicit scanner limits. |
| Consent | The test supplied a missing app default; observers lost real initialization; header-only GPC was treated as a DOM property; delayed requests escaped the observation window. | Passive per-test observation, application-owned defaults/readiness, independent GPC inputs, actual cookie/storage checks and delayed-request cases. |
| GA4 and tracking plans | Lost query/body fields, phantom events, hostname substring acceptance and invalid numeric values accepted as zero or infinity. | Per-record merge, duplicate preservation, approved endpoint matching and typed logical payloads with nested ecommerce items. |
| Email | Wrong Mailpit search route, old/other-recipient messages, unrelated six-digit numbers, ambiguous or encoded links. | Recipient-specific search, per-attempt identities, template-bound OTP extraction and exact-origin DOM link parsing. |
| Payment | Receipt recorded before durable fulfillment could suppress a valid retry. | Receipt and database work share a transaction; processing failure stays retryable; external effects require an outbox or equivalent contract. |
| Selector recovery | Locator source expressions treated as CSS, swallowed screenshot failures, missing unresolved rows, false confidence and incomplete failure inventory. | Live Locator evidence, uniqueness checks, retained attempts/errors, explicit verified triage, inspected source edits and separate proposed/applied states. |
| MSW | Success handler hid rate limiting, state survived reset, frozen-clock IDs collided. | Real MSW tests exercise scenario ordering, reset, distinct IDs, timeouts, retries and rejection of unhandled requests. |
| Traces and reporting | Numeric/OTLP error statuses were missed, lifecycle cleanup ran in the wrong process, Allure used the wrong option. | Explicit status normalization, worker-owned lifecycle and documented resultsDir configuration. SDK/Allure integrations remain outside the executed scope. |
| Test environments | PostgreSQL 18 mount and host endpoints disagreed with the runner; cleanup altered test results; curl was absent from the shown image. | Correct storage path, loopback ports aligned with URLs, original-status preservation and a Node HTTP healthcheck. |
| Suite curation | Function contexts were called equivalent to pytest-cov contexts; phases were treated as separate tests. | Distinguish parameter/phase attribution and union phases under the full test ID. |
| Writing, release and project context | Examples invented results, causes, approval or missing project facts and mixed evidence across builds. | Preserve exact source facts, uncertainty, retry state, actual candidate identity and unknowns. |

### Direct before/after checks

- The same nine selector-scorer tests produced **3 passes and 6 failures** against
  the original script, then **9 passes** against the repair.
- The first actual-MSW experiment produced **2 passing controls and 3 failures**:
  rate-limit requests returned 201, reset retained an old payment, and clock-based
  IDs collided. The subsequent focused suite passed all ten cases.
- The old trace filter counted **zero** error spans for numeric `2` and
  `STATUS_CODE_ERROR`, but one for `ERROR`. The normalization suite covers all three
  plus unknown representations.
- The old tracking validator accepted blank/whitespace numbers, `Infinity`, and a
  mismatched string wire type without a violation.
- The original consent test inserted the application's missing denied default. The
  unseeded broken app sent `gcs=G111`; the old test changed it to `G100` and passed.
- The original analytics capture/observer recipes passed one control and failed five
  counterexamples: POST batches, lookalike hosts, listener cleanup, absent initialization
  and queue replacement. The final focused browser suite passed all 22 cases.
- The JSON surrogate probe moved from **7/10 to 10/10** expected outcomes, retaining
  original source locations and malformed/unpaired handling.
- The environment recipe now preserves test exit **17** and startup exit **19** when
  cleanup fails with **23**. A successful test keeps exit **0** and reports teardown
  failure separately.

These experiments use different oracles and should not be summed into a single
percentage or a count of unique bugs. Before and after logs identify their own scope.

## What the evaluation scores mean

The original static run reported **471/512** matching content cases, with 41 flags.
It checked words in skill files, not whether an agent performed the requested work.

Checking the 50 generated responses with the repaired literal checker yielded
**14/50** satisfying all checkable patterns under either original or revised rubrics.
The flags include valid API/variable alternatives, the intended qa-start routing and
“no fixed sleeps” triggering the token `sleep`. Semantic criteria remain deferred.
Neither 471/512 nor 14/50 is presented as a skill success rate.

The local set now has **513 cases**. One writing case was added. Humanizer criteria
were changed to source fidelity, consent/Allure criteria were corrected, and one SQL
alternation was rewritten equivalently in the supported grammar. The runner now
counts semantic anti-pattern deferrals that it previously dropped. Consequently,
changes in score or deferred-criterion counts are not a clean measure of model progress.
The existing 90% content floor is retained separately from executable regression gates.

## Runtime and compatibility boundaries

The initial runs used Python 3.12.14, PyYAML 6.0.3, Node 24.19.0, Playwright 1.62.1,
MSW 2.15.0 and Chrome 155.0.8059.84. An execution-service outage removed temporary
files. The browser was restored as **Chrome 156.0.8078.47** for the final run; the
final manifest records the actual runtime. The checked-in evidence survived.

The MSW recipes target 2.x. The GA4 parser handles the documented observed transport;
standard ecommerce decoding requires an application adapter checked against actual
tag captures. Data-layer observers install property accessors and disclose that
property-descriptor-sensitive applications need an adapter. Observation windows and
application completion signals bound negative assertions about later events.

No live Claude CLI campaign, Docker/database integration, PSP transaction, GA4
server ingestion, Allure/OTel SDK integration, mobile/device-farm run, Firefox/WebKit
matrix, native GPC conformance or TC-string certification was completed. Payment
transactions use a controlled adapter; coverage contexts use controlled CoverageData
records. These are execution boundaries, not silently passed checks. Other sections
such as broader AI Act/cookie-attribute guidance were not certified by these fixtures.

## Keeping these failures from returning

The CI workflow runs Python regressions, skill structure/index checks, scanner
selftests, static content checks and the documented JavaScript/browser helpers.
Dependencies are pinned in requirements-dev.txt and package-lock.json. CI triggers
include version changes so an out-of-date generated index is checked.

When a new defect appears, preserve the source/build and a reproducing case. Run a
healthy counterpart to rule out a test that always fails. Keep response review separate
from executing generated code. Preserve failed, retried, skipped, blocked and unknown
results rather than hiding them to achieve green output.

## Primary references consulted

- [Google consent-mode concepts](https://developers.google.com/tag-platform/security/concepts/consent-mode) and [ecommerce contract](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce)
- [Global Privacy Control](https://w3c.github.io/gpc/)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Mailpit API](https://mailpit.axllent.org/docs/api-v1/)
- [Allure Playwright configuration](https://allurereport.org/docs/playwright-configuration/)
- [OpenTelemetry Node SDK](https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_sdk-node.html) and [Playwright worker fixtures](https://playwright.dev/docs/test-fixtures#worker-scoped-fixtures)
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [PostgreSQL 18 storage change](https://github.com/docker-library/postgres/pull/1259)
- [pytest-cov contexts](https://pytest-cov.readthedocs.io/en/latest/contexts.html) and [coverage.py contexts](https://coverage.readthedocs.io/en/latest/contexts.html)

Documentation supports the API/contract decisions. Runtime claims above are limited
to the recorded experiments and final verification logs.
