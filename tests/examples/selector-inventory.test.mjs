import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunctions } from './snippets.mjs';

const source = 'skills/selector-drift-recovery/references/recovery-scripts.md';
const { collectFailureInventory, requireVerifiedDrift } = loadFunctions(
  source, 'function collectFailureInventory(', ['collectFailureInventory', 'requireVerifiedDrift'],
);
const attempt = (status, retry = 0, extra = {}) => ({ status, retry, errors: [], attachments: [], ...extra });
const spec = (results, extra = {}) => ({
  id: 'pay', title: 'pay for an order', file: 'tests/checkout.spec.ts', line: 4, column: 1,
  tests: [{ projectName: 'chromium', projectId: 'chromium', expectedStatus: 'passed', status: 'unexpected', results }],
  ...extra,
});
const reportFor = results => ({ errors: [], suites: [{ title: 'checkout', specs: [spec(results)] }] });

test('every failed and timedOut retry survives a later successful attempt', () => {
  const input = reportFor([
    attempt('timedOut', 0), attempt('failed', 1), attempt('failed', 2), attempt('passed', 3),
  ]);
  input.suites[0].specs[0].tests[0].status = 'flaky';
  const inventory = collectFailureInventory(input);
  assert.equal(inventory.observedResults, 4);
  assert.deepEqual(inventory.attempts.map(row => [row.status, row.retry]), [
    ['timedOut', 0], ['failed', 1], ['failed', 2],
  ]);
  assert.equal(new Set(inventory.attempts.map(row => row.attemptId)).size, 3);
  assert.ok(inventory.attempts.every(row => row.testOutcome === 'flaky'));
});

test('nested suites, projects, and expected failures retain separate provenance', () => {
  const first = spec([attempt('failed')]);
  first.tests.push({ projectName: 'webkit', projectId: 'webkit', expectedStatus: 'failed',
    status: 'expected', results: [attempt('failed')] });
  const nested = spec([attempt('timedOut')], { id: 'nested', title: 'nested checkout' });
  const input = { errors: [], suites: [{ title: 'file', specs: [first],
    suites: [{ title: 'nested group', specs: [nested] }] }] };
  const { attempts } = collectFailureInventory(input);
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.map(row => row.projectName), ['chromium', 'webkit', 'chromium']);
  assert.equal(attempts[1].expectedStatus, 'failed');
  assert.deepEqual(attempts[2].suiteTitles, ['file', 'nested group']);
  assert.equal(new Set(attempts.map(row => row.attemptId)).size, 3);
});

test('missing messages, locations, and locator renderings never discard an attempt', () => {
  const raw = [
    attempt('failed'),
    attempt('failed', 1, { errors: [{ message: 'Worker connection lost' }] }),
    attempt('timedOut', 2, { error: { message: 'Request never completed' },
      errorLocation: { file: 'pages/checkout.ts', line: 20, column: 5 },
      attachments: [{ name: 'trace', path: 'results/trace.zip', contentType: 'application/zip' }] }),
  ];
  const { attempts } = collectFailureInventory(reportFor(raw));
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts.map(row => row.reporterResult), raw);
  for (const row of attempts) assert.equal(row.file, null);
  assert.equal(attempts[2].reportedTestLocation.file, 'tests/checkout.spec.ts');
});

test('timeout and assertion text leave source, route, intent, and cause unverified', () => {
  const messages = [
    "TimeoutError: locator.click exceeded; getByRole('button')",
    "expect(getByRole('button')).toBeVisible() timed out",
    "expect(order.total).toBe(42) failed",
  ];
  const input = reportFor(messages.map((message, retry) => attempt('failed', retry, {
    error: { message, location: { file: 'pages/checkout.ts', line: 42, column: 3 } },
  })));
  const before = structuredClone(input);
  for (const row of collectFailureInventory(input).attempts) {
    assert.equal(row.triage, 'unreviewed');
    for (const field of ['file', 'line', 'column', 'oldLocator', 'intent', 'pageRoute', 'triageEvidence']) {
      assert.equal(row[field], null, field);
    }
    assert.throws(() => requireVerifiedDrift(row), /Manual drift triage/);
  }
  assert.deepEqual(input, before, 'collection must not mutate the reporter evidence');
});

test('run-level errors remain visible even when no tests produced an attempt', () => {
  const errors = [{ message: 'Global setup failed', stack: 'setup.ts:12' }];
  const inventory = collectFailureInventory({ suites: [], errors });
  assert.equal(inventory.observedResults, 0);
  assert.deepEqual(inventory.attempts, []);
  assert.deepEqual(inventory.runErrors, errors);
});

test('interrupted and missing-status attempts remain incomplete inventory records', () => {
  const inventory = collectFailureInventory(reportFor([
    attempt('interrupted'), { errors: [{ message: 'Runner stopped' }] },
  ]));
  assert.deepEqual(inventory.attempts.map(row => row.status), ['interrupted', null]);
  assert.equal(inventory.attempts[1].retry, null);
});

test('observed healthy results can produce an empty failure inventory', () => {
  const inventory = collectFailureInventory(reportFor([attempt('passed'), attempt('skipped')]));
  assert.equal(inventory.observedResults, 2);
  assert.deepEqual(inventory.attempts, []);
  assert.deepEqual(inventory.runErrors, []);
});

test('empty or malformed reporter structures do not become a successful empty inventory', () => {
  const invalid = [null, [], {}, { suites: [], errors: [] }, { suites: [], errors: null },
    { suites: [null], errors: [] }, { suites: [{ specs: {} }], errors: [] },
    { suites: [{ specs: [spec([attempt('passed')])], suites: null }], errors: [] },
    { suites: [{ specs: [null] }], errors: [] },
    { suites: [{ specs: [{ tests: {} }] }], errors: [] },
    { suites: [{ specs: [{ tests: [null] }] }], errors: [] },
    { suites: [{ specs: [{ tests: [{ results: {} }] }] }], errors: [] },
    reportFor([null]), reportFor([attempt('timeout')]),
    ...[-1, 0.5, '1'].map(retry => reportFor([attempt('failed', retry)])),
  ];
  for (const input of invalid) assert.throws(() => collectFailureInventory(input));
});

const reviewed = () => ({
  ...collectFailureInventory(reportFor([attempt('timedOut')])).attempts[0],
  triage: 'confirmed-selector-drift', file: 'pages/checkout.ts', line: 42, column: 3,
  oldLocator: "page.getByTestId('old-pay')", intent: 'Pay', pageRoute: '/checkout',
  triageEvidence: 'trace.zip action 8 and inspected pages/checkout.ts:42; button ID changed',
});

test('the triage gate accepts a complete reviewed record and rejects untriaged records', () => {
  const row = reviewed();
  assert.equal(requireVerifiedDrift(row), row);
  for (const triage of ['unreviewed', 'other', '', undefined]) {
    assert.throws(() => requireVerifiedDrift({ ...row, triage }), /triage/);
  }
});

test('confirmation alone cannot bypass missing source, intent, route, or triage evidence', () => {
  for (const field of ['attemptId', 'file', 'oldLocator', 'intent', 'pageRoute', 'triageEvidence']) {
    for (const value of [null, '', '  ', 42]) {
      assert.throws(() => requireVerifiedDrift({ ...reviewed(), [field]: value }), /required/);
    }
  }
  for (const line of [null, 0, -1, 1.5, '42']) {
    assert.throws(() => requireVerifiedDrift({ ...reviewed(), line }), /source line/);
  }
});

function runDriver(raw) {
  const reads = [], writes = [], logs = [];
  loadFunctions(source, 'scripts/identify-drift.ts', [], {
    collectFailureInventory,
    fs: { readFileSync(file) { reads.push(file); return raw; },
      writeFileSync(file, value) { writes.push({ file, value: JSON.parse(value) }); } },
    console: { log(message) { logs.push(message); } },
  });
  return { reads, writes, logs };
}

test('the actual I/O driver writes the complete inventory and never reads guessed source files', () => {
  const input = reportFor([attempt('failed'), attempt('timedOut', 1)]);
  input.errors.push({ message: 'Global teardown error' });
  const result = runDriver(Buffer.from(JSON.stringify(input)));
  assert.deepEqual(result.reads, ['.drift-recovery/results.json']);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].file, '.drift-recovery/failure-inventory.json');
  assert.equal(result.writes[0].value.attempts.length, 2);
  assert.equal(result.writes[0].value.runErrors.length, 1);
  assert.match(result.logs[0], /Manual triage is still required/);
});

test('the actual I/O driver rejects invalid JSON and invalid UTF-8', () => {
  assert.throws(() => runDriver(Buffer.from('{broken')));
  assert.throws(() => runDriver(Buffer.from([0xff])));
});
