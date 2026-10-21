# Shop synthetic monitoring plan

Post-release probes for the Shop (`tests/workflows/fixture-app-contract.md`), designed with
`skills/synthetic-monitoring/SKILL.md`. Five probes, one critical path each, `retries: 0`,
every wall clock under 30 s. Probe bodies are in `probes.mjs`; `*.probe.spec.mjs` wires them
to the fixtures a scheduler would replace with production URLs and secrets.

## Discovery answers

`.agents/qa-project-context.md` is the unfilled template, so the contract answered the skill's
discovery questions:

| Question | Answer from the contract and the running Shop |
|---|---|
| Critical journeys | Storefront loads with the catalogue; sign-in; place an order and see it listed; password-reset email; `/health` |
| Revenue / churn paths | Order placement and sign-in. Both page on-call. |
| Silent failures | Password-reset delivery: the endpoint answers 202 even when SMTP is unreachable (only `smtp_errors` grows). Nobody reports it; the probe is the only detector. |
| Documented SLO | Only one: `/health` answers within 500 ms on a healthy service. Every other budget below is proposed from the skill's example table and the observed baselines (run 1 and run 2 numbers are in `final-response.md`). |
| Regions, CDN, caching | One loopback instance, no CDN. The multi-region rule does not apply; `/health` is served `cache-control: no-store`, and the health probe warns if that changes. |
| Third-party dependencies | SMTP (Mailpit locally). It has a status API (`/api/v1/info`) that the runbook points at. |
| Test accounts | Seeded `alice` and `bob`, addresses namespaced per instance. No `is_synthetic` flag and no analytics exclusion exist: the page pushes `dataLayer` events for probe traffic too. Mapping: `alice` = sign-in and reset probes, `bob` = order probe, so the one probe that writes data has its own account. |
| Existing monitoring | None known. Detection today would be user reports. |

## Probe table

| Probe | File | Frequency | Wall clock | Hard budget (FAIL) | Warning line (WARN) | Alert threshold | Runbook |
|---|---|---|---|---|---|---|---|
| health | `health.probe.spec.mjs` | 1 min | 5 s | 3 samples of `GET /health`, each 200 with body `{status:"ok", build:"shop-lab-v1"}` and each **≤ 500 ms** (contract) | slowest sample > 250 ms; response without `no-store` | 2 consecutive failures → page; 3 consecutive timeouts → page | `runbooks.md#health` |
| storefront | `storefront.probe.spec.mjs` | 1 min | 10 s | `GET /` 200; catalogue rows for `TEA-50` at EUR 12.00 and `CUP-01` at EUR 18.00 and one quantity control each within **3 s**; sign-in, disabled place-order and reset controls present | ready later than 1 s | 2 consecutive failures → page | `runbooks.md#storefront` |
| sign-in | `sign-in.probe.spec.mjs` | 5 min | 15 s | `POST /api/login` 200; "Signed in as <account>" and "Your orders" within **5 s**; `GET /api/me` 200 for that account; sign-out leaves `GET /api/me` 401 | submit-to-signed-in > 2 s; no `login` dataLayer event | 2 consecutive failures → page. A 429 is a failure that names throttling in its message. | `runbooks.md#sign-in` |
| order-journey | `order-journey.probe.spec.mjs` | 10 min | 20 s | sign-in; `POST /api/orders` 201 with `replayed:false`, amount 1200, `pending`, `fulfillment_count 0`, items `1 x TEA-50`; notice `Order created: <id>. Amount: EUR 12.00`; the order listed as pending; `GET /api/orders/<id>` 200; exactly one new order; click-to-listed **≤ 5 s** | click-to-listed > 2.5 s; purchase dataLayer event missing or with a wrong value/currency | 2 consecutive failures → page | `runbooks.md#order-journey` |
| password-reset-email | `password-reset-email.probe.spec.mjs` | 10 min | 20 s | `POST /api/password-reset/request` 202; a message with subject `Reset your Shop password` for exactly that recipient (no Cc/Bcc) visible in Mailpit within **10 s**; plaintext and HTML alternatives both carry `<shop>/reset-password?token=…`; captured message deleted afterwards | delivery > 2 s | 2 consecutive failures → Slack `#shop-monitoring`; 4 consecutive (40 min) → page | `runbooks.md#password-reset-email` |

Frequencies follow the skill's table (API health and homepage every minute, login every 5,
checkout and third-party integrations every 10).

## Failure semantics

- **FAIL** is a red probe: a hard assertion or the hard latency budget failed, or the probe's
  own wall clock went over its budget (`probe-result.json` records it; the budget check is
  `expect.soft` so it never hides the first error).
- **WARN** is a green probe carrying a `warning` annotation. Warnings cover the soft latency
  line, cacheability of `/health`, and the two analytics events, because none of these stops
  the user reaching the goal.
- Every result carries `probe` and `alert-route` annotations (`page-oncall` or
  `notify-monitoring`) and attaches `probe-result.json` with timings, notes and warnings. The
  reporter that posts to the alert webhook derives `severity` from consecutive failures
  (1 → info, 2 → warning on `notify-monitoring`, 2 → critical on `page-oncall`). The skill's
  "2+ regions" condition is not applicable to a loopback-only service and is recorded as such.

## Alerting rules

```
single failure                              log only
2 consecutive failures, route page-oncall   page on-call (PagerDuty + #shop-incidents), repeat 5 min
2 consecutive failures, notify-monitoring   Slack #shop-monitoring, repeat 30 min
4 consecutive failures, notify-monitoring   page on-call
warning annotation on 3 consecutive runs    Slack #shop-monitoring (latency drifting toward budget)
3 consecutive probe timeouts                page on-call (service unresponsive)
planned maintenance window                  silence paging, exclude the window from error budget
```

Alert text follows the skill's template (probe, severity, consecutive count, last success,
error, duration vs threshold, dashboard, runbook link).

## Data footprint and cleanup

| Probe | Writes | Cleanup inside the probe | What remains |
|---|---|---|---|
| health | nothing | – | nothing |
| storefront | nothing | – | nothing |
| sign-in | one session for `alice` | signs out through the page and asserts `GET /api/me` is 401 | nothing. A failed attempt counts toward the 5-per-60-s throttle; `retries: 0` keeps that at one per run. |
| order-journey | one pending order for `bob` | signs out; attaches `ledger.json` (account, order id, amount, status, time) | **one pending, unpaid order per run** in the synthetic account. The Shop has no order deletion, so the account owns it; no payment event is ever sent, so nothing is fulfilled or receipted. At one run per 10 min that is 144 orders a day: a purge of the synthetic account's orders, or a delete endpoint, is a product follow-up before this probe runs 24/7 against real data. |
| password-reset-email | one reset token for `alice`; one Mailpit message | deletes the captured message by ID (recipient-scoped; refuses an empty ID list) and verifies it is gone | one unconsumed token that expires after 300 s. The token is never confirmed, so the password and sessions stay untouched. |

Synthetic traffic exclusion: the Shop has no `is_synthetic` flag and pushes analytics events for
the probe accounts. Downstream pipelines must filter on the two synthetic addresses; this
cannot be done or verified from the probes.

## SLO proposal and error budget

- Availability SLO 99.9 % per calendar month (43.2 min budget), measured as minutes in which
  `health` or `storefront` was in consecutive-failure state. Maintenance windows excluded.
- Latency SLO: `/health` P99 ≤ 500 ms (contract); sign-in P95 ≤ 2 s; order P95 ≤ 2.5 s;
  reset-email delivery P95 ≤ 2 s. The warning lines above are these targets; the hard budgets
  are the points at which a single run is already user-visible breakage.
- Observed baselines (two healthy runs, two workers sharing one laptop): health samples
  5–46 ms, storefront ready 123–187 ms, sign-in 377–578 ms, order click-to-listed 135–367 ms,
  email delivery 141–244 ms. The warning lines sit 3–10x above these, the hard budgets 10–40x.

## Scheduling

The skill's recipe is a GitHub Actions `schedule` cron every 5 minutes. For this repository that
is 288 runs a day at roughly 1.5 min each (checkout, `npm ci`, browser install, run), about
430 billed minutes a day, which exhausts the 3,000 free minutes in a week. Recommended instead:
a self-hosted cron or Checkly running `npx playwright test --config … --workers 1` with
`SHOP_URL`, `MAILPIT_URL`, `SYNTHETIC_SIGNIN_*`, `SYNTHETIC_ORDER_*` secrets. The spec files
currently take the Shop from the lab fixture; replacing `app` with those variables is the only
change needed.

## Review cadence

Monthly: check warning frequency, budget drift against the baselines above, the synthetic
order count, and that each runbook's first checks still resolve. This is a proposal; no
calendar item or job was created from here.
