# Independent agent evidence gate

## Contents

- [Boundary and inputs](#boundary-and-inputs)
- [Gate configuration](#gate-configuration)
- [Adapter activity record](#adapter-activity-record)
- [Project-owned oracle](#project-owned-oracle)
- [Evidence and outcomes](#evidence-and-outcomes)

## Boundary and inputs

The executable utility is `scripts/agent-result-gate.mjs` in a full QA Skills checkout.
It starts a reviewed project-owned command after the host agent finishes. It does not
install an agent, call a model, or infer correctness from an agent's prose. A copied skill
alone does not include this repository utility.

Keep the gate configuration and oracle outside the agent's writable output directory.
Generate a unique `runId` in the trusted harness for each attempt. Bind both the adapter
record and independent evidence to that ID, the explicit target URL, and the candidate
build ID. Use environment variables or protected files for credentials, never CLI args,
target URL credentials, reports, or trace attachments.

The host adapter must count actual tool steps, enforce wall-clock/token/step budgets while
running, and keep the session evidence. This gate checks the recorded step budget, but
cannot reconstruct or certify the adapter's navigation from a number in a JSON file.

## Gate configuration

Create this file in the application project. Replace the example identities on every run.
The oracle executable and arguments are supplied by project configuration, never model
output. Relative `cwd` is resolved from this configuration file's directory.

```json
{
  "schemaVersion": 1,
  "runId": "unique-attempt-id",
  "target": "http://127.0.0.1:3000/",
  "buildId": "candidate-build-id",
  "maxSteps": 18,
  "oracle": {
    "command": "node",
    "args": ["account-oracle.mjs"],
    "cwd": ".",
    "timeoutMs": 15000,
    "requiredChecks": ["health", "build", "identity"]
  }
}
```

## Adapter activity record

The host adapter emits this record from its own counters and run metadata. `completed`
must be the boolean `true`; the step count must be a positive integer within the budget.
A missing record, `{"passed": true}`, `{"passed": "true"}`, or zero steps cannot pass.

```json
{
  "schemaVersion": 1,
  "runId": "unique-attempt-id",
  "target": "http://127.0.0.1:3000/",
  "buildId": "candidate-build-id",
  "completed": true,
  "steps": 6
}
```

## Project-owned oracle

Choose assertions for the actual goal and contract. For a sign-in goal, the following
complete `account-oracle.mjs` example independently checks an HTTP health endpoint,
the served build, and the authenticated identity. It assumes the application publishes
`GET /health` as `{ "status": "ok", "build": "..." }` and `GET /api/me` as
`{ "user": { "email": "..." } }`. Adapt those assertions to your application before use.
It verifies API identity; add a browser oracle if the goal also requires a particular UI.

The adapter extracts the current session cookie from its actual browser session into
`QA_SESSION_COOKIE` (the complete Cookie header value). Set `QA_EXPECTED_EMAIL` from the
seeded fixture. Do not let the model choose the expected identity. The gate supplies
`QA_ORACLE_EVIDENCE`, `QA_RUN_ID`, `QA_TARGET`, and `QA_BUILD_ID` itself.

```javascript
import { writeFile } from 'node:fs/promises';

const { QA_ORACLE_EVIDENCE, QA_RUN_ID, QA_TARGET, QA_BUILD_ID,
  QA_SESSION_COOKIE, QA_EXPECTED_EMAIL } = process.env;
if (![QA_ORACLE_EVIDENCE, QA_RUN_ID, QA_TARGET, QA_BUILD_ID,
  QA_SESSION_COOKIE, QA_EXPECTED_EMAIL].every(value => typeof value === 'string' && value.trim())) {
  throw new Error('Oracle requires its run binding, current session and seeded expected account');
}
const checks = [];
async function read(route, headers = {}) {
  try {
    const response = await fetch(new URL(route, QA_TARGET), {
      headers, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return { response, data };
  } catch {
    return null;
  }
}
function record(id, result, holds, evidence) {
  checks.push({ id, status: result && holds ? 'passed' : 'failed',
    observed: result !== null, evidence: result ? evidence : 'Request or JSON response did not complete' });
}
const health = await read('/health');
record('health', health, health?.response.status === 200 && health?.data.status === 'ok',
  `Health endpoint returned HTTP ${health?.response.status}; required status: ok`);
record('build', health, health?.response.status === 200 && health?.data.build === QA_BUILD_ID,
  `Served build matches candidate: ${health?.data.build === QA_BUILD_ID}`);
const account = await read('/api/me', { Cookie: QA_SESSION_COOKIE });
record('identity', account, account?.response.status === 200 && account?.data.user?.email === QA_EXPECTED_EMAIL,
  `Authenticated endpoint returned HTTP ${account?.response.status}; expected seeded identity matched: ${account?.data.user?.email === QA_EXPECTED_EMAIL}`);
await writeFile(QA_ORACLE_EVIDENCE, JSON.stringify({ schemaVersion: 1,
  runId: QA_RUN_ID, target: QA_TARGET, buildId: QA_BUILD_ID, checks }));
process.exitCode = checks.every(check => check.status === 'passed' && check.observed) ? 0 : 1;
```

## Evidence and outcomes

The gate uses a new private evidence path for every invocation, executes the oracle with
its deadline, and reads that path only after the process finishes. It requires unique,
nonempty checks; every required ID must exist, every observation must be boolean `true`,
every status must be `passed`, and the process must exit normally with code zero.

| Outcome | Meaning | CI exit |
|---|---|---|
| `passed` | All configured independent checks observed their targets and passed | 0 |
| `failed` | A check failed or the oracle returned a nonzero normal exit | 1 |
| `blocked` | Missing or malformed evidence, wrong binding, missing tool, signal or timeout | 1 |
| Input error | Invalid JSON/configuration or inaccessible input/output file | 2 |

Keep `gate-result.json` alongside the adapter trace. A passing gate establishes only its
configured checks for the recorded run and target. Typed JSON is not a signature: these
records rely on a trusted harness and reviewed oracle code. Do not claim that a gate
proves arbitrary browser-agent behavior or that a model's asserted success is evidence.
