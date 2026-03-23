# CI Failure Analysis

Patterns for parsing CI logs, classifying failures, and building stable fingerprints. Covers GitHub Actions, GitLab CI, and generic test runner output.

---

## Failure Category Decision Tree

```
CI job fails
│
├── Build step fails (before tests run)
│   ├── Compilation error
│   │   Clue: "error TS", "SyntaxError", "cannot find module"
│   │   Action: Fix code, check recent changes
│   │
│   ├── Dependency resolution failure
│   │   Clue: "npm ERR!", "pip install failed", "resolution failed"
│   │   Action: Check package lock, registry status, version constraints
│   │
│   └── Configuration error
│       Clue: "missing env", "invalid config", "workflow syntax error"
│       Action: Check CI config, environment variables, secrets
│
├── Test step fails
│   ├── Single test fails consistently
│   │   ├── Test changed recently?
│   │   │   YES → Likely TEST BUG (wrong assertion, bad setup)
│   │   │   NO → Likely APP BUG or ENVIRONMENT ISSUE
│   │   │
│   │   ├── App code changed recently?
│   │   │   YES → Likely APP BUG (regression)
│   │   │   NO → Check environment (dependency update, config drift)
│   │   │
│   │   └── Fails locally too?
│   │       YES → Confirmed bug (app or test)
│   │       NO → Environment-specific issue
│   │
│   ├── Single test fails intermittently
│   │   ├── Timing-related patterns?
│   │   │   Clue: "timeout", "waiting for", "ETIMEOUT"
│   │   │   Root cause: Race condition, slow backend, animation
│   │   │   Action: Quarantine, investigate timing
│   │   │
│   │   ├── Data-related patterns?
│   │   │   Clue: "not found", "already exists", "unique constraint"
│   │   │   Root cause: Shared test data, cleanup failure
│   │   │   Action: Isolate test data, check fixtures
│   │   │
│   │   └── Resource-related patterns?
│   │       Clue: "ENOMEM", "ENOSPC", "connection refused"
│   │       Root cause: CI resource contention
│   │       Action: Check runner resources, reduce parallelism
│   │
│   ├── Multiple tests fail at once
│   │   ├── All in same component?
│   │   │   Likely: APP BUG in shared component or service
│   │   │   Action: Find common dependency in stack traces
│   │   │
│   │   ├── All tests fail?
│   │   │   Likely: ENVIRONMENT ISSUE (build broken, service down)
│   │   │   Action: Check setup step, service health, recent deploys
│   │   │
│   │   └── Random subset fails?
│   │       Likely: Resource exhaustion (OOM, connection pool, file handles)
│   │       Action: Check CI metrics, reduce parallelism, increase resources
│   │
│   └── Tests pass but job fails
│       Clue: Exit code non-zero after tests pass
│       Check: Post-test scripts, coverage thresholds, lint failures
│
└── Post-test step fails
    ├── Coverage threshold not met
    │   Clue: "Coverage below threshold", "branch coverage: 45%"
    │   Action: Add tests for uncovered code
    │
    ├── Report upload fails
    │   Clue: "upload failed", "artifact too large"
    │   Action: Check storage, compress artifacts
    │
    └── Deploy fails
        Clue: "deploy error", "rollback"
        Action: Check deploy config, target environment
```

---

## CI Platform Log Patterns

### GitHub Actions

**Job-level failure signals:**
```
##[error]Process completed with exit code 1
##[error]The operation was canceled
Error: The operation timed out after 360000 milliseconds
```

**Step-level context:**
```
Run npm test
  npm test
  shell: /usr/bin/bash -e {0}
  env:
    CI: true
```

**Extracting useful context from GitHub Actions:**
- Job name and step name from workflow annotations
- Runner OS from `runs-on` value
- Matrix variables from job name suffix (e.g., `test (node-18, ubuntu-latest)`)
- Timing from step duration annotations

### GitLab CI

**Job failure signals:**
```
ERROR: Job failed: exit code 1
ERROR: Job failed (system failure): runner system failure
```

**Extracting context:**
- Job name from CI_JOB_NAME
- Pipeline ID from CI_PIPELINE_ID
- Stage from CI_JOB_STAGE

### Generic Test Runner Output

**Playwright:**
```
  1) [chromium] › checkout.spec.ts:42:5 › Checkout › completes payment ──────
     Error: expect(received).toBeVisible()
     Locator: getByTestId('order-confirmation')
     Expected: visible
     Received: <element not found>
     Call log:
       - waiting for getByTestId('order-confirmation')
```

**Jest/Vitest:**
```
 FAIL  src/utils/__tests__/calculateTotal.test.ts
  ● calculateTotal › applies tax correctly
    expect(received).toBe(expected) // Object.is equality
    Expected: 108
    Received: 100
      at Object.<anonymous> (src/utils/__tests__/calculateTotal.test.ts:15:29)
```

**pytest:**
```
FAILED tests/test_checkout.py::test_completes_payment - AssertionError:
    assert response.status_code == 200
    E     assert 500 == 200
    E     +500
    E     -200
```

---

## Fingerprinting Algorithm Detail

### Step-by-Step Process

```
INPUT: Raw CI log output (string)

1. NORMALIZE
   Apply normalization rules in order:
   - Strip ANSI codes
   - Replace timestamps with <TIMESTAMP>
   - Replace UUIDs with <UUID>
   - Replace PIDs with <PID>
   - Replace ports with <PORT>
   - Replace temp paths with <TMPPATH>
   - Replace memory addresses with <ADDR>
   - Replace random suffixes with <RAND>
   - Replace request/trace/correlation IDs with <REQ_ID>
   - Collapse whitespace

2. EXTRACT ANCHORS
   Parse normalized output for:
   a. Exception type:
      - Match: /(Error|Exception|Failure|FAILED|FAIL)\s*[:]/
      - Match: /(\w+Error|\w+Exception):/
      - Match: /exit code (\d+)/
      - Take the most specific match

   b. Error message template:
      - Take first line after exception type
      - Replace quoted strings with <STR>
      - Replace numbers > 3 digits with <NUM>
      - Keep structure, remove specifics

   c. Top stack frames (max 5):
      - Match: /at\s+(\w+)\s+\(([^)]+)\)/  (JavaScript)
      - Match: /File "([^"]+)", line \d+, in (\w+)/  (Python)
      - Match: /\s+at\s+([^\s]+)\s+\[as/  (Node.js native)
      - Keep function name and file name
      - Strip line numbers (they change with edits)
      - Strip node_modules frames (framework noise)

   d. Test name:
      - Match: /›\s+(.+?)\s+─/  (Playwright)
      - Match: /●\s+(.+?)\s+›/  (Jest)
      - Match: /FAILED\s+(\S+::\S+)/  (pytest)
      - Keep full test path including describe block

   e. URL pattern:
      - Match: /(GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/
      - Replace path segments that look like IDs with <ID>
      - /api/users/abc-123/orders → /api/users/<ID>/orders

   f. HTTP status code:
      - Match: /status[_ ]?code[=: ]+(\d{3})/
      - Match: /HTTP\/\d\.\d\s+(\d{3})/
      - Match: /(\d{3})\s+(OK|Created|Not Found|Internal Server Error)/

3. BUILD CANONICAL FORM
   Concatenate anchors in fixed order, separated by "|":
   exception_type | message_template | frame1,frame2,frame3 | test_name | url_pattern | status_code

   Omit empty anchors (don't include "|" for missing fields)

4. HASH
   SHA-256(canonical_form)
   Take first 16 hex characters

OUTPUT: 16-character hex fingerprint
```

### Fingerprint Stability Tests

Verify your fingerprint implementation with these test cases:

```
Test 1: Same error, different timestamps
  Input A: "2025-03-22T14:00:00Z Error: timeout at checkout.ts:42"
  Input B: "2025-03-23T09:15:30Z Error: timeout at checkout.ts:42"
  Expected: Same fingerprint

Test 2: Same error, different PIDs and ports
  Input A: "[pid=1234] ECONNREFUSED 127.0.0.1:54321"
  Input B: "[pid=5678] ECONNREFUSED 127.0.0.1:61234"
  Expected: Same fingerprint

Test 3: Same error, different line numbers (code was edited)
  Input A: "at processOrder (order.ts:142)"
  Input B: "at processOrder (order.ts:158)"
  Expected: Same fingerprint (line numbers stripped)

Test 4: Different errors should produce different fingerprints
  Input A: "TypeError: Cannot read property 'id' of undefined"
  Input B: "RangeError: Maximum call stack size exceeded"
  Expected: Different fingerprints

Test 5: Same error type, different property
  Input A: "TypeError: Cannot read property 'name' of undefined"
  Input B: "TypeError: Cannot read property 'email' of undefined"
  Expected: Different fingerprints (different message template)
```

---

## Common Failure Patterns

### Pattern: Test Bug vs App Bug

**How to distinguish:**

| Signal | Test Bug | App Bug |
|--------|----------|---------|
| Test changed recently | Yes | No |
| App code changed recently | No | Yes |
| Other tests for same feature pass | Yes (test-specific issue) | No (feature is broken) |
| Fails locally with same code | Maybe (environment-dependent) | Yes |
| Error in test file stack frame | Yes | No |
| Error in app code stack frame | No | Yes |
| Assertion is about wrong value | Check if assertion is correct | Likely app returns wrong value |

### Pattern: Environment Issue vs True Failure

**How to distinguish:**

| Signal | Environment Issue | True Failure |
|--------|------------------|--------------|
| Multiple unrelated tests fail | Yes | No (unless shared dependency) |
| Fails on retry | No (usually) | Yes |
| Error type | ECONNREFUSED, ENOMEM, ETIMEOUT | AssertionError, TypeError |
| CI runner metrics | CPU/memory spike | Normal |
| Time of day correlation | Yes (peak load) | No |
| Affects all branches | Yes | No (specific to changed code) |

### Pattern: Flaky Test Identification

**Flakiness indicators:**

```
1. Non-deterministic failure rate: fails 10-50% of the time
2. Passes on retry without code changes
3. Different failure rate on different runners
4. Failure correlates with CI load, not code changes
5. Test uses:
   - waitForTimeout (hardcoded waits)
   - Date.now() or new Date() (time-dependent)
   - Math.random() (non-deterministic)
   - Shared database/state (order-dependent)
   - External HTTP calls (network-dependent)
```

**Flakiness categories and fixes:**

| Category | Root Cause | Fix Pattern |
|----------|-----------|-------------|
| Timing | Race condition, animation, async | Replace waitForTimeout with waitFor condition |
| Data | Shared state, cleanup failure | Isolate per-test, use fixtures with cleanup |
| Environment | Network, resource contention | Mock externals, increase timeouts in CI |
| Order | Depends on other test's side effect | Make self-contained, use fresh fixtures |
| Time | Uses current date/time | Mock clock, use relative comparisons |

---

## Triage Automation Scripts

### Extract Failures from Playwright Report

```typescript
import { readFileSync } from 'fs';

interface PlaywrightResult {
  suites: Array<{
    title: string;
    specs: Array<{
      title: string;
      tests: Array<{
        results: Array<{
          status: string;
          error?: { message: string; stack: string };
          retry: number;
        }>;
      }>;
    }>;
  }>;
}

function extractFailures(reportPath: string) {
  const report: PlaywrightResult = JSON.parse(readFileSync(reportPath, 'utf-8'));
  const failures: Array<{
    testName: string;
    error: string;
    stack: string;
    retries: number;
    isFlaky: boolean;
  }> = [];

  for (const suite of report.suites) {
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        const lastResult = test.results[test.results.length - 1];
        const firstResult = test.results[0];

        if (lastResult.status === 'failed' || (lastResult.status === 'passed' && firstResult.status === 'failed')) {
          failures.push({
            testName: `${suite.title} > ${spec.title}`,
            error: firstResult.error?.message ?? 'Unknown error',
            stack: firstResult.error?.stack ?? '',
            retries: test.results.length - 1,
            isFlaky: lastResult.status === 'passed' && firstResult.status === 'failed',
          });
        }
      }
    }
  }

  return failures;
}
```

### Extract Failures from Jest/Vitest Output

```typescript
function extractJestFailures(output: string) {
  const failures: Array<{ testName: string; error: string; file: string }> = [];
  const failRegex = /FAIL\s+(\S+)\n([\s\S]*?)(?=\n\s*(?:PASS|FAIL|Tests:))/g;

  let match;
  while ((match = failRegex.exec(output)) !== null) {
    const file = match[1];
    const block = match[2];

    const testRegex = /●\s+(.+?)\n\s*([\s\S]*?)(?=\n\s*●|\n\s*$)/g;
    let testMatch;
    while ((testMatch = testRegex.exec(block)) !== null) {
      failures.push({
        testName: testMatch[1].trim(),
        error: testMatch[2].trim().split('\n')[0],
        file,
      });
    }
  }

  return failures;
}
```

---

## Metrics to Track

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| Auto-classification accuracy | % of auto-classified bugs that humans agree with | > 85% |
| False duplicate rate | % of merged tickets that were actually distinct issues | < 5% |
| Mean time to triage | Time from failure detection to ticket creation | < 15 min (auto), < 2h (manual) |
| Fingerprint collision rate | Different bugs producing same fingerprint | < 1% |
| Environment false positive rate | App bugs misclassified as environment issues | < 10% |
| Ticket quality score | Developer rating of auto-generated ticket usefulness | > 4/5 |
| Flaky detection rate | % of flaky tests caught by pipeline | > 90% |
