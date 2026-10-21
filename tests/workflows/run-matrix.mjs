import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBounded } from './support/process.mjs';
import { prepareRunDirectory, assessRun, unrunAfterFailedHealthy } from './support/outcome.mjs';
import { acquireMatrixLock } from './support/matrix-lock.mjs';

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
// 2026-10-21 addons: accessibility, data at rest, hardening and lab performance. Each fault
// runs against the addon suite only; the original cases keep running the combined suite.
const addonCases = [
  { id: 'shop-unlabeled-controls', env: { QA_SHOP_FAULT: 'unlabeled_controls' }, title: 'no WCAG 2.2 AA violations' },
  { id: 'shop-plaintext-sessions', env: { QA_SHOP_FAULT: 'plaintext_session_tokens' }, title: 'hashed at rest' },
  { id: 'shop-missing-idempotency-index', env: { QA_SHOP_FAULT: 'missing_idempotency_index' }, title: 'idempotency uniqueness' },
  { id: 'shop-no-login-throttle', env: { QA_SHOP_FAULT: 'no_login_throttle' }, title: 'throttled per account' },
  { id: 'shop-open-test-support', env: { QA_SHOP_FAULT: 'open_test_support' }, title: 'locked without the admin key' },
  { id: 'shop-smtp-failure', env: { QA_SHOP_FAULT: 'smtp_failure_503' }, title: 'mail service is down' },
  { id: 'todo-delayed-render', env: { QA_TODO_FAULT: 'delayed-render' }, title: 'largest content within the lab budget' },
  { id: 'todo-layout-shift', env: { QA_TODO_FAULT: 'layout-shift' }, title: 'layout stays stable' },
].map(scenario => ({ ...scenario, suite: 'addons', count: 11 }));
const oracleMatchers = {
  'shop-ownership': 'toBe', 'shop-pricing': 'toBe', 'shop-deduplication': 'toMatchObject',
  'shop-transaction': 'toHaveLength', 'shop-key-conflict': 'toBe', 'shop-reset-reuse': 'toBe',
  'todo-persistence': 'toHaveText', 'todo-duplicates': 'toHaveText', 'todo-filter': 'toHaveText',
  'todo-cancel': 'toHaveText', 'shop-logout': 'toBe', 'shop-unit-prices': 'toMatchObject',
  'shop-signed-whitespace': 'toBe', 'todo-removal-persistence': 'toHaveText',
  'shop-unlabeled-controls': 'toHaveLength', 'shop-plaintext-sessions': 'toMatch',
  'shop-missing-idempotency-index': 'toContainEqual', 'shop-no-login-throttle': 'toBe',
  'shop-open-test-support': 'toBe', 'shop-smtp-failure': 'toBe',
  'todo-delayed-render': 'toBeLessThan', 'todo-layout-shift': 'toEqual',
};
let cases = phase === 'initial' ? originalCases : phase === 'review-baseline'
  ? [...originalCases.filter(scenario => scenario.healthy), ...reviewCases.map(scenario => ({ ...scenario,
    expectedGap: !scenario.baselineTitle, title: scenario.baselineTitle ?? scenario.title }))]
  : [{ id: 'combined-healthy', suite: '.', healthy: true, count: 36 },
    ...[...originalCases.filter(scenario => !scenario.healthy), ...reviewCases].map(scenario => ({ ...scenario, suite: '.', count: 36 })),
    ...addonCases];
cases = cases.map(scenario => ({ ...scenario, runId: randomUUID(),
  oracle: oracleMatchers[scenario.id] ? { id: scenario.id, matcher: oracleMatchers[scenario.id] } : undefined,
  count: scenario.count ?? (scenario.suite === 'baseline-shop' ? 10 : 9) }));
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
const lock = acquireMatrixLock(output);
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
try {
const manifest = { startedAt: new Date().toISOString(), phase, node: process.version,
  artifactLayout: 'Each run uses <case-id>/<run-id>; artifactDirectory is relative to the matrix output root.',
  playwright: JSON.parse(await readFile(path.join(root, 'node_modules/playwright/package.json'))).version,
  browserExecutable: process.env.QA_BROWSER_EXECUTABLE ?? 'Playwright-installed Chromium',
  method: 'Fresh-agent acceptance assertions with explicit oracle wrappers; full suite per variant; retries disabled. Detection requires a designated matcher failure, a structured oracle record, and a matching per-run token. Broader causal interpretation still requires review.',
  sourceHashes: { ...await hashes(path.join(root, 'tests/workflows/generated/baseline-shop')),
    ...await hashes(path.join(root, 'tests/workflows/generated/baseline-todo')),
    ...await hashes(path.join(root, 'tests/workflows/fixture-app')),
    ...await hashes(path.join(root, 'tests/workflows/support')),
    ...await hashes(path.join(root, 'tests/workflows/upstream-todomvc')) }, runs: [] };
if (phase === 'final') Object.assign(manifest.sourceHashes, await hashes(path.join(root, 'tests/workflows/generated/review-followup')),
  await hashes(path.join(root, 'tests/workflows/generated/addons')));

for (const scenario of cases) {
  // Even a killed parent can leave descendants briefly alive. Never let a new
  // invocation share their ready files, SQLite databases, traces or reporter path.
  const directory = path.join(output, scenario.id, scenario.runId);
  await prepareRunDirectory(directory);
  // Bound each variant in proportion to its suite: four seconds per case, never under 90 s.
  const globalTimeoutMs = Math.max(90000, scenario.count * 4000);
  const args = ['node_modules/playwright/cli.js', 'test', '--config', 'tests/workflows/playwright.config.mjs',
    '--workers=2', '--retries=0', `--global-timeout=${globalTimeoutMs}`];
  const env = { ...process.env, QA_SHOP_FAULT: '', QA_TODO_FAULT: '', ...scenario.env, QA_MATRIX_RUN_ID: scenario.runId,
    QA_WORKFLOW_SUITE: path.join(root, 'tests/workflows/generated', scenario.suite), QA_WORKFLOW_OUTPUT: directory };
  const started = performance.now();
  const result = await runBounded({ command: process.execPath, args, cwd: root, env, timeoutMs: globalTimeoutMs + 10000,
    killGraceMs: 5000, signal: cancellation.signal, onSpawn: pid => lock.child(pid) });
  lock.child(null);
  await writeFile(path.join(directory, 'minimal.txt'), result.log);
  let report;
  let parseError;
  try { report = JSON.parse(await readFile(path.join(directory, 'verbose.json'), 'utf8')); }
  catch (error) { parseError = error.message; }
  const { tests, failed, timedOut, infrastructureError, outcome, oracleVerified } = assessRun(scenario, result, report);
  const run = { ...scenario, artifactDirectory: path.relative(output, directory),
    command: [process.execPath, ...args], code: result.code, signal: result.signal,
    wallMs: Math.round(performance.now() - started), stats: report?.stats, parseError,
    executed: tests.length, failed, infrastructureError, timedOut, outcome,
    forcedSettlement: result.forcedSettlement, launchError: result.launchError, aborted: result.aborted, outputTruncated: result.outputTruncated,
    oracleVerified,
    review: scenario.healthy || scenario.expectedGap ? undefined : oracleVerified ? 'designated assertion verified' : 'pending evidence review' };
  manifest.runs.push(run);
  await writeFile(path.join(output, 'matrix.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${scenario.id}: ${run.outcome}; ${tests.length} tests; ${failed.length} failed; ${run.wallMs}ms`);
  const remaining = cases.slice(cases.indexOf(scenario) + 1);
  const unrun = cancellation.signal.aborted ? remaining.map(next => ({ ...next, expectedCount: next.count, executed: 0,
    failed: [], outcome: 'not_run', code: null, reason: 'Matrix interrupted; remaining variants were not run', oracleVerified: false }))
    : unrunAfterFailedHealthy(scenario, outcome, remaining);
  if (unrun.length) {
    manifest.runs.push(...unrun);
    console.log(`Stopped after ${cancellation.signal.aborted ? 'interruption' : 'failed healthy control'}; ${unrun.length} requested variants not run`);
    break;
  }
}
manifest.finishedAt = new Date().toISOString();
await writeFile(path.join(output, 'matrix.json'), JSON.stringify(manifest, null, 2) + '\n');
process.exitCode = manifest.runs.every(run => ['healthy_pass', 'assertion_detection_verified', 'coverage_gap_confirmed'].includes(run.outcome)) ? 0 : 1;
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
  lock.release();
}
