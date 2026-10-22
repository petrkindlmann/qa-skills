# With and without the skills: one Shop task, nine blind takes (2026-10-22)

## Question

Does an agent that reads four of this repository's skills write a Shop acceptance suite that
catches more real defects than the same agent given the same task without them? And how much
of any difference comes from the skills' contents rather than from the repository's general
agent rules in `AGENTS.md`?

## Answer

On this task and this model, not overall. All nine suites passed the healthy Shop twice, and
all nine caught eight of the nine pre-registered faults. The skills arm was the only one to
catch the ninth, a payment signature verified over re-serialized JSON instead of the raw
bytes, in all three takes (the other arms: one of three and two of three). That guidance was
written into `api-testing` during the first campaign on this same Shop, so the advantage is
real but partly circular. On a secondary set of ten other lab faults the skills arm caught 15
of 30, the rules-only arm 16 and the bare arm 18: the skills takes never tested the access
rule on test-only routes or the health latency budget, two contract clauses outside the four
skills' subjects. The skills made the three takes very alike (9/9 and 5/10 each) and cost
more: longer runs, more tool calls, more code.

## Method

- **Task.** One prompt: build and run a practical acceptance suite (roughly 8 to 12 tests) for
  the lab Shop, covering browser and API journeys, failure handling, and durable state under
  concurrency and restart, from the public contract only. Prompts are saved verbatim in each
  take's `task-prompt.txt` under `tests/workflows/generated/experiment/`.
- **Three arms, three takes each**, every take by a fresh agent on Claude Opus 5.5 at the same
  effort, authored one at a time:
  - **Skills** (`with-1..3`). Told to use `api-testing`, `playwright-automation`,
    `email-testing` and `payment-testing` from `skills/`, working in the repository, whose
    `AGENTS.md` is in its context.
  - **Rules only** (`without-1..3`). Works in a copy of the lab that contains no skills and no
    reports, and is told not to read outside it. It was meant to have no `AGENTS.md` either,
    but its transcripts show the harness attached the repository's `AGENTS.md` anyway, because
    the agent was started from the repository directory. It therefore had the general rules
    (evidence and execution, the QA-during-development steps, the skill catalogue by name)
    and none of the skill contents. No take in this arm opened a skill file.
  - **Bare** (`bare-1..3`). Added when that was found, before any scoring: the same prompt
    and lab copy, run as a fresh `claude -p` session started inside the lab, whose transcript
    shows no `AGENTS.md`, no project memory and no QA skill in its listing.

  Every take in every arm also had the user's global `CLAUDE.md`, which carries general working
  rules (verify before claiming done, keep changes scoped) and nothing about testing recipes.
- **Primary score, fixed before any take was scored.** Each take runs against the healthy Shop
  twice (both must pass) and then once under each of nine Shop faults. A fault counts as
  detected when the run fails cleanly (no timeout, no infrastructure error) and a second run
  under the same fault fails again with at least one failing title in common; a first failure
  that does not repeat is recorded as unstable. There is no designated oracle: any genuine
  assertion failure counts, and the failing titles are kept.
- **Secondary, exploratory score.** After authoring and before any scoring, the other ten Shop
  faults in the lab were added as a separate set, scored the same way and reported in full.
  They were not chosen for this experiment and are never added to the primary score.
- **Blindness check.** No take transcript contains a fault name or a read of the fault
  catalogue; the scorer's file name appears only in directory listings. Per-take model,
  duration, tool calls and attached instruction files are in
  [`integrity.md`](evidence/with-without-2026-10-22/integrity.md).
- **Lab repair before scoring.** The first take exposed a lab defect: the Shop's listen backlog
  of 5 made macOS reset bursts of concurrent connections. It was fixed (backlog 128, probe 284
  of 640 resets before, 0 after) before any take was scored.
- **Frozen skills.** Difficulties the skills-arm takes reported were queued and repaired only
  after all takes were authored, so the skills condition is the same for every take.

## Results

All nine takes passed both healthy controls in the primary run, with 11 or 12 tests each.

**Primary set** (takes that detected the fault, out of three per arm):

| Fault | Skills | Rules only | Bare |
|---|---|---|---|
| `cross_user_order_read` | 3 | 3 | 3 |
| `trust_client_amount` | 3 | 3 | 3 |
| `duplicate_fulfillment` | 3 | 3 | 3 |
| `receipt_before_commit` | 3 | 3 | 3 |
| `idempotency_payload_conflict` | 3 | 3 | 3 |
| `reusable_reset_token` | 3 | 3 | 3 |
| `logout_cookie_only` | 3 | 3 | 3 |
| `compensating_prices` | 3 | 3 | 3 |
| `canonicalized_signature` | 3 | 1 | 2 |
| **Total** | **27/27** | **25/27** | **26/27** |

**Secondary set** (exploratory):

| Fault | Skills | Rules only | Bare |
|---|---|---|---|
| `unlabeled_controls` | 3 | 3 | 3 |
| `plaintext_session_tokens` | 0 | 0 | 0 (one unstable) |
| `missing_idempotency_index` | 0 | 0 | 0 |
| `no_login_throttle` | 3 | 3 | 3 |
| `open_test_support` | 0 | 1 | 3 |
| `smtp_failure_503` | 0 | 0 | 0 |
| `slow_health` | 0 | 1 | 2 |
| `wrong_currency_event` | 3 | 3 | 2 (one invalid) |
| `reset_email_dropped` | 3 | 3 | 3 |
| `catalog_currency_missing` | 3 | 2 | 2 |
| **Total** | **15/30** | **16/30** | **18/30** |

Per take, primary then secondary: with-1 9 and 5, with-2 9 and 5, with-3 9 and 5;
without-1 8 and 7, without-2 8 and 4, without-3 9 and 5; bare-1 8 and 6, bare-2 9 and 5,
bare-3 9 and 7.

**Host sleep during the secondary run.** The laptop lid was closed twice while the secondary
set ran (03:50 to 04:22 and 04:39 to 04:44 local). Exactly four runs overlapped those windows,
all in the bare arm, and all four were killed as timeouts after stretching to 251 to 1,085
seconds against a 256-second bound. They were re-run awake under `caffeinate`, and the re-run
results replace them: bare-1 `smtp_failure_503` missed, `slow_health` detected,
`wrong_currency_event` detected. bare-2's re-run failed its own second healthy control (a
browser status line that updated after the 4-second assertion window, while the server had
answered 200), so its `wrong_currency_event` stays invalid and was not re-run again. The
original runs, the re-runs and the power log are all in the evidence folder; the scorer now
records each run's wall-clock start and end so this can be checked from the evidence alone.
The primary run and all authoring took place while the machine was awake.

**Cost.** The skills takes ran longer, made more tool calls and wrote more code for about the
same number of assertions:

| Arm | Wall time per take | Tool calls | Code lines | `expect` calls | Tests |
|---|---|---|---|---|---|
| Skills | 539 to 964 s | 46 to 94 | 638 to 777 | 139 to 207 | 11 to 12 |
| Rules only | 484 to 580 s | 20 to 26 | 540 to 596 | 192 to 195 | 11 to 12 |
| Bare | 408 to 517 s | 32 to 36 | 455 to 562 | 168 to 200 | 11 to 12 |

Code lines exclude blanks and comment-only lines. Part of the skills arm's extra time went into
reconciling the skills with this harness: TypeScript and page objects against a fixed `.mjs`
suite, Stripe's 400 against the contract's 401, Zod and AJV that were not installed.

## What the difference consists of

- **Where the skills helped.** Five of the six detections of `canonicalized_signature` came
  from a test that sends whitespace-changed bytes under the original signature and expects a
  refusal; with-3 caught it from the other side, a non-compact body correctly signed over its
  own bytes that the faulty server refused. `api-testing` asks for exactly this ("sign the
  exact bytes sent; include a valid noncanonical JSON representation"). The two arms without
  the skill wrote it in three of six takes. That paragraph entered the skill in the same
  commit that added this fault to the Shop, as did the skill's guidance on revocation,
  persistence, calculated values and idempotency, which map onto the other primary faults.
  Those eight faults were caught by every take in every arm, so for them the model's own
  knowledge was enough; the signature case is the one where the written lesson still made the
  difference.
- **Where the skills narrowed the suite.** `open_test_support` (test-only routes must refuse a
  caller without the admin key) and `slow_health` (the health endpoint's stated latency
  budget) are contract clauses that none of the four skills is about. No skills take tested
  either; the bare arm tested the first in all three takes and the second in two. Every take
  that caught `open_test_support` did so through an unauthenticated request to a test-support
  route expecting 403, and every take that caught `slow_health` through a timing assertion on
  `/health`. Being told to use four named skills appears to have pulled attention onto their
  subjects and away from the rest of the contract.
- **What no arm caught.** `missing_idempotency_index` (a race that three-request bursts do not
  reliably hit), `plaintext_session_tokens` (needs a check of how sessions are stored, which no
  take made) and `smtp_failure_503` (most takes noted they could not stop the shared Mailpit)
  were missed by every take. They mark the edge of what this task invites, not a difference between
  arms.
- **Consistency.** The skills takes scored identically (9 and 5) and reported difficulties
  with the same four skills in nearly the same terms. The other arms varied more between
  takes.

## What changed because of it

- **Skill repairs from the takes' own reports**, applied after all takes were authored, in
  commit `3c52d9f`: the conditional `retry-after` example in `api-testing` that contradicted
  its own anti-pattern, a fallback when no schema library may be installed, the Stripe-only
  400 in `payment-testing`, the Mailpit empty-ID delete that empties a shared inbox (with a
  cleanup helper the example tests now execute), and the TypeScript, page-object and label
  assumptions in `playwright-automation`.
- **A contract sweep in `api-testing`'s Done When**: every clause the contract states gets a
  test or an explicit "not covered" line, including access rules on admin and test-only
  routes, latency budgets and health endpoints. This was written after seeing the secondary
  result, so those two faults can no longer serve as an unbiased check of it.
- **Harness.** A subagent started from this repository always carries `AGENTS.md`; a
  skills-free condition needs a fresh session started outside it, verified from the
  transcript. The scorer records wall-clock bounds per run.

## Limitations

- Three takes per arm on one task and one model. The comparison shows what happened here; it
  is not an effect size with a confidence interval.
- The primary faults are this lab's original Shop faults, and `api-testing` was repaired during
  the campaign that created them. The primary set therefore partly measures whether those
  lessons were written down. The secondary faults were added in later campaigns for other
  skills and are less entangled with these four.
- Every arm brings the model's own testing knowledge; the comparison measures what the four
  skills and the agent rules add on top of it, not testing knowledge as such.
- The bare arm runs as a top-level print session and the other two as subagents, so its system
  prompt differs from theirs as well as its instruction files. The with-skills prompt also
  allows reading the runtime support file, which the other prompts restrict; all three skills
  takes read it, and it names no fault.
- Fault detection does not measure readability, maintenance cost, or how well a suite explains
  a failure.

## Evidence

Folder: [`docs/evidence/with-without-2026-10-22/`](evidence/with-without-2026-10-22/).

- `primary.json` and `primary.log`: the primary run, with failing titles per detection.
- `secondary.json` and `secondary.log`: the secondary run as it happened, including the four
  sleep-affected runs.
- `secondary-rerun-bare-1.*` and `secondary-rerun-bare-2.*`: the awake re-runs.
- `host-sleep.txt`: the macOS power log for the session.
- `integrity.md`: per-take model, duration, tool calls, instruction files and blindness check.
- The nine suites, with their prompts, execution logs and final responses:
  `tests/workflows/generated/experiment/`. The scorer: `tests/workflows/run-experiment.mjs`.
