# Real Mailpit email verification

This directory contains a reproducible, localhost-only Mailpit service and executed Playwright tests of real SMTP delivery, HTTP capture, HTML reset-link extraction, and recipient-safe cleanup. It was adapted from `skills/email-testing/SKILL.md` and `references/mailpit-playwright.md` after reading the repository `AGENTS.md`. The available QA project-context file was a placeholder template; the task supplied the concrete local-only choices.

## Pin and prerequisites

`release.json` pins **Mailpit v1.31.6**, published 2026-10-15 and verified against official GitHub release metadata on 2026-10-21, with one official asset per supported platform.

| Item | Value |
| --- | --- |
| Official release | https://github.com/axllent/mailpit/releases/tag/v1.31.6 |
| Pinned API specification | https://raw.githubusercontent.com/axllent/mailpit/v1.31.6/server/ui/api/v1/swagger.json |
| API specification SHA-256 | `77cd5441b66fabfadaee3fafc84e63c927edc0eaed88590d82745c94b663f3ca` |
| Tested runtime (Linux) | Node `v24.19.0`, Python `3.12.14`, `@playwright/test` `1.62.1` |
| Tested browser (Linux) | Google Chrome `156.0.8078.47`, provided by the parent workflow at `/tmp/qa-skills-chrome/opt/google/chrome/chrome` |
| Tested runtime (macOS) | Node `v26.0.0`, Python `3.14.6`, Playwright-installed Chromium headless shell `151.0.7922.34`, 2026-10-21 |
| Candidate commit | `e876dcfd6194066d1d697aea9ca6d7e08d2ce123` plus the workflow files recorded by SHA-256 in each evidence file |

| Platform key | Official archive | Archive SHA-256 | Extracted executable SHA-256 |
| --- | --- | --- | --- |
| `linux-amd64` | `mailpit-linux-amd64.tar.gz` (asset 642736510) | `10fa12ccc610f653d4ed4df848c1817f9935dcf4e9a6a458a19ab0fa02093f91` | `89ad3d1987140f5f4432be497e0aa8fbf1e8a6bb30258b7d35d5ea4bedfcd4df` |
| `darwin-arm64` | `mailpit-darwin-arm64.tar.gz` (asset 642736475) | `1411270aa8fd7f4fb0cc358318754d7bb7c2c30bfd70572dd12d05a53e956373` | `2213c19efa6ee6f009ab7f4b2b686e037bedac7e56e0b05e20149653df843017` |

Archive digests are the `digest` values GitHub publishes per release asset; executable digests were computed from the extracted file. The binary and archive live only below `/tmp/qa-mailpit-runtime/mailpit-1.31.6-<platform>/`. The install command selects the asset for `platform.system()` and `platform.machine()`, downloads it over HTTPS only (no redirect may leave HTTPS, and the transfer is capped at the pinned byte count), verifies both hashes, extracts only the expected regular executable, and checks `mailpit version --no-release-check`. Subsequent runs reuse the verified download. Any other platform fails before downloading and needs a separately reviewed asset pin. Process liveness uses `/proc` where it exists and `ps -o stat=,lstart=` elsewhere.

The parent workflow supplied the matching installed Playwright Test package and local browser. This directory did not change root dependencies, CI, or any skill. The default browser cache was absent, so this environment needs `QA_BROWSER_EXECUTABLE` as shown below.

## Commands

These commands are from `/workspace/scratch/db79cfa7c2bc`, matching the execution evidence. No unbounded process is needed: the detached service and foreground service both have a maximum lifetime.

```bash
python qa-skills/tests/workflows/mailpit/mailpit_service.py install

# Start and return verified connection JSON. Port 0 means choose a free loopback port.
python qa-skills/tests/workflows/mailpit/mailpit_service.py start \
  --instance local-app --ttl 1800 --ready-file /tmp/qa-mailpit-runtime/local-app-ready.json

# Print exports for the application: MAILPIT_URL, SMTP_HOST, SMTP_PORT, SMTP_SECURE.
python qa-skills/tests/workflows/mailpit/mailpit_service.py env --instance local-app

# Probe the installed API version, unique database identity, and real SMTP NOOP.
python qa-skills/tests/workflows/mailpit/mailpit_service.py status --instance local-app

# Stop this instance only; does not signal unrelated PIDs or purge any shared inbox.
python qa-skills/tests/workflows/mailpit/mailpit_service.py stop --instance local-app
```

For a process-owning app/test launcher, use foreground `serve`; terminate it with SIGTERM after the ready file exists:

```bash
python qa-skills/tests/workflows/mailpit/mailpit_service.py serve \
  --instance root-flow --ttl 1800 \
  --ready-file /tmp/qa-mailpit-runtime/root-ready.json --verbose
```

Ready JSON includes `smtp_host`, `smtp_port`, `base_url`, and `http_url`, plus uppercase environment keys, PIDs, log paths, and the actual command. The server binds SMTP and HTTP specifically to `127.0.0.1`; ports are dynamic by default and configurable using `--http-port` and `--smtp-port`. An occupied requested port fails before launching the server. Do not concurrently launch two callers with the same instance name; give every independently owned service its own name. Readiness is bounded to 15 seconds, downloads to 60 seconds, normal stop to 8 seconds, and service TTL to 10–3600 seconds. A TTL supervisor terminates the actual Mailpit child even if a caller forgets cleanup. The foreground wrapper removes its ready file on normal signal-driven stop.

All inherited `MP_*` settings are stripped before launching Mailpit. No relay, forwarding, webhook, POP3, link checking, or SpamAssassin service is configured. Version checks and SMTP reverse DNS are disabled. SMTP accepts only synthetic `@example.test` recipients. The service has no test-inbox auto-pruning (`--max 0`), so one worker cannot lose messages to a count limit.

### Run the four integration tests

```bash
QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome \
  python qa-skills/tests/workflows/mailpit/run_verification.py

QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome \
  python qa-skills/tests/workflows/mailpit/run_verification.py \
  --verbose --workers 4 --repeat-each 3

# Intentionally fails with exit 1: proves a bad template subject is detected.
QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome \
  python qa-skills/tests/workflows/mailpit/run_verification.py --bad-subject

python qa-skills/tests/workflows/mailpit/check_lifecycle.py
```

Each verification run creates a private service, exports its dynamic ports to Playwright, writes evidence to a new timestamped directory, verifies that owned cleanup leaves zero messages, and stops the service. Use `--run-name NAME` to choose a new, unused evidence directory. The run enforces Playwright Test 1.62.1, zero retries, a 180-second global test timeout and a 190-second process timeout. Verbose mode records individual HTTP requests, polling attempts, captured IDs, and explicit deletion IDs; minimal mode emits normal test outcomes. Both retain machine-readable results and source hashes.

## What is actually exercised

1. **A real SMTP reset behind 55 newer decoys.** The intended recipient is absent from the ordinary 50-message first page, then found by `/api/v1/search?query=to:...` with an exact recipient check. A second message is delayed by the fixture producer for 450 ms while the test starts polling immediately. The first captured ID is excluded. Both minimal and all three repeat runs required five poll attempts for the second email.
2. **Actual captured HTML.** Chromium's inert `DOMParser` decodes `&amp;`/`&#38;` and extracts anchor attributes. The helper requires the exact origin, `/reset`, exactly one nonempty `token` parameter, and one distinct URL. Equivalent duplicate anchors are accepted; missing links/tokens, another origin, credential-bearing URLs, ambiguous links, duplicate token parameters, and relative URLs are rejected. These cases are sent over SMTP and fetched over HTTP before extraction.
3. **Content and real failure paths.** The positive case checks subject, sender, recipient, reply-to, and `X-Test-Run` fetched from the separate `/api/v1/message/{ID}/headers` endpoint. A previously observed message cannot satisfy a second request. A recipient with no mail times out within its specified bound. An explicit nonexistent message ID produces a real HTTP 404. The separate bad-subject run proves the subject assertion fails after receiving the real email.
4. **Scoped cleanup with a surviving foreign owner.** Every test attempt uses UUID-based recipients. Cleanup checks exact single-recipient ownership and the `X-Test-Run` value before sending a nonempty `{ "IDs": [...] }` deletion body. It validates all proposed IDs before deletion. Empty-ID cleanup makes no deletion request; another recipient's ID and a wrong run marker are rejected. An observed sentinel carrying another owner marker survives the first owner's cleanup. The sentinel is then removed by its own fixture teardown.

No Mailpit response is mocked. The SMTP sender uses Python's standard `smtplib`; the reader uses Playwright's real HTTP request context. The only intentional delay is in the synthetic producer; consumers use bounded `expect.poll`, not a fixed sleep before inbox reads. Cleanup never sends an unscoped `DELETE /api/v1/messages` request, because the official API defines an omitted/empty ID list as deletion of the entire inbox.

## Observed results

| Execution | Result | SMTP messages accepted | Messages after owned cleanup | Evidence |
| --- | --- | ---: | ---: | --- |
| First attempt, default missing browser | 2 passed; 2 blocked at browser startup, before their bodies ran | 3 | 0 | `artifacts/first-run.log`, `artifacts/first-run-results.json` |
| Minimal, 4 workers | 4 passed; 0 skipped/flaky, 2.6 s | 68 | 0 | `artifacts/minimal/evidence.json`, `playwright.log`, `results.json` |
| Verbose, 4 workers × 3 repeats | 12 passed; 0 skipped/flaky, 6.2 s | 204 | 0 | `artifacts/verbose-repeat3/evidence.json`, `playwright.log`, `results.json`, `server_log.log` |
| Intentional bad subject | 1 failed at the subject assertion; exit 1, 3.2 s | 57 | 0 | `artifacts/negative-subject/evidence.json`, `playwright.log`, trace/screenshot |
| Foreground lifecycle | Passed; occupied-port refusal and clean SIGTERM shutdown | No message required | N/A | `artifacts/lifecycle.json` |

The negative control received `Account newsletter` where `Reset your password` was required. It remains reported as a failed test, with its nonzero exit status preserved. Minimal, verbose, and negative verification instances all stopped with exit 0 after the test command finished.

Setup discovery also exposed that this binary uses `version --no-release-check`; `--version` and `version --disable-version-check` are unsupported. Those exploratory failures were corrected before the recorded successful runs.

These checks prove the real inbox boundary, assertions, extraction, and cleanup. They do not submit an application reset form or change an account password; the parent workflow integrates the helper with the app's UI/reset/login test. SPF/DKIM/DMARC and external deliverability are outside this localhost capture test.

## Official references

- API overview: https://mailpit.axllent.org/docs/api-v1/
- Pinned API specification: https://raw.githubusercontent.com/axllent/mailpit/v1.31.6/server/ui/api/v1/swagger.json
- Runtime configuration: https://mailpit.axllent.org/docs/configuration/runtime-options/
- Release metadata: https://api.github.com/repos/axllent/mailpit/releases/tags/v1.31.6

`task-prompt.txt` preserves the assigned task, and `final-output.md` preserves the complete handoff response.
