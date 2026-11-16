import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFunctions } from './snippets.mjs';
import { regressionCheck, readJUnit, format, exitCode } from '../../skills/bug-reproduction/scripts/regression-check.mjs';

const script = fileURLToPath(new URL('../../skills/bug-reproduction/scripts/regression-check.mjs', import.meta.url));

// The reported bug: lines of 0.10 and 0.20 total 0.30000000000000004 instead of 0.30.
const buggy = `export const total = lines => lines.reduce((sum, line) => sum + line, 0);\n`;
const fixed = `export const total = lines => lines.reduce((sum, line) => sum + Math.round(line * 100), 0) / 100;\n`;
const taxSource = `export const tax = amount => Math.round(amount * 21) / 100;\n`;
const header = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as order from '../src/total.mjs';\n`;
const smallAmounts = `test('order total of small amounts', () => { assert.equal(order.total([0.1, 0.2]), 0.3); });\n`;
const twoLines = `test('order total of two lines', () => { assert.equal(order.total([1, 2]), 3); });\n`;
const symptom = /0\.30000000000000004/;

const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;

function project(t, { source = buggy, committedTest = null } = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-regression-check-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  git('init', '-q', '-b', 'main');
  write('src/total.mjs', `${source}${taxSource}`);
  write('tests/tax.test.mjs', `${header}test('tax of 100 is 21', () => { assert.equal(order.tax(100), 21); });\n`);
  if (committedTest) write('tests/total.test.mjs', committedTest);
  git('add', '.');
  git('commit', '-q', '-m', 'order total');
  return { repo, git, write, fix: (source = fixed) => write('src/total.mjs', `${source}${taxSource}`) };
}

const command = [process.execPath, '--test', '--test-isolation=none', '--test-reporter=junit', '--test-reporter-destination={report}', '{tests}'];
const check = (repo, options = {}) => regressionCheck({ repo, command, symptom, env, timeoutMs: 20_000, ...options });
const statuses = result => Object.fromEntries(result.tests.map(row => [row.name.replace(/^.* › /, ''), row.status]));

test('an uncommitted fix and its test: found without naming the file, red at HEAD with the symptom', async t => {
  const { repo, git, write, fix } = project(t);
  fix();
  write('tests/total.test.mjs', `${header}${smallAmounts}`);
  const status = git('status', '--porcelain');
  const result = await check(repo);
  assert.equal(result.verdict, 'shows_the_bug', result.reason);
  assert.equal(exitCode(result.verdict), 0);
  assert.deepEqual(statuses(result), { 'order total of small amounts': 'shows_the_bug' });
  assert.match(result.tests[0].message, symptom);
  assert.equal(result.tests[0].new, true);
  assert.deepEqual(result.frozen, [{ file: 'tests/total.test.mjs', sha256: createHash('sha256').update(fs.readFileSync(path.join(repo, 'tests/total.test.mjs'))).digest('hex') }]);
  assert.equal(result.base, git('rev-parse', 'HEAD'));
  assert.equal(result.candidate, `${git('rev-parse', 'HEAD')} + working tree`);
  assert.equal(result.baseRuns, 1);
  // The project is as it was and no worktree is left.
  assert.equal(git('status', '--porcelain'), status);
  assert.equal(git('worktree', 'list').split('\n').length, 1);
});

test('without a symptom a red then green test is reported for reading, not as proof', async t => {
  const { repo, write, fix } = project(t);
  fix();
  write('tests/total.test.mjs', `${header}${smallAmounts}`);
  const result = await check(repo, { symptom: null });
  assert.equal(result.verdict, 'red_then_green');
  assert.match(result.reason, /no symptom was given/);
  assert.match(format(result), /red_then_green \(1\): .*compare the failure with the bug report/);

  const other = await check(repo, { symptom: /duplicated row/ });
  assert.equal(other.verdict, 'no_test_shows_the_bug');
  assert.deepEqual(statuses(other), { 'order total of small amounts': 'red_without_symptom' });
  assert.equal(exitCode(other.verdict), 1);
});

test('a new test that passes at the base is listed apart and the base is run again', async t => {
  const { repo, write, fix } = project(t);
  fix();
  write('tests/total.test.mjs', `${header}${smallAmounts}${twoLines}`);
  const result = await check(repo);
  assert.equal(result.verdict, 'shows_the_bug');
  assert.deepEqual(statuses(result), { 'order total of small amounts': 'shows_the_bug', 'order total of two lines': 'green_at_base' });
  assert.equal(result.baseRuns, 3);
  assert.match(format(result), /green_at_base \(1\): new, and passes at the base[\s\S]*passed in 3 of 3 base run/);

  write('tests/total.test.mjs', `${header}${twoLines}`);
  const none = await check(repo, { repeat: 1 });
  assert.equal(none.verdict, 'no_test_shows_the_bug');
  assert.equal(none.baseRuns, 1);
  assert.match(none.reason, /none of the 1 new or changed test\(s\) fails at the base/);
});

test('a test that needs a name the fix adds is not evidence, whatever the symptom says', async t => {
  const { repo, write, fix } = project(t);
  write('src/total.mjs', `${fixed}${taxSource}export const formatTotal = lines => total(lines).toFixed(2);\n`);
  write('tests/total.test.mjs', `${header}test('order total is formatted', () => { assert.equal(order.formatTotal([0.1, 0.2]), '0.30'); });\n`);
  // A one-word symptom taken from the report's title also matches the TypeError.
  const result = await check(repo, { symptom: /formatTotal/ });
  assert.equal(result.verdict, 'no_test_shows_the_bug');
  assert.equal(result.tests[0].status, 'missing_at_base');
  assert.equal(result.tests[0].missing, 'formatTotal');
  assert.match(format(result), /needs formatTotal: .*formatTotal is not a function/);

  // The same when the whole file fails to load at the base.
  write('tests/total.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { formatTotal } from '../src/total.mjs';\n`
    + `test('order total is formatted', () => { assert.equal(formatTotal([0.1, 0.2]), '0.30'); });\n`);
  const unloaded = await check(repo, { symptom: null });
  assert.equal(unloaded.verdict, 'no_test_shows_the_bug');
  assert.deepEqual(statuses(unloaded), { 'order total is formatted': 'missing_at_base' });
  assert.deepEqual(unloaded.tests[0].base, ['absent']);

  // A test support file that was not carried to the base is the same case: name it with the tests.
  fix();
  write('tests/total.test.mjs', `${header}import { fixture } from './fixture.mjs';\ntest('order total of small amounts', () => { assert.equal(order.total(fixture), 0.3); });\n`);
  write('tests/fixture.mjs', 'export const fixture = [0.1, 0.2];\n');
  const unfrozen = await check(repo, { tests: ['tests/total.test.mjs'] });
  assert.deepEqual(statuses(unfrozen), { 'order total of small amounts': 'missing_at_base' });
  assert.match(format(unfrozen), /needs fixture: .*Cannot find module/);
  // Found by itself, the fixture is carried along and the test reaches the bug.
  assert.equal((await check(repo)).verdict, 'shows_the_bug');
  // Support files are carried and not handed to the runner as tests.
  fs.renameSync(path.join(repo, 'tests/fixture.mjs'), path.join(repo, 'tests/fixtures.mjs'));
  write('tests/fixtures/lines.mjs', 'export const fixture = [0.1, 0.2];\n');
  write('tests/total.test.mjs', `${header}import { fixture } from './fixtures/lines.mjs';\ntest('order total of small amounts', () => { assert.equal(order.total(fixture), 0.3); });\n`);
  fs.rmSync(path.join(repo, 'tests/fixtures.mjs'));
  const carried = await check(repo);
  assert.equal(carried.verdict, 'shows_the_bug', carried.reason);
  assert.deepEqual(carried.frozen.map(item => item.file).sort(), ['tests/fixtures/lines.mjs', 'tests/total.test.mjs']);
  await assert.rejects(check(repo, { tests: ['tests/fixtures/lines.mjs'] }), /looks like a test file to run/);
});

test('a test file in a source folder called utils is a test by its name', async t => {
  const { repo, write, fix } = project(t);
  fix();
  // hono keeps src/utils/url.test.ts beside src/utils/url.ts.
  write('src/utils/total.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as order from '../total.mjs';\n${smallAmounts}`);
  const result = await check(repo);
  assert.equal(result.verdict, 'shows_the_bug', result.reason);
  assert.deepEqual(result.frozen.map(item => item.file), ['src/utils/total.test.mjs']);
  // A file in such a folder without a test name stays a support file.
  write('tests/utils/server.mjs', 'export const port = 0;\n');
  await assert.rejects(check(repo, { tests: ['tests/utils/server.mjs'] }), /looks like a test file to run/);
});

test('new tests that were all skipped leave nothing to say', async t => {
  const { repo, write, fix } = project(t);
  fix();
  const skipped = `test('order total on the next runtime', { skip: 'needs a newer runtime' }, () => { assert.equal(order.total([0.1, 0.2]), 0.3); });\n`;
  write('tests/total.test.mjs', `${header}${skipped}`);
  const result = await check(repo);
  assert.equal(result.verdict, 'inconclusive', result.reason);
  assert.match(result.reason, /1 new or changed test\(s\) were skipped/);
  assert.deepEqual(statuses(result), { 'order total on the next runtime': 'skipped' });
  assert.equal(exitCode(result.verdict), 2);
  // One test that ran is enough for a verdict about the bug.
  write('tests/total.test.mjs', `${header}${skipped}${twoLines}`);
  const ran = await check(repo, { repeat: 1 });
  assert.equal(ran.verdict, 'no_test_shows_the_bug');
  assert.deepEqual(statuses(ran), { 'order total on the next runtime': 'skipped', 'order total of two lines': 'green_at_base' });
});

test('a test file that fails to load at the base: evidence only when the load error is the symptom', async t => {
  const { repo, write, fix } = project(t);
  fix();
  // The bug stops the file while it is imported, as a route table or a schema would.
  write('tests/total.test.mjs', `${header}const prices = order.total([0.1, 0.2]);\nif (prices !== 0.3) throw new Error('price table holds ' + prices);\n`
    + `test('price table is built', () => { assert.equal(prices, 0.3); });\n`);
  const result = await check(repo);
  assert.equal(result.verdict, 'shows_the_bug', JSON.stringify(result.tests));
  assert.deepEqual(result.tests[0].base, ['absent']);
  const other = await check(repo, { symptom: /duplicated row/ });
  assert.deepEqual(statuses(other), { 'price table is built': 'did_not_load' });
  assert.equal(other.verdict, 'no_test_shows_the_bug');
  assert.match(format(other), /did_not_load \(1\): did not run at the base[\s\S]*price table holds 0\.30000000000000004/);
});

test('a bug that raises a name error of its own is still the bug', async t => {
  // At the base total() calls a helper that was never defined; the name is in the base's source.
  const { repo, write, fix } = project(t, { source: `export const total = lines => roundCents(lines.reduce((sum, line) => sum + line, 0));\n` });
  fix();
  write('tests/total.test.mjs', `${header}${smallAmounts}`);
  const result = await check(repo, { symptom: /roundCents is not defined/ });
  assert.equal(result.verdict, 'shows_the_bug', JSON.stringify(result.tests));
});

test('a test that is flaky on the buggy code is not counted as green at the base', async t => {
  const { repo, write, fix } = project(t);
  const counter = path.join(repo, '..', `${path.basename(repo)}-runs`);
  t.after(() => fs.rmSync(counter, { force: true }));
  fix();
  // Passes the first time it runs, whatever the code does.
  write('tests/total.test.mjs', `${header}import fs from 'node:fs';\ntest('order total of small amounts', () => {\n`
    + `  fs.appendFileSync(${JSON.stringify(counter)}, 'x');\n  if (fs.readFileSync(${JSON.stringify(counter)}, 'utf8').length === 1) return;\n`
    + `  assert.equal(order.total([0.1, 0.2]), 0.3);\n});\n`);
  const result = await check(repo);
  assert.deepEqual(statuses(result), { 'order total of small amounts': 'flaky_at_base' });
  assert.deepEqual(result.tests[0].base, ['passed', 'failed']);
  assert.equal(result.verdict, 'no_test_shows_the_bug');
  assert.match(format(result), /failed in 1 of 2 base runs/);
});

test('a changed assertion in an old test, a fix that fails and a fix that breaks another test', async t => {
  const { repo, git, write, fix } = project(t, { committedTest: `${header}${twoLines}` });
  fix();
  write('tests/total.test.mjs', `${header}${twoLines}${smallAmounts}`);
  const added = await check(repo);
  assert.equal(added.verdict, 'shows_the_bug');
  // The old test in the same file passes at both and is not a new test.
  assert.deepEqual(statuses(added), { 'order total of small amounts': 'shows_the_bug' });

  write('tests/total.test.mjs', `${header}test('order total of two lines', () => { assert.equal(order.total([0.1, 0.2]), 0.3); });\n`);
  const changed = await check(repo);
  assert.equal(changed.verdict, 'shows_the_bug');
  assert.equal(changed.tests[0].new, false);

  write('tests/total.test.mjs', `${header}${smallAmounts}`);
  fix(`export const total = lines => lines.reduce((sum, line) => sum + line, 0) + 0;\n`);
  const notFixed = await check(repo);
  assert.equal(notFixed.verdict, 'not_fixed');
  assert.deepEqual(statuses(notFixed), { 'order total of small amounts': 'fails_at_candidate' });

  write('src/total.mjs', `${fixed}export const tax = amount => amount;\n`);
  const breaks = await check(repo, { command: [...command.slice(0, -1), 'tests/total.test.mjs', 'tests/tax.test.mjs'] });
  assert.equal(breaks.verdict, 'breaks_other_tests');
  assert.match(breaks.regressions[0], /tax of 100 is 21/);
  assert.equal(exitCode(breaks.verdict), 1);
  assert.equal(git('worktree', 'list').split('\n').length, 1);
});

test('a test that failed before the change and still fails is left out', async t => {
  const broken = `test('needs a service this machine does not have', () => { assert.fail('connect ECONNREFUSED'); });\n`;
  const { repo, write, fix } = project(t, { committedTest: `${header}${broken}` });
  fix();
  write('tests/total.test.mjs', `${header}${broken}${smallAmounts}`);
  const result = await check(repo);
  assert.equal(result.verdict, 'shows_the_bug');
  assert.equal(result.alreadyFailing.length, 1);
  assert.match(format(result), /1 test\(s\) fail at the base with its own tests and at the candidate, and were left out/);
});

test('two committed revisions, with a prepare step that runs in the worktrees only', async t => {
  const { repo, git, write, fix } = project(t);
  const base = git('rev-parse', 'HEAD');
  fix();
  write('tests/total.test.mjs', `${header}${smallAmounts}`);
  git('add', '.');
  git('commit', '-q', '-m', 'round the total');
  const marker = path.join(repo, '..', `${path.basename(repo)}-prepared`);
  t.after(() => fs.rmSync(marker, { force: true }));
  const result = await check(repo, { base, candidate: 'HEAD', prepare: `pwd >> ${JSON.stringify(marker)}` });
  assert.equal(result.verdict, 'shows_the_bug', result.reason);
  assert.equal(result.candidate, git('rev-parse', 'HEAD'));
  const prepared = fs.readFileSync(marker, 'utf8').trim().split('\n');
  assert.equal(prepared.length, 2);
  assert.ok(prepared.every(cwd => cwd !== repo && /regression-/.test(cwd)), prepared.join(' '));

  await assert.rejects(check(repo, { base, candidate: 'HEAD', prepare: 'echo no lockfile >&2; exit 3' }), /"echo no lockfile >&2; exit 3" failed at .*no lockfile/s);
  assert.equal(git('worktree', 'list').split('\n').length, 1);
  await assert.rejects(check(repo, { base, candidate: 'HEAD', tests: null, command: [] }), /test command/);
  await assert.rejects(check(repo, { base: 'no-such-revision' }), /git rev-parse/);
});

test('no report, a timeout, no test file and an edited file are not verdicts about the bug', async t => {
  const { repo, write, fix } = project(t);
  fix();
  await assert.rejects(check(repo), /No changed file since HEAD looks like a test/);

  write('tests/total.test.mjs', `${header}${smallAmounts}`);
  const noReport = await check(repo, { command: [process.execPath, '-e', 'console.log("ran nothing"); process.exit(1)'] });
  assert.equal(noReport.verdict, 'inconclusive');
  assert.match(noReport.reason, /base: no JUnit report was written \(exit 1\).*ran nothing/s);
  assert.equal(exitCode(noReport.verdict), 2);

  // The runner leaves a worker behind that never exits. The check must end and take it down.
  const pidFile = path.join(repo, '..', `${path.basename(repo)}-worker`);
  t.after(() => fs.rmSync(pidFile, { force: true }));
  const hang = `const { spawn } = require('node:child_process');`
    + `const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });`
    + `require('node:fs').appendFileSync(${JSON.stringify(pidFile)}, worker.pid + '\\n'); setInterval(() => {}, 1000);`;
  const slow = await check(repo, { command: [process.execPath, '-e', hang], timeoutMs: 1_500 });
  assert.equal(slow.verdict, 'inconclusive');
  assert.match(slow.reason, /base: the run timed out after 1\.5 s/);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const workers = fs.readFileSync(pidFile, 'utf8').trim().split('\n').map(Number);
  assert.ok(workers.length >= 1);
  if (process.platform !== 'win32') assert.deepEqual(workers.filter(alive), []);

  write('tests/total.test.mjs', `${header}import fs from 'node:fs';\nfs.appendFileSync(new URL('../src/total.mjs', import.meta.url), '\\n// touched by the test\\n');\n${smallAmounts}`);
  const tampered = await check(repo);
  assert.equal(tampered.verdict, 'tampered');
  assert.match(tampered.reason, /base: a tracked file changed while the tests ran/);
});

test('the command line prints the report, writes JSON and exits with the verdict', t => {
  const { repo, write, fix } = project(t);
  fix();
  write('tests/total.test.mjs', `${header}${smallAmounts}${twoLines}`);
  const json = path.join(repo, '..', `${path.basename(repo)}-result.json`);
  t.after(() => fs.rmSync(json, { force: true }));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: repo, env, encoding: 'utf8', timeout: 60_000 });

  const good = run('--symptom', '0\\.30000000000000004', '--repeat', '2', '--json', json, '--', ...command);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /shows_the_bug \(1\): fails at the base with the symptom[\s\S]*order total of small amounts[\s\S]*green_at_base \(1\)[\s\S]*verdict: shows_the_bug/);
  assert.match(good.stderr, /again, a new test passed there \(2 of 2\)/);
  const saved = JSON.parse(fs.readFileSync(json, 'utf8'));
  assert.equal(saved.verdict, 'shows_the_bug');
  assert.equal(saved.baseRuns, 2);

  const slashes = run('--symptom', '/0\\.3000/i', '--tests', 'tests/total.test.mjs', '--repeat', '1', '--', ...command);
  assert.equal(slashes.status, 0, slashes.stderr);

  write('tests/total.test.mjs', `${header}${twoLines}`);
  const none = run('--repeat', '1', '--', ...command);
  assert.equal(none.status, 1);
  assert.match(none.stdout, /verdict: no_test_shows_the_bug/);

  for (const [args, message] of [[['--nope', 'x', '--', ...command], /Unknown option: --nope/], [['--base'], /Missing value for --base/],
    [['--base', 'HEAD'], /Give the test command after --/], [['--repeat', '0', '--', ...command], /--repeat takes a number of 1 or more/]]) {
    const bad = run(...args);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, message);
  }
  assert.match(run('--help').stdout, /Usage: node regression-check\.mjs/);
});

test('the script reads JUnit reports exactly as the documented helper does', () => {
  const { readJUnit: documented } = loadFunctions('skills/bug-reproduction/references/regression-evidence.md', 'function regressionEvidence(',
    ['readJUnit'], { spawnSync, createHash, fs, os, path });
  const directory = fileURLToPath(new URL('./fixtures/junit/', import.meta.url));
  const reports = fs.readdirSync(directory).filter(name => name.endsWith('.xml'));
  assert.ok(reports.length >= 2);
  for (const name of reports) {
    const xml = fs.readFileSync(path.join(directory, name), 'utf8');
    assert.deepEqual(readJUnit(xml), documented(xml), name);
    assert.ok(readJUnit(xml).length > 0, name);
  }
});

test('a runner that writes no report when a test file cannot be loaded at the base', async t => {
  const { repo, write } = project(t, { committedTest: `${header}${twoLines}` });
  write('src/total.mjs', `${fixed}${taxSource}export const formatTotal = lines => total(lines).toFixed(2);\n`);
  write('tests/total.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total, formatTotal } from '../src/total.mjs';\n`
    + `test('order total of two lines', () => { assert.equal(total([1, 2]), 3); });\ntest('order total is formatted', () => { assert.equal(formatTotal([0.1, 0.2]), '0.30'); });\n`);
  // Stands for mocha and others: the import error ends the process before any report exists.
  const runner = path.join(repo, '..', `${path.basename(repo)}-runner.mjs`);
  t.after(() => fs.rmSync(runner, { force: true }));
  fs.writeFileSync(runner, `import { spawnSync } from 'node:child_process';\nimport fs from 'node:fs';\nconst [report, ...files] = process.argv.slice(2);\n`
    + `const run = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=junit', '--test-reporter-destination=' + report, ...files], { encoding: 'utf8' });\n`
    + `const xml = fs.existsSync(report) ? fs.readFileSync(report, 'utf8') : '';\n`
    + `if (/does not provide an export named/.test(xml)) { fs.rmSync(report); console.error(/SyntaxError: [^\\n&]*/.exec(xml)[0]); process.exit(1); }\nprocess.exit(run.status);\n`);
  const result = await check(repo, { command: [process.execPath, runner, '{report}', '{tests}'] });
  assert.equal(result.verdict, 'no_test_shows_the_bug', result.reason);
  assert.deepEqual(statuses(result), { 'order total of two lines': 'missing_at_base', 'order total is formatted': 'missing_at_base' });
  assert.equal(result.tests[0].missing, 'formatTotal');

  // When the base cannot run its own tests either, nothing is concluded.
  const broken = await check(repo, { command: [process.execPath, '-e', 'process.exit(1)'] });
  assert.equal(broken.verdict, 'inconclusive');
});
