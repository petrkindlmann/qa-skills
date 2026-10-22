// With-versus-without experiment: run each authored take of the Shop task healthy and under
// every Shop fault, and count which faults each take detects. A fault counts as detected when
// the take passes healthy and at least one of its tests fails under the fault with a clean
// process (no timeout, no infrastructure error). Unlike the controls matrix there is no
// designated oracle: the takes were authored blind, so any genuine assertion failure counts and
// the failing titles are recorded for review.
//
// Flakiness must not pass for detection, so the healthy control runs twice and both must pass,
// and a fault counts as detected only when a second run under the same fault also fails
// cleanly with at least one failing title in common with the first; otherwise it is
// recorded as unstable.
//
// Usage: node tests/workflows/run-experiment.mjs <take>[,<take>...]   (folders under generated/experiment)
// Env:   QA_EXPERIMENT_OUTPUT (default tests/workflows/artifacts/experiment)
//        QA_EXPERIMENT_SET primary (default) or secondary
//        QA_EXPERIMENT_FAULTS comma-separated subset of the chosen set, for a smoke check only
//
// The primary set is the score fixed before any take was scored. The secondary set is every
// other Shop fault in the lab, added after authoring but before scoring as an exploratory
// measure; it is reported in full and never mixed into the primary score.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBounded } from './support/process.mjs';
import { prepareRunDirectory, testsFrom, assessRun } from './support/outcome.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.QA_EXPERIMENT_OUTPUT ?? path.join(root, 'tests/workflows/artifacts/experiment'));
const takes = (process.argv[2] ?? '').split(',').filter(Boolean);
if (!takes.length) throw new Error('Name at least one take folder under tests/workflows/generated/experiment');

export const SHOP_FAULTS = Object.freeze([
  'cross_user_order_read', 'trust_client_amount', 'duplicate_fulfillment', 'receipt_before_commit',
  'idempotency_payload_conflict', 'reusable_reset_token', 'logout_cookie_only', 'compensating_prices',
  'canonicalized_signature',
]);

export const SECONDARY_FAULTS = Object.freeze([
  'unlabeled_controls', 'plaintext_session_tokens', 'missing_idempotency_index', 'no_login_throttle',
  'open_test_support', 'smtp_failure_503', 'slow_health', 'wrong_currency_event', 'reset_email_dropped',
  'catalog_currency_missing',
]);

async function runSuite(take, fault, directory) {
  await prepareRunDirectory(directory);
  const args = ['node_modules/playwright/cli.js', 'test', '--config', 'tests/workflows/playwright.config.mjs',
    '--workers=2', '--retries=0', '--global-timeout=240000'];
  const env = { ...process.env, QA_SHOP_FAULT: fault ?? '', QA_TODO_FAULT: '', QA_MATRIX_RUN_ID: randomUUID(),
    QA_WORKFLOW_SUITE: path.join(root, 'tests/workflows/generated/experiment', take), QA_WORKFLOW_OUTPUT: directory };
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const result = await runBounded({ command: process.execPath, args, cwd: root, env, timeoutMs: 250000, killGraceMs: 5000 });
  await writeFile(path.join(directory, 'minimal.txt'), result.log);
  let report = null;
  let parseError;
  try { report = JSON.parse(await readFile(path.join(directory, 'verbose.json'), 'utf8')); }
  catch (error) { parseError = error.message; }
  const tests = testsFrom(report);
  // assessRun decides timeouts and infrastructure errors; the count is what this run observed.
  const assessment = assessRun({ healthy: true, count: tests.length }, result, report);
  const failed = tests.filter(test => test.outcome === 'unexpected').map(test => ({
    title: test.title, error: test.results[0]?.errors[0]?.split('\n').slice(0, 3).join(' ').slice(0, 300) }));
  // Wall-clock bounds let a reader check a run against host sleep, which stretches timeouts.
  return { take, fault: fault ?? 'healthy', startedAt, finishedAt: new Date().toISOString(),
    code: result.code, signal: result.signal, parseError,
    wallMs: Math.round(performance.now() - started), executed: tests.length, failed,
    timedOut: assessment.timedOut, infrastructureError: assessment.infrastructureError,
    clean: !result.signal && !assessment.timedOut && !assessment.infrastructureError && !parseError && tests.length > 0 };
}

const set = process.env.QA_EXPERIMENT_SET || 'primary';
const sets = { primary: SHOP_FAULTS, secondary: SECONDARY_FAULTS };
if (!sets[set]) throw new Error(`QA_EXPERIMENT_SET must be primary or secondary, not ${set}`);
const faults = process.env.QA_EXPERIMENT_FAULTS ? process.env.QA_EXPERIMENT_FAULTS.split(',').filter(Boolean) : [...sets[set]];
if (faults.some(fault => !sets[set].includes(fault))) throw new Error(`QA_EXPERIMENT_FAULTS names a fault outside the ${set} set`);
const cleanFail = run => run.clean && run.failed.length > 0 && run.code === 1;
const cleanPass = run => run.clean && run.failed.length === 0 && run.code === 0;

await mkdir(output, { recursive: true });
const manifest = { startedAt: new Date().toISOString(), node: process.version, set, faults, takes: {} };
for (const take of takes) {
  const controls = [];
  for (const attempt of [1, 2]) {
    const healthy = await runSuite(take, null, path.join(output, take, `healthy-${attempt}`));
    controls.push(healthy);
    console.log(`${take} healthy ${attempt}: ${healthy.executed} tests, ${healthy.failed.length} failed, clean=${healthy.clean}`);
  }
  const healthyPass = controls.every(cleanPass) && controls[0].executed === controls[1].executed;
  const record = { healthy: controls[0], controls, faults: {}, detected: [], missed: [], unstable: [], invalid: [] };
  for (const fault of faults) {
    const run = await runSuite(take, fault, path.join(output, take, fault));
    const entry = { first: run };
    let verdict = !healthyPass ? 'invalid' : cleanPass(run) ? 'missed' : cleanFail(run) ? 'confirm' : 'invalid';
    if (verdict === 'confirm') {
      const again = await runSuite(take, fault, path.join(output, take, `${fault}-confirm`));
      entry.confirm = again;
      const firstTitles = new Set(run.failed.map(test => test.title));
      entry.sharedTitles = again.failed.map(test => test.title).filter(title => firstTitles.has(title));
      verdict = cleanFail(again) && entry.sharedTitles.length > 0 ? 'detected' : 'unstable';
    }
    record.faults[fault] = { ...run, ...entry, verdict };
    record[verdict].push(fault);
    console.log(`${take} ${fault}: ${verdict}; ${run.executed} tests; ${run.failed.length} failed; ${run.wallMs}ms`);
  }
  manifest.takes[take] = record;
  await writeFile(path.join(output, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n');
}
manifest.finishedAt = new Date().toISOString();
await writeFile(path.join(output, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${set} set\nTake | healthy x2 | detected | missed | unstable | invalid`);
for (const [take, record] of Object.entries(manifest.takes)) {
  console.log(`${take} | ${record.controls.every(cleanPass) ? 'pass' : 'FAIL'} | ${record.detected.length}/${faults.length} | ${record.missed.join(', ') || '-'} | ${record.unstable.join(', ') || '-'} | ${record.invalid.join(', ') || '-'}`);
}
