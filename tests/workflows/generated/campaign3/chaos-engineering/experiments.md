# Chaos experiments against the Shop

Skill: `chaos-engineering` (SKILL.md v2.0, `references/fault-injection.md`). Target: the local Shop
(`tests/workflows/fixture-app-contract.md`) started per test by `support/fixtures.mjs`, with the
real Mailpit. Host: Apple M4, 10 cores, macOS, shared with other work during the runs (load
averages 40-114 for most of the session; see "Abort and rollback actually used").

Each experiment follows the skill's five steps: steady-state hypothesis written and recorded as
test annotations before any injection (`experiment()` in `helpers.mjs`), the variable introduced
with a bounded scope, observation through the public API and browser plus the `/test-support/state`
durable view, analysis of recovery time and data integrity, and the record attached to the test
result (`experiment-record` attachment and a `[chaos]` stdout line in `verbose.json`). Every
experiment ends with `expectHealthy(...)`: `/health` 200 with the contract body inside its 500 ms
budget, asserted, with the message "Shop healthy again at the end of the experiment".

Files: `mail-outage.spec.mjs` (1), `process-restart.spec.mjs` (2, 3), `cpu-load.spec.mjs` (4 and
its safety check 4a), `helpers.mjs` (probes, flows, the three injectors, the record).

## Hypothesis table

| # | Experiment | Steady state and hypothesis | Blast radius | Abort condition | Rollback | Verdict |
|---|---|---|---|---|---|---|
| 1 | SMTP outage (dependency down) | Steady: healthy Shop answers `/health` 200 < 500 ms, a reset request is 202 and the mail reaches Mailpit, `smtp_errors` 0. Hypothesis: with SMTP pointing at a closed port, `POST /api/password-reset/request` still answers 202 with the contract message, every failed delivery increments `smtp_errors` by exactly one (API twice, browser once), an unknown account counts nothing, no API or browser response is 5xx, `/health` stays within budget. | One extra Shop process started by the test with `--smtp-port` = a loopback port proven `ECONNREFUSED`; worker Mailpit and the per-test healthy Shop untouched; a few seconds. | Any response >= 500 from the faulted Shop or seen by the browser, or a health probe over budget: the assertion throws, no further requests, rollback in `finally`. | Dispose the faulted request context and stop the faulted Shop (timed, < 30 s); then prove the healthy Shop still delivers mail with `smtp_errors` 0. | Confirmed in all 7 executed runs; refused at the steady-state gate in run 6 |
| 2 | Process restart mid-flow (service crash) | Steady: signed-in session, one pending order (4200), one live session in state. Hypothesis: after SIGTERM + relaunch on the same database and port, the cookie still works, the order is returned byte-equal, replaying its idempotency key gives `replayed: true` and the same order, no second order, sessions equal before/after, and the payment then fulfills it exactly once; ready within the runtime's 15 s. | This test's Shop process only; one restart. | `restart()` throws (not ready in 15 s), first `/health` after restart not 200, or durable state differs from the snapshot: stop before any further step. | The restart is its own recovery; fixture teardown stops the Shop. Final: health within budget and a fresh sign-in (bob). | Confirmed, 8/8 |
| 3 | Fulfillment fails once after restart | Steady: pending order, 0 receipts. Hypothesis: restarted with `failFulfillmentOnce`, the first valid payment event gets 503 `fulfillment_unavailable`; the order stays pending, `fulfillment_count` 0, no receipt; redelivering the same bytes returns 200 `duplicate: false` and fulfills once; a third delivery is `duplicate: true`; all of it survives one more restart. | This test's Shop process; two restarts; the fault is armed for one fulfillment. | Not ready after restart; first delivery not the expected 503 (fault not observed = invalid experiment, reported as a failure, never as a pass); order paid or receipt present after the 503. | Fault self-clears after one failure; an explicit plain `app.restart()` afterwards clears any residue and doubles as the durability check; fixture teardown is the backstop. | Confirmed, 8/8 |
| 4 | CPU exhaustion (host) | Steady: ten `/health` samples all 200 and <= 500 ms (the experiment refuses to start otherwise). Hypothesis: with 20 busy threads (2 x cores) for 6 s, `/health` keeps answering 200 within 500 ms, a sign-in, order and signed payment complete correctly, health is back within budget within 5 s of the load ending. A budget miss is recorded with the gap (per the task), a non-200 is a failure. | 20 worker threads inside the Playwright worker process, each with its own 6 s deadline; this Shop process; nothing else on the host touched. | Machine-checked by `monitorHealth`: a probe not 200 or slower than 5000 ms terminates the load at once. | `load.abort()` in `finally` (no-op once the threads exit on their own); poll health until within budget. | Confirmed in 6 runs; disproved with the gap recorded in runs 6 and 7 (1 probe each over budget, by 97.8 and 217.6 ms) |
| 4a | Safety check: abort gate | Hypothesis: with the abort threshold forced to 0 ms the first probe trips the abort, every thread is terminated within 5 s, the Shop is healthy right after. | Same as 4, at most 6 s. | Forced. | `load.abort()` (worker `terminate()`), timed. | Confirmed in all 7 executed runs; refused at the steady-state gate in run 4 |

## Results, baseline versus actual

Eight runs: 1-2 on the first version of the suite, 3-8 on the final code (the difference is only in
how experiment 4's self-clearing check is measured and the abort-gate rollback bound, see "Changes
between runs"). Numbers come from the `experiment-record` attachments in each run's `verbose.json`;
the per-run extraction is in `execution.log`. Ranges below are across all runs that executed the step.

### 1. SMTP outage

| Measure | Baseline (healthy Shop) | During outage (faulted Shop) | After rollback |
|---|---|---|---|
| `/health` | 18-288 ms, 200 (run 6: 1311.5 ms, refused before injection) | 6-295 ms, 200, two probes per run | 4-196 ms, 200 |
| Reset request status/body | 202, contract message, mail in Mailpit within 8 s | 202 x3 (two API, one browser form), contract message; first request 46-165 ms | 202, second mail delivered |
| `smtp_errors` | 0 | 0 -> 1 -> 2 (unknown account: still 2) -> 3 | 0 on the healthy Shop |
| Mail for the faulted account in Mailpit | n/a | 0 messages | n/a |
| 5xx seen (API statuses, `page.on('response')`) | none | none | none |
| Rollback (dispose context + stop faulted Shop) | | 174-2142 ms | < 30 s window held |

Data integrity: nothing at stake beyond `reset_tokens` rows; the healthy Shop lost nothing. The
sign-in on the faulted Shop worked during the outage, so the fault was confined to mail.

### 2. Process restart mid-flow

| Measure | Before restart | After restart |
|---|---|---|
| Restart to ready (`app.restart()` including the runtime's readiness poll) | | 660-2515 ms (2515, 2106, 1558, 1736, 2318, 1206, 660, 1250) |
| First `/health` after restart | 5-245 ms | 10-197 ms, 200 |
| `GET /api/me` with the pre-restart cookie | 200 | 200, same user |
| `GET /api/orders/ID`, `GET /api/orders` | pending, fc 0 | byte-equal to the pre-restart order |
| Replay of the idempotency key | 201 created | 200 `{ order, replayed: true }` |
| `state.orders` / `state.sessions` | 1 / `{alice: 1}` | 1 / `{alice: 1}` |
| Payment after restart | | 200 `duplicate: false`; order paid, fc 1, receipts 1 |

Data integrity: lost no, duplicated no, corrupted no, in every run.

### 3. Fulfillment fails once after restart

| Step | Observed (identical in all eight runs apart from timings) |
|---|---|
| Armed restart to ready | 364-2370 ms; session survived every time |
| First delivery | 503 `{ error: "fulfillment_unavailable" }` in 9-107 ms (the fault was observed, so the experiment is valid) |
| State after the 503 | order pending, `fulfillment_count` 0, receipts 0 (state and `GET /api/orders/ID` agree) |
| Same bytes redelivered | 200 `{ received: true, duplicate: false }`; paid, fc 1, receipts 1 |
| Third delivery | 200 `duplicate: true`; fc still 1 |
| Rollback restart (plain) | 0.7-2.4 s; paid, fc 1, receipts 1 after it; a fourth delivery is still `duplicate: true` |

Data integrity: 1 order, 1 receipt, `fulfillment_count` 1 across 503, retry, repeat and a restart.

### 4. CPU exhaustion

Per run (1 to 8), host 1-minute load average at the start in brackets where measured:

| Run | Baseline max (10 samples) | Under load: samples / p50 / p95 / max | Over budget | Verdict | Threads' own runtime max | Load gone (main-thread view) |
|---|---|---|---|---|---|---|
| 1 | 373.2 ms | 45 / 22.6 / 93.3 / 205.5 ms | 0 | confirmed | (not measured in v1) | 8539 ms |
| 2 | 223.2 ms | 37 / 43.9 / 187.6 / 226.9 ms | 0 | confirmed | (not measured in v1) | 8359 ms |
| 3 | 32.8 ms | 36 / 8.6 / 126.9 / 333.7 ms | 0 | confirmed | 6086 ms | 6804 ms |
| 4 [101] | 435.2 ms | 42 / 5.6 / 118.7 / 351.2 ms | 0 | confirmed | 6082 ms | 7582 ms |
| 5 [93] | 268.3 ms | 35 / 49.1 / 163.4 / 346.1 ms | 0 | confirmed | 6033 ms | 7940 ms |
| 6 [58] | 111.1 ms | 34 / 39.1 / 130.8 / 597.8 ms | 1 | disproved, miss 97.8 ms | 6045 ms | 7163 ms |
| 7 [28] | 186.9 ms | 20 / 137.9 / 717.6 / 717.6 ms | 1 | disproved, miss 217.6 ms | 6139 ms | 7416 ms |
| 8 [31] | 17.0 ms | 37 / 9.1 / 183.0 / 238.1 ms | 0 | confirmed | 6018 ms | 6499 ms |

Across the eight runs: 286 probes under load, all 200, 2 over the 500 ms budget. The order flow
(create, signed payment, read back) was 201 / 200 `duplicate: false` / paid with `fulfillment_count`
1 and amount 4200 in every run, in 67-566 ms. Health was back within budget 7-33 ms after the load
ended. Caveat recorded in each run: latency is measured by the test process, which shares the
saturated CPU, so it bounds the server's latency from above. The two misses are single probes and
happened while the host carried unrelated load (28-58); under a quiet host (runs 1-3, 8) the worst
probe was 334 ms. The test does what the task asked: a miss is recorded with its gap, a non-200 or a
failed probe would fail the test, and neither happened.

### 4a. Abort gate (skill Verification step 2)

Threshold forced to 0 ms: the first probe (23-229 ms) tripped the abort in every executed run;
terminating 20 busy threads took 73-2441 ms (2441 ms in run 5 at host load 93; otherwise under 1.3 s);
the load was gone 345-2544 ms after construction versus its own 6000 ms deadline; health right after
answered in 11-217 ms. Run 4 was refused at the steady-state gate before injection.

## Abort and rollback actually used

- No abort fired in a live experiment (1-4). The abort path was exercised on purpose in 4a and
  terminates the load in 0.07-2.4 s.
- Two runs stopped at the steady-state gate, before any injection. Run 4 (4a): the first baseline
  probe of the run took 7561.8 ms against the 500 ms budget, and the Shop fixture teardown then
  exceeded the 30 s test timeout; `uptime` right after showed load averages 101 / 59 / 44 on 10 cores
  from unrelated work (another Playwright Chromium at 146 % CPU, a VM, three `tsc` runs, a Next server).
  Run 6 (experiment 1): the healthy Shop's baseline probe took 1311.5 ms at host load 58. The skill's
  "no chaos during an incident" rule held both times: nothing was injected. Both are reported as the
  failed runs they are, not as flakes, and the other four experiments in each run passed. A bounded
  170 s wait for the load to drop below 25 expired at 114; run 5 then passed at 93 and the last two
  runs at 28-31.
- Rollbacks used: stop of the faulted Shop (exp. 1, 0.2-2.1 s), `app.restart()` (exp. 3, 0.7-2.4 s),
  `load.abort()` (4a, 0.07-2.4 s; a no-op in 4 because the threads self-cleared). All inside the
  skill's 30 s rule. The fixture teardown (fresh Shop per test) is the backstop for every one.

## Findings and action items

1. Restart to ready ranged from 364 ms to 2515 ms over the sixteen timed restarts, tracking the
   host's load (0.36-0.66 s at load ~28, 2.1-2.5 s at load 60-100; 321 ms on an idle Shop during
   discovery). The runtime's SIGTERM-and-poll makes a slow graceful shutdown and a slow relaunch
   indistinguishable from here, and the server source was out of bounds. No contract budget exists
   for restart time, so this is an observation. Action: re-run experiments 2 and 3 on a quiet host
   ten times to set a restart-time budget, then add it to the hypothesis. Owner: Shop fixture
   maintainer (unassigned in this lab); re-run with the same tests.
2. `/health` within 500 ms is a single-sample promise that a shared host breaks on its own: 7.5 s
   and 1.3 s single probes at idle refused two runs, and two single probes under my load reached
   598 and 718 ms while the host was also busy. Monitoring built on this budget should sample
   N-of-M before alerting; chaos runs should keep the steady-state gate and never widen the budget.
   Action: keep the ten-sample gate; do not relax the budget; if the 500 ms promise is meant for a
   shared CI host, the contract should say what percentile it applies to. Owner: contract owner
   (unassigned here).
3. The SMTP failure exercised is the fast one (connection refused). A black-holed SMTP port
   (packets dropped) would exercise the SMTP timeout path and could turn the 202 into a slow
   response; that case was not runnable here (see below) and remains open. Owner: whoever can run
   with a firewall rule.

## Changes between runs

After runs 1-2 (both 5/5) the self-clearing check in experiment 4 changed from "last worker exit
observed by the main thread within deadline + 3 s" (measured 8.4-8.5 s against a 9 s bound: the
contended main thread notices exits late and worker start-up staggers under load) to each thread
reporting its own start and end (`threadRuntimesMs`, bound deadline + 500 ms, measured 6000-6139 ms),
with the observed clear time kept as a runaway guard at deadline + 6 s. The abort-gate rollback bound
went from 2 s to 5 s with the observed values recorded; the skill's rule is under 30 s. Run 5 later
measured 2441 ms for that rollback at host load 93, so the original 2 s bound would have flagged a
run in which the rollback worked. Neither change touched an application assertion.

## What was not safe to try here

- Stopping the worker Mailpit for one test: `launchService().stop()` is one-way (no restart on the
  same port), so the `app` fixture of every later test in that worker would keep an SMTP port with
  nothing behind it. Rollback impossible within the runtime API; the closed-port Shop was used instead.
- A black-holed (dropping, not refusing) SMTP port, `tc netem` latency or packet loss, `iptables`
  partitions, toxiproxy: all need firewall or network changes or a new dependency, both forbidden.
- `stress-ng`, `fallocate` disk fill, memory exhaustion: not installed, and the host was shared with
  little headroom; the in-process CPU load was capped at 6 s with per-thread deadlines for that reason.
- SIGKILL mid-transaction or corrupting the SQLite file: the runtime only offers SIGTERM via
  `restart()`, and the database file belongs to the runtime.
- Injecting while the host was already at load 100: refused by the gate, twice.
- Running experiments in parallel or with more than one worker: the health budget is host-sensitive.
