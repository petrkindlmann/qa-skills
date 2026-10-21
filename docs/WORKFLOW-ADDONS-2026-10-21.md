# Addon workflows, 21 October 2026

A continuation of the [real-workflow campaign](REAL-WORKFLOWS-2026-10-21.md) on the same
fixtures: the pinned official TodoMVC, the local HTTP/SQLite Shop and the real Mailpit
binary. The earlier round exercised nine skills through application tasks. This round adds
four skills that had only static coverage, eight more deliberate defects, and the ability to
run every suite on an arm64 Mac.

## Outcome

| Check | Result |
| --- | ---: |
| Addon acceptance cases, healthy fixtures, desktop | **11 passed** |
| Same cases at phone width, four workers, two repeats | **22 passed** |
| Combined healthy suite (baseline + review + addons) | **36 passed** |
| Addon defect variants caught by the designated assertion | **8 of 8** (7 on the first pass; see below) |
| Original 14 defect variants against the enlarged suite | **14 of 14** (see `workflow-addons-2026-10-21/evidence/matrix.json`) |
| Real Mailpit SMTP/API/browser checks on macOS arm64 | **4 passed**, lifecycle check passed |
| Repository gates after the skill edits | validator 0 errors, index in sync, static coverage 93.8 %, 133 Python + 85 example + 84 browser tests |

Provenance is different from the baseline suites and matters for reading these numbers.
The eleven cases and the eight faults were written by Claude Fable 5.1 with the public
contracts, the shared runtime, the earlier report and the four skills open. They establish
that the recipes in those skills execute against a running application and that their
assertions fail for the designated regressions. They do not measure blind authoring by a
fresh agent, and they are not a reliability percentage for the skills.

## What was added

### Accessibility (`accessibility-testing`)

The documented `checkAccessibility` helper was ported to the suite with one addition: a scan
that evaluated no rules fails instead of passing. It scans the Shop sign-in page, the
signed-in account state and the reset form, all clean under `wcag2a`, `wcag2aa` and
`wcag22aa`. A keyboard-only sign-in walks Tab order (Email, Password, Sign in) and submits
with Enter. The pinned TodoMVC promises no conformance, so its populated list is asserted
against an explicit baseline: exactly `button-name` and `label`, both on row controls. A new
rule firing, or one of these being fixed, changes the test.

The skill's install advice named a stale minor (4.11.x; 4.14.0 was current on 2026-10-21).
The skill and recipe now say to pin the exact current release and review each bump.

### Data at rest (`database-testing`)

Node's built-in `node:sqlite` opens the Shop's own database read-only. Session tokens must be
64 hex characters that neither equal nor contain the cookie value, passwords must be salted
hashes, and logout must remove the row. A constraint test inserts a duplicate
`(user_id, idem_key)` inside a transaction that is always rolled back and expects SQLite
itself to refuse it; the unique index is resolved by its columns, not its name. A third case
checks `integrity_check`, `foreign_key_check` and three orphan queries after a payment and a
logout.

### Hardening (`security-testing`)

The Shop fixture gained a failed-login throttle: five failures for an address within 60
seconds, then 429 `too_many_attempts` with `Retry-After: 60` for every further attempt
including the correct password. Unknown addresses throttle identically, so the limiter cannot
enumerate accounts. The test advances the fixture clock instead of sleeping. A second case
proves the test-support routes stay locked without, with a guessed and with an empty key. A
third starts a Shop whose SMTP port is closed and requires the reset request to stay a
uniform 202 while the `smtp_errors` counter records the outage.

### Lab performance (`performance-testing`)

`PerformanceObserver` measures LCP and CLS on TodoMVC with loopback budgets (1500 ms, 0.1).
The entry field is also anchored to where it first rendered and must not move during the
settle window or while rows are added.

## What escaped, and what it taught

The first CLS control did not catch the `layout-shift` fault. A 240 px banner inserted 400 ms
after load pushed the whole app down, and the measured CLS was **0.072**: the score weights a
shift by the area it moves, and a compact app on a 1280×800 viewport moves little area. The
budget passed while every user would have seen the jump. The test now also compares the entry
field's bounding box with its first-render position, which fails for the same fault at both
desktop and phone widths. The `performance-testing` skill and its recipe carry the same
anchor. This is the only one of the eight addon faults that needed a second pass, and the
escaped run is recorded in the evidence rather than replaced.

## The review pass

A code review of the diff (Claude Code `/code-review`, high effort) returned eight findings.
Six changed the code: the per-variant Playwright cap stayed at 90 s while the combined suite
grew to 36 cases and one loaded local run finished 0.4 % under it, so the cap now scales with
the case count; the HTTPS download read fixed 64 KiB blocks, which let a trickling server
outlive the 60 s deadline, so it reads whatever has arrived; the mail-outage fault was named
`smtp_failure_500` while returning 503 and is now `smtp_failure_503`; the macOS liveness check
spawned `ps` five times a second for the whole service TTL and now memoizes the identity for
two seconds behind a signal-0 probe; the addon helpers copied the baseline Shop helpers and
now import them; and the login handler used `row = None` as a hidden failure flag, replaced by
an explicit `accepted` outcome. The remaining two were process notes: the new report files had
to be in the same commit as the links to them, and the CI cost of the larger matrix had to be
stated. Both are handled in the delivery message. The matrix was re-run on the reviewed code
before the evidence below was retained.

## Fixture faults added

| Fault | Fixture | Designated assertion |
| --- | --- | --- |
| `unlabeled_controls` | Shop page: captions no longer label their inputs | no WCAG 2.2 AA violations |
| `plaintext_session_tokens` | Shop: session table stores the raw bearer value | hashed at rest |
| `missing_idempotency_index` | Shop: migration dropped `UNIQUE(user_id, idem_key)` | idempotency uniqueness |
| `no_login_throttle` | Shop: failed logins never throttle | throttled per account |
| `open_test_support` | Shop: support routes shipped without the key check | locked without the admin key |
| `smtp_failure_503` | Shop: a mail outage turns reset into 503 for real accounts | mail service is down |
| `delayed-render` | TodoMVC: shell hidden until a 2.5 s bootstrap | largest content within the lab budget |
| `layout-shift` | TodoMVC: late 240 px banner above the app | layout stays stable |

Each fault is a single-location switch in `tests/workflows/fixture-app/faults.py` or an exact
one-match mutation of served bytes in `tests/workflows/upstream-todomvc/faults/mutations.mjs`;
original upstream files are unchanged.

## Running on macOS

The Mailpit installer pinned Linux AMD64 only, downloaded with `curl` and read `/proc` for
process identity, and the runtime launched `python`, which macOS does not ship. The pin now
carries one official asset per platform (Linux AMD64 and macOS arm64) with the digests GitHub
publishes per asset, downloads over HTTPS only with the transfer capped at the pinned size,
falls back to `ps` for process identity, and launches `python3` unless `QA_PYTHON` says
otherwise. Six Python tests cover the asset selection and the download guards. The complete
suite, including the real Mailpit checks, ran on an arm64 Mac with Node 26, Python 3.14 and
the Playwright-installed Chromium headless shell.

## Limits

Lab budgets are loopback numbers and prove regressions, not production speed. The axe scan
covers the rules axe ships; WCAG 2.2 criteria without rules still need manual checks. The
throttle, the locked routes and the mail outage are fixture behaviours; a real service's
limiter, admin surface and provider failures need their own evidence. Chromium only. Hosted
CI runs the Linux path; the macOS results come from one machine.

## Reproduce

```bash
npm ci
npx playwright install chromium
npm run workflow:setup
npm run test:workflows            # 36 healthy cases
npm run test:mailpit
npm run test:workflow-controls    # 23 variants, every designated assertion must fail
QA_WORKFLOW_VIEWPORT=mobile QA_WORKFLOW_SUITE=$PWD/tests/workflows/generated/addons \
  npx playwright test --config tests/workflows/playwright.config.mjs --repeat-each=2
```
