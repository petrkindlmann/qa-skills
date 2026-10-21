import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assessRun, prepareRunDirectory, unrunAfterFailedHealthy } from '../workflows/support/outcome.mjs';
import { runBounded } from '../workflows/support/process.mjs';

// Pinned Playwright JSON shape, including expectedStatus and actual attempts.
const report = () => ({ errors: [], suites: [{ specs: [{ title: 'ownership contract', tests: [{
  status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed', retry: 0, duration: 1, errors: [] }],
}] }] }] });
const testRecord = value => value.suites[0].specs[0].tests[0];
const processPass = { code: 0, signal: null, timedOut: false };
const healthy = { healthy: true, count: 1 };
const negative = { count: 1, title: 'ownership contract', runId: 'current-run', oracle: { id: 'ownership', matcher: 'toBe' } };
const token = '12345678-1234-1234-1234-123456789abc';
const negativeReport = () => {
  const value = report();
  Object.assign(testRecord(value), { status: 'unexpected', annotations: [{ type: 'qa-oracle-failure', description: JSON.stringify({
    schemaVersion: 1, id: 'ownership', matcher: 'toBe', token, runId: 'current-run',
  }) }] });
  Object.assign(testRecord(value).results[0], { status: 'failed', errors: [{ message: `Error: QA_ORACLE:ownership:${token}\nExpected 404; received 200` }] });
  return value;
};
const processFail = { ...processPass, code: 1 };

test('workflow gate accepts a complete healthy passing run', () => {
  assert.equal(assessRun(healthy, processPass, report()).outcome, 'healthy_pass');
});
test('a failed healthy control preserves requested variants as unrun instead of spending their budgets', () => {
  const remaining = [{ id: 'fault-one', count: 36 }, { id: 'fault-two', count: 11 }];
  const stopped = unrunAfterFailedHealthy({ ...healthy, id: 'control' }, 'healthy_failure', remaining);
  assert.deepEqual(stopped.map(run => [run.id, run.outcome, run.expectedCount, run.executed]),
    [['fault-one', 'not_run', 36, 0], ['fault-two', 'not_run', 11, 0]]);
  assert.ok(stopped.every(run => !run.oracleVerified && run.code === null && /control failed/.test(run.reason)));
  assert.deepEqual(unrunAfterFailedHealthy(healthy, 'healthy_pass', remaining), []);
  assert.deepEqual(unrunAfterFailedHealthy(negative, 'not_established', remaining), []);
});
test('expected failure annotations cannot count as healthy passes', () => {
  const value = negativeReport();
  Object.assign(testRecord(value), { status: 'expected', expectedStatus: 'failed' });
  assert.equal(assessRun(healthy, processPass, value).acceptable, false);
});
test('skipped and interrupted cases cannot satisfy the healthy count', () => {
  for (const status of ['skipped', 'interrupted', 'timedOut']) {
    const value = report(); testRecord(value).results[0].status = status;
    assert.equal(assessRun(healthy, processPass, value).acceptable, false, status);
  }
});
test('missing and empty reports fail closed', () => {
  for (const value of [undefined, { errors: [], suites: [] }]) {
    assert.equal(assessRun(healthy, processPass, value).acceptable, false);
    assert.equal(assessRun(negative, processFail, value).acceptable, false);
  }
});
test('missing cases and retry passes cannot replace the intended execution', () => {
  assert.equal(assessRun({ ...healthy, count: 2 }, processPass, report()).acceptable, false);
  const value = report(); testRecord(value).results[0].retry = 1;
  assert.equal(assessRun(healthy, processPass, value).acceptable, false);
});
test('global errors and abnormal process termination reject otherwise passing output', () => {
  const value = report(); value.errors.push({ message: 'setup failed' });
  assert.equal(assessRun(healthy, processPass, value).acceptable, false);
  for (const extra of [{ signal: 'SIGTERM' }, { timedOut: true }, { forcedSettlement: true }, { launchError: 'spawn failed' }, { code: 1 }]) {
    assert.equal(assessRun(healthy, { ...processPass, ...extra }, report()).acceptable, false);
  }
});
test('designated matcher failure and per-run oracle evidence establish a detection', () => {
  assert.equal(assessRun(negative, processFail, negativeReport()).outcome, 'assertion_detection_verified');
});
test('a matching title and SQL setup error are infrastructure failures and cannot pass the gate', () => {
  const value = negativeReport();
  testRecord(value).results[0].errors = [{ message: 'Error: no such table: sessions' }];
  const assessed = assessRun(negative, processFail, value);
  assert.equal(assessed.outcome, 'not_established');
  assert.equal(assessed.infrastructureError, true);
  assert.equal(assessed.acceptable, false);
  assert.equal(assessed.oracleVerified, false);
});
test('missing, malformed, wrong-oracle and stale-run records cannot prove detection', () => {
  for (const description of ['not json', '{}', ...[
    { id: 'other' }, { matcher: 'toEqual' }, { runId: 'old-run' }, { token: 'not-a-token' }, { schemaVersion: '1' },
  ].map(extra => JSON.stringify({ schemaVersion: 1, id: 'ownership', matcher: 'toBe', token, runId: 'current-run', ...extra }))]) {
    const value = negativeReport();
    testRecord(value).annotations[0].description = description;
    assert.equal(assessRun(negative, processFail, value).acceptable, false, description);
  }
  const value = negativeReport(); testRecord(value).annotations = [];
  assert.equal(assessRun(negative, processFail, value).acceptable, false);
  assert.equal(assessRun({ ...negative, runId: '' }, processFail, negativeReport()).acceptable, false);
});
test('a nonzero exit without the designated assertion is not detection', () => {
  assert.equal(assessRun({ ...negative, title: 'another contract' }, processFail, negativeReport()).acceptable, false);
  const value = negativeReport(); testRecord(value).results[0].errors = [];
  assert.equal(assessRun(negative, processFail, value).acceptable, false);
});
test('browser infrastructure failures and incomplete negative runs do not count', () => {
  const value = negativeReport(); testRecord(value).results[0].errors = [{ message: 'browserType.launch: missing browser' }];
  assert.equal(assessRun(negative, processFail, value).acceptable, false);
  assert.equal(assessRun({ ...negative, count: 2 }, processFail, negativeReport()).acceptable, false);
});
test('an independent infrastructure failure rejects a run even when the designated oracle failed', () => {
  for (const error of ['page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1234/',
    'page.goto: net::ERR_CONNECTION_RESET', 'Error: no such table: sessions',
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'missing'", 'Error: Cannot find module missing']) {
    const value = negativeReport();
    const other = structuredClone(value.suites[0].specs[0]);
    other.title = 'unrelated setup'; other.tests[0].annotations = [];
    other.tests[0].results[0].errors = [{ message: error }];
    value.suites[0].specs.push(other);
    const result = assessRun({ ...negative, count: 2 }, processFail, value);
    assert.equal(result.infrastructureError, true, error);
    assert.equal(result.acceptable, false, error);
    assert.equal(result.oracleVerified, false, error);
  }
  assert.equal(assessRun(negative, processFail, negativeReport()).acceptable, true, 'HTTP 200 vs 404 remains an application assertion');
  const neighboringSource = negativeReport();
  testRecord(neighboringSource).results[0].errors[0].message += '\n  12 | throw new Error("no such table: sessions")\n     | ^\n';
  assert.equal(assessRun(negative, processFail, neighboringSource).acceptable, true, 'neighboring fixture source is not an observed infrastructure error');
});
test('cancellation cannot count as a healthy run even if a child exits zero', () => {
  assert.equal(assessRun(healthy, { ...processPass, aborted: true }, report()).acceptable, false);
});
test('unexpected passes of test.fail cases are not broken-application detections', () => {
  const value = report(); Object.assign(testRecord(value), { status: 'unexpected', expectedStatus: 'failed' });
  assert.equal(assessRun(negative, processFail, value).acceptable, false);
});
test('preparing a reused run directory removes stale evidence and preserves unrelated files', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qa-report-reuse-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'verbose.json'), JSON.stringify(negativeReport()));
  await writeFile(path.join(directory, 'minimal.txt'), 'old run');
  await writeFile(path.join(directory, 'keep.txt'), 'keep');
  await prepareRunDirectory(directory);
  await assert.rejects(readFile(path.join(directory, 'verbose.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(directory, 'minimal.txt')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'keep');
});
test('bounded process runner records actual successful and failed child exits', async () => {
  const success = await runBounded({ command: process.execPath, args: ['-e', 'console.log("child ran")'], timeoutMs: 3000 });
  assert.equal(success.code, 0); assert.equal(success.timedOut, false); assert.match(success.log, /child ran/);
  const failure = await runBounded({ command: process.execPath, args: ['-e', 'process.exit(7)'], timeoutMs: 3000 });
  assert.equal(failure.code, 7); assert.equal(failure.timedOut, false);
});
test('spawn errors settle without waiting for a nonexistent child', async () => {
  const result = await runBounded({ command: '/qa-no-such-executable', timeoutMs: 500 });
  assert.match(result.launchError, /ENOENT/); assert.equal(result.code, null);
});
test('explicit cancellation stops the owned process and returns an aborted result', async () => {
  const cancellation = new AbortController();
  let pid;
  const result = await runBounded({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'],
    timeoutMs: 5000, killGraceMs: 100, settlementGraceMs: 100, signal: cancellation.signal,
    onSpawn: childPid => { pid = childPid; cancellation.abort(); } });
  assert.ok(pid > 0);
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('inherited pipes and SIGTERM-resistant descendants cannot keep the runner pending', { skip: process.platform === 'win32' }, async () => {
  const descendant = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
  const program = `const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const p=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});console.log('descendant='+p.pid);setInterval(()=>{},1000);`;
  const start = performance.now();
  const result = await runBounded({ command: process.execPath, args: ['-e', program], timeoutMs: 500, killGraceMs: 150, settlementGraceMs: 150 });
  assert.equal(result.timedOut, true); assert.ok(performance.now() - start < 3000);
  const pid = Number(result.log.match(/descendant=(\d+)/)?.[1]);
  assert.ok(pid > 0);
  try {
    const state = await readFile(`/proc/${pid}/stat`, 'utf8');
    assert.match(state, /\) Z /, 'descendant must be gone or awaiting reaping, not running');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
});

test('real Playwright oracle records a chosen matcher but refuses SQL errors and a different assertion', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qa-oracle-runner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const playwright = pathToFileURL(path.join(root, 'node_modules/@playwright/test/index.mjs')).href;
  const helper = new URL('../workflows/support/oracle.mjs', import.meta.url).href;
  await writeFile(path.join(directory, 'oracle.spec.mjs'), `
    import { test, expect } from ${JSON.stringify(playwright)};
    import { oracle } from ${JSON.stringify(helper)};
    test('healthy control', async () => { await oracle('ownership', 'toBe', () => expect(404).toBe(404)); });
    test('ownership contract', async () => { await oracle('ownership', 'toBe', () => expect(200).toBe(404)); });
    test('SQL contract', async () => { await oracle('sql', 'toBe', () => { throw new Error('no such table: sessions'); }); });
    test('other assertion', async () => { await oracle('other', 'toBe', () => expect([200]).toEqual([404])); });
  `);
  const resultFile = path.join(directory, 'result.json');
  await writeFile(path.join(directory, 'playwright.config.mjs'), `export default { testDir: ${JSON.stringify(directory)}, retries: 0, workers: 1, reporter: [['json', { outputFile: ${JSON.stringify(resultFile)} }]], outputDir: ${JSON.stringify(path.join(directory, 'artifacts'))} };`);
  const processResult = await runBounded({ command: process.execPath,
    args: [path.join(root, 'node_modules/playwright/cli.js'), 'test', '--config', path.join(directory, 'playwright.config.mjs')],
    env: { ...process.env, QA_MATRIX_RUN_ID: 'current-run' }, timeoutMs: 20000 });
  assert.equal(processResult.code, 1, processResult.log);
  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  assert.equal(assessRun({ ...negative, count: 4 }, processResult, result).outcome, 'not_established',
    'the unrelated SQL infrastructure failure blocks the whole variant');
  for (const [title, id] of [['SQL contract', 'sql'], ['other assertion', 'other']]) {
    assert.equal(assessRun({ ...negative, count: 4, title, oracle: { id, matcher: 'toBe' } }, processResult, result).acceptable, false, title);
  }
  await rm(resultFile, { force: true });
  const controlProcess = await runBounded({ command: process.execPath,
    args: [path.join(root, 'node_modules/playwright/cli.js'), 'test', '--config', path.join(directory, 'playwright.config.mjs'),
      '--grep', 'healthy control|ownership contract'],
    env: { ...process.env, QA_MATRIX_RUN_ID: 'current-run' }, timeoutMs: 20000 });
  const controlResult = JSON.parse(await readFile(resultFile, 'utf8'));
  assert.equal(assessRun({ ...negative, count: 2 }, controlProcess, controlResult).outcome, 'assertion_detection_verified',
    'the healthy control and intended assertion establish detection without unrelated infrastructure errors');
});
