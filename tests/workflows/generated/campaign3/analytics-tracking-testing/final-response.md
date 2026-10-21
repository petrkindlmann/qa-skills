# analytics-tracking-testing against the local Shop: final response

## What ran

Suite: `login-events.spec.mjs` (3 tests) + `purchase-events.spec.mjs` (5 tests), 8 tests, each on
its own real Shop instance (fixture `app`) with its own browser context; `test.afterEach` ends the
session through `POST /api/logout`; the one test that sends a real password-reset mail polls the
worker's Mailpit for messages to that instance's alice address and deletes them.

Command (repo root, HEAD 7b85619, Node 26.0.0, @playwright/test 1.62.1, Chromium bundled, macOS 27.0.1):

```
QA_WORKFLOW_SUITE=.../campaign3/analytics-tracking-testing QA_WORKFLOW_OUTPUT=/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad/campaign3-analytics-tracking-testing node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs --workers 2
```

| Run | Suite version | Result |
|---|---|---|
| 1 | before the two raw-layer "never cleared" assertions | 8 passed, 0 failed, 0 flaky, 0 skipped (6.3 s) |
| 2 | same | 8 passed, 0 failed, 0 flaky, 0 skipped (11.8 s) |
| 3 | final | 8 passed, 0 failed, 0 flaky, 0 skipped (11.6 s) |
| 4 | final, consecutive | 8 passed, 0 failed, 0 flaky, 0 skipped (9.2 s) |

Detector checks (not app tests): `selfcheck-validator.mjs` passed (2 good payloads accepted, 4 broken
payloads produce the expected missing/type violations); scratch broken page through the same observer
and assertions: 5 of 5 assertions failed as they must (duplicate purchase, minor-unit value, replaced
layer, empty login method, duplicate login). Full commands and trimmed output: `execution.log`.
Coverage table: `coverage.md`.

What the tests establish: the login push happens once per successful sign-in with `method: "password"`,
not on load, reload, rejected sign-in (401), sign-out or reset request; the purchase push happens once
per created order with `transaction_id`, `value` (= amount/100: 42 for 4200, 12 for 1200, 54 for 5400),
`currency` and `items[{item_id, quantity}]` equal to the order returned by `GET /api/orders/ID` and
`GET /api/orders`, never for a rejected order (400), once for a double-click, and it sits after the
order response (it carries the server-assigned id) and before the orders list refreshes (at push time
the list still shows its pre-order rows and the checkout button is still disabled); `window.dataLayer`
is an array on load, never replaced, never cleared.

## What the skill got right

- The passive observer in `references/datalayer-capture.md` worked on this page unchanged in logic:
  it saw `window.dataLayer = window.dataLayer || []` through the assignment accessor, wrapped `push`,
  reported `replacements: 0` and `errors: []` in every test, and the audit found itself intact. In the
  broken-page check it still observed a push made through an app-replaced `push` and counted a replaced
  layer, without repairing either.
- "After actions, checkpoint `trace.entries.length` and assert only new entries" is the right discipline;
  it is what makes the sign-out, reset-request and rejected-order tests mean something.
- "Check counts as well as shape; selecting the first matching event conceals duplicates" (SKILL.md
  160-161): every assertion here is on arrays or counts, and the broken page shows them failing on
  duplicates.
- "A matching schema cannot prove that a price is correct. Compare the payload with the known test
  cart" (SKILL.md 141-142, tracking-plan.md "A schema alone accepts the wrong finite price"): the
  validator accepted `value: 4200`; only the literal `42` assertion catches minor units.
- Completion signal before reading the trace, never `waitForTimeout`: no sleep anywhere, 32 test
  executions, zero flakes.
- The plan-as-file plus `validateEvent` reports `missing` and `type` violations as written.
- The guard in `readDataLayerTrace` ("Install the dataLayer observer before navigation") caught my own
  scratch mistake (`page.setContent` is not a navigation, so `addInitScript` never ran).

## Recipe difficulties, with the exact lines

1. **The skill's frame does not fit an app with no beacon.** SKILL.md 55 "Intercept the beacon, never
   trust the DOM or `dataLayer` alone", 298-299 Anti-pattern 1, and Done When 339 "Each tracked event
   has a test that intercepts the real collect-endpoint beacon ... no DOM-only or dataLayer-only
   assertions". The contract defines the push as the observable and there is no tag manager or
   collect endpoint. The exception at 150-151 ("When the question is specifically the GTM input ...
   assert the push") and the parenthetical at 299 authorize this suite, but Done When 339 cannot be
   met, and 341 (dedup), 342-344 (consent), 345 (multi-pixel fixture), 346 (news-media), 347 (CI
   baseline diff) do not apply. What I did: followed only "Asserting dataLayer.push" (148-166) and
   `references/datalayer-capture.md`.
2. **Observer is TypeScript; the suite is `.mjs`.** datalayer-capture.md "Copy this block into
   `helpers/datalayer.ts`", `import { Page } from '@playwright/test';`, `export type DataLayerTrace`,
   `installDataLayerObserver(page: Page, layerName = 'dataLayer')`, `const trace: DataLayerTrace = ...`
   inside the serialized init function, `readDataLayerTrace(page: Page): Promise<DataLayerTrace>`.
   The config matches `**/*.spec.mjs`. I removed the annotations (`helpers/datalayer.mjs`); I did not
   test whether Playwright's transform would have accepted the `.ts` helper imported from `.mjs`.
3. **The recipe cannot answer the contract's ordering clause.** datalayer-capture.md
   `function record(item) { ... trace.entries.push(structuredClone(item)); ... }` records the object
   only. "after the order response arrives and before the orders list refreshes" needs page state at
   the instant of the push. I added `trace.context[i]` (timestamp plus a serializable list of UI probes
   passed through `addInitScript`'s argument) and changed the signature to
   `installDataLayerObserver(page, { layerName, uiProbes })`. `trace.entries` keeps the recipe shape.
4. **No documented analytics completion signal.** datalayer-capture.md "`analytics-state` below is a
   documented application milestone ... Replace that selector and phase with the real signal; do not
   set it from the test" and the example `await expect(page.getByTestId('analytics-state'))
   .toHaveAttribute('data-phase', 'view-item-complete');`. The Shop has none. I used the handlers'
   terminal UI state, read from the served page: `#notice[role=status]` text (`Signed in.`,
   `Order created: ID. Amount: EUR x.xx`, `invalid_credentials`, `invalid_order`, `Signed out.`) and
   `html[data-ready="true"]` after load. The contract documents these only as "shows the server's
   order ID, amount" / "reports success or the server error"; they are the last statement of each
   handler, not a tracking milestone.
5. **Example plan requires a per-item `price` this contract does not have.** tracking-plan.md
   `"items": { "array": { "item_id": "string", "price": "number", "quantity": "number" } }`. Wrote
   `tracking-plan.json` from the contract (`item_id`, `quantity` only). The plan format also has no
   slot for scenario literals; "Add scenario-specific expected values after schema checks" leaves
   `method: "password"` and `currency: "EUR"` unversioned. I added an `expected` key that
   `validateEvent` ignores and the tests read.
6. **`import plan from './tracking-plan.json';`** (tracking-plan.md "Use both schema and scenario
   assertions"): under Node 26 ESM a JSON import needs `with { type: 'json' }`; unsure whether
   Playwright 1.62's loader honours it in `.mjs`, I replaced it with a `readFileSync` loader
   (`helpers/plan.mjs`) without trying it. Unverified either way.
7. **"Gate can fail" verification is not reachable here.** SKILL.md 329-330: "its trace (`--trace on`)
   shows the captured `/g/collect` request" and "rename a required param in a branch (e.g. `value` →
   `amount` in the app) and re-run". No beacon; fixture edits out of scope. Substituted with
   `selfcheck-validator.mjs` and the scratch broken page (`page.goto('data:text/html,...')`) through
   the same observer and assertions, both recorded in `execution.log`.
8. **`.agents/qa-project-context.md`** (SKILL.md 42) exists but is the unfilled template; it answered
   no discovery question. The contract file served as project context.

## What could not be verified

- That any tracking data leaves the browser: there is no beacon in this application; the push is the
  contract's observable and the only one.
- The gate failing against a deliberately broken Shop (no fixture edits) and CI gating (no workflow
  changes; the repository's Actions-minutes rule).
- Whether the recipe's TypeScript helper and bare JSON import run under Playwright's transform.
- Ordering is proven from the server-assigned id in the push and DOM state at push time, not from a
  network timeline; "before the orders list refreshes" rests on the list still showing its pre-order
  rows when the push is recorded.
- Arrival of the password-reset mail is not asserted (the test only cleans it up); inbox behaviour is
  email-testing's concern, not the tracking plan's.

## Post-authoring edit for the fault matrix

The orchestrator wrapped one assertion in `purchase-events.spec.mjs` in
`oracle('c3-analytics-currency', 'toEqual', …)` from the lab's `support/oracle.mjs`: the
comparison of the pushed purchase against `expectedPurchase(apiOrder)`, the order read back
through the public API. Under the Shop fault `wrong_currency_event` (the purchase event
reports a hard-coded `USD` while the order is in EUR) this derived comparison is the first
assertion to fail, before the scenario literal `expect(pushed.ecommerce.currency).toBe('EUR')`
is reached; the first attempt wrapped the literal and the matrix reported the fault as a
candidate only, because the designated assertion was never executed. The matrix cases
`c3-analytics-healthy` and `c3-analytics-currency` were added to `run-matrix.mjs`. No other
assertion, helper or expectation changed.
