# chaos-engineering against the Shop: final response

## What ran

Suite: `tests/workflows/generated/campaign3/chaos-engineering/` (3 spec files, 5 tests, 1 helper),
run with the task's command, `--workers 1`, Chromium, Playwright 1.62.1, node 26.0.0, HEAD 9b08fa8
(uncommitted suite). Each test starts its own real Shop (and one test a second, faulted Shop) against
the worker's real Mailpit. No routed or mocked HTTP; no change outside the owned folder.

| Run | Code | Result | Wall time | Host load (1 min) | Note |
|---|---|---|---|---|---|
| 1 | first version | 5 passed | 72.6 s | not measured | |
| 2 | first version | 5 passed | 58.0 s | not measured | twice in a row on the first version |
| 3 | final | 5 passed | 85.8 s | not measured | |
| 4 | final | 4 passed, 1 failed | 163.7 s | 101 | refused at the steady-state gate before injection: first baseline `/health` of the run 7561.8 ms (budget 500 ms), Shop teardown > 30 s; host incident from unrelated work |
| 5 | final | 5 passed | 67.3 s | 93 -> 62 | abort-gate rollback 2441 ms under the host load |
| 6 | final | 4 passed, 1 failed | 56.3 s | 58 -> 40 | refused at the gate before injection (experiment 1 baseline probe 1311.5 ms); experiment 4 recorded its first budget miss (max 597.8 ms, 1/34 probes) |
| 7 | final | 5 passed | 89.7 s | 28 -> 32 | experiment 4 recorded a miss (max 717.6 ms, 1/20 probes); restarts 364-660 ms |
| 8 | final | 5 passed | 38.8 s | 31 -> 43 | twice in a row on the final code (7 and 8) |

A bounded 170 s wait for the host load to fall below 25 expired at 114; a conditional run was skipped
once at 32. The two failures are the suite refusing to inject into a system that was not in steady
state, which is what the skill's "no chaos during an incident" rule asks for; neither is a Shop defect
and no expectation was weakened to get past them.

Experiments and verdicts (numbers in `experiments.md`, per-run extraction in `execution.log`):

1. SMTP outage (second Shop with `--smtp-port` on a port proven `ECONNREFUSED`): reset requests
   202 with the contract message through the API and the browser form, `smtp_errors` 0 -> 3 with an
   unknown account adding nothing, no 5xx anywhere, Mailpit empty for the faulted account, health
   within budget during and after, rollback 0.2-2.1 s, healthy Shop still delivering afterwards.
   Confirmed in all 7 executed runs.
2. Process restart mid-flow: session cookie, pending order (byte-equal), idempotency key
   (`replayed: true`), session count all survive; the payment then fulfills exactly once. Restart to
   ready 0.66-2.5 s. Confirmed 8/8.
3. Fulfillment fails once after restart: 503 `fulfillment_unavailable` observed (the test fails if the
   fault is not observed), order pending / 0 / no receipt, retry 200 `duplicate: false` and paid once,
   repeat `duplicate: true`, all durable across one more restart. Confirmed 8/8.
4. CPU exhaustion (20 busy worker threads for 6 s): 286 health probes under load across eight runs,
   all 200; 2 single probes over the 500 ms budget (597.8 and 717.6 ms in runs 6 and 7, host also
   busy), recorded as "disproved, miss 97.8 / 217.6 ms" as the task allows; under a quiet host the
   worst probe was 334 ms. The order flow completed correctly under load every time; threads stopped
   at their own deadline (6000-6139 ms); health back within budget in < 35 ms. Confirmed in 6 runs,
   disproved with the gap recorded in 2.
   4a. Safety check: the abort gate, forced to 0 ms, halted the load on the first probe and the
   rollback terminated 20 busy threads in 0.07-2.4 s. Confirmed in all 7 executed runs.

Every test ends with `expectHealthy(..., 'Shop healthy again at the end of the experiment')`.

## What the skill got right

- The five-step workflow (hypothesis, inject, observe, analyze, fix and iterate) and the "Done When"
  list map cleanly onto a Playwright test: annotations before injection, `try`/`finally` as the
  rollback, an attached record with baseline versus actual, recovery time and a lost/corrupted line.
- "Running chaos experiments during incidents" (SKILL.md lines 409-413) and "Monitoring is a
  prerequisite" turned into a baseline gate; that gate is what refused runs 4 and 6 when the host
  was at load 58-101, so nothing was injected into an unhealthy system. The rule earned its place.
- "No rollback plan" (lines 397-401): "pick injections with a built-in timeout" led to per-thread
  deadlines on the CPU load, and "Time the rollback" (line 427) led to every rollback being measured.
- Verification steps 1-3 (lines 425-432) are the right order: trip the abort on purpose first (4a),
  confirm the fault self-clears, time the rollback, then trust the live experiment.
- Starter Experiment 2 (lines 340-359: idempotency, no duplicate charges under a dependency error)
  is exactly experiment 3's shape; the "what to observe" list was a usable checklist.
- The toxiproxy test in `references/fault-injection.md` lines 88-115 has the right skeleton
  (disable, `try`, `finally` enable) and I reused it for the faulted Shop.

## Recipe difficulties, with the lines

1. No runnable recipe applies to this environment. `references/fault-injection.md` lines 7-17
   (`tc qdisc add dev eth0 root netem ...`), 19-31 (toxiproxy YAML), 36-41 (`kubectl delete pod`),
   45-68 (Litmus `ChaosEngine`), 72-84 (`fallocate`, `stress-ng --cpu 4 --timeout 60s`,
   `stress-ng --vm`), and 88-115 (`toxiproxy-node-client`): this host has no `tc`, `iptables`,
   `stress-ng`, `fallocate`, `toxiproxy-server` or `toxiproxy-node-client` (checked with `command -v`
   and `ls node_modules`); `kubectl` exists but there is no cluster; a new dependency was forbidden.
   The decision tree (SKILL.md lines 250-269) ends at "Linux: tc + stress-ng (manual)" and
   "toxiproxy" for integration tests; it has no branch for "a local process under test whose runtime
   can restart it or point its dependency at a dead port". What I did: dependency down = a Shop
   started with `--smtp-port` on a closed loopback port, proven refused before use; service crash =
   `app.restart()` (SIGTERM + relaunch); CPU stress = `worker_threads` busy loops with their own
   deadlines. All three are rows in the SKILL.md tables (lines 182-225); none has a recipe below
   the table.
2. `references/fault-injection.md` lines 108-110 (`response.headers.get('x-response-time')`,
   `expect(latency).toBeLessThan(5000)`): the Shop has no such header, and 5000 ms is a number
   with no source. I measured client-side with `performance.now()` and used the contract's own
   budget (500 ms); the recipe should say to take the budget from the service's contract or SLO.
3. SKILL.md Step 1 (lines 91-107) gives a metrics template but not a sample count or a rule that the
   baseline is asserted before injection; the "check for active incidents" sentence lives in the
   anti-patterns (line 413), not in the workflow. I made the baseline an assertion (ten probes for the
   CPU experiment, one `expectHealthy` for the rest). Without that, runs 4 and 6 would have injected
   into a host already at load 58-101 and reported the result as the Shop's.
4. Automated abort (`references/fault-injection.md` lines 117-143): only AWS FIS, Gremlin and Litmus
   examples. For a test-level experiment I wrote `monitorHealth` (probe loop, threshold, `onAbort`)
   from scratch; the reference could carry a ten-line in-test version since that is what "Need network
   fault injection in integration tests?" (line 261) users will have.
5. Verification step 3 (line 429, "start a bounded injection ... then walk away. Confirm the fault
   clears itself at the deadline") does not warn that the observer may share the CPU with the fault.
   My first self-clearing check measured the last thread's exit from the main thread and read 8.4-8.5 s
   for a 6 s deadline (start-up stagger plus late exit notification under contention) against a 9 s
   bound; it passed twice but measured the wrong thing. The final code has each thread report its
   own start and end (6000-6139 ms) and keeps the observed clear time as a runaway guard. Likewise the
   rollback timing of the abort gate stretched from 0.07 s to 2.4 s with host load alone; the skill's
   "under 30 s" is the only bound that survived, and my tighter 2 s bound had to go to 5 s.
6. "Done When" (line 442) and the findings template (lines 170-175) require a ticket with a named
   owner and a due date for every weakness. There is no tracker or team in this lab; the findings in
   `experiments.md` carry an action and a stated re-run but "owner: unassigned". The skill offers no
   degraded form for a single engineer's run.
7. Discovery Questions (lines 36-61) point at `.agents/qa-project-context.md`; it exists but is the
   unfilled template, so nothing could be skipped and the answers came from the contract instead. The
   AGENTS.md instruction "suggest the user creates one" is the only route; the skill does not say
   what to do when the file is a template.
8. Most of the skill (Tools, lines 229-275; Game Day, 279-312; Starting Small narrative) is about
   teams, platforms and Kubernetes and had no bearing on a single-process local run. The parts that
   carried the work fit on one page: the workflow, three anti-patterns, Verification 1-3, Done When.

## What I could not verify

- A dropping (black-holed) SMTP port, which exercises the SMTP timeout path rather than
  connection refused; needs a firewall rule, forbidden here. The 202-under-outage promise is only
  proven for the fast-failure case.
- Server-side latency under load: all latencies are measured by the test process, which shares the
  saturated CPU; the numbers bound the server from above. The Shop exposes no timing header. The two
  recorded budget misses (598 and 718 ms single probes) cannot be attributed to my load alone because
  the host carried unrelated load at the time.
- Restart recovery as a property of the Shop: 364-2515 ms across sixteen restarts tracked the host's
  load; separating the server's shutdown from the host would need an idle host and the server source,
  both out of bounds.
- Stopping the worker Mailpit as the task's alternative injection: no restart path in the runtime
  API, so its rollback could not be guaranteed and it was not attempted.
- Anything the skill routes to platforms (Litmus, Chaos Mesh, FIS, Gremlin, toxiproxy, tc,
  stress-ng): not present and not permitted.
- The findings' action items are not tracked anywhere; the skill's "ticket with owner and due date"
  criterion is unmet by construction.

## Counts

8 runs, 40 test executions: 38 passed, 2 failed. Both failures are steady-state gate refusals before
any fault was injected (run 4, test 4a; run 6, experiment 1) during an external host incident.
Final code: runs 3, 5, 7 and 8 passed 5/5; runs 7 and 8 are the consecutive passes. Hypotheses:
1, 2, 3 and 4a confirmed in every executed run; 4 confirmed in 6 runs and disproved with the gap
recorded in 2 (never a failed or non-200 probe). Summed suite wall time 633 s.

## Post-authoring edit for the fault matrix

The orchestrator wrapped two existing assertions in `oracle()` from the lab's
`support/oracle.mjs`: the no-5xx guard inside the mail-outage experiment's `post` helper
(`c3-chaos-smtp-503`, `toBeLessThan`, Shop fault `smtp_failure_503`, under which the reset
endpoint answers 503 instead of the contract's 202 when SMTP is unreachable) and the
no-receipt-after-failed-fulfillment check in the restart experiment (`c3-chaos-receipt`,
`toHaveLength`, Shop fault `receipt_before_commit`). The wrapper rethrows the same error and
changes nothing on a passing run. The matrix runs this suite with one worker, as the
experiments were authored. No hypothesis, threshold, helper or other assertion changed.
