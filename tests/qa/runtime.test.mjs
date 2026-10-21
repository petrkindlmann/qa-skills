import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBounded } from '../../tests/workflows/support/process.mjs';
import { routeSkills } from '../../tools/qa/route.mjs';
import { validateConfig } from '../../tools/qa/config.mjs';
import { parseTap, parsePlaywright, assessCommand } from '../../tools/qa/results.mjs';
import { initialize, makePlan, runPlan } from '../../tools/qa/run.mjs';
import { redactText } from '../../tools/qa/privacy.mjs';
import { renderReport } from '../../tools/qa/report.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repo, 'scripts/qa.mjs');
const baseProject = { checks: [{ id: 'tests' }], frameworks: ['node-test'], changedFiles: [] };

const routingCases = [
  ['Can we test the payment confirmation email?', ['payment-testing', 'email-testing']],
  ['Our LLM feature invents answers when retrieval returns nothing.', ['ai-system-testing']],
  ['Generate tests from this PRD.', ['ai-test-generation']],
  ['This one locator is flaky on a fast machine.', ['test-reliability']],
  ['The redesign broke all selectors in 80 tests.', ['selector-drift-recovery']],
  ['Classify these 60 CI failures into groups.', ['ai-bug-triage']],
  ['Reproduce why the old session still works after logout.', ['bug-reproduction']],
  ['A screen reader cannot name the submit control.', ['accessibility-testing']],
  ['Check whether the CMP sends data before consent.', ['compliance-testing']],
  ['The GA4 checkout event has the wrong currency.', ['analytics-tracking-testing']],
  ['Exercise Android deep links with Appium.', ['mobile-testing']],
  ['Compare our browser matrix in Safari.', ['cross-browser-testing']],
  ['Measure the layout shift after the banner arrives.', ['performance-testing']],
  ['Prove the database migration preserves unique email addresses.', ['database-testing']],
  ['Use Pact to check the consumer contract.', ['contract-testing']],
  ['Remove duplicate tests from this regression suite.', ['test-suite-curation']],
  ['Set up QA from scratch for this new project.', ['qa-start']],
  ['Onboard a QA engineer into our existing team.', ['qa-project-bootstrap']],
  ['Keep a scheduled probe of the status page.', ['synthetic-monitoring']],
  ['Exercise the feature flag during the canary rollout.', ['testing-in-production']],
];
for (const [goal, expected] of routingCases) test(`routing: ${goal}`, () => {
  const actual = routeSkills({ goal, project: baseProject });
  assert.deepEqual(actual.primary.map(item => item.skill), expected);
});

test('changed paths add focused supporting skills without loading the catalog', () => {
  const routing = routeSkills({ goal: 'Run the checks', project: { ...baseProject, changedFiles: ['src/auth/session.ts', 'db/migrations/003.sql'] } });
  assert.deepEqual(routing.primary.map(item => item.skill), ['unit-testing']);
  assert.deepEqual(routing.supporting.map(item => item.skill), ['database-testing', 'security-testing']);
  assert.equal(routing.supporting.length, 2);
});

test('config rejects shell strings, duplicate ids, unknown fields, credentials and missing reporter', () => {
  for (const config of [
    { version: 1, checks: [{ id: 'test', command: 'npm test', reporter: 'tap' }] },
    { version: 1, checks: [{ id: 'test', command: ['node'], reporter: 'tap' }, { id: 'test', command: ['node'], reporter: 'tap' }] },
    { version: 1, budegtMs: 1000 },
    { version: 1, url: 'https://username:password@example.test' },
    { version: 1, checks: [{ id: 'test', command: ['node'] }] },
    { version: 1, checks: [{ id: 'browser', command: ['node'], reporter: 'tap' }] },
    { version: 1, checks: [{ id: 'browser-http-response', command: ['node'], reporter: 'tap' }] },
  ]) assert.throws(() => validateConfig(config));
  assert.doesNotThrow(() => validateConfig({ version: 1, checks: [], browser: { readySelector: '[data-ready="true"]' }, budgetMs: 5000 }));
});

const tap = counts => `TAP version 13\n${Array.from({ length: counts.total ?? 1 }, (_, i) => `${counts.failed ? 'not ' : ''}ok ${i + 1} - behavior`).join('\n')}\n1..${counts.total ?? 1}\n# tests ${counts.total ?? 1}\n# pass ${counts.passed ?? 1}\n# fail ${counts.failed ?? 0}\n# cancelled 0\n# skipped ${counts.skipped ?? 0}\n# todo 0\n`;
test('TAP gate rejects zero, skips, duplicate summaries and inconsistent totals', () => {
  assert.equal(parseTap(tap({})).status, 'passed');
  assert.equal(parseTap(tap({}).replaceAll('\n', '\r\n')).status, 'passed');
  assert.equal(parseTap(tap({ total: 0, passed: 0 })).status, 'incomplete');
  assert.equal(parseTap(tap({ total: 1, passed: 0, skipped: 1 })).status, 'incomplete');
  assert.equal(parseTap(tap({}) + tap({})).status, 'incomplete');
  assert.equal(parseTap(tap({ total: 2 })).status, 'incomplete');
  assert.equal(parseTap(tap({}).replace('ok 1 - behavior', '')).status, 'incomplete');
  assert.equal(parseTap(tap({}).replace('ok 1 - behavior', 'not ok 1 - failed assertion')).status, 'incomplete');
  assert.equal(parseTap(tap({}).replace('ok 1 - behavior', 'ok 1 - ignored # SKIP')).status, 'incomplete');
  assert.equal(parseTap(tap({}).replace('1..1', '1..2')).status, 'incomplete');
  assert.equal(assessCommand({ reporter: 'tap' }, { code: 1, log: tap({}) }).status, 'failed');
  assert.equal(assessCommand({ reporter: 'tap' }, { code: 0, log: tap({ total: 1, passed: 0, failed: 1 }) }).status, 'failed');
});

function playwright(tests, errors = []) { return JSON.stringify({ suites: [{ specs: [{ title: 'a behavior', tests }] }], errors }); }
const passed = { expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] };
test('Playwright gate rejects missing results, empty suites, flaky retries and expected failures', () => {
  assert.equal(parsePlaywright(`npm preamble\n${playwright([passed])}\n`).status, 'passed');
  assert.equal(parsePlaywright(playwright([])).status, 'incomplete');
  assert.equal(parsePlaywright(playwright([{ ...passed, results: [] }])).status, 'incomplete');
  assert.equal(parsePlaywright(playwright([{ ...passed, status: 'flaky', results: [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }] }])).status, 'incomplete');
  assert.equal(parsePlaywright(playwright([{ expectedStatus: 'failed', status: 'expected', results: [{ status: 'failed', retry: 0 }] }])).status, 'incomplete');
  assert.equal(parsePlaywright(playwright([], [{ message: 'global setup unavailable' }])).status, 'blocked');
  assert.equal(parsePlaywright(playwright([passed]).slice(0, -2)).status, 'incomplete');
  assert.equal(parsePlaywright(playwright([null])).status, 'incomplete');
  assert.equal(parsePlaywright(playwright([{ ...passed, results: [{ status: 'passed', errors: [] }] }])).status, 'incomplete');
  const skipped = { expectedStatus: 'passed', status: 'skipped', results: [{ status: 'skipped', retry: 0, errors: [] }] };
  assert.equal(parsePlaywright(`${playwright([skipped])}\n${playwright([passed])}`).status, 'incomplete');
  assert.equal(parsePlaywright(`${playwright([{ ...passed, status: 'unexpected', results: [{ status: 'failed', retry: 0, errors: [{ message: 'defect' }] }] }])}\n${playwright([passed])}`).status, 'incomplete');
});

async function fixture(t, files = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-runtime-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), contents);
  }
  return directory;
}
async function execute(project, extra = []) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  return runBounded({ command: process.execPath, args: [cli, 'run', '--project', project, ...extra], env, timeoutMs: 15_000, killGraceMs: 200, settlementGraceMs: 200 });
}
async function resultOf(project) {
  const directories = await fs.readdir(path.join(project, 'qa-results'));
  assert.equal(directories.length, 1);
  const directory = path.join(project, 'qa-results', directories[0]);
  return { directory, result: JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8')) };
}

test('real CLI discovers and runs a Node project outside Git and produces linked reports', async t => {
  const project = await fixture(t, {
    'package.json': JSON.stringify({ name: 'tiny-shop', type: 'module', scripts: { test: 'node --test' } }),
    'prices.test.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; test('independent unit prices',()=>assert.deepEqual([1200,1800],[1200,1800]));\n",
  });
  const executed = await execute(project);
  assert.equal(executed.code, 0, executed.log);
  const { result, directory } = await resultOf(project);
  assert.equal(result.summary.status, 'passed');
  assert.equal(result.summary.tests.observed, 1);
  assert.equal(result.plan.project.commit, null);
  assert.equal(result.checks[0].source, 'package.json scripts.test');
  const html = await fs.readFile(path.join(directory, 'report.html'), 'utf8');
  assert.match(html, /Configured checks passed\./);
  assert.match(html, /evidence\/project-tests\.log/);
  for (const name of ['plan.json', 'agent-handoff.md', 'minimal.log', 'verbose.log']) assert.ok((await fs.stat(path.join(directory, name))).size > 0);
});

test('real CLI keeps a defect red and does not turn skipped tests green', async t => {
  for (const [body, expected, failed] of [
    ["test('server revokes old session',()=>assert.equal(200,401));", 'failed', 1],
    ["test.skip('server revokes old session',()=>{});", 'incomplete', 0],
  ]) {
    const project = await fixture(t, {
      'package.json': JSON.stringify({ scripts: { test: 'node --test --test-reporter=tap test.mjs' } }),
      'test.mjs': `import test from 'node:test'; import assert from 'node:assert/strict'; ${body}\n`,
    });
    const execution = await execute(project);
    assert.equal(execution.code, expected === 'failed' ? 1 : 2, execution.log);
    const { result } = await resultOf(project);
    assert.equal(result.summary.status, expected);
    assert.equal(result.summary.tests.failed, failed);
  }
});

test('an explicit npm reporter argument remains singular', async t => {
  const project = await fixture(t, {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
    'one.test.mjs': "import test from 'node:test'; test('one observation',()=>{});\n",
    'qa.config.json': JSON.stringify({ version: 1, checks: [{ id: 'explicit', command: ['npm', 'run', 'test', '--', '--test-reporter=tap'], reporter: 'tap' }] }),
  });
  const execution = await execute(project);
  assert.equal(execution.code, 0, execution.log);
  assert.equal((await resultOf(project)).result.summary.tests.observed, 1);
});

test('no tests, exit-zero text and missing executable cannot produce a passing run', async t => {
  for (const [checks, expected] of [
    [[], 'incomplete'],
    [[{ id: 'text', command: [process.execPath, '-e', 'console.log("All good")'], reporter: 'exit-code' }], 'incomplete'],
    [[{ id: 'missing', command: ['qa-executable-that-does-not-exist-4091'], reporter: 'tap' }], 'blocked'],
  ]) {
    const project = await fixture(t, { 'qa.config.json': JSON.stringify({ version: 1, checks }) });
    const execution = await execute(project);
    assert.equal(execution.code, 2, execution.log);
    assert.equal((await resultOf(project)).result.summary.status, expected);
  }
});

test('the total budget bounds stalled commands and leaves subsequent checks blocked', async t => {
  const project = await fixture(t, { 'qa.config.json': JSON.stringify({ version: 1, budgetMs: 1300, checks: [
    { id: 'stalled', command: [process.execPath, '-e', 'setInterval(()=>{}, 1000)'], reporter: 'tap', timeoutMs: 5000 },
    { id: 'must-not-start', command: [process.execPath, '-e', 'console.log("unexpected")'], reporter: 'tap', timeoutMs: 5000 },
  ] }) });
  const started = Date.now();
  const execution = await execute(project);
  assert.equal(execution.code, 2, execution.log);
  assert.ok(Date.now() - started < 5000, 'outer run must settle promptly');
  const { result } = await resultOf(project);
  assert.equal(result.checks[0].timedOut, true);
  assert.equal(result.checks[1].status, 'blocked');
  assert.equal(result.checks[1].durationMs, 0);
});

test('plan is read-only, init is explicit and AGENTS wiring is idempotent', async t => {
  const project = await fixture(t, { 'AGENTS.md': '# Existing project policy\n\nKeep this text.\n' });
  const before = await fs.readdir(project);
  await makePlan({ project, goal: 'Check logout session revocation' });
  assert.deepEqual(await fs.readdir(project), before);
  await initialize({ project, wireAgent: true });
  const once = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
  assert.match(once, /^# Existing project policy\n\nKeep this text\./);
  assert.match(once, /at most two repair attempts/);
  await initialize({ project, wireAgent: true });
  assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), once);
  const config = JSON.parse(await fs.readFile(path.join(project, 'qa.config.json'), 'utf8'));
  assert.equal(config.version, 1);
});

test('conflicting workflow markers do not rewrite the existing AGENTS file', async t => {
  const text = 'Original\n<!-- qa-skills:workflow:start -->\nPartial manual edit\n';
  const project = await fixture(t, { 'AGENTS.md': text });
  await assert.rejects(initialize({ project, wireAgent: true }), /conflicting QA workflow markers/);
  assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), text);
});

test('known secrets, URL query values, and hostile report strings are kept out of shareable HTML', async t => {
  const project = await fixture(t, { 'qa.config.json': JSON.stringify({ version: 1, goal: '<img src=x onerror="alert(1)">', checks: [
    { id: 'output', command: [process.execPath, '-e', 'console.log("password=opensesame https://example.test/reset?code=needle123 Bearer token123")'], reporter: 'exit-code' },
  ] }) });
  const plan = await makePlan({ project });
  const { result, directory } = await runPlan(plan);
  const html = await fs.readFile(path.join(directory, 'report.html'), 'utf8');
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x/);
  assert.ok(!(await fs.readFile(path.join(directory, 'verbose.log'), 'utf8')).includes('opensesame'));
  assert.ok(!JSON.stringify(result).includes('needle123'));
  assert.ok(!JSON.stringify(result).includes('token123'));
  assert.equal(redactText('value abcdef', ['abcdef']), 'value [REDACTED]');
  const hostile = structuredClone(result);
  hostile.checks[0].evidence = 'javascript:alert(1)';
  assert.ok(!renderReport(hostile).includes('href="javascript:'));
});
