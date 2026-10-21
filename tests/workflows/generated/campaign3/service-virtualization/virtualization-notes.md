# Virtualizing the Shop's JSON API for the storefront page

Skill applied: `skills/service-virtualization` (SKILL.md v2.0, `references/msw.md`,
`references/record-replay.md`, `references/ci.md`, the drift seam in `references/wiremock.md`).
Target: the single-page storefront at `/` and the `/api/*` endpoints it calls, as specified by
`tests/workflows/fixture-app-contract.md`. Candidate build: commit `fff3118` plus an
uncommitted 4-line edit to `tests/workflows/fixture-app/` by another worker in this checkout
(made 20:38 local, before the recording and all runs; not read here). Playwright 1.62.1,
Chromium bundled, macOS. Every test starts its own real Shop through `support/fixtures.mjs`.

## The recipe, as used

1. **Record first.** `record.mjs` starts a real Mailpit and a real Shop and drives the request
   script in `scenario.mjs` through a Playwright `APIRequestContext` (its cookie jar carries the
   `shop_session` cookie between steps). Each step becomes one cassette in `recordings/`:
   `{ name, recordedAt, build, request: { method, path, headers, body }, response: { status,
   headers (content-type, retry-after, set-cookie with the value redacted), body } }`. This is
   the cassette shape from `record-replay.md`, one file per interaction instead of one
   multi-step file, so a stub can name the exact response it is derived from. Fifteen cassettes
   cover `/health`, the catalogue, `/api/me` signed out and in, login 200/401/429, order
   creation 201/200-replayed/409/400, the list, one order, a 404 and logout 204. The 429 is a
   real one: five failed attempts for bob, then the sixth with the right password.

   Re-record with
   `QA_RECORD_WORKDIR=/some/scratch/dir node tests/workflows/generated/campaign3/service-virtualization/record.mjs`
   from the repository root.

2. **One layer between tests and tool** (SKILL.md principle 5): `virtual-api.mjs`. It is built
   on `page.route`, not MSW, because the page is driven in a real browser and MSW's browser
   mode needs `mockServiceWorker.js` served from the application origin, which the Shop does not
   serve and the task forbids adding. The layer keeps the three ideas the MSW recipe rests on:
   - a **guard**: registered first, so Playwright (reverse registration order) tries it last; any
     `/api/*` request no stub or passthrough claimed is aborted (`route.abort('failed')`, the
     page sees `Failed to fetch`) and appended to `log.unhandled`. This is the `page.route`
     counterpart of `onUnhandledRequest: "error"`;
   - **explicit passthrough** per `METHOD /path`, so each test states which calls may reach the
     real Shop (`log.passed` records them);
   - **stubs** registered last so an opt-in error shadows the success path (anti-pattern 8), with
     `once` to step aside after one answer so the same test can watch the recovery; and `hold`,
     which parks a real request at the proxy until the test calls `release()`, for the slow
     dependency without sleeping on wall-clock time.

3. **Every stub is derived from a cassette** (`fulfillFrom(recording, overrides)` in
   `virtual-api.mjs`, `scenarios` table):

   | Scenario | Derived from | What changed |
   |---|---|---|
   | 500 on `POST /api/orders` | `orders-create-invalid` (400) | status 500, `error: "internal_error"`; the `{ error: string }` envelope is the contract's |
   | 500 on `GET /api/orders` | same | same |
   | 429 on `POST /api/login` | `login-throttled` | nothing; a real 429 with `Retry-After: 60` |
   | malformed 200 on `POST /api/login` | `login-ok` | the JSON text cut in half |
   | empty catalogue | `catalog` | `products: []` |
   | fully virtualized load | `catalog`, `me-unauthenticated` | nothing |
   | slow `GET /api/orders` | the live response, held | timing only |

4. **Freshness.** `loadRecording()` runs the 30-day `assertFresh()` from `record-replay.md`
   on every load, so stubs and the fidelity check both refuse a stale cassette. The cassettes
   were recorded on 2026-10-21; from 2026-11-21 the suite fails until re-recorded. That is the
   skill's rule applied as written; see the trade-off below.

## Tests (`virtualized-ui.spec.mjs`, 7 page tests)

1. 500 on order creation: `internal_error` is shown, the button re-enables, no `purchase`
   event, the live Shop has no order; the retry reuses the same `Idempotency-Key` (captured at
   the stub and on the wire) and creates exactly one order, one `purchase` event.
2. 429 on login: `too_many_attempts` shown, sign-in form kept, account hidden, no `login`
   event, `/api/me` (unrouted) is 401; the next submit reaches the real Shop and signs in.
3. Slow `/api/orders`: while the list is held the account section is visible but the page does
   not say `Signed in.`; after release it does. Two overlapping refreshes held together leave
   exactly one order row (no duplication, stale list kept meanwhile). Four real list requests
   accounted for.
4. Malformed JSON on a 200 login: the notice carries the parser's message (contains `JSON`), the
   form stays, no `login` event; the next submit signs in.
5. Empty catalogue: no product rows, `Cart total: EUR 0.00`, button disabled signed out. Signed
   in, the page enables the button; the attempt must end in a visible error and zero live
   orders (it does: the real Shop answers 400 `invalid_order`). The branch taken is recorded as a
   test annotation.
6. 500 on the orders list right after sign-in: error shown, session real (`/api/me` 200), list
   empty; `Refresh orders` recovers through the real Shop.
7. Fully virtualized load: the page renders the recorded catalogue with no call reaching the
   Shop; a deliberately unstubbed `POST /api/password-reset/request` is aborted, shown as
   `Failed to fetch`, and is the only entry in `log.unhandled` (the guard proof SKILL.md asks for).

## The fidelity check (`stub-fidelity.spec.mjs`)

Rule: for every cassette, replay its request (same `scenario.mjs` steps, same order, fresh live
Shop, Playwright `request` fixture, no `page.route` anywhere) and compare
`responseShape(recorded)` with `responseShape(live)`:

- `status` equal;
- media type of `content-type` equal;
- presence of `Retry-After` and of `Set-Cookie` equal;
- the body's type signature equal: field names and primitive types at every depth, arrays
  described by their first element (`empty` when none), a non-JSON body as `unparsable`.
  Values are never compared (ids, emails, amounts, timestamps differ per instance).

Every difference is reported by path (`body.order.amount: "number" -> "string"`,
`body.replayed: missing in live response`, `status: 201 -> 200`) through `expect.soft`, so one
run lists all drift. The test also requires that every cassette on disk was replayed and that
the cassette's method and literal path match the step that produced it.

Proven both ways: the comparator unit test feeds it a dropped field, a retyped field, a changed
status, an emptied array, an added field and an HTML body; and a disk-level simulation (mutate
`catalog.json`, run only the fidelity test, restore) failed with
`body.products[0].unit_amount: "string" -> "number"` and `body.version: missing in live response`.
The freshness gate is exercised with a 29-day and a 31-day stamp.

## What the stubs cannot tell you

- Whether the real Shop ever produces these responses. It never answers 500 or a malformed
  body, and an empty catalogue is impossible with its fixed products. The stubs test the page's
  handling, not the server's behaviour; the fidelity check only proves the *recorded* responses
  still match.
- Anything the comparator ignores: values, extra headers, timing, cookie attributes, response
  ordering within arrays beyond the first element, and error *semantics* (a 400 with the right
  envelope but a new error code passes).
- Zero egress. The guard aborts what it sees and logs it; a green suite is not network evidence
  (SKILL.md, Verification). Non-`/api` requests (the page itself) always reach the real Shop.
- Server-side idempotency. In test 1 the stubbed 500 never reached the Shop, so the retry
  creates the first order regardless; the assertion is that the page reuses the key, which is
  what protects it when a real 500 followed a committed order. The contract's replay behaviour
  itself is covered by the recorded `orders-create-replayed` cassette and the fidelity check.
- The 30-day rule is weaker here than the live comparison: a cassette that passes fidelity today
  is not stale whatever its date. It is kept because the page tests can run without the
  fidelity spec (`--grep`), and because the skill mandates it.

## Observations about the page (not contract violations)

- Errors are shown as raw codes (`internal_error`, `invalid_order`, `too_many_attempts`); the
  429's `Retry-After` is not surfaced.
- `Place order` is enabled when the cart cannot hold anything; only the server's 400 stops it.
- A successful `Refresh orders` does not clear a previous error notice.
- There is no loading state while `/api/orders` is pending; the previous list stays on screen.
