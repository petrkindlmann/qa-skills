# Workflow campaign 3: ten more skills against running software (2026-10-21)

Campaigns 1 and 2 exercised thirteen skills by having fresh agents author test suites against
two local applications and then proving, with a fault matrix, that the suites detect the
defects they claim to guard. Campaign 3 extends that to ten skills that had never been run
against software: visual-testing, bug-reproduction, selector-drift-recovery,
synthetic-monitoring, analytics-tracking-testing, service-virtualization, test-migration,
test-suite-curation, test-data-management and chaos-engineering.

The method is unchanged and is recorded in `docs/REAL-WORKFLOWS-2026-10-21.md`: one fresh
general-purpose agent per skill, blind to the fixture internals, the fault catalogue, the
other generated suites and the reports; it owns one folder under
`tests/workflows/generated/campaign3/`, saves its prompt, its execution log and a final
response that lists every recipe difficulty with the exact skill lines. The orchestrator
then wraps one designated assertion per fault in `oracle()`, adds the cases to
`run-matrix.mjs`, runs the matrix, and repairs the skill from the recorded difficulties.
Every post-authoring edit is noted in the suite's `final-response.md`.

## Outcome

All ten skills produced a passing suite on the healthy applications, and each suite then ran
under the controls matrix. Of 36 matrix cases, 34 were established: 10 healthy controls and
24 designated-assertion detections. The two cases that were not established are recorded as
limits rather than hidden: the migrated legacy suite renames a duplicate before deleting it,
so it cannot see `delete-wrong-duplicate`, and a three-request burst does not reliably hit
the race that `missing_idempotency_index` opens. The agents recorded 93 recipe difficulties
with the exact skill lines; each became a repair in the skill concerned, and each repaired
skill still passes its static evals.

| | Count |
|---|---|
| Skills exercised | 10 |
| Matrix cases established | 34 of 36 |
| Faults added to the lab | 6 (`redesign-classes`, `style-regression`, `slow_health`, `wrong_currency_event`, `reset_email_dropped`, `catalog_currency_missing`) |
| Recipe difficulties recorded | 93 |

## Results by skill

| Skill | Application | Tests | Healthy runs | Faults detected | Difficulties recorded | Skill files repaired |
|---|---|---|---|---|---|---|
| visual-testing | TodoMVC | 10 (9 baselines + detector check) | 3 consecutive + matrix | style-regression | 3 recovered (session lost) | SKILL.md, references/recipes.md |
| bug-reproduction | Shop | 5 | 2 + matrix | logout_cookie_only, idempotency_payload_conflict | 8 | SKILL.md, references/determinism.md, references/ticket-writeback.md |
| selector-drift-recovery | TodoMVC (redesigned build) | 9 | 2 + matrix | 4 stacked faults on the redesign | 12 | SKILL.md, references/recovery-scripts.md |
| synthetic-monitoring | Shop | 5 probes | 2 + matrix | slow_health, reset_email_dropped (new fault) | 15 | SKILL.md, references/probe-implementations.md, references/platforms-and-ci.md |
| analytics-tracking-testing | Shop | 8 | 2 + matrix | wrong_currency_event | 8 | SKILL.md, references/datalayer-capture.md, references/tracking-plan.md |
| service-virtualization | Shop (page.route + live fidelity) | 10 | 3 + matrix | catalog_currency_missing (new fault) | 8 | SKILL.md, references/record-replay.md, references/ci.md |
| test-migration | TodoMVC (legacy Cypress suite as input) | 7 | 2 + matrix | persistence-lost, filter-state-error, escape-commits-edit; delete-wrong-duplicate undetected (legacy limit) | 10 | SKILL.md, references/framework-guides.md |
| test-suite-curation | the 90-test lab corpus | 90 audited, 72 kept, 18 quarantined | curated: 2 + matrix | curated corpus re-verified against 6 faults | 12 | SKILL.md, references/clustering.md, tiering.md, destructive-safety.md, audit-record.md |
| test-data-management | Shop | 7 | 2 + matrix | cross_user_order_read, duplicate_fulfillment; missing_idempotency_index not established (race) | 9 | SKILL.md, references/factories.md |
| chaos-engineering | Shop (one worker) | 5 experiments | 2 consecutive + matrix | smtp_failure_503, receipt_before_commit | 8 | SKILL.md, references/fault-injection.md |

Matrix evidence lives in `docs/evidence/workflow-campaign3-2026-10-21/`, one JSON record and
one log per batch:

| File | Cases | Established |
|---|---|---|
| `matrix.json` | visual-testing, bug-reproduction, selector-drift-recovery | 10 of 10 |
| `matrix-synthetic-monitoring.json` | synthetic-monitoring | 3 of 3 |
| `matrix-analytics-tracking-testing.json` | analytics-tracking-testing | 2 of 2 |
| `matrix-service-virtualization.json` | service-virtualization | 2 of 2 |
| `matrix-test-migration.json` | test-migration | 4 of 5 |
| `matrix-test-suite-curation.json` | the curated corpus | 7 of 7 |
| `matrix-test-data-management.json` | test-data-management | 3 of 4 |
| `matrix-chaos-engineering.json` | chaos-engineering | 3 of 3 |

### visual-testing

The agent's session was lost with the host window; its files, transcript and three further
runs by the orchestrator stand in for its report. Nine screenshot baselines with explicit
stabilisation (animations disabled, caret hidden, injected stylesheet removing the fades,
`maxDiffPixels: 0`, a settle helper). The matrix fault `style-regression` is detected by six
of the nine baselines. Repairs: where `toHaveScreenshot` options go when the config is
read-only; baselines are platform-tagged, so macOS baselines do not serve Linux CI; inventory
CSS transitions before choosing a stabilisation strategy; an odiff recipe for local pixel
diffs without a service.

### bug-reproduction

Two defect reports became five tests and a reproduction note. Both faults are detected by
the designated assertion and by at least one neighbouring test. The eight difficulties were
mostly about steps that assume a code checkout with the fix in it (red-first, revert the fix,
bisect): on a black-box target they cannot be followed, and the skill now says what to do
instead (discriminating observation in Step 2, the "not reproducible but the team wants a
guard" branch in Step 7, `none: not a regression on this build` in the report).

### selector-drift-recovery

The agent regenerated a nine-test TodoMVC suite on the redesigned build, keeping the original
oracle ids, so the four stacked faults (`redesign-classes+persistence-lost`, `+delete-wrong-
duplicate`, `+filter-state-error`, `+escape-commits-edit`) are detected by the same titles the
original suite used. Twelve difficulties, the sharpest being that the aria-snapshot diff is
blind to class-only drift (Principle 2 now says so), that Phase 3 under-reports drift
because only the first failing locator surfaces in an error (resolve every locator), and
that the rubric had no rung for role-less containers. `summarizeRecovery` now returns
`{ recovered, accepted, flagged }` and the PR body lists accepted rows.

### synthetic-monitoring

Five probes (storefront, sign-in, order journey, password-reset email, health) with a budget
helper that records three samples. Fifteen difficulties, mostly placeholder selectors,
URLs and payload shapes in `probe-implementations.md` that the reader must replace, and a
cron example whose cost was unstated (288 runs and about 430 billed minutes a day at five-minute
intervals). The reset-email probe needed a fault that did not exist, so the Shop gained
`reset_email_dropped`: the endpoint still answers 202 but no message is sent. Both matrix
faults were verified by the designated assertion.

### analytics-tracking-testing

Eight tests observe `window.dataLayer.push` through the skill's passive observer and
cross-check every purchase against the order the public API reports: login pushed once and
not on load or reload, nothing on a rejected sign-in, purchase fields equal to the API order
with exact key sets, two orders giving two pushes with distinct ids, a double-click giving
one order and one push, a rejected order giving nothing, and the contract's ordering
clause. The matrix fault `wrong_currency_event` (the push reports a hard-coded `USD`) is
caught first by the comparison against the API order, not by the scenario literal; the
first oracle wrap sat on the literal and the matrix reported a candidate only, which is
recorded in the suite's final response. Eight difficulties: the skill's beacon-first frame
and Done When cannot be met in an application with no tag manager and no collect endpoint
(the skill now says which items apply and which are recorded as not applicable); the
observer is TypeScript and the serialized init body must be plain JavaScript; the observer
records the object but not the page state an ordering clause needs; no documented tracking
milestone; the example plan requires a per-item price the contract lacks and has no slot
for scenario literals; the bare JSON import; the gate-can-fail step needs an editable
application; an unfilled context template.

### service-virtualization

The agent recorded fifteen cassettes from the live Shop through its own forty-line recorder
(including a real 429 with `Retry-After` after five failed logins, a 409 and a 404 that the
UI never triggers), built a `page.route` layer with an unhandled-request guard, and wrote
seven page tests for responses the Shop never produces (500 on order creation with the same
idempotency key reused on retry and exactly one live order afterwards, 429 on login, a held
orders list, a malformed body, an empty catalogue, a 500 on the list with recovery) plus a
stub-fidelity test that replays every recording unrouted and compares the response shape.
The matrix fault `catalog_currency_missing`, added for this check, is caught by the fidelity
test. The agent also found a bug in the skill's own `assertFresh` example: a missing stamp
gives `NaN`, and `NaN > 30` is false, so the freshness gate silently passed the cassette it
exists to reject. Eight difficulties: no route for a browser page calling its own backend
(the skill sent the reader to MSW browser mode, which needs the application to serve a
worker); the decision tree sends an owned HTTP API to in-process mocks; the recorder sentence
in SKILL.md contradicted the reference; the `assertFresh` bug; no drift check against the
live provider anywhere; the age gate fails a suite on a date even when a fidelity check
proves the cassettes current; the positional replay harness; an unfilled context template.

### test-migration

The input was a seven-test legacy Cypress suite written for this campaign (Cypress itself is not
installed, so the legacy suite cannot run). The agent hand-migrated it from the skill's
golden-reference recipe after finding both recommended converters unusable (one interactive,
one a new dependency): seven Playwright tests with the legacy names kept verbatim, a page
helper using role locators wherever the markup exposes a role, a migration map with all 28
legacy assertions mapped and none dropped, ten intentional changes explained, and a negative
probe proving the migrated assertions fail on wrong expectations. The matrix verifies three
TodoMVC faults; `delete-wrong-duplicate` passes undetected because the legacy test renames
the duplicate before deleting it, a limit of the legacy coverage the migration faithfully
preserved and the map lists. Ten difficulties: no fallback when converters are unavailable;
the unfilled context template; verification commands that do not fit a project's own runner
and a `wc -l` that counts a custom reporter's summary line; Cypress key tokens inside
`.type()` and `{ force: true }` nowhere in the guide; `toHaveText` normalising whitespace,
which would have made the trimming assertion vacuous; no rows for two-argument
`cy.contains`, identical unnamed roles, callback assertions, `.each()` or `Cypress.env`;
no reduced done definition for a one-shot migration whose source framework is gone.

### test-suite-curation

The input was the lab's own corpus: 90 tests in 22 files written by different agents over
the campaigns. The agent inventoried them with a trace-derived request set per test and a
static behaviour fingerprint with helpers inlined, clustered near-duplicates, read every
candidate's assertions, and produced a decisions table with 58 contract clauses mapped to
surviving tests: 62 keep, 9 merge, 1 rewrite, 18 quarantined with a superseding test, a
residual risk and a restore path, one orphan helper. Under the skill's own rules none of the
18 could be deleted, because no mutation result existed; the curated copy therefore carries
nine `test.skip` quarantines with audit annotations and ran twice green. The orchestrator
then ran the fault matrix on the curated copy: healthy with exactly the nine declared
quarantines, and six faults across both applications detected by surviving assertions,
including the idempotency conflict whose original bug-reproduction guards were quarantined.
Twelve difficulties: the skill assumes instrumentable source (no section for a black-box
end-to-end corpus); the clustering normalisation erases the tokens that carry a browser
test's meaning and clusters wrapper specs at 1.0; scipy and babel are optional; mutation
testing is impossible on a pinned build, so the done definition cannot be met as written;
no CI history; pytest and Vitest markers where Playwright uses tags; a title-suffix skip
changes test ids; pytest-only verification commands; unfillable approver columns; the
unfilled context template; whole-file duplicates that one diff finds.

### test-data-management

The agent built a zero-dependency factory layer for the Shop: a seeded generator (the
scope name hashed into a seed, a stream forked per factory), order, signed-payment and
reset factories with defaults, overrides and presets, the promise canonicalised to the
server's SKU-sorted form, and an isolation design for an application that deletes nothing
(a scope per test with its own user, factories, cookie jar and a ledger of every record the
Shop confirmed; assertions read the ledger; a reconcile step checks the durable state from
the test-support endpoint against baseline plus ledger). Seven tests prove the layer,
including three concurrent scopes on one Shop, a parallel same-key burst, tampered and
re-signed payments and a reconcile across a restart; 7/7 twice. The matrix verifies
`cross_user_order_read` and `duplicate_fulfillment`. `missing_idempotency_index` passed
undetected twice: a three-request burst does not reliably hit the race a dropped unique
constraint opens, and the case stays in the matrix as that limit (the database-testing
addon catches the same fault at the schema level). Nine difficulties: the skill's default
stack is Fishery and Faker with no plain form; every cleanup recipe deletes; associations
build their parent; Playwright has no shuffle flag; no seed script to run twice; the bare
JSON import; nothing on byte-exact signed bodies; nothing on canonicalising the promise;
the unfilled context template.

### chaos-engineering

Five experiments, each with its hypothesis, blast radius, abort condition and rollback
recorded as annotations before injection and a baseline-versus-actual record attached after:
an SMTP outage (a second Shop pointed at a port proven closed; reset requests still answer 202
through the API and the browser form, the outage is counted in `smtp_errors`, an unknown
account counts nothing, no 5xx), a restart between order and payment (cookie, order,
idempotency key and sessions survive, the payment then fulfils once), a fulfillment failure
injected after restart (the 503 must be observed, the order stays pending with no receipt,
the retry pays once, a repeat is a duplicate, all of it durable across another restart), CPU
exhaustion from twenty worker threads with per-thread deadlines (286 health probes across
eight runs all answered, two single probes missed the 500 ms budget by 98 and 218 ms and were
recorded as such), and a deliberate abort-gate trip. The final code passed twice in a row;
two earlier runs refused to inject because the baseline health check missed while the host
was overloaded by unrelated processes, which is the steady-state gate working. The matrix
verifies `smtp_failure_503` and `receipt_before_commit`. Eight difficulties: no recipe runs
without tc, toxiproxy, kubectl or stress-ng, and the decision tree has no branch for a local
process; a latency header few services emit and a bound with no source; no sample count for
the baseline and no rule to assert it before injecting; automated abort only for managed
platforms; an observer sharing the CPU with the fault reads the deadline late; findings
demand owners where no tracker exists; the unfilled context template; most of the skill
concerns clusters and game days.

## What the lab gained

- **Faults.** Two TodoMVC mutations (`redesign-classes` renames every class hook while keeping
  behaviour; `style-regression` changes the stylesheet) and four Shop faults, listed above.
  TodoMVC faults now stack (`redesign-classes+escape-commits-edit`), with the redesign applied
  last so the behavioural mutation still matches its anchor.
- **Matrix.** A case may declare an exact number of quarantined `test.skip` tests (any other
  skip keeps the run incomplete), may designate an oracle id that lives in a copied spec, and
  may set its worker count. `tests/examples/workflow-gate.test.mjs` covers the good and broken
  quarantine cases.
- **Oracle placement.** Once the first wrap sat on an assertion the fault never reached,
  because an earlier assertion in the same test failed first (the analytics currency
  literal). The matrix reported a candidate, not a detection, which is the gate working; the
  wrap moved to the assertion that fails first and the suite's final response says why.

## What the difficulties had in common

- **Recipes assume tooling the project does not have.** Faker and Fishery, scipy and babel,
  tc, toxiproxy, kubectl, stress-ng, StrykerJS, cy2pw, MSW browser mode: ten skills reached
  for at least one tool that was absent or forbidden. Each repaired skill now carries the
  plain form beside the tool, and says when the plain form is the better choice.
- **Recipes assume an editable, instrumentable application.** Revert-the-fix, rename-a-param,
  per-test coverage and mutation testing all need source the agent may not touch. The repairs
  give the black-box equivalent (fault injection as the kill-set, a discriminating
  observation, a broken static page through the same observer) and the reduced done
  definition it implies.
- **Recipes assume deletion, a beacon, a seed script or CI history.** Where the system does
  not have one, the skill now says what replaces it rather than leaving the reader to improvise.
- **The project context file was an unfilled template in seven of the nine surviving
  records.** The cause is this repository: it ships the blank template at the path every
  skill reads. The rule that a file still holding the template's placeholders counts as
  absent is now in `AGENTS.md` and in the seven skills whose agents reported it.

## Limitations

- One agent, one take per skill. Difficulties are what that agent met, not a census.
- The fault matrix proves that a designated assertion fails under a known fault with a clean
  process. It does not prove that the suite would catch an unknown fault.
- visual-testing's own difficulty list was lost with the agent's session; the three points
  recovered from its files are a floor.
- All runs on macOS with bundled Chromium; the lab's Linux CI job skips the visual baselines.
- The two not-established cases are limits of the suites, not of the faults: both faults are
  caught elsewhere in the lab (the baseline TodoMVC suite and the database-testing addon).
- The chaos experiments measure the host. Two of its eight runs refused to inject because the
  machine was overloaded by unrelated work; the numbers in its record are from this laptop.
- The test-suite-curation re-verification covers six behaviours of the 58 the curation map
  lists; the other 52 rest on the agent's reading of assertions.
