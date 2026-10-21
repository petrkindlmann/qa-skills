import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessRun, prepareRunDirectory } from '../workflows/support/outcome.mjs';
import { runBounded } from '../workflows/support/process.mjs';

// Pinned Playwright JSON shape, including expectedStatus and actual attempts.
const report = () => ({ errors: [], suites: [{ specs: [{ title: 'ownership contract', tests: [{
  status: 'expected', expectedStatus: 'passed', results: [{ status: 'passed', retry: 0, duration: 1, errors: [] }],
}] }] }] });
const testRecord = value => value.suites[0].specs[0].tests[0];
const processPass = { code: 0, signal: null, timedOut: false };
const healthy = { healthy: true, count: 1 };
const negative = { count: 1, title: 'ownership contract' };
const negativeReport = () => {
  const value = report();
  Object.assign(testRecord(value), { status: 'unexpected' });
  Object.assign(testRecord(value).results[0], { status: 'failed', errors: [{ message: 'Expected 404; received 200' }] });
  return value;
};
const processFail = { ...processPass, code: 1 };

test('workflow gate accepts a complete healthy passing run', () => {
  assert.equal(assessRun(healthy, processPass, report()).outcome, 'healthy_pass');
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
test('designated actual assertion failure establishes a detection candidate', () => {
  assert.equal(assessRun(negative, processFail, negativeReport()).outcome, 'assertion_detection_candidate');
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
