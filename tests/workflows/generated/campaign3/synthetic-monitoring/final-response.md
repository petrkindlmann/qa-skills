# synthetic-monitoring against the Shop: final response

Skill exercised: `skills/synthetic-monitoring/SKILL.md` plus both reference files. Target:
the Shop fixture (contract `tests/workflows/fixture-app-contract.md`) through the lab fixtures
(`app`, `mailpit`). Candidate commit 736b88e on main, macOS, Playwright 1.62.1 with bundled
Chromium, Mailpit v1.31.6. `.agents/qa-project-context.md` is the unfilled template, so the
contract and the running Shop answered the discovery questions (see `monitoring-plan.md`).

## What was delivered

| File | Content |
|---|---|
| `probe-support.mjs` | contract constants, `startProbe` (per-probe wall clock, `probe`/`alert-route` annotations, hard budget vs warning line, `probe-result.json` attachment), recipient-scoped Mailpit client |
| `probes.mjs` | the five probe bodies with their FAIL/WARN semantics in comments |
| `health.probe.spec.mjs` | 3 x `GET /health`, 200 + `{status:"ok", build:"shop-lab-v1"}`, each ≤ 500 ms (contract); warn > 250 ms or cacheable |
| `storefront.probe.spec.mjs` | `GET /` renders both products at contract prices with controls within 3 s; warn > 1 s |
| `sign-in.probe.spec.mjs` | page sign-in as `alice`, account view ≤ 5 s, `/api/me` 200, sign-out verified by `/api/me` 401; warn > 2 s or no `login` event |
| `order-journey.probe.spec.mjs` | page sign-in as `bob`, 1 x TEA-50 order, 201 fresh pending 1200, notice, listed, owner read, exactly one new order, ≤ 5 s; `ledger.json`; warn > 2.5 s or wrong purchase event |
| `password-reset-email.probe.spec.mjs` | 202, one correctly addressed `Reset your Shop password` in Mailpit ≤ 10 s with the link in text and HTML, captured message deleted; warn > 2 s |
| `monitoring-plan.md` | discovery answers, probe table (frequency, wall clock, budget, warning, alert threshold, runbook pointer), failure semantics, alerting rules, data footprint, SLO proposal, scheduling cost, review cadence |
| `runbooks.md` | six-line runbook per probe |
| `execution.log` | every command with trimmed output |

## What actually ran

Command (from the repo root), run twice back to back on the healthy Shop, 2 workers:

```
QA_WORKFLOW_SUITE=/Users/petr/projects/qa-skills/tests/workflows/generated/campaign3/synthetic-monitoring \
QA_WORKFLOW_OUTPUT=/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad/campaign3-synthetic-monitoring \
node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs --workers 2
```

| Run | Result | Probe wall clocks | Measured latencies | Warnings |
|---|---|---|---|---|
| 1 | 5 passed, 0 failed | 71 ms – 1.0 s | health 28/15/5 ms; storefront 123 ms; sign-in 377 ms; order 135 ms; email 141 ms | none |
| 2 | 5 passed, 0 failed, exit 0 | 222 ms – 1.6 s | health 46/10/39 ms; storefront 187 ms; sign-in 578 ms; order 367 ms; email 244 ms | none |

Every probe stayed under 30 s and under its own wall-clock budget; no hard budget or warning
line was approached (worst ratio: sign-in at 578 ms against a 2 s warning line).

Broken-case check (AGENTS.md: a detector needs a known-bad case too), in a scratchpad spec
outside the scheduled suite so that the suite stays green, run twice (6 then 7 cases),
13 executions, all passed, meaning each probe rejected as designed:

- health fails with the Shop stopped (connection refused), on a wrong path (404 on sample 1),
  and when the hard budget is below the observed latency;
- storefront fails when `/` is replaced by the reset page;
- sign-in fails on a wrong password;
- password-reset fails when no email arrives for an unknown account (`no "Reset your Shop
  password" email`, after the full 10 s delivery budget);
- health stays green but carries exactly one `warning` annotation, mirrored in
  `probe-result.json` with status `passed`, when only the warning line is crossed.

Total: 10 healthy probe executions + 13 broken-case executions = 23 passed, 0 failed,
0 skipped. Not exercised against a broken case: the order probe and the storefront price
assertions (no way to break the catalogue or order creation without editing the fixture,
which is out of scope).

## What the skill got right

- "Assert on the goal, not the status code" is exactly the Shop's trap: the reset endpoint
  answers 202 whether or not SMTP works (the contract says only `smtp_errors` grows). The
  email probe is the only thing that would notice. The same rule shaped the sign-in probe
  (account view + `/api/me`), the order probe (notice, list, owner read, footprint of one)
  and the storefront probe (prices, not a 200).
- The probe design table's frequencies and timeouts mapped one-to-one onto the five probes.
- "Keep probes simple and fast": all wall clocks 71 ms – 1.6 s, the 30 s ceiling never close.
- The log / warn / page escalation and the "single failure is noise" rule gave the alert
  thresholds directly; the alert template and the six-line runbook template were usable as-is.
- "Probes must not affect production data" drove the account split (`bob` owns every order),
  the ledger attachment, the never-confirmed reset token and the ID-scoped Mailpit delete
  that refuses an empty ID list.
- Verification step 3 ("break the asserted content and confirm the probe fails") is what the
  broken-case spec implements; it caught nothing wrong, but it is the reason the detectors
  are proven rather than assumed.
- The 2026 platform notes (Checkly Rocky, k6 2.0) were irrelevant to a loopback lab but did
  not get in the way.

## Recipe difficulties, with the exact lines

1. `references/probe-implementations.md`, login-flow probe,
   `const loginResponse = await page.goto(\`${PROD_URL}/login\`);`
   The Shop has no `/login`: `GET /login` returns 404 (verified). Sign-in lives on `/`.
   Did instead: `page.goto(\`${baseURL}/\`)`.
2. Same probe, `await page.getByLabel('Email').fill(SYNTH_EMAIL);`
   Fails as written: the page has the labels "Email" and "Account email";
   `getByLabel('Email')` resolves to 2 elements and `fill` throws
   `strict mode violation: getByLabel('Email') resolved to 2 elements` (verified with
   `label-check.mjs`). Did instead: `getByLabel('Email', { exact: true })`, same for
   `Password` (a "New password" label exists on the reset view).
3. Same probe, `await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });` and
   `page.getByRole('heading', { name: /dashboard/i })`.
   Single-page app: the URL never changes after sign-in and there is no dashboard heading.
   Did instead: assert the text `Signed in as <account>` and the heading `Your orders`,
   then confirm the session server-side with `GET /api/me`.
4. Same probe, `const PROD_URL = process.env.PRODUCTION_URL!;` and the two
   `SYNTHETIC_USER_*` env lines (TypeScript non-null assertions).
   The lab is `.mjs`; the URL and the account emails are per-instance (namespaced) and come
   from the `app` fixture, so static secrets cannot carry them. Did instead: the spec passes
   `app.baseURL` and `app.users.<id>` into the probe body; `monitoring-plan.md` names the
   environment variables a scheduler would use.
5. API health probe, `expect(body.status).toBe('healthy'); expect(body.database).toBe('connected'); expect(body.cache).toBe('connected');`
   The contract's body is `{ "status": "ok", "build": "shop-lab-v1" }` with no dependency
   fields. Did instead: exact body equality including `build`, which also catches an
   unexpected release serving.
6. API health probe, `test('authenticated API returns valid response', ...)` with
   `headers: { Authorization: \`Bearer ${API_KEY}\` }` and
   `expect(body.email).toContain('synthetic');`
   The Shop has cookie sessions, no bearer tokens, no API key, and its seeded accounts are
   `alice+<namespace>@example.test` / `bob+...`; nothing contains "synthetic" and there is no
   account-creation API to make one that does. Did instead: dropped the bearer test (the
   session check lives in the sign-in probe via the cookie) and recorded the account-naming
   requirement as a gap in the plan.
7. API health probe, `const start = Date.now(); const response = await request.get(...); const duration = Date.now() - start;`
   with one sample against a 2000 ms budget. Against the contract's 500 ms budget, the first
   request through a freshly created Playwright request context in a standalone script
   measured 370 ms while Node `fetch` measured 32 ms for the same cold request: a harness
   artifact that would eat most of the budget. Inside the test runner the first sample was
   28–46 ms, so the artifact did not show there, but I could not rule it out in advance.
   Did instead: three sequential samples with `performance.now()`, every sample under the
   contract budget, slowest sample recorded.
8. API health probe, `test.describe.configure({ timeout: 5_000, retries: 0 });`
   With the lab fixture, the Playwright timeout also covers starting a Shop process and the
   browser; total test durations were 0.7–2.9 s, so 5 s would have held, but it would be
   measuring fixture startup rather than the probe. Did instead: `testInfo.setTimeout(wall
   clock + 10 s)` as a backstop and a `expect.soft` on the probe's own wall clock, which is
   the number the skill's 30 s ceiling is about.
9. Search probe (`probes/search.ts`): not applicable, the Shop has no search. Replaced by the
   storefront probe (the skill's "Homepage load" row), asserting catalogue prices.
10. `probes/config.ts` `getProbeConfig()` with `baseUrl: 'https://staging.example.com'` and
    `credentials: { email: 'synthetic@staging.example.com', ... }`: unusable as written for
    per-instance URLs and namespaced emails; the `app` fixture is the environment config here.
11. `references/platforms-and-ci.md`, `cron: '*/5 * * * *'` GitHub Actions workflow. Not
    applied (no files outside this folder may change, and the user's global rules require a
    cost statement for any workflow): it would be 288 runs a day with `npm ci` and a browser
    install each, roughly 430 billed minutes a day, past the 3,000 free minutes within a week.
    The plan recommends a self-hosted cron or Checkly instead.
12. `alerting-rules.yaml` routes match on `severity` and `probe: [login, checkout, api-health]`;
    the note says severity is derived from the consecutive-failure count by the reporter.
    No reporter or alert manager exists here. Did instead: each result carries `probe` and
    `alert-route` annotations and a `probe-result.json`; severity derivation is written down
    in the plan, not implemented.
13. SKILL.md Non-destructive patterns, `Create-then-delete: create a draft, verify, delete immediately`.
    The Shop has no order deletion, and the skill offers no pattern for a system that can
    create but not delete; it only says to avoid "operations that cannot be automatically
    cleaned up", which would mean no order probe at all. Did instead: dedicated account
    ownership (`bob`), no payment event so nothing is fulfilled, a `ledger.json` per run, and
    a documented purge follow-up (144 pending orders a day at the 10-minute cadence).
14. SKILL.md Dedicated test accounts, `Separate accounts per concurrent probe`: two seeded
    accounts for three account-using probes. `alice` serves sign-in and reset (a reset request
    touches no session, so they cannot conflict); `bob` is alone on the writing probe.
15. SKILL.md Verification step 1, `npx playwright test probes/ --reporter=list`: this
    repository runs through `tests/workflows/playwright.config.mjs` with `QA_WORKFLOW_SUITE`
    and its own reporters; used the supplied command.

## What could not be verified

- Multi-region confirmation (SKILL.md "Done When", alerting rule "2+ regions"): the Shop is
  loopback-only; recorded as not applicable, not as done.
- "A test alert reaches on-call within the SLA detection time, confirmed once": no alert
  manager, webhook or pager exists in the lab. The routing is encoded as annotations and a
  rules table only.
- "Synthetic traffic is excluded from RUM, billing and error-budget pipelines": the Shop pushes
  `dataLayer` `login` and `purchase` events for the synthetic accounts and has no
  `is_synthetic` flag; exclusion has to happen downstream and cannot be checked from here.
- An SLA dashboard and a scheduled review job: proposed in the plan, not created.
- Order cleanup: no delete endpoint; the footprint is owned, not removed.
- The probes ran with the Shop and Mailpit as Playwright fixtures on one laptop, two workers;
  production latency baselines will differ, so the warning lines (3–10x the observed values)
  should be re-based after the first week of real data.
- Broken cases for the order probe and the storefront price assertions were not exercised
  (see above).

## Out of scope observation

`git status` at the end shows `docs/QA-RUNNER.md`, `tests/qa/runtime.test.mjs` and six files
under `tools/qa/` modified at 19:56–19:59 during this session. This task never wrote to them;
another process in the workspace did. Only this folder was created or changed by this task;
`tests/workflows/support`, the Playwright config, the skill and the package files are unchanged.

## Counts

- Healthy suite, run 1: 5 passed / 0 failed. Run 2: 5 passed / 0 failed (exit 0).
- Broken-case checks: 13 executions (6 + 7), 13 passed (every probe rejected or warned as
  designed), 0 failed.
- Skill difficulties: 15, listed above (items 1, 2, 5, 6 fail as written on this app; 3, 4, 7,
  8, 10, 12 needed adaptation; 9 not applicable; 11, 13, 14, 15 are guidance gaps).

## Post-authoring edit for the fault matrix

After authoring, the orchestrator marked two assertions with the lab's `oracle()` helper so the controls matrix can verify a designated failure under a fault: the health budget check in `probe-support.mjs` (`budget()` became async and takes an optional `oracleId`, passed by `healthProbe`; the five call sites are now awaited) and the reset-email delivery poll in `probes.mjs`. The wrapper rethrows the same error and changes nothing on a passing run. The matrix runs the suite healthy, under `slow_health` and under a new Shop fault `reset_email_dropped` (the endpoint still answers 202 but no message reaches SMTP), which the agent's own finding about the uniform 202 motivated.
