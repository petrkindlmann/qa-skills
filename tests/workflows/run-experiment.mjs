// With-versus-without experiment: run each authored take of the Shop task healthy and under
// every Shop fault, and count which faults each take detects. A fault counts as detected when
// the take passes healthy and at least one of its tests fails under the fault with a clean
// process (no timeout, no infrastructure error). Unlike the controls matrix there is no
// designated oracle: the takes were authored blind, so any genuine assertion failure counts and
// the failing titles are recorded for review.
//
// Usage: node tests/workflows/run-experiment.mjs <take>[,<take>...]   (folders under generated/experiment)
// Env:   QA_EXPERIMENT_OUTPUT (default tests/workflows/artifacts/experiment)
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

async function runSuite(take, fault, directory) {
  await prepareRunDirectory(directory);
  const args = ['node_modules/playwright/cli.js', 'test', '--config', 'tests/workflows/playwright.config.mjs',
    '--workers=2', '--retries=0', '--global-timeout=240000'];
  const env = { ...process.env, QA_SHOP_FAULT: fault ?? '', QA_TODO_FAULT: '', QA_MATRIX_RUN_ID: randomUUID(),
    QA_WORKFLOW_SUITE: path.join(root, 'tests/workflows/generated/experiment', take), QA_WORKFLOW_OUTPUT: directory };
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
  return { take, fault: fault ?? 'healthy', code: result.code, signal: result.signal, parseError,
    wallMs: Math.round(performance.now() - started), executed: tests.length, failed,
    timedOut: assessment.timedOut, infrastructureError: assessment.infrastructureError,
    clean: !result.signal && !assessment.timedOut && !assessment.infrastructureError && !parseError && tests.length > 0 };
}

await mkdir(output, { recursive: true });
const manifest = { startedAt: new Date().toISOString(), node: process.version, faults: SHOP_FAULTS, takes: {} };
for (const take of takes) {
  const healthy = await runSuite(take, null, path.join(output, take, 'healthy'));
  console.log(`${take} healthy: ${healthy.executed} tests, ${healthy.failed.length} failed, clean=${healthy.clean}`);
  const record = { healthy, faults: {}, detected: [], missed: [], invalid: [] };
  const healthyPass = healthy.clean && healthy.failed.length === 0 && healthy.code === 0;
  for (const fault of SHOP_FAULTS) {
    const run = await runSuite(take, fault, path.join(output, take, fault));
    record.faults[fault] = run;
    const verdict = !healthyPass ? 'invalid' : run.clean && run.failed.length > 0 && run.code === 1 ? 'detected'
      : run.clean && run.failed.length === 0 && run.code === 0 ? 'missed' : 'invalid';
    record[verdict].push(fault);
    console.log(`${take} ${fault}: ${verdict}; ${run.executed} tests; ${run.failed.length} failed; ${run.wallMs}ms`);
  }
  manifest.takes[take] = record;
  await writeFile(path.join(output, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n');
}
manifest.finishedAt = new Date().toISOString();
await writeFile(path.join(output, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('\nTake | healthy | detected | missed | invalid');
for (const [take, record] of Object.entries(manifest.takes)) {
  console.log(`${take} | ${record.healthy.failed.length === 0 && record.healthy.clean ? 'pass' : 'FAIL'} | ${record.detected.length}/${SHOP_FAULTS.length} | ${record.missed.join(', ') || '-'} | ${record.invalid.join(', ') || '-'}`);
}
