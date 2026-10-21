# service-virtualization, campaign 3 — final response

Workspace `/Users/petr/projects/qa-skills` at `fff3118` (main). Playwright 1.62.1, Chromium
bundled, msw 2.15.0 installed but not used. Everything lives in
`tests/workflows/generated/campaign3/service-virtualization/`; nothing else was changed by me.

Candidate build, stated exactly: `fff3118` plus an **uncommitted edit to
`tests/workflows/fixture-app/` made by someone else working in this checkout** (`faults.py` +1
line, `server.py` +3 lines, mtime 20:38:15 local). That edit predates my recording (20:43) and
all three suite runs (20:47-20:49), so recordings and runs describe one consistent Shop; I did
not read the edit (the task forbids reading `fixture-app/`) and cannot say what it does. The
fidelity check passing means it did not change any recorded response shape.

## What ran

| Run | Command | Result |
|---|---|---|
| record | `QA_RECORD_WORKDIR=<scratchpad>/record node .../service-virtualization/record.mjs` | 15 cassettes written from a live Shop (build `shop-lab-v1`), every status as the contract states |
| suite run 1 | the task's command, `--workers 2` | 10 passed, 0 failed (6.0 s test time) |
| drift simulation | `catalog.json` mutated on disk, `--grep "recorded shape"`, file restored | 1 failed as intended: `body.products[0].unit_amount: "string" -> "number"`, `body.version: missing in live response` |
| suite run 2 | the task's command (final files) | 10 passed, 0 failed (7.5 s) |
| suite run 3 | the task's command (final files) | 10 passed, 0 failed (5.2 s) |

Total: 30 executed test results passed, 0 unexpected, 0 flaky, 0 skipped; 1 deliberate failure.
Run 1 differs from runs 2 and 3 only by a test annotation added afterwards (the empty-catalogue
test now records which branch it took); runs 2 and 3 are the two consecutive passes on the final
files. Commands and trimmed output: `execution.log`.

The 10 tests: 7 page tests in `virtualized-ui.spec.mjs` (500 on order creation with key reuse
and single order after recovery; 429 on login; held/slow `/api/orders` with overlapping refreshes;
malformed 200 login body; empty catalogue; 500 on the orders list with Refresh recovery; fully
virtualized load plus the deliberate unhandled request) and 3 in `stub-fidelity.spec.mjs` (live
replay of all 15 cassettes with shape comparison; comparator on six broken inputs; freshness gate
on 29/31-day stamps and a missing stamp). Design, rule and limits: `virtualization-notes.md`.

Deliverables: (1) `recordings/*.json`, 15 cassettes with the request that produced each,
`recordedAt`, build; (2) the 7 page tests; (3) `stub-fidelity.spec.mjs` with `scenario.mjs`
shared with the recorder; (4) `virtualization-notes.md`. Supporting: `cassette.mjs`
(`loadRecording`, `assertFresh`, `shapeOf`, `responseShape`, `diffShapes`), `virtual-api.mjs`
(the `page.route` layer and the `scenarios` table), `record.mjs`.

## What the skill got right

- Record first, derive every stub from a recorded shape, keep one shape per endpoint across
  the suite (anti-pattern 2). The `scenarios` table names the cassette each stub comes from.
- Its list of error variants (429 with `Retry-After`, 500, timeout, malformed body; principle 4,
  anti-pattern 5) is exactly the front-end team's list.
- Handler ordering: opt-in errors must sit in front of the success path (anti-pattern 8). In
  `page.route` terms that is "register stubs last"; the `once` option gives the recovery half of
  each test for free.
- The unhandled-request guard plus "prove it with a deliberate unhandled request" (SKILL.md
  Verification, Done When). Test 7 does precisely that and the guard's log is asserted empty in
  every other test.
- "A green suite or empty log search is not an egress guarantee" — carried into the notes.
- `recordedAt` plus an expiry check on every load.
- Verification's demand to say which transports and scenarios were exercised.

## Recipe difficulties, with the lines

1. **No route for a browser-driven suite against the app's own API.** SKILL.md Quick Route
   line 32 `| Node/browser test hitting an external HTTP API | MSW → references/msw.md |` and
   ci.md `| Browser-based API mocking | MSW (browser mode with Service Worker) |`. MSW's browser
   mode needs `mockServiceWorker.js` served from the application origin and `setupWorker` in the
   page; the Shop serves neither and the task forbids touching it. `page.route`, request
   interception in the test runner, appears nowhere in SKILL.md or the references. Did instead:
   `virtual-api.mjs` on `page.route`, transplanting the three load-bearing ideas of
   `references/msw.md` (reverse handler order, unhandled guard, explicit passthrough). The facts
   it rests on — Playwright tries handlers in reverse registration order and `route.fallback()`
   chains them — came from Playwright's documentation, not the skill.

2. **Decision tree sends an owned HTTP API to in-process mocks.** SKILL.md lines 102-103:
   `Is the dependency internal to your codebase? ├─ Yes → In-process mock (vi.mock / jest.mock /
   monkeypatch)`. The Shop API is internal, yet a browser page calling it over HTTP cannot be
   mocked in-process. Followed anti-pattern 4 ("Stub at the HTTP layer") instead of the tree.

3. **Recorder tooling.** SKILL.md lines 192-194: `Implement it with a record-replay library
   (**Hoverfly**, **Polly.JS**, or **VCR**-style cassettes), not a hand-rolled recorder.`
   record-replay.md softens this: `MSW itself does not record — pair it with Hoverfly's capture
   mode or write the cassette format below.` None of the three is installed, no new dependencies
   allowed, and Playwright's own `routeFromHAR({ update: true })` records only page traffic, so
   it could not capture a 429-after-five-failures, a 409, a 404 or a replayed 201 the UI never
   triggers. Did instead: `record.mjs` (about 40 lines) writes the reference's cassette format
   through Playwright's `APIRequestContext`, the "write the cassette format below" branch.
   The two sentences should agree.

4. **`assertFresh` silently accepts a missing stamp.** record-replay.md:
   ```
   const ageDays = (Date.now() - new Date(recordedAt).getTime()) / 86_400_000;
   if (ageDays > MAX_AGE_DAYS) {
   ```
   `new Date(undefined).getTime()` is `NaN`, `NaN > 30` is `false`, so a cassette without
   `recordedAt` (or with a garbled one) passes the gate it exists to enforce. Added a
   `Number.isFinite` guard and a test (`assertFresh(undefined)` must throw).

5. **No drift check against the live provider.** Anti-pattern 3 and wiremock.md "Drift
   detection" offer only `prism mock openapi.yaml` or replaying a Pact; the Shop has neither an
   OpenAPI document nor a Pact. record-replay.md has no drift detection at all beyond age. Did
   instead: `responseShape` (status, media type, `Retry-After`/`Set-Cookie` presence, recursive
   body type signature) compared live vs cassette per step, with the recorder and the check
   sharing `scenario.mjs`. This is deliverable (3); the skill does not describe it.

6. **The 30-day expiry is time-based, not evidence-based.** SKILL.md 197-199 `fail the test
   when a recording is older than 30 days`. Applied as written, so this suite will fail from
   2026-11-21 until `record.mjs` is rerun, although the fidelity test would still prove the
   cassettes current. Kept because the page tests can run without the fidelity spec.

7. **Positional replay harness.** record-replay.md replays `cassette.steps[step++]` by call
   order regardless of method or path. Keyed stubs by `METHOD /path` instead; a page that fires
   two requests in parallel would otherwise receive each other's bodies.

8. **`.agents/qa-project-context.md` is the unfilled template**, so Discovery step 1 ("use it")
   answered nothing. Everything came from the contract and the served page.

## What I could not verify

- Zero egress. The guard aborts and logs what it intercepts under `/api/`; the page document and
  anything outside `/api/` reach the real Shop by design. No network-level evidence.
- How the real Shop behaves on a real 500, a malformed body or an empty catalogue: it never
  produces them, so those stubs test only the page.
- Server-side idempotency after a 500 that follows a committed write: the stubbed 500 never
  reached the Shop; the test proves the page reuses its key, the recorded
  `orders-create-replayed` cassette and the fidelity check prove the server's replay shape.
- Browser coverage beyond Chromium; three runs only for flake rate.
- The 30-day gate in real time (exercised with synthetic 29-day and 31-day stamps only).
- The parser message asserted in the malformed-body test (`toContainText('JSON')`) is
  Chromium's wording; another engine could phrase it differently.

## Observations about the page, outside the contract

Raw error codes shown to the user, `Retry-After` not surfaced, `Place order` enabled with an empty
cart (the server's 400 is the only stop), a stale error notice survives a successful refresh, no
loading state while `/api/orders` is pending.

## Counts

Final suite: 10 passed, 0 failed (runs 2 and 3, final files; run 1 also 10/0). Drift simulation:
1 failed, as intended.

## Post-authoring edit for the fault matrix

The orchestrator added one hard assertion at the end of the fidelity test in
`stub-fidelity.spec.mjs`: the per-step differences are also collected into a `drifted` map and
`expect(drifted).toEqual({})` is wrapped in `oracle('c3-virt-catalog-drift', 'toEqual', …)`
from the lab's `support/oracle.mjs`. The per-step `expect.soft` reporting is unchanged; the
hard assertion exists because the matrix needs a thrown matcher failure to designate, and a
soft expectation does not throw. The matrix runs the suite healthy and under a new Shop fault
`catalog_currency_missing` (`GET /api/catalog` drops its top-level `currency` field), added
by the orchestrator for this check; the uncommitted fixture edit the agent noticed in its
checkout was that fault, which the agent did not read. No other assertion, recording,
helper or expectation changed.
