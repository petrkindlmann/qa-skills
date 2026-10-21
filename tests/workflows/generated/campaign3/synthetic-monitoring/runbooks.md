# Runbooks for the Shop synthetic probes

Six lines per probe, after the template in
`skills/synthetic-monitoring/references/platforms-and-ci.md`. First checks are ordered by
likelihood: third-party status, recent deploys, then the app's own telemetry. "Dashboard"
is the probe-result history the scheduler keeps (`probe-result.json` per run); no Grafana
exists for this Shop yet.

## health

- What the probe tests: three `GET /health` in a row return 200 `{status:"ok", build:"shop-lab-v1"}`, each within 500 ms (the contract's budget).
- First check: is the process up (`service.log`, port listening)? Then the last deploy: a different `build` value means a release landed that the probe does not expect. Then CPU/memory of the host for the latency case.
- Manual verification: `curl -w '%{time_total}\n' <shop>/health` three times; compare status, body and time.
- Escalate: page the Shop on-call if the process is up and still slow or wrong; if the process is down, restart it and open an incident.
- Dashboard: health probe history (latency per sample, warnings for cacheable responses).
- Runbook owner: platform team, review quarterly.

## storefront

- What the probe tests: `GET /` returns 200 and the page renders both catalogue products at the contract prices (TEA-50 EUR 12.00, CUP-01 EUR 18.00) with a quantity control each, plus the sign-in, place-order and reset controls, within 3 s.
- First check: `GET /api/catalog` by hand; a price change there is a catalogue deploy, not an outage. Then the last deploy of the page. Then browser console errors on `/`.
- Manual verification: open `<shop>/` in a browser; both rows and prices should be visible without signing in.
- Escalate: catalogue price drift → merchandising owner immediately (revenue). Page not rendering → Shop on-call.
- Dashboard: storefront probe history (navigation and catalogue-render timings).
- Runbook owner: storefront team, review quarterly.

## sign-in

- What the probe tests: the sign-in synthetic account submits the page form, `POST /api/login` returns 200, "Signed in as <account>" and "Your orders" appear within 5 s, `GET /api/me` recognises the session, sign-out leaves `GET /api/me` at 401.
- First check: the failure message. `429` means the synthetic account is throttled (5 failures in 60 s): something else is hammering it, or someone rotated its password; wait 60 s and look for the source. `401` means the credentials in the secret store are wrong. Then the last deploy of the auth path.
- Manual verification: sign in with the synthetic account in a browser; then `curl -b <cookie> <shop>/api/me`.
- Escalate: page the Shop on-call if real users cannot sign in either (check the error rate on `/api/login`); otherwise fix the account and rerun.
- Dashboard: sign-in probe history (submit-to-signed-in timing, missing `login` event warnings).
- Runbook owner: accounts team, review quarterly.

## order-journey

- What the probe tests: the order synthetic account signs in, places 1 x TEA-50 through the page, gets a 201 with a fresh pending order of 1200, sees the confirmation notice and the order listed as pending, can read it by ID, and exactly one order was added. No payment event is sent.
- First check: the assertion that failed. A `409 idempotency_conflict` or `replayed:true` means the page reused a key: look at recent page deploys. A `400 invalid_order` means the catalogue changed under the probe. Then database health (SQLite write errors in `service.log`). Then the count of pending synthetic orders: if the purge job has stopped, the account is filling up.
- Manual verification: sign in as the synthetic order account, place the default cart, confirm the notice and the list entry; `curl -b <cookie> <shop>/api/orders`.
- Escalate: page the Shop on-call; order creation is the revenue path. Loop in the data owner if the ledger shows orders the purge did not remove.
- Dashboard: order probe history (click-to-listed timing, purchase-event warnings, `ledger.json` per run).
- Runbook owner: checkout team, review quarterly.

## password-reset-email

- What the probe tests: `POST /api/password-reset/request` for the synthetic account returns 202 and a single correctly addressed `Reset your Shop password` message with the reset link in both text and HTML reaches Mailpit within 10 s; the probe deletes that message afterwards and never confirms the token.
- First check: the mail service (`<mailpit>/api/v1/info`, SMTP port reachable); then `smtp_errors` in the app's state (test mode) or SMTP errors in `service.log`; then the last deploy of the reset path or the email template (subject and link format are asserted).
- Manual verification: submit the "Forgot your password?" form with the synthetic address; watch the Mailpit UI for the message.
- Escalate: Slack `#shop-monitoring` on the second failure; page on-call after four (40 minutes without reset emails). Note the endpoint answers 202 regardless, so users see nothing wrong until they wait for mail.
- Dashboard: reset-email probe history (request-to-delivered timing).
- Runbook owner: accounts team, review quarterly.
