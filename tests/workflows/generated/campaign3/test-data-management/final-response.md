# test-data-management against the Shop — final response

Workspace `/Users/petr/projects/qa-skills`, branch `main`, HEAD `9b08fa8`, Node v26.0.0,
Playwright 1.62.1, Chromium bundled, real Mailpit. Everything created lives in
`tests/workflows/generated/campaign3/test-data-management/`; nothing else was changed
(`git status --short` shows only this folder as new). No dependencies added, no commits.

## What actually ran

Command (from the repo root, `--workers 2`, the harness's config):

```
QA_WORKFLOW_SUITE=/Users/petr/projects/qa-skills/tests/workflows/generated/campaign3/test-data-management \
QA_WORKFLOW_OUTPUT=/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad/campaign3-test-data-management \
node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs --workers 2
```

| Attempt | Result | Cause |
|---|---|---|
| A | 0 scheduled, run error | my import path: `support/test.mjs` is one level deeper than the spec, needed `../../../../support/fixtures.mjs` |
| B | 5 passed, 2 failed | my API slip: tests pass scopes to `reconcileState`, which expected ledgers; it now accepts either |
| **Run 1 (final code)** | **7 passed, 0 failed** | |
| **Run 2 (final code)** | **7 passed, 0 failed**, 9.5 s, 0 flaky, 0 skipped | |

Seven authored, seven executed, seven passed on two consecutive runs. Every test's ledger is
attached to its result (`ledger-<scope>.json` in `verbose.json` and the HTML report); the
`ledger-payment.json` attachment, for instance, records login, order, three 401 rejections,
one 422, one receipt and one duplicate receipt, each with event id and status.

Tests (all in `test-data.spec.mjs`, all through the factories and the scope only):

1. Factory order accepted (201) and reads back equal to the promise; catalogue fixture equals
   `GET /api/catalog`; the contract example override comes to 4200; scoped list equals ledger.
2. Determinism: same scope + seed builds identical orders, signed envelopes and reset data;
   other scope or seed differs; overrides change only what they name; invalid builds flagged.
3. Three scopes (alice, bob, alice) create concurrently on one Shop: 6 distinct keys and ids;
   bob's list is exactly bob's ledger; cross-user reads 404; same-user scopes leak in the raw
   list and not in the ledger-scoped view.
4. Replay (200, `replayed: true`, same order), permutation replays, changed intent 409,
   a 3-way parallel burst gives one 201 and two replays and one order.
5. Tampered, re-signed and unsigned envelopes 401 with no receipt and no status change;
   validly signed wrong amount 422; signed envelope 200, order paid, fulfillment 1;
   duplicate `duplicate: true` and still fulfillment 1; receipts in state equal the ledger.
6. `/test-support/state` reconciles clean against two ledgers (and reports bob's order and
   receipt as unexplained when reconciled against alice alone); after `app.restart()` the
   orders are the same rows, the reconciliation is clean including sessions, public read agrees.
7. Reset data drives a real SMTP message to the namespaced address; token from the text part
   confirms; old sessions and old password fail, new password works, token single-use, state's
   reset token consumed, reconciliation clean.

Supporting evidence runs: one foreground probe script against a live Shop + Mailpit (response
shapes), one in-process factory determinism check, the skill's PII grep (no matches), a grep
for `Math.random`/`Date.now`/`randomUUID` (only a polling deadline in `scope.mjs`), a grep for
hand-built request bodies in the spec (none), `playwright test --help` (no `--shuffle`), and
a scratch check of the reference's JSON import line. All in `execution.log`.

## What the skill got right

- The factory shape it prescribes (defaults + overrides, sequences for unique fields, named
  traits instead of fixture files, `build`/`buildList`) mapped directly onto orders, payment
  envelopes and reset data, and it is the shape that made the tests short.
- "Each test owns its data" and "expectations from the factory, not from the system" are the
  two rules that made the parallel test and the read-back test meaningful.
- Core Principle 4 (seeded randomness, no `Math.random`/`Date.now` in data) is right and
  cheap to follow without Faker: a 30-line PRNG seeded from the scope name was enough.
- The warning that transaction rollback cannot clean up E2E tests is exactly true here: the
  Shop owns its SQLite file; the test process never sees a transaction.
- The Playwright `test.extend` dynamic-fixture pattern (create through the API, hand the
  record to the test, act after `use`) is what the `scopes` fixture is, with "attach the
  ledger" in place of "delete".
- Verification steps 2 (parallel run) and 4 (PII grep) applied verbatim and passed; step 5's
  intent (state returns to baseline) was recoverable as "baseline + ledger == state".
- Factories-vs-fixtures decision rule: the catalogue is read-only reference data and became a
  fixture; orders, events and reset data have a lifecycle and became factories. The drift check
  of the fixture against the server catalogue (test 1) is the skill's "reference data" idea
  applied to a server that owns the prices.

## Recipe difficulties, with the lines

1. **The default factory stack is unavailable and the skill has no zero-dependency form.**
   `SKILL.md:81` ("**Fishery** (2.4.0) is the default for TypeScript ... all pair with
   **faker** (v10.4.0)"), `SKILL.md:29` (Quick Route sends per-test-override needs to Fishery),
   `references/factories.md:15` (`npm install --save-dev fishery @faker-js/faker`),
   `SKILL.md:72` and `references/factories.md:100` (`faker.seed(42)`),
   `references/seeding-and-synthetic.md:37`. `ls node_modules | grep -iE 'faker|fishery'` is
   empty and the task forbids new dependencies. What I did: `factories/prng.mjs` (FNV-1a hash
   of the scope name as the default seed, mulberry32 stream, `fork(label)` per factory so one
   factory's extra call cannot shift another's values) and hand-written `build`/`buildList`
   with a per-factory sequence. The skill should carry this plain form; most of its own
   reasoning ("sequences", "seeded") does not need a library.
2. **Every cleanup recipe assumes deletion; the Shop has none.** `SKILL.md:110` ("deletes it
   after `await use(...)`"), `SKILL.md:184` ("use API-based cleanup (delete in reverse
   creation order)"), `SKILL.md:206` ("Every data creation must have a corresponding
   cleanup"), `SKILL.md:227` and `SKILL.md:237` (row counts return to baseline),
   `references/factories.md:210` (`await request.delete(`/api/test/orders/${order.id}`)`),
   `references/factories.md:228-233` (`/api/test/seed`, `/api/test/cleanup`),
   `references/seeding-and-synthetic.md:95` (`tx.rollback()`), `:99` (`TRUNCATE`), `:111`
   (`request.delete(`/api/test/${r.type}/${r.id}`)`). None of these endpoints or mechanisms
   exist, and the task names an append-only system as the design problem. What I did: a
   ledger of every record the Shop confirmed, assertions scoped to the ledger
   (`visibleOrders`/`foreignOrders`), `reconcileState` with an `exclusive` flag (own Shop:
   baseline + ledger must equal state; shared Shop: ledger must be contained in state), and
   the ledger attached to each test result. The skill's "No Cleanup Strategy" anti-pattern
   (`SKILL.md:205-206`) reads as if cleanup were always possible; it should name the
   ledger-and-reconcile alternative for systems without deletion.
3. **Associations assume the factory can create the parent.** `SKILL.md:88` ("an order builds
   its user"), `references/factories.md:84` and `:205` (`userId: userFactory.build().id`).
   The Shop has no account-creation API; alice and bob are the only users and their addresses
   are namespaced per instance. What I did: users are a fixture read from `app.users`, and the
   order/payment/reset factories take `{ user }` or `{ order }` as inputs rather than building
   them. The "association" direction is inverted: a factory consumes a confirmed parent.
4. **Randomised order is not available.** `SKILL.md:234` ("under randomized order
   (`--shuffle` / `-p randomly`)") and `SKILL.md:224`. `node node_modules/playwright/cli.js
   test --help` has no `--shuffle` in 1.62.1. Only parallelism was exercised (`--workers 2`,
   `fullyParallel: true`).
5. **Seed idempotency has no seed script to run.** `SKILL.md:148` (`INSERT ... ON CONFLICT`),
   `SKILL.md:223` (`psql -c "SELECT count(*) ..." && <seed> && ...`), `SKILL.md:235`. The Shop
   seeds its two users in-process at start; there is no script and no psql. The closest
   observation is test 6: `app.restart()` on the same database keeps both accounts and all
   orders, and the state after restart equals the state before. Recorded as an analogue, not
   as the recipe.
6. **The static-fixture import line fails in Node ESM as written.** `references/factories.md:181`
   (`import productsResponse from '../fixtures/data/api-responses/products.json';`). In a
   plain `.mjs` module Node v26 throws `ERR_IMPORT_ATTRIBUTE_MISSING ... needs an import
   attribute of "type: json"` (checked in a scratch script, not in the suite; a TypeScript
   project under Playwright's transform may differ). I kept the catalogue fixture as an `.mjs`
   export. The same recipe (`references/factories.md:184`, `page.route` + `route.fulfill`)
   is also a mocked response, which the task forbids, so it was not applied.
7. **Nothing in the skill covers byte-exact signed payloads.** The dynamic-fixture pattern
   posts `data: { ... }` objects (`references/factories.md:204-205`), which Playwright
   re-serialises. An HMAC over the body must be computed over the exact string that is sent,
   so the payment factory returns `body` as a string and the scope sends it as a string with
   an explicit `content-type`. The "hand-built payment payloads" the task describes are
   precisely where this goes wrong; the skill has no guidance for it.
8. **Server-owned ordering changes what the factory may promise.** The contract says item
   order does not change intent; the live Shop returns `items` sorted by SKU. "Reads back equal
   to what the factory promised" was only true once the promise was canonical
   (`canonicalItems`). The skill talks about deterministic data but not about normalising the
   promise to the server's canonical form; it is a one-line rule worth adding next to
   Core Principle 4.
9. **Discovery context was an empty template.** `SKILL.md:40` sends the agent to
   `.agents/qa-project-context.md`; it exists but every field is still a `[placeholder]`, so
   the contract file was the only usable context.

## What I could not verify

- Randomised test order (no `--shuffle` in Playwright 1.62.1).
- Seed-script idempotency as the skill defines it (no seed script exists).
- `reconcileState(..., { exclusive: false })` on a genuinely shared Shop: written and
  reasoned, but every test here owns its Shop, so only exclusive mode has executed.
- `reset.tooShort()` against the Shop (the contract does not fix the error code for a short
  password, nor whether a failed confirm consumes the token), token expiry via
  `scope.advanceClock(301)`, and the `--fail-fulfillment-once` 503 path: all wired, none run.
- Browser-form journeys: the suite is API-level through Playwright request contexts; the
  factories were not driven through the page.
- Cross-process "two tests cannot see each other's orders": with the harness's fresh Shop per
  test there is nothing to see across tests, so the proof is three concurrent scopes inside one
  Shop (test 3), which is the case that matters when a Shop is shared.

## Final counts

Authored 7, executed 7, passed 7, failed 0, skipped 0, blocked 0 on each of two consecutive
runs of the final code (earlier attempts A and B failed on my own path and API mistakes,
both recorded above and in `execution.log`).

## Post-authoring edit for the fault matrix

The orchestrator wrapped two existing assertions in `test-data.spec.mjs` in `oracle()` from
the lab's `support/oracle.mjs`: the count of 201 responses in the parallel same-key burst
(`c3-tdm-idempotency-index`, `toHaveLength`, Shop fault `missing_idempotency_index`) and the
fulfillment count read back after the duplicate payment delivery
(`c3-tdm-duplicate-fulfillment`, `toBe`, Shop fault `duplicate_fulfillment`; the read was
hoisted into a local so the wrapper holds only the assertion), and bob's read of each of
alice's order ids in the parallel-scopes test (`c3-tdm-cross-user`, `toEqual`, Shop fault
`cross_user_order_read`; the read was hoisted the same way). The wrapper rethrows the same
error and changes nothing on a passing run. No factory, ledger, expectation or other
assertion changed. The matrix also ran the suite under `missing_idempotency_index` (a
migration that dropped the unique constraint on the idempotency key): the three-request
same-key burst did not hit the race, so the fault passed undetected and the case is
recorded as not established. A race is not a reliable detector of a missing constraint;
the database-testing addon catches that fault at the schema level.
