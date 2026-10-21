# Real application workflows, 21 October 2026

## Outcome

This second campaign is complete. It exercised nine skills through five fresh agent
tasks, followed by an explicitly review-driven continuation. It added actual browser,
HTTP, SQLite and SMTP workflows, repaired two skills, and made the workflow gate fail
closed when execution evidence is missing or misleading.

The collection remains at **50 skills**, version **3.2.0**. `playwright-automation` and
`api-testing` are now **2.1**. The earlier collection-wide work is retained in
[the first campaign report](STRESS-TEST-2026-10-20.md).

| Check | Observed result |
| --- | --- |
| Python regressions | 127 passed |
| JavaScript/helper/gate regressions | 85 passed |
| Browser/documented-recipe regressions | 84 passed |
| Total repository regressions | **296 passed, no failed or skipped cases** |
| Healthy application acceptance suite | **25 passed**, two workers, no retries; 11.25 s in the final gate integration run |
| Narrow viewport repeat | **50 passed**, four workers, two executions per case, no retries; 14.56 s |
| Deliberate application defects | **14 of 14 exposed by the designated assertions** |
| Full healthy/defect matrix | 375 attempts: 346 passed and 29 intended failures; no skips |
| Actual Mailpit SMTP checks | 4 passed; a separate four-worker, three-repeat run passed all 12 attempts |
| Mailpit wrong-subject control | One intended assertion failure, exit 1; owned mail still cleaned up |
| Repository structure/index | 50 skills, zero errors; generated index in sync |
| Static content coverage | 481/513 lexical cases matched; 32 flags, 811 semantic criteria deferred |

The 375 matrix attempts are repetitions of 25 test definitions across configurations,
not 375 independent requirements. The narrow viewport is desktop Chromium at 390×844,
not a real mobile device. Runtime values describe these executions; they are not a
controlled performance comparison or a measured long-run flake rate.

Raw counts and timings are in [metrics.json](real-workflows-2026-10-21/evidence/metrics.json).
The [strict matrix review](real-workflows-2026-10-21/evidence/final-matrix-strict-review.json)
checks all final reports and confirms the executed application/test source hashes
still match the captured snapshot.

## What ran for real

### Official TodoMVC

The browser suite drives the official vanilla JavaScript TodoMVC at upstream commit
`25a9e31eb32db752d959df18e4d214295a2875e8`. Original application bytes, dependencies,
licenses and hashes are retained. The local HTTP server checks those hashes, supplies
an offline content policy, and returns 204 for optional online learning metadata.
Application behavior is driven through ordinary user actions, without storage seeding
or Playwright request interception.

The suite covers creation, whitespace handling, identical titles, editing, Enter and
Escape, completion, filters, hidden records, deletion, clearing completed items,
empty-state recovery and reload persistence. The follow-up adds an immediate reload
after each deletion entry point, including clearing the last record.

The current upstream ES5 source at `ff43b02e59dfa604386bb382034b2cd07c2bcd8a` was also
inspected and probed. Its in-memory storage lost the item after reload. That observation
is retained as a compatibility boundary, not labelled an upstream defect. The benchmark
uses the separately pinned persistent variant required by its contract.

See [provenance](../tests/workflows/upstream-todomvc/provenance.json),
[public contract](../tests/workflows/todomvc-contract.md), and
[fixture probes](../tests/workflows/upstream-todomvc/observations/probe-results.json).

### Local Shop with SQLite

The Shop is a deliberately small application built for this campaign, not an external
production service. It runs a real loopback HTTP server, commits actual SQLite
transactions, sends real SMTP messages and exposes a browser UI. Each test gets a fresh
database and unique recipient namespace. Explicit restart checks reopen the same
database and port.

Tests cover session login/logout, account isolation, server-priced checkout, invalid
orders, concurrent equivalent submissions, conflicting idempotency keys, signed
payment events, duplicate delivery, atomic rollback, retry and restart durability.
The reset journey follows a link from an actual captured email, changes the password,
rejects old credentials, checks existing-session invalidation, token reuse and expiry.

The payment protocol is a local HMAC contract. No Stripe, Adyen, card network, payment
attempt or external provider integration was exercised. Mail was captured locally.

See the [public Shop contract](../tests/workflows/fixture-app-contract.md),
[initial acceptance suite](../tests/workflows/generated/baseline-shop/shop.spec.mjs),
and [review follow-up](../tests/workflows/generated/review-followup/).

### Actual Mailpit

Mailpit **1.31.6** is pinned to its official Linux AMD64 release and checked against
archive SHA-256 `10fa12ccc610f653d4ed4df848c1817f9935dcf4e9a6a458a19ab0fa02093f91`
and executable SHA-256 `89ad3d1987140f5f4432be497e0aa8fbf1e8a6bb30258b7d35d5ea4bedfcd4df`.
It binds to loopback, accepts synthetic `@example.test` recipients and has no relay.
The service helper checks API version, database identity and SMTP readiness, and bounds
download, startup, requests, lifetime and shutdown.

The separate inbox suite receives a delayed reset after 55 newer decoys, excludes stale
IDs, checks actual message/header responses, parses captured HTML and rejects unsafe or
ambiguous links. Cleanup verifies recipient and run ownership before deleting selected
IDs; a separately observed sentinel survives another owner's cleanup. All completed
verification inboxes ended empty, including the deliberate failure run.

This establishes local capture and extraction behavior, not external deliverability.
See [release provenance](../tests/workflows/mailpit/release.json),
[service instructions](../tests/workflows/mailpit/README.md), and
[raw SMTP evidence](real-workflows-2026-10-21/evidence/mailpit/).

## The author, review, repair workflow

Fresh agents received product contracts and relevant skill files without the deliberate
defect names, oracle answers or earlier diagnoses. They were instructed not to inspect
application fault modules or prior evaluation reports. This was instruction-level
separation in a shared workspace, not an OS-enforced blind environment.

| Task | Skills applied | Output and execution |
| --- | --- | --- |
| Mailpit integration | email-testing | Actual SMTP/API/DOM tests and service lifecycle evidence |
| Shop acceptance authoring | api-testing, playwright-automation, email-testing, payment-testing | Ten independent acceptance cases executed |
| TodoMVC acceptance authoring | playwright-automation, ai-test-generation | Nine independent browser cases executed |
| Test-code review | ai-qa-review | Concrete review of assertions, isolation and runtime cost; no execution claimed |
| Failure triage and advancement note | ai-bug-triage, release-readiness, qa-report-humanizer | Actual raw reports reviewed; no execution or publication claimed |

The initial Shop and Todo authors used frozen skills from commit
`e876dcfd6194066d1d697aea9ca6d7e08d2ce123`. Complete prompts, outputs and execution notes
are retained in `tests/workflows/generated/` and `tests/workflows/mailpit/`.

The reviewer identified five actionable recommendations. Controlled application variants
confirmed **three additional Shop escapes**. The Todo persistence concern was narrower:
the selected deletion journey could be masked by later writes, but another existing
blank-edit test already caught the broader shared-store defect. We retained that
counterevidence rather than counting it as a fourth suite-wide escape.

A continuation then received the review and version 2.1 skills and authored six focused
tests. It is explicitly labelled review-driven work, not a fresh blind evaluation.
All six passed against healthy apps; the full combined suite subsequently caught the
three previously missed defects. This result reflects the whole author/review/repair
process. It cannot isolate a causal gain from skill wording alone.

The final release-review task distinguished the earlier browser startup problem from an
actual ownership failure, preserved the 10-pass/1-fail candidate count, and recommended
holding advancement. It did not treat an 11-pass baseline under a different runtime
configuration as proof of candidate readiness. Its proposed severity remains a reviewer
assessment of the supplied local evidence, not a production incident finding.

## Defect sensitivity

| Deliberate defect | Earlier acceptance suite | Final suite evidence |
| --- | --- | --- |
| Cross-user order read | Detected | Foreign order returned 200 and order data instead of 404 |
| Client-controlled amount | Detected | Amount became 1 instead of 4200 |
| Duplicate fulfillment | Detected | Fulfillment count increased beyond one |
| Receipt committed before fulfillment | Detected | Receipt remained after the transient failure |
| Same key with changed intent | Detected | Changed payload replayed with 200 instead of 409 |
| Reusable reset token | Detected | Used token returned 200 instead of 400 |
| Missing Todo persistence | Detected | Saved records disappeared on reload |
| Wrong duplicate deleted | Detected | Wrong record/completion identity remained |
| Incorrect filter state | Detected | Visible titles differed from the required subset |
| Escape saves an edit | Detected | Canceled draft replaced the saved title |
| Cookie-only logout | **Missed** | Copied pre-logout credential returned 200 instead of 401 |
| Compensating unit prices | **Missed** | Tea cost 1500 instead of 1200, despite the original basket still totaling 4200 |
| Signature over reserialized JSON | **Missed** | Correctly signed noncanonical bytes returned 401 instead of 200 |
| Deletion not saved until a later write | Detected through blank editing | New direct delete/clear cases also expose records returning on immediate reload |

The baseline therefore detected **11/14** selected variants; the combined final suite
detected **14/14**. These are finite synthetic controls, some selected from the review's
counterexamples. This fraction is not a general reliability percentage for the skills.
All 14 final failures were reviewed against their intended contract, not accepted solely
because the test process exited nonzero.

## Changes to the skills

The Playwright starter placed `global-setup.ts` outside its configured `testDir`. The
actual runner skipped setup and then failed to load the missing storage-state file.
The worker recipe also saved authentication without connecting it to the builtin
`storageState` fixture; normal `page` tests reached the protected route unauthenticated.

The repaired configuration discovers setup, starts with Chromium for the small-project
path, and avoids a fictional teardown file. The worker fixture connects saved state,
uses worker metadata, closes contexts and removes its state file. Shared accounts are
limited to suitable read-only tests; fresh browser contexts do not isolate backend
account changes. Five runner regressions execute the actual documented code fences.
The immutable baseline passed two and failed three; the repaired recipes pass all five.
The multi-role runtime example was a passing control, not a reproduced runtime defect.

The installed Playwright 1.62.1 CLI rejected `playwright migrate` as an unknown command.
The skill's unsupported migrator claim and dated “latest” table were replaced with
installed-version and official-documentation checks. This follows Playwright's
[setup-project](https://playwright.dev/docs/test-global-setup-teardown),
[authentication](https://playwright.dev/docs/auth), and
[fixture](https://playwright.dev/docs/test-fixtures) contracts.

The API and Playwright guidance now calls for independent session replay after logout,
immediate persistence observations before later writes, independent unit-value checks,
accepted boundaries, and valid exact-byte signature examples. It also preserves the
application's documented 403/404 and idempotent-state contracts instead of requiring
every status from every endpoint. The Todo author encountered a control disappearing
from a filtered view after unchecking it; the guidance now explains how to assert that
transition through its stable resulting list and count.

## The gate was tested too

Final integrity review found three orchestration risks. Actual controlled checks
established the before/after behavior:

- A CLI failure before reporter initialization could reuse a previous `verbose.json`.
  Each run now removes old result files before launching and rejects absent new evidence.
- Playwright marks an expected `test.fail()` failure with outcome `expected`. The gate
  now requires actual passed attempts for healthy runs, exact case counts, no retries,
  no skips and no abnormal process termination.
- Killing only a parent process did not close its captured pipe while a descendant
  retained it. The runner now owns a POSIX process group, escalates termination, caps
  captured output, and settles by an outer deadline even if pipes remain open.

Fourteen new regression cases cover these boundaries. Actual expected-failure and CLI
error outputs were rejected by the repaired gate. An inherited-pipe probe demonstrated
that parent-only termination left `close` pending and group cleanup released it. The
new supervision test completed the resistant-descendant scenario in under a second.

The full application matrix had already used fresh output folders and ordinary tests.
Its raw reports were reclassified with the strict final gate and its executed sources
were hash-checked. A fresh 25-case healthy run and a fresh 25-case ownership-fault run
then exercised the repaired orchestration end to end. The final browser suite also
uses that supervisor for its nested Playwright runner.

## Execution adjustments retained in the record

The first Todo run passed 8/9; its uncheck helper timed out after the application
correctly removed the filtered row. The author's correction preserved the behavioral
assertions and the next run passed 9/9. An initial root login control used a glob where
`toHaveURL` expected a literal/regular expression; that harness error was corrected
before recording the immutable recipe baseline.

A discovery probe was accidentally still selected by the first Shop matrix, creating
11 cases where the harness expected 10. The probe is preserved as `probe.mjs` and is no
longer collected as an acceptance test. The original count mismatch and the review
matrix's disproved Todo escape hypothesis remain in raw evidence.

The default executor sandbox denied local socket creation and browser socket options;
two subprocess-output assertions also failed there. The same commands passed with
approved execution permissions. Both blocked/failed attempts and subsequent permitted
results are retained separately. They are not application failure counts.

## Reproduce and maintain

Use Linux AMD64, Python 3.12 and Node 24. Dependencies pin Playwright Test 1.62.1 and
Mailpit 1.31.6. Recorded runs used Google Chrome 156.0.8078.47. CI installs the browser
associated with its pinned Playwright package; a hosted CI execution is not claimed.

```bash
npm ci
npx playwright install --with-deps chromium
npm run workflow:setup
npm run test:workflows
npm run test:mailpit
npm run test:workflow-controls
```

Use `QA_BROWSER_EXECUTABLE` only to intentionally select a system browser. The ordinary
run prints concise text and writes JSON, failure screenshots and traces. Workflow
controls preserve actual failed assertions. Services use owned ports, fresh databases,
recipient namespaces and bounded cleanup. No inbox-wide purge is needed.

The CI job is configured with a ten-minute job limit and retains evidence even on
failure. Source changes, dependency changes and browser changes should trigger these
checks again. Passing local fixtures do not establish external email delivery, real
PSP behavior, every browser/device, production load, legal compliance, or behavior of
every future model. The remaining 41 skills received repository/static checks in this
pass, not new forward-use tasks.

The work is committed on `codex/skills-real-workflows-2026-10-21`; the final Git handoff
identifies the delivered commit and remote-publication status. No approval, deployment,
message publication, merge or hosted CI result is implied by these local executions.
