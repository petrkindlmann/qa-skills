# Reproduction notes — two support reports against the Shop

Build under test: `201d1d41d17d7229c84e94319d1c83ce3bac20bc` (main), `GET /health` build `shop-lab-v1`.
Environment: macOS Darwin 27.0.0, Node v26.0.0, Python 3.14.6, Playwright 1.62.1, bundled Chromium
(browser path) and Playwright `request` contexts (HTTP path). Fresh SQLite database and namespaced
seeded users per test (`app` fixture), real Mailpit per worker (unused by these flows, no mail sent).

Neither report reproduces on this build. Each one is classified per SKILL.md Step 7 as
**not reproducible on 201d1d4 under matched conditions**, with the evidence below, and each
carries a regression test that is green now and goes red if the reported behavior appears.

---

## Report 1 — sign-out does not revoke a copied session cookie

> "After I click Sign out in the browser, a colleague who had copied my session cookie earlier
> can still load /api/me and my orders. Expected: signing out revokes the session everywhere,
> not just in my browser."

### Contract clause

- Public and account endpoints: "`POST /api/logout`: invalidates the current session and returns 204."
- Orders: "All order endpoints return 401 without a valid session."
- Browser journeys: "Logout removes access."

### Repro spec (Step 1 intake)

| Dimension | Value |
|---|---|
| Build / commit | reporter: unknown. Tested: `201d1d4` |
| Environment | reporter: "the browser", unspecified. Tested: Chromium (Playwright) for the page, HTTP client for the colleague |
| Input data | reporter: own account, "my orders". Tested: seeded `alice`, one order placed via the page (TEA-50 x1, 1200) and one via the copied cookie |
| Steps | sign in on `/`, colleague copies `shop_session`, click **Sign out**, colleague calls `/api/me` and `/api/orders` |
| Expected | 401 `{"error":"unauthenticated"}` on `/api/me`, `/api/orders`, `/api/orders/ID` for the copy |
| Actual (reported) | 200 on `/api/me` and the orders |
| Actual (observed) | 401 on all three, in 1 HTTP probe, 2 suite runs and 10 repeats of 2 tests (see execution.log) |
| Frequency | reporter: implied every time. Observed: 0 of 22 attempts |
| Locale / timezone | not relevant to this flow |
| Timestamp / logs | none supplied |

Missing from the report and worth asking: the build they were on; whether the "copy" was the raw
cookie value or an exported browser profile; whether the page showed "Signed out." (the shipped page
only shows it after `POST /api/logout` returned, and on a failed request it shows the error and stays
signed in).

### Minimal reproduction (Step 2 outcome)

The browser's **Sign out** button does nothing more than `POST /api/logout` (page script), so the
smallest discriminating sequence is four HTTP calls. The order is not needed to discriminate: `/api/me`
alone flips 200 to 401. It stays in the regression test because the report names orders.

```sh
BASE=http://127.0.0.1:PORT        # from the ready file; EMAIL from seeded_users
TOKEN=$(curl -si -X POST $BASE/api/login -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Alice-secret-123!\"}" | sed -n 's/^[Ss]et-[Cc]ookie: shop_session=\([^;]*\).*/\1/p')
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/me -H "cookie: shop_session=$TOKEN"                   # 200  (copy is live)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/logout -H "cookie: shop_session=$TOKEN"       # 204
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/me -H "cookie: shop_session=$TOKEN"                   # expected 401 — observed 401
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/orders -H "cookie: shop_session=$TOKEN"               # expected 401 — observed 401
```

Observed vs expected: identical on this build (401/401). Reported: 200/200.

### Regression tests (report-1-session-revocation.spec.mjs)

1. `browser Sign out revokes a session cookie copied by someone else` — the literal reported path:
   sign in on the page, place an order, copy the browser's `shop_session` (asserted HttpOnly,
   SameSite=Lax, Path=/), prove the copy is live (200 on `/api/me`, lists 1 order), click Sign out,
   then 401 on `/api/me`, `/api/orders`, `/api/orders/ID` for the copy; the browser itself is 401 and
   stays signed out across a reload.
2. `POST /api/logout invalidates the session for every holder of the cookie` — the isolated HTTP
   form: the copy can even place an order before logout; after logout the owner and the copy are both
   401; control: a fresh sign-in works, sees the order, and does not resurrect the old cookie (the
   test would also catch a session store keyed by user instead of by token).

Determinism: no clock, RNG or third-party call in the flow; waits are Playwright auto-waits on
`expect(locator)`; the fixture starts a fresh Shop per test. 10 of 10 repeats green for both tests.

### Severity and status

- If confirmed on any build: **Critical / S1 (security)**. A session the user believes revoked
  remains valid; sign-out is the only user-side mitigation for a leaked cookie.
- On `201d1d4`: not reproducible. Status: *cannot reproduce — regression guard in place; needs
  build + client details from the reporter*.

---

## Report 2 — same Idempotency-Key, different basket, accepted instead of 409

> "Posting the same order twice with the same Idempotency-Key but a different basket gave me 200
> and a second order instead of a conflict."

### Contract clause

- Orders and idempotency: "Reusing a key for a different quantity, SKU or currency returns 409
  `{ "error": "idempotency_conflict" }`." Also: "Reusing a key with equivalent items and currency
  returns 200, the original order and `replayed: true`. Item order does not change intent." and
  "Keys belong to the signed-in user ... different users may independently use the same key."

### Repro spec (Step 1 intake)

| Dimension | Value |
|---|---|
| Build / commit | reporter: unknown. Tested: `201d1d4` |
| Environment | reporter: unspecified client. Not the shipped page: it mints a fresh `crypto.randomUUID()` key per attempt and clears it on any quantity change, so "same key, different basket" is only possible from an API client. Tested: HTTP client |
| Input data | reporter: "a different basket". Tested: contract example basket (TEA-50 x2 + CUP-01 x1 = 4200), then quantity 3 for TEA-50; also SKU dropped and currency USD |
| Steps | sign in, `POST /api/orders` with key K and basket A, `POST /api/orders` with key K and basket B, `GET /api/orders` |
| Expected | second POST 409 `{"error":"idempotency_conflict"}`, orders list holds exactly the first order |
| Actual (reported) | 200 and a second order |
| Actual (observed) | 409 and one order, in 1 HTTP probe, 2 suite runs and 10 repeats of 3 tests |
| Frequency | reporter: single occurrence implied. Observed: 0 of 32 attempts |
| Timestamp / logs | none supplied; the 200 body (was `replayed` true or false? same `id`?) would have settled a lot |

### Minimal reproduction (Step 2 outcome)

Started from the discovery sequence (quantity change, reorder, currency change) and cut to two POSTs
and one GET; the reorder and currency/SKU cases are breadth and live in separate tests.

```sh
H=(-H "cookie: shop_session=$TOKEN" -H 'content-type: application/json' -H 'Idempotency-Key: k1')
curl -s -w '\n%{http_code}\n' -X POST $BASE/api/orders "${H[@]}" \
  -d '{"currency":"EUR","items":[{"sku":"TEA-50","quantity":2},{"sku":"CUP-01","quantity":1}]}'   # 201, amount 4200
curl -s -w '\n%{http_code}\n' -X POST $BASE/api/orders "${H[@]}" \
  -d '{"currency":"EUR","items":[{"sku":"TEA-50","quantity":3},{"sku":"CUP-01","quantity":1}]}'   # expected 409 idempotency_conflict — observed 409
curl -s $BASE/api/orders -H "cookie: shop_session=$TOKEN"                                          # expected 1 order — observed 1
```

Observed vs expected: identical on this build. Reported: 200 plus a second order.

### Regression tests (report-2-idempotency-conflict.spec.mjs)

1. `reusing an Idempotency-Key with a different quantity returns 409 and creates no order` — the
   reporter's exact move, then the list holds only the original (same id, amount, items); control:
   an equivalent reordered basket still replays with 200 `replayed: true` and the same order, so a
   fix that over-corrects into "every reuse conflicts" is also caught.
2. `a changed SKU set or currency under a used key also conflicts` — the other two intent
   dimensions the clause names; USD on a used key must be 409, not 400 (the contract orders the
   checks that way).
3. `keys are scoped to the signed-in user, so a conflict is not a global lock on the key` — bob
   may reuse alice's key with a different basket and gets his own 201; each sees one order; alice's
   key still replays alice's order; bob gets 404 on alice's order id.

Determinism: fixed literal keys, server-owned prices, no time dependence; fresh Shop per test.
10 of 10 repeats green for all three.

### Severity and status

- If confirmed: **High / S2 (money and data integrity)**. A client retry after editing the basket
  produces a duplicate order and, once paid, a duplicate fulfillment path; the idempotency contract
  exists precisely to prevent that.
- On `201d1d4`: not reproducible. Status: *cannot reproduce — regression guard in place; ask for the
  client used, the exact two bodies, and the second response body*.

---

## Triage summary

| Report | Clause | If real | On 201d1d4 | Tests | Evidence |
|---|---|---|---|---|---|
| 1 sign-out revocation | `POST /api/logout` invalidates the current session; order endpoints 401 without a valid session; "Logout removes access" | Critical, security | not reproducible, 0/22 | 2 (browser + HTTP) | execution.log §2, §6, §8 |
| 2 idempotency conflict | reuse with different quantity/SKU/currency returns 409 `idempotency_conflict` | High, money | not reproducible, 0/32 | 3 (HTTP) | execution.log §2, §6, §8 |

Oracle sensitivity: both oracles (`expectSessionRevoked`, `expectIdempotencyConflict`) were run
against a throwaway stub that behaves exactly as the reports describe, and both failed there
(`oracle-sensitivity.mjs`, execution.log §7). That is the closest available substitute for the
skill's "watch it go red first" on an application that has no such defect.

What is still open: the reporters' build, client and response bodies. If a build is named that is
older than `201d1d4`, the two spec files are the targeted command for `git bisect run` on the
application's history; on this repository's history there is no bad commit to start from.

## Ticket write-back (Step 8 block, both reports)

```markdown
## Reproduction attempt (verified negative on 201d1d4)

**Minimal repro:** see "Minimal reproduction" above (4 HTTP calls for report 1, 3 for report 2), or
  `QA_WORKFLOW_SUITE=tests/workflows/generated/campaign3/bug-reproduction node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs`
**Environment / build:** 201d1d41d17d7229c84e94319d1c83ce3bac20bc, shop-lab-v1; macOS 27.0.0, Node 26.0.0, Playwright 1.62.1 Chromium
**Expected vs actual:** report 1: 401/401 expected, 401/401 observed (reported 200/200);
  report 2: 409 + 1 order expected, 409 + 1 order observed (reported 200 + 2 orders)
**Introducing commit:** none — not a regression on this build; bisect not applicable without a bad commit
**Regression tests:** tests/workflows/generated/campaign3/bug-reproduction/report-1-session-revocation.spec.mjs (2),
  report-2-idempotency-conflict.spec.mjs (3); green 5/5, 50/50 on --repeat-each 10; both oracles red against the defect stub
**Evidence:** execution.log in the same folder; Playwright JSON/HTML reports under the scratchpad run folders named there
**Determinism:** no clock/RNG/network dependence in either flow; fixed Idempotency-Key literals; fresh Shop + DB per test; no sleeps
```
