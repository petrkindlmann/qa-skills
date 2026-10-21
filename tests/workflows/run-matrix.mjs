import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBounded } from './support/process.mjs';
import { prepareRunDirectory, assessRun } from './support/outcome.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.resolve(process.env.QA_MATRIX_OUTPUT ?? path.join(root, 'tests/workflows/artifacts/matrix'));
const phase = process.argv[2] ?? 'final';
if (!['initial', 'review-baseline', 'final'].includes(phase)) throw new Error('Phase must be initial, review-baseline or final');
const originalCases = [
  { id: 'shop-healthy', suite: 'baseline-shop', healthy: true, count: 10 },
  { id: 'todo-healthy', suite: 'baseline-todo', healthy: true, count: 9 },
  { id: 'shop-ownership', suite: 'baseline-shop', env: { QA_SHOP_FAULT: 'cross_user_order_read' }, title: 'order ownership is private' },
  { id: 'shop-pricing', suite: 'baseline-shop', env: { QA_SHOP_FAULT: 'trust_client_amount' }, title: 'catalog controls money' },
  { id: 'shop-deduplication', suite: 'baseline-shop', env: { QA_SHOP_FAULT: 'duplicate_fulfillment' }, title: 'concurrent payment redelivery' },
  { id: 'shop-transaction', suite: 'baseline-shop', env: { QA_SHOP_FAULT: 'receipt_before_commit' }, title: 'transient fulfillment rolls back' },
  { id: 'shop-key-conflict', suite: 'baseline-shop', env: { QA_SHOP_FAULT: 'idempotency_payload_conflict' }, title: 'concurrent equivalent checkout' },
  { id: 'shop-reset-reuse', suite: 'baseline-shop', env: { QA_SHOP_FAULT: 'reusable_reset_token' }, title: 'actual reset email completes' },
  { id: 'todo-persistence', suite: 'baseline-todo', env: { QA_TODO_FAULT: 'persistence-lost' }, title: 'persist through reload' },
  { id: 'todo-duplicates', suite: 'baseline-todo', env: { QA_TODO_FAULT: 'delete-wrong-duplicate' }, title: 'duplicate titles remain independent' },
  { id: 'todo-filter', suite: 'baseline-todo', env: { QA_TODO_FAULT: 'filter-state-error' }, title: 'filters visibly select' },
  { id: 'todo-cancel', suite: 'baseline-todo', env: { QA_TODO_FAULT: 'escape-commits-edit' }, title: 'Escape preserves' },
];
const reviewCases = [
  { id: 'shop-logout', suite: 'baseline-shop', count: 10, env: { QA_SHOP_FAULT: 'logout_cookie_only' }, title: 'copied' },
  { id: 'shop-unit-prices', suite: 'baseline-shop', count: 10, env: { QA_SHOP_FAULT: 'compensating_prices' }, title: 'unit' },
  { id: 'shop-signed-whitespace', suite: 'baseline-shop', count: 10, env: { QA_SHOP_FAULT: 'canonicalized_signature' }, title: 'noncanonical' },
  { id: 'todo-removal-persistence', suite: 'baseline-todo', count: 9, env: { QA_TODO_FAULT: 'delete-persistence-lost' }, title: 'single delete persists immediately', baselineTitle: 'whitespace Enter and empty blur' },
];
let cases = phase === 'initial' ? originalCases : phase === 'review-baseline'
  ? [...originalCases.filter(scenario => scenario.healthy), ...reviewCases.map(scenario => ({ ...scenario,
    expectedGap: !scenario.baselineTitle, title: scenario.baselineTitle ?? scenario.title }))]
  : [{ id: 'combined-healthy', suite: '.', healthy: true, count: 25 },
    ...[...originalCases.filter(scenario => !scenario.healthy), ...reviewCases].map(scenario => ({ ...scenario, suite: '.', count: 25 }))];
cases = cases.map(scenario => ({ ...scenario, count: scenario.count ?? (scenario.suite === 'baseline-shop' ? 10 : 9) }));
if (process.argv[3]) {
  const selected = process.argv[3].split(',');
  if (selected.some(id => !cases.some(scenario => scenario.id === id))) throw new Error('Unknown selected matrix case');
  cases = cases.filter(scenario => selected.includes(scenario.id));
}

async function hashes(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await hashes(file));
    else if (/\.(mjs|cjs|py|html|json|md)$/.test(entry.name)) result[path.relative(root, file)] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  return result;
}

await mkdir(output, { recursive: true });
const manifest = { startedAt: new Date().toISOString(), phase, node: process.version,
  playwright: JSON.parse(await readFile(path.join(root, 'node_modules/playwright/package.json'))).version,
  browserExecutable: process.env.QA_BROWSER_EXECUTABLE ?? 'Playwright-installed Chromium',
  method: 'Frozen fresh-agent acceptance suites; full suite per variant; retries disabled. Nonzero exit alone is not a detection. Inspect assertion evidence before accepting each candidate.',
  sourceHashes: { ...await hashes(path.join(root, 'tests/workflows/generated/baseline-shop')),
    ...await hashes(path.join(root, 'tests/workflows/generated/baseline-todo')),
    ...await hashes(path.join(root, 'tests/workflows/fixture-app')),
    ...await hashes(path.join(root, 'tests/workflows/support')),
    ...await hashes(path.join(root, 'tests/workflows/upstream-todomvc')) }, runs: [] };
if (phase === 'final') Object.assign(manifest.sourceHashes, await hashes(path.join(root, 'tests/workflows/generated/review-followup')));

for (const scenario of cases) {
  const directory = path.join(output, scenario.id);
  await prepareRunDirectory(directory);
  const args = ['node_modules/playwright/cli.js', 'test', '--config', 'tests/workflows/playwright.config.mjs',
    '--workers=2', '--retries=0', '--global-timeout=90000'];
  const env = { ...process.env, QA_SHOP_FAULT: '', QA_TODO_FAULT: '', ...scenario.env,
    QA_WORKFLOW_SUITE: path.join(root, 'tests/workflows/generated', scenario.suite), QA_WORKFLOW_OUTPUT: directory };
  const started = performance.now();
  const result = await runBounded({ command: process.execPath, args, cwd: root, env, timeoutMs: 100000, killGraceMs: 5000 });
  await writeFile(path.join(directory, 'minimal.txt'), result.log);
  let report;
  let parseError;
  try { report = JSON.parse(await readFile(path.join(directory, 'verbose.json'), 'utf8')); }
  catch (error) { parseError = error.message; }
  const { tests, failed, timedOut, infrastructureError, outcome } = assessRun(scenario, result, report);
  const run = { ...scenario, command: [process.execPath, ...args], code: result.code, signal: result.signal,
    wallMs: Math.round(performance.now() - started), stats: report?.stats, parseError,
    executed: tests.length, failed, infrastructureError, timedOut, outcome,
    forcedSettlement: result.forcedSettlement, launchError: result.launchError, outputTruncated: result.outputTruncated,
    review: scenario.healthy ? undefined : 'pending evidence review' };
  manifest.runs.push(run);
  await writeFile(path.join(output, 'matrix.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${scenario.id}: ${run.outcome}; ${tests.length} tests; ${failed.length} failed; ${run.wallMs}ms`);
}
manifest.finishedAt = new Date().toISOString();
await writeFile(path.join(output, 'matrix.json'), JSON.stringify(manifest, null, 2) + '\n');
process.exitCode = manifest.runs.every(run => ['healthy_pass', 'assertion_detection_candidate', 'coverage_gap_confirmed'].includes(run.outcome)) ? 0 : 1;
