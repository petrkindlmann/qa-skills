# Run QA and keep the evidence

The full QA Skills checkout includes a local CLI that discovers a project's checks,
selects relevant skills, runs bounded commands, and writes a readable HTML report.
The coding agent uses the selected skills to design tests and make authorized repairs.
The CLI executes checks and records evidence; it does not call a model.

## Start with one command

From the QA Skills checkout, after `npm ci`:

```bash
npm run qa -- run --project /absolute/path/to/app --goal "Check the critical user flows"
```

For another working directory, use `node /absolute/path/to/qa-skills/scripts/qa.mjs`.
Node 24 is required. The project must have its own dependencies installed. A normal
`package.json` test script is discovered automatically; `qa.config.json` overrides it.
The CLI does not install packages, deploy changes, or start an unconfigured application.
Test suites may own their application lifecycle, such as Playwright's `webServer`.

The command prints the report path and returns:

| Exit | Meaning |
|---|---|
| `0` | All configured checks passed with observations |
| `1` | At least one executed check failed |
| `2` | Work is blocked, incomplete, or has no usable observation |

A zero-exit command whose test output cannot be interpreted stays incomplete. No tests,
skipped tests, missing tools, timeouts, and inaccessible targets cannot create a clean
application verdict. These results cover the configured checks, not every possible bug.

## Make QA part of coding tasks

```bash
node /absolute/path/to/qa-skills/scripts/qa.mjs init \
  --project /absolute/path/to/app --wire-agent
```

This creates `qa.config.json` if absent and adds an idempotent QA section to the project's
`AGENTS.md`. It preserves other instructions and existing configuration. The host must
read `AGENTS.md` for the workflow to activate; individual skill discovery remains host
dependent. No global settings or background services are installed.

The project instruction tells the host to:

1. Inspect project context, tests, the user's goal, and changed files.
2. Run `plan`, read the selected skills, and execute their domain workflows.
3. Run the configured checks and inspect the evidence report.
4. Reproduce failures and repair application code within the authorized task.
5. Rerun affected checks, preserving their assertions; stop after two unsuccessful repair
   attempts with a concrete blocker and remaining work.

This bounded loop is intentional. A failure must not trigger endless edits, broad
permission requests, assertion deletion, or repeated retries that hide its first result.
The CLI writes `agent-handoff.md` with next steps; the host carries out that work.

For a read-only preview of routing and commands:

```bash
node /absolute/path/to/qa-skills/scripts/qa.mjs plan \
  --project /absolute/path/to/app --goal "Check checkout and password reset"
```

`plan` executes no tests and writes no project files. Its skill choices are recommendations,
with reasons tied to the goal, manifest, and current changes. The host should resolve
ambiguous domain requirements from the actual application before authoring assertions.

## Check a running application

Install the QA checkout's browser once with `npx playwright install chromium`. Then:

```bash
node /absolute/path/to/qa-skills/scripts/qa.mjs run \
  --project /absolute/path/to/app \
  --url http://127.0.0.1:3000/ \
  --ready-selector '[data-testid="app-ready"]' \
  --goal "Check the running application"
```

Use an application-owned state that appears only after the page is ready. The browser
check requires the expected final URL and visible content before running accessibility
rules. Supply `--expected-url` if an intentional redirect changes that URL. A generic
empty page, login redirect, or response with HTTP 200 is insufficient evidence.

The default accessibility tags include WCAG 2.0 A/AA, 2.1 A/AA, and 2.2 AA. Automated
findings and rules requiring human review remain distinct. Add application-specific
journeys through the project's own test suite; this single-page observation does not
exercise checkout, authentication, native devices, or every page of the application.

`QA_BROWSER_EXECUTABLE` selects an intentionally installed Chromium/Chrome binary. Record
the actual version when using it. A missing browser is a blocker, not an empty pass.

## Configure explicit checks

Commands are argument arrays, run from the application root without an added shell.
Set per-check deadlines and a total budget. Use named scripts for complex test setup.
Check IDs `browser` and `browser-*` are reserved for the native browser phase.

```json
{
  "version": 1,
  "goal": "Check the release candidate",
  "budgetMs": 180000,
  "checks": [
    {
      "id": "unit-tests",
      "command": ["node", "--test", "--test-reporter=tap", "tests/unit.test.mjs"],
      "reporter": "tap",
      "timeoutMs": 30000
    },
    {
      "id": "user-journeys",
      "command": ["node", "node_modules/playwright/cli.js", "test", "--reporter=json"],
      "reporter": "playwright-json",
      "timeoutMs": 90000
    }
  ]
}
```

Supported evidence formats are Node TAP and Playwright JSON. Other declared test commands
can execute with `reporter: "exit-code"`; an uninterpreted successful exit stays incomplete.
Use a structured adapter before promoting another runner's exit code to a test verdict.
An explicit empty `checks` array is useful for a browser-only run, and does not silently
add an unrelated package test command.

Optional browser configuration:

```json
{
  "version": 1,
  "checks": [],
  "url": "http://127.0.0.1:3000/",
  "browser": {
    "expectedUrl": "http://127.0.0.1:3000/",
    "readySelector": "[data-testid=app-ready]",
    "accessibility": true,
    "timeoutMs": 30000
  }
}
```

Use `--config` for another config path and `--output` for the report parent directory.
Each execution receives a unique directory so previous failures remain inspectable.

## Read the report

| File | Purpose |
|---|---|
| `report.html` | Human-readable status, check details, routing, and next actions |
| `result.json` | Structured verdict and per-check observations |
| `plan.json` | Project discovery, commands, routing, and source context |
| `agent-handoff.md` | Concrete follow-up work for the host agent |
| `minimal.log` | Concise command outcomes |
| `verbose.log` | Command output for diagnosis |
| Per-check evidence | Captured structured output and command logs |

Share the full run directory when its relative evidence links matter. HTML content is
escaped, credentials are not accepted in target URLs, and common secrets are redacted
from display/log output. Keep application test data synthetic; automatic redaction is
not a guarantee that arbitrary application logs contain no sensitive data.

Source metadata includes the Git revision and dirty state where available. An uncommitted
working tree is reported as such; a clean report is not evidence for subsequent edits.

## CI integration

Run the same configured command in the app's CI job after its dependencies and any
required test browser are installed. Retain evidence even when checks fail:

```yaml
- name: Run application QA
  run: node .skills/qa-skills/scripts/qa.mjs run --project . --output qa-results
- name: Keep QA evidence
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: qa-evidence
    path: qa-results/
    if-no-files-found: error
```

The path assumes the full QA Skills repository is checked out at `.skills/qa-skills`
with its dependencies installed. Installing isolated skills does not install this CLI.
The repository's own CI separately exercises the CLI, documented helpers, and the
healthy/22-fault application controls. None of those runs grants deployment approval.

## Verify the runner itself

```bash
npm run test:qa
npm test
npm run test:browser
```

The runner tests cover good and broken results, no observed tests, malformed output,
skips/retries, command timeout, missing prerequisites, routing boundaries, hostile report
strings, and real local browser/HTTP behavior. The controlled application matrix lives
under `tests/workflows/`; `npm run test:workflow-controls` runs its healthy and defect
variants. If the healthy control fails, later fault variants remain explicitly unrun.
