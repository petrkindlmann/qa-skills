# Test-data layer for the Shop

Factories, ledger and isolation rules for `tests/workflows/generated/campaign3/test-data-management/`.
Plain `.mjs`, no dependencies beyond `@playwright/test` and `node:crypto`.

## Layout

| File | Role |
|---|---|
| `factories/prng.mjs` | `hashSeed(text)` (FNV-1a), `createPrng(seed)` (mulberry32: `int`, `pick`, `hex`, `fork(label)`), `createSequence()` |
| `factories/catalogue.mjs` | Static reference fixture: SKUs, unit amounts, quantity bounds. `catalogueView()` for the drift check against `GET /api/catalog` |
| `factories/order.factory.mjs` | `orderFactory` and the `ITEMS` presets |
| `factories/payment.factory.mjs` | `paymentEventFactory`, `signBody(body, secret)` |
| `factories/reset.factory.mjs` | `resetFactory` |
| `factories/index.mjs` | `createFactories({ scope, seed, secret })`, `sanitiseScope()` |
| `support/ledger.mjs` | `Ledger`, `orderView(order)`, `reconcileState(state, scopesOrLedgers, { exclusive })` |
| `support/scope.mjs` | `openScope({ app, mailpit, user, name, seed })`: the only way tests write to the Shop |
| `support/test.mjs` | `test.extend` with the `scopes` fixture; attaches every ledger to the test result |
| `test-data.spec.mjs` | Seven tests that use nothing but the factories and the scope |

## Factory API

```js
const f = createFactories({ scope: 'order-roundtrip' });          // seed = hashSeed(scope)
const f = createFactories({ scope: 'order-roundtrip', seed: 7 }); // pinned seed
```

`scope` is sanitised to the Shop's idempotency-key alphabet (`[A-Za-z0-9._:-]`, at most 80 chars)
and prefixes every key and event id. Same scope and seed give the same data on every run;
a different scope gives different data. Each factory draws from its own forked PRNG stream,
so adding a call in one factory never shifts another factory's values.

### Orders

```js
const built = f.order.build();                                   // deterministic 1-2 lines, qty 1..10
const built = f.order.build({ items: ITEMS.contractExample });   // override items -> amount 4200
const built = f.order.build({ idempotencyKey: 'x.pinned', currency: 'USD' });
const list  = f.order.buildList(3, overrides);
```

`build()` returns `{ sequence, idempotencyKey, payload, expected }`:

- `payload` is the exact `POST /api/orders` body: `{ currency, items }`.
- `expected` is the promise: `{ currency, amount, items, status: 'pending', fulfillment_count: 0 }`,
  with `amount` computed from the catalogue fixture and `items` canonicalised (sorted by SKU,
  which is how the Shop hands them back). An invalid build (unknown SKU, quantity outside
  1..10, duplicate SKU, empty items, non-EUR) gets `expected = { rejected: 'invalid_order' }`.
- Keys are `<scope>.order-<n>` with a per-factory sequence.

Variants of an already-built order keep its key:

- `f.order.permuted(built)`: same intent, items reversed. The Shop must replay (200, `replayed: true`).
- `f.order.conflicting(built)`: first quantity changed. The Shop must answer 409 `idempotency_conflict`.

Presets in `ITEMS`: `contractExample` (4200), `singleTea` (1200), `maxQuantity` (18000),
`unknownSku`, `tooMany` (the last two are rejected builds).

### Payment events

```js
const signed = f.payment.build({ order });                                   // order: { id, currency, amount }
const signed = f.payment.build({ order, overrides: { amount: order.amount + 1 } }); // valid signature, mismatched data -> 422
```

Returns `{ sequence, event, body, signature, headers, expected }`. `body` is the string that was
signed; `headers` carries `content-type: application/json` and `X-Test-Payment-Signature`.
Send `body` as a string. Re-serialising the event would change the bytes and break the signature.
Event ids are `evt-<scope>-<n>`.

Broken variants, each with `expected: { rejected: 'invalid_signature' }`:

- `f.payment.tampered(signed, patch?)`: data changed after signing, stale signature kept (default patch: amount + 1).
- `f.payment.resigned(signed, otherSecret)`: same bytes, signature from the wrong secret.
- `f.payment.unsigned(signed)`: same bytes, no signature header.

### Reset flow

```js
const built = f.reset.build({ user: app.users.bob });          // email from app.users, never typed
const short = f.reset.tooShort(built);                          // 11-character password
```

Returns `{ sequence, userId, email, currentPassword, newPassword, subject, linkPattern, expected }`.
`newPassword` is `Reset-<n>-<12 hex>!` (21 chars) from the seeded stream.

## Scope and ledger

```js
const alice = await scopes.open({ app, mailpit, user: app.users.alice, name: 'order-roundtrip' });
await alice.login();
const created = await alice.createOrder(alice.factories.order.build()); // -> { status, order, replayed }
await alice.pay(alice.factories.payment.build({ order: created.order }));
await alice.requestReset(built); const { token } = await alice.readResetEmail(built); await alice.confirmReset(built, token);
await alice.visibleOrders();   // orders in the Shop's list that this ledger created
await alice.foreignOrders();   // orders in the list this ledger did not create
await alice.state();           // /test-support/state
```

A scope owns one user, one factory set, one ledger and one HTTP context (own cookie jar), so
several scopes can act concurrently inside one test as different or the same user.

The ledger records what the Shop confirmed, keyed by the response, never by assumption:

| Entry | Written when |
|---|---|
| `order` | 201 from `POST /api/orders`; carries id, key and the factory promise |
| `replay` | 200 with `replayed: true` |
| `rejected-order` | any other answer, with status and error |
| `receipt` (+ order marked paid) | 200 `received` and not duplicate |
| `duplicate-receipt`, `rejected-payment` | 200 duplicate; any rejection |
| `reset-request`, `reset-email`, `sessions-cleared` | 202; message consumed from Mailpit; 200 on confirm (also flips the request to consumed) |
| `login`, `logout` | 200 / 204 |

`reconcileState(state, [aliceScope, bobScope])` compares `/test-support/state` with the ledgers:
orders by id and full ORDER shape, receipts by event id, reset tokens by per-user consumed
flags, sessions by login count. With `exclusive: true` (default; the Shop belongs to this test)
anything in the state the ledgers do not explain is reported; with `exclusive: false` (a shared
Shop) only the ledgers' own records are checked. The `scopes` fixture attaches every ledger
as `ledger-<scope>.json` to the Playwright result, so a run leaves a record of what it created.

## Isolation rules (an application with no deletion)

1. **A test owns a scope, never the Shop.** Everything a test creates goes through a scope it
   opened with a name unique in the suite. The harness gives each test a fresh Shop; the rules
   below are what keep the suite correct when that is not the case.
2. **Ownership is the ledger.** "My orders" means `ledger.orderIds()`, not `GET /api/orders`.
   Assertions on lists go through `visibleOrders()`; a count on the raw list is only valid when
   the test also asserts `foreignOrders()` is empty, which it may do only on a Shop it owns.
3. **Keys and ids are namespaced by scope.** Idempotency keys `<scope>.order-<n>` and event ids
   `evt-<scope>-<n>` cannot collide across scopes, so two scopes may use the same user and the
   same sequence numbers. (The Shop scopes keys per user as well; the prefix is what protects
   two tests sharing a user.)
4. **Users partition reads; scopes partition writes.** Bob cannot read Alice's orders (404,
   indistinguishable from an unknown id). Two scopes on the same user see each other's orders
   in the raw list, which is why rule 2 exists.
5. **Expectations come from the factory, never from the Shop.** The promise is computed before
   the request; the read-back is compared with it. Reading first and asserting equality later
   proves nothing.
6. **No cleanup, so reconcile instead.** Nothing is deleted. The test proves the durable state
   equals baseline (two seeded users, nothing else) plus the ledger, and does so again after a
   process restart. On a shared Shop use `exclusive: false` and accept that the baseline grows.
7. **Inbox scope is the address.** Mailpit searches are `to:"<built.email>"`, the address comes
   from `app.users`, and a scope consumes each message id once. One reset scope per user per
   Shop; two scopes resetting the same user would compete for the same inbox.
8. **Determinism stops at the server.** Payloads, keys, event ids, signatures and passwords are
   deterministic. Order ids are server-generated UUIDs; the ledger captures them and tests use
   `expect.any(String)` for the id.

## What the seven tests prove

1. Catalogue fixture equals the served catalogue; a default build and an overridden build are
   accepted (201) and read back equal to the promise; the scoped list is exactly the ledger.
2. Same scope and seed build identical orders, payment envelopes and reset data; another scope
   or seed differs; overrides change only what they name; invalid builds are flagged; scope names
   are sanitised.
3. Three scopes (alice, bob, alice) create concurrently on one Shop: six distinct keys and ids;
   bob's list is exactly bob's ledger; cross-user reads are 404; same-user scopes leak in the
   raw list and not in the scoped view.
4. Replay returns the same order (200, `replayed: true`), a permutation replays, a changed
   intent is 409, a burst of three equivalent submissions yields one 201 and two replays.
5. Tampered, re-signed and unsigned envelopes are 401 and leave no receipt and no status
   change; a validly signed mismatched amount is 422; the signed envelope is 200 and the order
   becomes paid with `fulfillment_count: 1`; a duplicate is `duplicate: true` with no second
   fulfillment; receipts in state equal the ledger.
6. State reconciled against two ledgers is clean (and reconciling against one of them reports
   the other's order and receipt as unexplained); after `app.restart()` the orders are the same
   rows and the reconciliation is still clean, including sessions; the public read matches.
7. Reset data drives a real SMTP message to the namespaced address, the token from the text
   part confirms the new password, old sessions and old password fail, the token is single-use,
   and state's reset token is consumed.

## Known gaps

- `reset.tooShort()` is built but not exercised against the Shop: the contract does not say
  which error a short password returns or whether a failed confirm consumes the token.
- Token expiry through `scope.advanceClock(301)` is wired but not exercised.
- The `--fail-fulfillment-once` 503 path (receipt and fulfillment as one transaction) is not
  exercised through the factory; `app.restart({ failFulfillmentOnce: true })` is available.
- `reconcileState(..., { exclusive: false })` is written for a shared Shop but every test here
  owns its Shop, so only exclusive mode has run.
- The suite is API-level (Playwright request contexts). The factories do not drive the browser
  forms; the checkout page's dataLayer events are outside this layer.
- Order ids are not deterministic (server UUIDs). Snapshot-style assertions on ids are not possible.
- Randomised test order: Playwright 1.62.1 has no `--shuffle`; parallelism (`--workers 2`,
  `fullyParallel`) was the only ordering independence exercised.
- The skill's `faker`/`fishery` stack is not installed and no dependency could be added; the
  PRNG here is a 32-bit mulberry32, adequate for SKUs and quantities, not for realistic names
  or addresses the Shop does not need.
