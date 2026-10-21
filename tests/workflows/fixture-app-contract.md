# Shop workflow application contract

This is a local, synthetic application for executing QA workflows. It uses actual
HTTP, browser forms, SQLite transactions and SMTP delivery to a local Mailpit process.
Its payment endpoint is a fixture protocol, not a Stripe or other PSP integration.

## Start and isolate

```bash
python tests/workflows/fixture-app/server.py --port 0 --db /tmp/shop-case.sqlite \
  --ready-file /tmp/shop-ready.json --smtp-port 1025 --test-mode
```

The ready JSON contains `base_url`, `pid` and `seeded_users` (an array of `{id,email}`).
Bindings are loopback only. Use a fresh
database per independent scenario. Reuse that database when checking persistence
across a process restart. `SIGTERM` and `SIGINT` stop the server cleanly. No route
requires external network access. Startup flag `--fail-fulfillment-once` simulates
one transient fulfillment error after a valid payment event is accepted for handling.
It is a test-environment configuration, not a request parameter.

Seeded users:

| User ID | Email | Password |
|---|---|---|
| `alice` | `alice@example.test` | `Alice-secret-123!` |
| `bob` | `bob@example.test` | `Bob-secret-456!` |

For parallel inbox isolation, use `--email-suffix RUN_ID`, where RUN_ID has 1–64 ASCII
letters, digits, underscores or hyphens. The addresses become
`alice+run_id@example.test` and `bob+run_id@example.test`; passwords do not change.
Read the actual addresses from `seeded_users`. Use the same suffix and database on
restart; existing account addresses are retained. Inbox cleanup must be scoped to
the scenario's addresses/messages.

## Public and account endpoints

- `GET /health`: 200 `{ "status": "ok", "build": "shop-lab-v1" }`.
- `GET /api/catalog`: 200 `{ "currency": "EUR", "products": [...] }`.
  `TEA-50` costs **1200** minor units and `CUP-01` costs **1800** minor units.
  Prices are server owned. Quantity is an integer from 1 through 10 inclusive.
- `POST /api/login`: JSON `{ "email": "...", "password": "..." }`. Valid credentials
  return 200 `{ "user": { "id": "alice", "email": "alice@example.test" } }` and a
  `shop_session` cookie with `HttpOnly`, `SameSite=Lax` and `Path=/`. Invalid credentials
  return 401 `{ "error": "invalid_credentials" }`. The fixture runs over local HTTP,
  so it intentionally does not set `Secure`.
- Failed sign-ins are throttled per email address. After **5** failures within
  **60 seconds** every further attempt for that address, including one with the correct
  password, returns 429 `{ "error": "too_many_attempts" }` with `Retry-After: 60` and
  creates no session. Unknown addresses throttle identically. The counter clears after a
  successful sign-in or once the window passes; use the test clock rather than sleeping.
- `GET /api/me`: 200 with the same user shape when signed in; otherwise 401
  `{ "error": "unauthenticated" }`.
- `POST /api/logout`: invalidates the current session and returns 204.

## Orders and idempotency

`POST /api/orders` requires a session and an `Idempotency-Key` header. The key must
contain 1–128 ASCII letters, digits, dots, underscores, colons or hyphens.

```json
{"currency":"EUR","items":[{"sku":"TEA-50","quantity":2},{"sku":"CUP-01","quantity":1}]}
```

The result is 201 `{ "order": ORDER, "replayed": false }`. `ORDER` has `id`, `user_id`,
`currency`, `amount`, `items`, `status` and `fulfillment_count`. The amount for the
example is **4200**. A new order is `pending` with `fulfillment_count: 0`.

Optional client `amount` is ignored: the server always recalculates from its catalog.
Unknown SKUs, duplicate SKUs, noninteger/out-of-range quantities, empty items or a
currency other than EUR return 400 `{ "error": "invalid_order" }` without an order.

Reusing a key with equivalent items and currency returns 200, the original order and
`replayed: true`. Item order does not change intent. Reusing a key for a different
quantity, SKU or currency returns 409 `{ "error": "idempotency_conflict" }`. The
currency conflict is checked against an existing key before a new order's currency
validation. Keys belong to the signed-in user. Parallel equivalent submissions must
create one order; different users may independently use the same key.

`GET /api/orders` returns 200 `{ "orders": [ORDER, ...] }` for the current user only.
`GET /api/orders/ID` returns 200 `{ "order": ORDER }` only to its owner. Both unknown
IDs and another user's IDs return exactly 404 `{ "error": "not_found" }`.
All order endpoints return 401 without a valid session.

## Signed local payment events

`POST /api/webhooks/payment` accepts exact JSON request bytes such as:

```json
{"id":"evt-case-1","type":"payment.succeeded","data":{"order_id":"ORDER_ID","currency":"EUR","amount":4200}}
```

Set `X-Test-Payment-Signature` to `sha256=` followed by the hexadecimal HMAC-SHA256
of the exact body bytes, using the synthetic fixture secret `local-payment-secret`.
Missing or incorrect signatures return 401 `{ "error": "invalid_signature" }` and
must not record a receipt or fulfill an order. A malformed event returns 400. Unknown
orders return 404; a mismatched amount or currency returns 422
`{ "error": "payment_mismatch" }`.

A valid event returns 200 `{ "received": true, "duplicate": false, "order_id": ID }`.
The order becomes `paid` with `fulfillment_count: 1`. A repeated event ID and identical
body returns 200 with `duplicate: true`. A repeated event ID with different body
returns 409 `{ "error": "event_conflict" }`. Neither repeats nor distinct successful
payment events for an already-paid order may fulfill it a second time.

Receipt and fulfillment are one durable transaction. The injected transient failure
returns 503 `{ "error": "fulfillment_unavailable" }`; the order remains pending and
there is no committed receipt. Retrying the same event succeeds. These invariants
must also hold for concurrent deliveries and after process restart.

## Password reset and actual inbox use

`POST /api/password-reset/request` takes `{ "email": "..." }` and always responds
202 `{ "message": "If this account exists, a reset email has been sent." }` for a
syntactically valid email, whether or not an account exists, and whether or not the
SMTP service is reachable (a delivery failure only increments the `smtp_errors`
counter). Unknown accounts do not receive mail. Known accounts receive a real SMTP message addressed to that account,
with subject `Reset your Shop password`, plaintext and HTML alternatives, and a link
to this application's `/reset-password?token=...` page. Consume the message through
Mailpit's own API or UI. Do not infer the token from application state.

`POST /api/password-reset/confirm` takes `{ "token": "...", "password": "..." }`.
A password must have at least 12 characters. A valid reset returns 200
`{ "reset": true }`, changes the password, consumes the token and invalidates all
existing sessions for that user. Old credentials must fail; new credentials must work.
Tokens expire after **300 seconds** and are single use. Invalid, expired and consumed
tokens return 400 `{ "error": "invalid_or_expired_token" }`.

## Browser journeys

`GET /` serves labelled login, catalog/cart, order and password-reset-request controls.
The checkout shows the server's order ID, amount and payment state. Reloading while
signed in restores the user and their orders. Logout removes access. A reset link
opens a labelled new-password form; submission reports success or the server error.
Normal browser journeys need no application-source edits or request interception.

## Explicit test support

These routes exist only with `--test-mode` and require
`X-Test-Admin-Key: local-test-admin`; a missing or wrong key returns 403
`{ "error": "forbidden" }`:

- `GET /test-support/state`: returns current fixture `now`, `orders`, `receipts`,
  `reset_tokens` (only user, expiry and consumed state; never raw tokens),
  `sessions` (count per user), and `smtp_errors` (count).
- `POST /test-support/clock`: `{ "advance_seconds": 301 }` advances the fixture clock
  by a nonnegative integer, enabling deterministic expiry assertions without sleeps.

Test support supplies an independent durable-state observation; assertions should
still exercise and inspect the public requests or browser actions under test.
There is no endpoint that enables application defects or asks the server to mark a
test as passing. Each scenario should own its database and inbox messages.
