## Mailpit work is complete

Implemented the real service and runnable verification under [tests/workflows/mailpit](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/README.md). The binary, archive, databases, and process state remain outside Git under `/tmp/qa-mailpit-runtime/`. I did not change skills, root dependencies/CI, or Git history.

### Ready integration contract

From the repository root:

```bash
python tests/workflows/mailpit/mailpit_service.py install
python tests/workflows/mailpit/mailpit_service.py serve \
  --instance root-flow --ttl 1800 \
  --ready-file /tmp/qa-mailpit-runtime/root-ready.json --verbose
```

[mailpit_service.py](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/mailpit_service.py) emits ready JSON containing `smtp_host`, `smtp_port`, `base_url`, and `http_url`. Both listeners bind to `127.0.0.1`; ports are dynamic unless explicitly supplied. Readiness checks the actual API version, unique database path, and SMTP NOOP. SIGTERM stops the binary and supervisor and removes the ready file. Download, startup, requests, shutdown, and service lifetime are bounded.

The early shared `app` instance remains available to the parent: SMTP **127.0.0.1:47079**, API **http://127.0.0.1:53841**, with its original one-hour expiry. Stop it when finished using `python tests/workflows/mailpit/mailpit_service.py stop --instance app`. All verification-only instances are stopped.

### Exact pin

The setup pins official **Mailpit v1.31.6 Linux AMD64**, published October 15, 2026. genui{"citation":{"ref":"turn54view0"}}

- Archive: [official release asset](https://github.com/axllent/mailpit/releases/download/v1.31.6/mailpit-linux-amd64.tar.gz).
- Archive SHA-256: `10fa12ccc610f653d4ed4df848c1817f9935dcf4e9a6a458a19ab0fa02093f91`.
- Executable SHA-256: `89ad3d1987140f5f4432be497e0aa8fbf1e8a6bb30258b7d35d5ea4bedfcd4df`.

[release.json](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/release.json) also records the exact API specification URL/SHA-256 and official metadata/documentation URLs. The helper verifies both binary hashes, strips inherited `MP_*` configuration, disables version-check networking and reverse DNS, configures no forwarding/relay, and accepts only synthetic `@example.test` recipients.

### Observed results

| Run | Outcome | Real SMTP messages accepted | Inbox after scoped cleanup |
| --- | --- | ---: | ---: |
| Minimal, four workers | **4 passed**, 2.6 s | 68 | 0 |
| Verbose, four workers × three repeats | **12 passed**, 6.2 s; none skipped/flaky | 204 | 0 |
| Deliberate wrong subject | **1 failed as intended**, exit 1 | 57 | 0 |
| Foreground lifecycle | **Passed**: readiness, occupied-port refusal, SIGTERM shutdown | N/A | N/A |

Evidence: [minimal](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/artifacts/minimal/evidence.json), [verbose repeats](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/artifacts/verbose-repeat3/evidence.json), [negative-control log](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/artifacts/negative-subject/playwright.log), and [lifecycle](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/artifacts/lifecycle.json).

The negative control received **“Account newsletter”** instead of **“Reset your password”**; its failed status remains preserved. The [first attempt](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/artifacts/first-run.log) is separately retained: two SMTP/API tests passed, while two browser-dependent tests stopped at startup because the default browser cache was absent. Completed runs used parent-provided Chrome **156.0.8078.47**, Node **v24.19.0**, Python **3.12.14**, and Playwright Test **1.62.1**.

### What was proved

The suite uses actual SMTP, Mailpit, HTTP responses, and Chromium DOM parsing—no mocked Mailpit responses. It finds the correct recipient behind **55 newer decoys**, excludes a stale reset ID, and immediately polls while a second producer delivery is delayed **450 ms**. Successful delayed capture took **five polling attempts** in the minimal run and every repeat.

Captured HTML entity decoding preserves tokens. Missing, unsafe, relative, duplicate-token, and ambiguous reset links fail. Subject, sender, recipient, reply-to, and the separate headers endpoint are checked. Stale-only and absent-recipient waits fail within bounds; a missing message ID produces a real HTTP 404.

Cleanup validates all explicit IDs against exact recipient ownership and `X-Test-Run` before deleting. Empty lists make no deletion request. Foreign IDs and wrong owners are rejected. An observed sentinel for another recipient/owner survives the first owner’s cleanup. Each verification inbox then reaches zero through its own teardown.

These checks cover the inbox and extraction. Application UI submission, password change, and login remain the parent workflow’s separate end-to-end step.

### Rerun

```bash
QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome \
  python tests/workflows/mailpit/run_verification.py

QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome \
  python tests/workflows/mailpit/run_verification.py --verbose --workers 4 --repeat-each 3

QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome \
  python tests/workflows/mailpit/run_verification.py --bad-subject

python tests/workflows/mailpit/check_lifecycle.py
```

The bad-subject command intentionally exits 1. Other commands exit 0 on success. Omit `--run-name` for fresh timestamped evidence. Reports preserve exact commands, environment, candidate commit `e876dcfd6194066d1d697aea9ca6d7e08d2ce123`, and hashes of executed workflow source.

The task and this complete response are saved as [task-prompt.txt](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/task-prompt.txt) and [final-output.md](sandbox:/workspace/scratch/db79cfa7c2bc/qa-skills/tests/workflows/mailpit/final-output.md).
