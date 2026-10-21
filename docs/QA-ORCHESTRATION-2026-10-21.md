# QA execution, host workflow, reports, and video material

## Outcome

The merged project had a useful collection of skills and controlled application tests.
This change adds an executable path from a project goal to selected skills, bounded
checks, observed results, and a readable report. A supporting coding agent can follow
the project workflow to author missing checks and make authorized repairs.

The distinction matters: the local CLI supplies routing, execution, and evidence.
The host supplies application reasoning and code changes. The project does not claim
that a command can validate every behavior of any arbitrary application.

Base reviewed: `462126bcc4d3bfe94a7c064b848c690c1366f343`.
Implementation branch: `codex/qa-orchestration-2026-10-21`.

## What changed

### A usable entry point

`scripts/qa.mjs` provides `plan`, `run`, and `init --wire-agent`. It discovers declared
tests, package manager, framework indicators, project context, changed paths, Git
revision, and dirty state. Routing chooses a small group of relevant skills and explains
the choice. It does not load all 50 skills for every request.

The CLI executes declared argv arrays with individual deadlines, a total run budget,
bounded output, and cleanup of owned subprocesses. Node TAP and Playwright JSON have
typed result adapters. Unsupported output, empty suites, skips, retries, cancellations,
missing tools, and timeouts cannot silently produce a clean result.

For a running URL, the browser phase checks HTTP status, the expected final URL, and
an application-owned readiness selector before scanning accessibility. A blank page
or unexpected login redirect does not count as a successfully checked application.

See [the runner guide](QA-RUNNER.md) for commands, configuration, browser setup, and CI.

### QA during normal coding tasks

The opt-in project instruction tells the host to inspect context, read the selected
skills, execute their domain workflows, author relevant missing checks when authorized,
run the checks, reproduce failures, and repair code within the user's task. Two
unsuccessful repair attempts end with a concrete blocker and retained evidence.

`qa-do` now carries action requests through execution instead of stopping at a routing
recommendation. `qa-start` uses repository evidence to resolve routine setup and does
not treat optional missing context as a reason to stop. Dashboard and release-readiness
guidance use the observed run while keeping uncovered work and release approval distinct.

`init --wire-agent` preserves existing project instructions and configuration. It does
not modify global host settings or install a background model. The host must read the
project's `AGENTS.md` for that workflow to activate.

### Reports with inspectable evidence

Every invocation gets its own directory with `report.html`, `result.json`, `plan.json`,
`agent-handoff.md`, concise and detailed logs, and per-check evidence. Reports retain
failed, blocked, incomplete, and unverified results and link to the underlying output.

The HTML escapes untrusted content and uses generated relative evidence links. Display
and log output redact known secret environment values and URL query/fragment data.
This is useful protection, not a claim that arbitrary application logs are free of
sensitive data.

The actual 49-case field report was rendered at 1440 px and 390 px. Both layouts had
matching viewport and scroll widths. Its automated accessibility scan reported zero
violations and zero incomplete rules. Retained previews:
[desktop](evidence/qa-orchestration-2026-10-21/qa-report-desktop.png) and
[mobile](evidence/qa-orchestration-2026-10-21/qa-report-mobile.png).

### More trustworthy gates

The workflow matrix requires the designated Playwright matcher to fail and attach
structured evidence with a matching run token. A matching test title, an arbitrary
exception, or an absent observation is insufficient. A failed healthy control stops
later fault variants and records them as unrun.

Each matrix invocation now isolates its fixture databases, service readiness files,
traces, and reporter output under unique run directories. An exclusive output lock
tracks the parent and active child. Interruption cancels the active process group;
stale or ambiguous ownership fails promptly with a fresh-directory remedy.

The agentic-browser gate executes a project-owned independent oracle and requires
typed evidence bound to the run, target, and build. A model's self-grade, a string
`"true"`, stale evidence, missing observations, or an unconfigured host adapter cannot
be promoted to a passing result. The external host adapter remains a prerequisite.

### Recipe and runtime repairs

- Accessibility recipes include the cumulative WCAG 2.0, 2.1, and 2.2 AA tags and
  require the intended page and visible application state before scanning.
- The callable accessibility helper supports explicit known gaps and exclusions
  without treating a nonempty rule count as proof that the intended page loaded.
- Hosted inbox requests have a client deadline covering both response headers and
  body parsing. Received-after checkpoints are taken immediately before the app action.
- The shared Python launcher honors an exact `QA_PYTHON` path, including spaces, and
  supports the existing platform defaults with a bounded runtime.
- Subprocess cleanup kills owned descendants even if their parent has already closed
  its pipes, including descendants that ignore SIGTERM.
- Node 24 reporter discovery avoids missing TAP and duplicate reporter arguments.
  Contradictory TAP counters and concatenated Playwright reports are rejected.
- Native browser evidence has a reserved namespace so a configured check cannot
  overwrite its evidence file.

## Fresh application task

A new agent, without inherited audit discussion or a defect hint, received a small
HTTP application's requirements and an ordinary release-review task. The fixture was
intentionally seeded with a free-shipping boundary defect.

The original three tests passed. At subtotal 5000, the real HTTP endpoint nevertheless
charged shipping of 500 and returned total 5500, while the requirements promised free
standard shipping at 5000 or more.

The agent added 46 assertions before changing the implementation. Three assertions
failed against the original code. It repaired `subtotal > 5000` to `subtotal >= 5000`;
all 49 assertions then passed, including 26 real HTTP checks. Temporarily reverting
the comparator made the selected boundary regression fail again, and restoring it
returned the candidate to passing. Every application process was stopped.

This is one fresh authoring-and-repair task on a controlled API fixture. It supports
the complete workflow for that task; it is not a success-rate estimate across projects.

Evidence: [task and source](evidence/qa-orchestration-2026-10-21/field-use/README.md),
[agent report](evidence/qa-orchestration-2026-10-21/field-use/evidence/REPORT.md),
[source diff](evidence/qa-orchestration-2026-10-21/field-use/evidence/source.diff),
[final HTML report](evidence/qa-orchestration-2026-10-21/field-runner-final/report.html), and
[final structured result](evidence/qa-orchestration-2026-10-21/field-runner-final/result.json).

## Verification

The final local run passed **375 regression tests**: 133 Python, 116 documented-helper,
92 browser-recipe, and 34 QA runner tests. The integrated CLI executed the latter three
groups in 55.609 seconds and observed no failures, skips, cancellations, TODOs, or retries.

| Evidence group | Final observation |
|---|---|
| Python validators, evaluator, scanner, and service helpers | 133 passed |
| Executed JavaScript examples and gate/process controls | 116 passed |
| Browser recipe regressions | 92 passed |
| QA runner, routing, report, and local browser/HTTP controls | 34 passed |
| Fresh shipping task | 49 passed after repair; 3 related failures before repair |
| Healthy application matrix control | 36 passed |
| Controlled fault variants | 22 of 22 designated assertions detected |
| Whole matrix | 628 repeated case executions: 588 passed and 40 intended failures |
| Structure and generated index | 50 skills, 0 errors, index in sync |
| Static content coverage | 484 of 516 cases matched; 32 flags, 817 semantic criteria deferred |

The full isolated matrix took 396.903 seconds. Independent review compared every failed
case/title with the expected fault symptoms: no extra or missing failures, no
infrastructure failures, no skipped or retried cases, and no source mismatches. All
51 matrix source hashes matched the reviewed files; all 23 artifact directories were
unique. The 628 executions repeat cases across variants and are not 628 unique tests.

Static coverage is a lexical check, not an agent success rate. The 32 flags and 817
deferred semantic criteria remain visible. The accessibility rubric was strengthened
from the older three-tag list to all five cumulative WCAG tags; the agentic rubric now
requires independent evidence, and the routing rubric includes action completion and
bounded repair behavior. Criteria were not removed to hide failing application tests.

Evidence: [summary](evidence/qa-orchestration-2026-10-21/summary.json),
[HTML regression report](evidence/qa-orchestration-2026-10-21/runner/report.html),
[Python output](evidence/qa-orchestration-2026-10-21/python.log),
[matrix](evidence/qa-orchestration-2026-10-21/matrix.json),
[independent matrix review](evidence/qa-orchestration-2026-10-21/matrix-review.json),
[raw matrix reporters and logs](evidence/qa-orchestration-2026-10-21/matrix-reports.zip), and
[static content results](evidence/qa-orchestration-2026-10-21/static-content.json).

Environment: Linux, Node 24.19.0, Python 3.12.14, Playwright 1.62.1, axe 4.14.0,
and Chrome 156.0.8078.47. Local browser and HTTP subprocesses required normal process
permissions; restricted sandbox attempts were not accepted as verification.

Tests ran against an uncommitted working tree based on the reviewed commit. The
[implementation hash manifest](evidence/qa-orchestration-2026-10-21/source-sha256.json)
binds the retained evidence to the source delivered in the implementation commit.
Documentation and packaging were completed afterward without changing tested code.

### Interrupted-run finding retained

An earlier full matrix used output directories also touched by a surviving child of an
interrupted run. Its pricing variant contained the intended assertion failure plus
three unrelated failures. The earlier gate did not recognize the browser spelling
`net::ERR_CONNECTION_REFUSED` as infrastructure failure.

The observed errors led to the unique directories, output lock, cancellation handling,
and stronger infrastructure rejection above. The affected run is preserved as
[matrix-interference.json](evidence/qa-orchestration-2026-10-21/matrix-interference.json)
and [matrix-interference.log](evidence/qa-orchestration-2026-10-21/matrix-interference.log).
It is not used as clean release evidence. The final matrix is a separate fresh run.

The field-task folder also retains the initial restricted-environment and Node reporter
failures. The final report does not erase those earlier observations.

## Video material

[Three storyboards](VIDEO-SCENARIOS.md) cover the shipping boundary repair, independent
session replay after logout, and the 22-fault proof. The eight-second motion graphic
is reproducible with `scripts/render-proof-animation.py` and has GIF, square MP4,
widescreen MP4, and cover-image exports.

The graphic illustrates the controlled campaign at the reviewed base commit. It is
not live footage of an agent making a source repair. The shipping example supplies
separate evidence for an actual host-agent repair.

## Review pass before landing

An independent code review of the implementation commit on 21 October 2026 reported
fifteen findings. These were repaired before the change reached `main`:

- `parsePlaywright` parsed from the first `{` to the end of the log, so pnpm's trailing
  `ELIFECYCLE` line or bun's "script exited" line after a failing report made the whole
  report unreadable and dropped the per-test counts. The adapter now extracts complete
  top-level JSON objects and still rejects a log that contains two reports.
- Discovery inserted `--` before extra arguments for every package manager. npm and bun
  strip it; pnpm forwards it, and Playwright then treats `--reporter=json` as a test
  filter. The separator is now npm-only (checked with npm 11, pnpm 10.22, bun 1.3.14).
- The routing rule for `report` matched the README's own example goal and routed it to
  `qa-dashboard` alone. A reporting skill no longer displaces the executing skill, and
  the bare word `regression` no longer selects `bug-reproduction`.
- A discovered `node --test` script that declares a non-TAP reporter was given the TAP
  adapter it could never satisfy; it is now recorded by exit code, and the node-test
  detection lives in one helper instead of three copies.
- A `results: [null]` entry threw inside the check loop and the run ended without
  `result.json`. The entry is now unsupported, and an unexpected throw records a blocked
  `runner-error` check while the evidence already observed is still written.
- Any environment value under a name containing `token`, `key`, `password`, `secret` or
  `credential` was redacted everywhere, so `TOKENIZERS_PARALLELISM=false` blanked every
  `false` in the evidence. Values shorter than eight characters, booleans and plain
  numbers are no longer treated as secrets.
- Lockfiles over 10 MB made `plan`, `run` and `init` fail; they are now hashed by stream.
- The browser worker wrote its observations only at the end, so an axe scan that overran
  the budget lost the HTTP and readiness results. It now publishes after each phase and
  races the scan against the remaining budget; the parent keeps partial observations and
  adds one blocked record. The `browser-browser-launch` double prefix and the shared
  cumulative duration are gone.
- The repository's own `qa.config.json` budget (180 s) was smaller than the sum of its
  per-check deadlines (210 s); it is now 240 s.
- The matrix lock's `child()` wrote its record in place and `release()` could throw from
  the matrix's `finally` block; the record is now replaced atomically and release failures
  are logged. A PID reused after a crash still reads as live; the message names the
  fresh-output remedy. The two `not_run` record shapes share one helper.
- `oracle()` called `test.info()` unconditionally and duplicated multi-line Playwright
  messages in the rebuilt stack; it now annotates only inside a running test.

Left as designed and documented in the runner guide: `CI=1` is set for declared commands,
so configuration keyed on it applies and a pass on retry stays incomplete.

After these repairs the complete verification ran on macOS arm64 (Node 26, Python 3.14),
which the implementation commit had not exercised: 133 Python tests, 116 helper, 92
browser-recipe and 37 runner tests, the healthy workflow control 36/36, the Mailpit
verification, and the 23-variant matrix with 22 verified detections.

## Remaining boundaries

- A host must interpret the selected skills and execute domain-specific work. No
  Claude/Codex CLI or model runtime is bundled inside the local runner.
- Dependencies, browser binaries, application access, real requirements, and suitable
  test data remain project prerequisites. Existing suites may own service startup.
- Automatic typed command evidence currently covers Node TAP and Playwright JSON.
  Other frameworks need an adapter before their successful exit can count as verified.
- The native URL check observes one supplied page. Authenticated journeys, provider
  contracts, mobile devices, other browser engines, and manual accessibility work
  require their corresponding project workflows.
- Local Shop payment behavior is an HMAC contract fixture, not a provider sandbox or
  a real financial transaction. No deployment, external report publication, or payment
  was performed by these tests.
- Linux with Node 24 and Chrome was exercised in this change. No new Windows or macOS
  execution is claimed. Remote CI can only establish its own result after publication.
- A finite set of passing controls cannot establish that all skills always work or
  that an application has no unknown defects. Semantic skill evaluations and broader
  production use remain separate from static content coverage.
