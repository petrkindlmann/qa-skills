# QA runner

Run existing project checks, choose relevant skills, and retain a readable evidence report. Requires Node 24 or later and this repository's dependencies. The target application and its required services must already be available.

## One command

From this repository:

```bash
node scripts/qa.mjs run --project /path/to/app --goal 'Check the account changes'
```

With no config, the runner discovers `package.json`'s `test` script and invokes the project's package manager. It recognizes npm, pnpm, Yarn, and Bun from the declared package manager or lockfile. Extra arguments such as `--reporter=json` are separated with `--` for npm only; pnpm forwards that token to the script. It does not install missing dependencies, start servers, run builds, or deploy. A declared test script remains executable project code, including any package-manager lifecycle scripts it invokes. Use a project you are authorized to test.

For Node's test runner, discovery requests TAP through `NODE_OPTIONS` when no reporter is already declared in the script, argv, or existing options. For a Playwright test script, discovery appends `--reporter=json`. For a Vitest script that declares no reporter, discovery appends `--reporter=junit --outputFile=.vitest/qa-junit.xml` and reads that file back (Vitest 5 writes the reporter to a file; older versions print it). A script with multiple test processes must be split into separate configured checks. A custom reporter, shell chain, or other framework can require an explicit command.

Browser checks use the dependencies installed in this QA Skills checkout. An application-owned readiness state and an exact final URL prevent a blank page or login redirect from becoming a passing accessibility scan:

```bash
node scripts/qa.mjs run --project /path/to/app \
  --url http://127.0.0.1:3000/account \
  --ready-selector '[data-testid="account-ready"]' \
  --goal 'Check account accessibility'
```

The expected URL defaults to `--url`. Use `--expected-url` for an intentional redirect. Without a readiness selector, the runner records the HTTP response and marks application readiness blocked. It does not scan an unconfirmed page. The browser runs in a new isolated context; authenticated pages need a project-specific browser test command and fixture. `QA_BROWSER_EXECUTABLE` can point to an already installed compatible Chrome/Chromium binary; otherwise Playwright uses its installed Chromium.

## Configuration

`init` creates `qa.config.json` from the discovered test command and preserves an existing config:

```bash
node scripts/qa.mjs init --project /path/to/app --wire-agent
```

`--wire-agent` is explicit. It appends or replaces a marked workflow block in that project's `AGENTS.md`, preserving surrounding content. It refuses conflicting markers and a symlinked `AGENTS.md`. It does not change global agent settings. The block asks a supporting host agent to inspect the diff, read the selected skills, execute checks, investigate failures, make repairs only within the user's authorized task, and rerun at most twice. The host still decides how to apply the instructions.

Example config:

```json
{
  "version": 1,
  "goal": "Check checkout and receipt delivery",
  "budgetMs": 180000,
  "checks": [
    {
      "id": "unit",
      "command": ["node", "--test", "--test-reporter=tap", "tests/prices.test.mjs"],
      "reporter": "tap",
      "timeoutMs": 60000
    },
    {
      "id": "checkout",
      "command": ["npm", "run", "test:e2e", "--", "--reporter=json"],
      "reporter": "playwright-json",
      "timeoutMs": 90000
    }
  ],
  "url": "http://127.0.0.1:3000/",
  "browser": {
    "expectedUrl": "http://127.0.0.1:3000/",
    "readySelector": "[data-testid=store-ready]",
    "accessibility": true,
    "timeoutMs": 15000
  }
}
```

`checks` replaces discovery. An empty array requests no project commands. Commands are argv arrays; the runner never interprets them as shell strings. Any explicit `sh -c` or package script you configure can still invoke a shell. Every check needs a unique lowercase id, command, and reporter. `browser` and `browser-*` ids are reserved for native browser evidence. Unknown config fields, duplicate ids, invalid URLs, and invalid durations fail before execution.

| Setting | Meaning |
|---|---|
| `version` | Required literal `1`. |
| `checks[].reporter` | `tap`, `playwright-json`, `junit-xml`, `ctrf-json`, or `exit-code`. |
| `checks[].resultFile` | The relative path the command writes its report to. Optional for `junit-xml` (pytest `--junitxml`, jest-junit, gotestsum `--junitfile`), required for `ctrf-json`. The file counts only when this command produced or rewrote it. |
| `checks[].timeoutMs` | 100 to 900000 ms; default 90000. |
| `budgetMs` | Total execution budget, 100 to 3600000 ms; default 180000. |
| `browser.timeoutMs` | 100 to 90000 ms; default 15000, with bounded worker setup/cleanup allowance. |
| `browser.accessibility` | Defaults to true. Uses cumulative WCAG 2.0 A/AA, 2.1 A/AA, and 2.2 AA tags. |
| `--config` | Explicit config path, relative to project or absolute. |
| `--output` | Parent directory for a new unique run folder; default `<project>/qa-results`. |
| `--verbose` | Also print the redacted command logs. |

## Results that do not hide missing work

The Node TAP adapter requires a header, root plan, observed test records, and reconciling counters from one run. The Playwright adapter reads an entire fresh JSON report from the running process's output. No earlier report file is reused. It requires actual result attempts with typed retry and error records. The JUnit XML adapter accepts the shape pytest, Vitest, jest-junit, mocha-junit-reporter, gotestsum and Surefire write: one root, one `<testcase>` per test, and suite counters that must reconcile with the recorded cases. It reads the command output, or the declared `resultFile` when the command produced or rewrote it during the run; a stale, missing, symlinked or oversized file is reported as incomplete, and Surefire's flaky and rerun records count as retries. The CTRF adapter reads a `reportFormat: "CTRF"` document from `resultFile` (jest-ctrf-json-reporter, cypress-ctrf-json-reporter, vitest-ctrf-json-reporter, pytest-json-ctrf); its summary must reconcile with the test list, `pending` counts as skipped, and `other`, flaky or retried tests stay incomplete. No adapter treats skips, cancellation, TODO tests, retries, expected failures, or an empty suite as a clean run.

| Outcome | Meaning | CLI exit |
|---|---|---:|
| Passed | Every configured check has passing observed evidence. | 0 |
| Failed | An assertion or declared command failed. | 1 |
| Blocked | A required executable, browser, readiness contract, or execution budget prevented completion. | 2 |
| Incomplete | Observations were absent, skipped, retried, cancelled, or not in a supported report format. | 2 |
| Unverified check | An `exit-code` command completed but provided no typed test evidence; overall run remains incomplete. | 2 |

Browser HTTP/readiness/axe checks are observations, not authored test cases. Their results count as checks; they are not added to the report's test count. An axe result with rules requiring review remains incomplete, and a clean automated result does not establish full accessibility conformance. Test-command failures are evidence of a failing check, not proof that the product rather than its environment is at fault.

## Routing and handoff

```bash
node scripts/qa.mjs plan --project /path/to/app --goal 'Reproduce why logout leaves the old session usable'
```

`plan` reads manifests, lockfiles, available test scripts, optional project context, Git commit/diff metadata, and existing configuration. It writes no files and runs no tests. It emits one or two primary skills plus up to four relevant supporting skills, with reasons and absolute skill paths. Rules distinguish test generation from testing an AI feature, one flaky locator from bulk selector recovery, a single defect from batch triage, native devices from browser engines, and tracking data from consent policy. Changed paths can add focused supporting coverage.

The CLI is a deterministic runner and router. It does not call a model, author tests, or repair code. `agent-handoff.md` connects its observations to the host agent's next actions. The optional project workflow block makes that handoff available during subsequent authorized development work, subject to the host's support for project instructions.

## Report artifacts

Each run creates a unique directory with:

- `report.html`: standalone, responsive evidence report with check cards, routing reasons, next actions, and provenance.
- `result.json`: typed outcomes, counts, execution metadata, and next actions.
- `plan.json`: selected commands, target, environment, input hashes, and skill routes.
- `agent-handoff.md`: bounded instructions for the host agent.
- `minimal.log` and `verbose.log`: status summary and command output.
- `evidence/*.log`: each command's captured output.

Reports show the candidate commit and whether local changes existed. A dirty tree means the commit alone does not identify the source used. The input hashes identify the manifest/config/context files read, not a hash of the entire application. All known secret environment values and URL queries/fragments are redacted from retained output; application logs can contain other sensitive content, so inspect before sharing. HTML escapes untrusted content and accepts only generated relative evidence links. Report folders can contain application data; add `qa-results/` to the target project's ignore rules if desired.

The overall run budget bounds subprocess execution. On POSIX, termination targets each owned process group, with short TERM/KILL cleanup grace. Checks that cannot start within the remaining budget become blocked. Planning and report writes are outside that execution budget and are separately bounded reads/processes.

## Regression controls

```bash
node --test --test-isolation=none tests/qa/runtime.test.mjs
node --test --test-isolation=none tests/qa/browser.test.mjs
```

Runtime tests cover route selection, real Node projects outside Git, default and explicit reporters, failed and skipped cases, malformed/empty reports, missing executables, process timeout, opt-in workflow wiring, redaction, and hostile HTML. Browser controls run the full CLI against local healthy/inaccessible/redirected pages and real Playwright HTTP assertions. They use real local processes and sockets, so a restricted execution sandbox may require its normal local-process permission.
