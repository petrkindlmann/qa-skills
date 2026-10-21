# bug-reproduction — campaign3 final response

## What actually ran

Commit `201d1d41d17d7229c84e94319d1c83ce3bac20bc`, macOS Darwin 27.0.0, Node v26.0.0, Python 3.14.6,
Playwright 1.62.1 with bundled Chromium. Real Shop (fresh SQLite per test) and real Mailpit (per worker).

| Run | Command (from repo root) | Result |
|---|---|---|
| Discovery probe | `node $SCRATCH/discover/discover.mjs ...` (foreground, runtime.mjs) | both reports do NOT reproduce over HTTP |
| Suite run 1 | `QA_WORKFLOW_SUITE=... QA_WORKFLOW_OUTPUT=$SCRATCH/campaign3-bug-reproduction node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs --workers 2` | 4 passed, 1 failed (my `page.request` relative URL, not the app) |
| Suite run 2 (after fix) | same | **5 passed, 0 failed**, 15.5 s |
| Determinism | same `--repeat-each 10`, separate output folder | **50 passed, 0 failed, 0 flaky**, 112.6 s |
| Oracle sensitivity | `node tests/workflows/generated/campaign3/bug-reproduction/oracle-sensitivity.mjs` | both oracles red against a stub with the reported defects (run 1 crashed on my own jar-clearing mistake; run 2 clean) |

Tests authored and executed: 5 (2 for report 1, 3 for report 2), each independent (own Shop, own
request contexts disposed in `finally`), all through the public contract (browser page + HTTP). No
mocked or routed HTTP. Mailpit untouched by these flows. No commits; nothing outside
`tests/workflows/generated/campaign3/bug-reproduction/` and the scratchpad was written.

Deliverables in the folder: `task-prompt.txt`, `helpers.mjs`, `report-1-session-revocation.spec.mjs`,
`report-2-idempotency-conflict.spec.mjs`, `oracle-sensitivity.mjs`, `reproduction-notes.md`
(repro spec, minimal script, observed vs expected, severity, contract clause, triage table, Step 8
block), `execution.log`, this file.

## Triage in one paragraph

Report 1 concerns "`POST /api/logout`: invalidates the current session and returns 204" plus "All
order endpoints return 401 without a valid session" / "Logout removes access"; if real it is
Critical (security); on 201d1d4 it does not reproduce (0 of 22 attempts). Report 2 concerns
"Reusing a key for a different quantity, SKU or currency returns 409 `idempotency_conflict`"; if
real it is High (duplicate orders and money); on 201d1d4 it does not reproduce (0 of 32 attempts),
and the shipped page cannot even produce the input (it mints a fresh random key per attempt and
clears it on quantity edits), so the reporter used an API client. Both are classified
not-reproducible-on-this-build with the missing intake rows listed as questions back to support.

## What the skill got right

- **Step 1 intake before theorizing.** Filling the repro-spec table exposed what both reports
  lack (build, client, response bodies) and turned those into concrete questions instead of guesses.
  It also surfaced the UI-cannot-produce-this finding for report 2 from reading the page, not the source.
- **Step 2 "confirm the baseline before you cut."** Translated directly into the tests' most
  important lines: prove the copied cookie is live (200, lists the order) *before* sign-out, and
  prove the first POST is 201 *before* the conflicting one. Without that, a 401 or 409 proves nothing.
- **Step 3 ISOLATE.** Reading the page script showed Sign out is exactly `POST /api/logout`, so the
  report-1 repro shrinks to four HTTP calls while one browser test keeps the literal path.
- **Step 5 "assert the real expected value."** Every assertion is the contract's literal: 401 with
  `{"error":"unauthenticated"}`, 409 with `{"error":"idempotency_conflict"}`, exactly one order with
  the original id and amount, 200 `replayed: true` with the same order for the equivalent basket.
- **Step 6/Verification repeat runs.** `--repeat-each 10` is what the skill asks for and it ran as
  written: 50/50.
- **Step 7 table.** Gave the right vocabulary for a negative result and forced the "match the
  reporter's environment and data" question, which is where the open items come from.
- **Step 8 seven-element block.** Used verbatim in reproduction-notes.md; it made "introducing
  commit: none" an explicit statement rather than a silent omission.

## Recipe difficulties, with the exact lines

1. **SKILL.md lines 84–90 (Principle 4) and 227–244 (Step 5 "red first") cannot be followed on a
   healthy application.** The task requires tests that PASS now and would fail if the defect existed;
   there is no fix to precede and no red to watch. The skill has no branch for "report does not
   reproduce but a guard test is still required"; Step 7 (lines 270–288) ends at "document the
   negative result" and never hands back to Step 5. What I did instead: `oracle-sensitivity.mjs`
   stands up a throwaway HTTP stub that behaves exactly as the two reports describe and runs the
   same oracle functions the specs import; both must throw. That is a check of the tests, not of the
   app, and the notes say so.
2. **Step 6 lines 256–262 ("Revert the fix temporarily (stash it ... comment the fix line)") has
   nothing to revert.** The runtime does expose a fault switch (`tests/workflows/support/runtime.mjs`
   line 91, `APP_FAULT: process.env.QA_SHOP_FAULT`), but its fault names live only in paths the brief
   forbids reading; guessing them would be probing internals. The stub in item 1 is the substitute.
   A fault catalogue in the contract would have let Step 6 run as written.
3. **Step 3 lines 146–171 and references/bisect.md lines 21–30 (`git bisect bad HEAD` / `git
   bisect good v2.4.0`) are not applicable.** HEAD is good, there is no release tag, and this
   repository's history is the skills repo, not the application's deployment history. Skipped;
   recorded in the Step 8 block as "none — not a regression on this build". The ticket template
   (ticket-writeback.md lines 29–30, element 4 at line 46) has no "N/A" wording for this case.
4. **Step 4 lines 194–223 and references/determinism.md lines 77–115 (`page.clock.install`,
   `page.route(...) → route.fulfill`, `addInitScript` seed) were not usable.** Neither flow has a
   clock, RNG or third-party call, and the environment rule "No routed or mocked HTTP" means the
   `page.route` recipe at determinism.md lines 86–92 would have broken the brief if applied.
   Determinism here is structural: fixed `Idempotency-Key` literals, server-owned prices, a fresh
   Shop per test, Playwright auto-waits only. Of the checklist at determinism.md lines 119–123 only
   the last box (10 identical runs) applied.
5. **Step 2 lines 128–134 ("never minimize before confirming it reproduces").** Taken literally this
   forbids any minimization here, because the baseline never fails. What I minimized is the
   *discriminating observation* (the smallest call sequence whose outcome differs between contract and
   report), not a failing repro. The skill should name that case; Anti-Pattern 2 (lines 316–319)
   reads as if it were a mistake.
6. **Discovery Questions lines 50–52.** `.agents/qa-project-context.md` exists but is the unfilled
   template (78 bracketed placeholders), so it answered nothing; the skill's only guidance is to
   suggest creating one. Not blocking, every answer came from the contract and the live app.
7. **Runtime gotcha, not a skill line:** `page.request.get('/api/me')` fails with
   `apiRequestContext.get: Invalid URL` because the suite config sets no `use.baseURL` (each test
   owns a Shop on a random port). The brief warns about manual request contexts but says builtin
   fixtures "work normally"; `page.request` needs the absolute `app.baseURL + path` here. Cost: one
   failed suite run.
8. **Shell:** starting the server with `&` is denied (noted in the earlier attempt's log; I used the
   foreground runtime.mjs scripts from the start). macOS has no `timeout`; the tool's timeout was used.

## What I could not verify

- That either defect exists on the reporters' build. No SHA, timestamp, client or response body was
  supplied; the only reproduction surface available is `201d1d4`, where both behave per contract.
- A red run of the specs against the real application. Only the oracle functions were seen red,
  against a stub (item 1 above). If a fault name for `QA_SHOP_FAULT` is published, the same two spec
  files are the targeted red/green command.
- Report 1 with a second real browser profile. The "colleague" is an HTTP client presenting the raw
  cookie value, which is the same thing at the HTTP layer the report describes, but not a second
  Chromium context.
- Adjacent contract clauses the reports do not name: parallel equivalent submissions creating one
  order, and password-reset invalidating all sessions. Not exercised.
- Repository hygiene outside my folder: the working tree carried modifications before I started
  and gained more during the session (evals/*.json, scripts/eval_patterns.py, scripts/run_evals.py,
  skills/compliance-testing/*); none are mine and none affect these runs, but the tree is not clean.

## Final counts

- Regression suite: **5 passed, 0 failed** (run 2; run 1 had 1 authoring failure, fixed).
- Determinism: **50 passed, 0 failed, 0 flaky** (`--repeat-each 10`).
- Oracle sensitivity: **2 of 2 oracles red** against the defective stub.
- Reports reproduced: **0 of 2** on `201d1d4`.

## Post-authoring edit for the fault matrix

After authoring, two helper assertions (`expectSessionRevoked` 401 on /api/me, `expectIdempotencyConflict` 409) were wrapped in the lab's `oracle()` helper so the controls matrix can verify a designated assertion failure under a fault. The wrapper rethrows the same error and changes nothing on a passing run.
