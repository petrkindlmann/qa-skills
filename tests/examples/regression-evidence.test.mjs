import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFunctions } from './snippets.mjs';

const { readJUnit, regressionVerdict, regressionEvidence } = loadFunctions(
  'skills/bug-reproduction/references/regression-evidence.md', 'function regressionEvidence(',
  ['readJUnit', 'regressionVerdict', 'regressionEvidence'], { spawnSync, createHash, fs, os, path });

// The reported bug: lines of 0.10 and 0.20 total 0.30000000000000004 instead of 0.30.
const buggy = `export const total = lines => lines.reduce((sum, line) => sum + line, 0);\n`;
const fixed = `export const total = lines => lines.reduce((sum, line) => sum + Math.round(line * 100), 0) / 100;\n`;
const wrongFix = `export const total = lines => lines.reduce((sum, line) => sum + line, 0) + 0;\n`;
const breaksTax = `${fixed}export const tax = amount => amount;\n`;
const taxSource = `export const tax = amount => Math.round(amount * 21) / 100;\n`;
const header = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as order from '../src/total.mjs';\n`;
const regressionTest = `${header}test('order total of small amounts', () => { assert.equal(order.total([0.1, 0.2]), 0.3); });\n`;
const symptom = /0\.30000000000000004/;
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;

function project(t, { source = buggy, testFile = regressionTest, commitTest = false } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-regression-'));
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
  write('src/total.mjs', `${source}${source.includes('tax') ? '' : taxSource}`);
  write('tests/tax.test.mjs', `${header}test('tax of 100 is 21', () => { assert.equal(order.tax(100), 21); });\n`);
  if (commitTest) write('tests/total.test.mjs', testFile);
  git('add', '.');
  git('commit', '-q', '-m', 'order total');
  if (!commitTest) write('tests/total.test.mjs', testFile);
  return { repo, git, write };
}

const evidence = (repo, options = {}) => regressionEvidence({
  repo,
  tests: ['tests/total.test.mjs'],
  command: [process.execPath, '--test', '--test-isolation=none', '--test-reporter=junit', '--test-reporter-destination={report}', 'tests/total.test.mjs', 'tests/tax.test.mjs'],
  symptom,
  select: /order total/,
  env,
  timeoutMs: 20_000,
  ...options,
});

test('an uncommitted fix and its test: red at HEAD with the symptom, green in the working tree', t => {
  const { repo, git, write } = project(t);
  write('src/total.mjs', `${fixed}${taxSource}`);
  const status = git('status', '--porcelain');
  const result = evidence(repo);
  assert.equal(result.verdict, 'distinguishes', result.reason);
  assert.deepEqual(result.regressions, []);
  assert.deepEqual(result.frozen, [{ file: 'tests/total.test.mjs', sha256: sha256(path.join(repo, 'tests/total.test.mjs')) }]);
  assert.equal(result.base.revision, git('rev-parse', 'HEAD'));
  assert.equal(result.candidate.revision, `${git('rev-parse', 'HEAD')} + working tree`);
  assert.match(result.base.tests.find(item => /order total/.test(item.name)).message, symptom);
  // The base ran in a worktree that is gone again, and the project is as it was.
  assert.equal(git('status', '--porcelain'), status);
  assert.equal(git('worktree', 'list').split('\n').length, 1);
});

test('two commits: the test is carried onto a base that never had it', t => {
  const { repo, git, write } = project(t);
  const base = git('rev-parse', 'HEAD');
  write('src/total.mjs', `${fixed}${taxSource}`);
  git('add', '.');
  git('commit', '-q', '-m', 'round the total');
  const result = evidence(repo, { base, candidate: 'HEAD' });
  assert.equal(result.verdict, 'distinguishes', result.reason);
  assert.equal(result.base.revision, base);
  assert.equal(result.candidate.revision, git('rev-parse', 'HEAD'));
  assert.equal(git('worktree', 'list').split('\n').length, 1);
});

test('a test that passes on the buggy revision does not distinguish', t => {
  const alreadyGreen = `${header}test('order total of two lines', () => { assert.equal(order.total([1, 2]), 3); });\n`;
  const { repo, write } = project(t, { testFile: alreadyGreen });
  write('src/total.mjs', `${fixed}${taxSource}`);
  const result = evidence(repo);
  assert.equal(result.verdict, 'does_not_distinguish');
  assert.match(result.reason, /never showed the bug: .*order total of two lines/);
});

test('red for another reason is not evidence, though it goes green with the fix', t => {
  const usesNewApi = `${header}test('order total is formatted', () => { assert.equal(order.formatTotal([0.1, 0.2]), '0.30'); });\n`;
  const { repo, write } = project(t, { testFile: usesNewApi });
  write('src/total.mjs', `${fixed}${taxSource}export const formatTotal = lines => total(lines).toFixed(2);\n`);
  const result = evidence(repo);
  assert.equal(result.verdict, 'inconclusive');
  assert.match(result.reason, /failed without the symptom .*formatTotal is not a function/);
  // Without a real symptom the same two runs would have been accepted.
  assert.equal(regressionVerdict(result.base, result.candidate, { symptom: /./, select: /order total/ }).verdict, 'distinguishes');
  assert.throws(() => regressionVerdict(result.base, result.candidate, { select: /order total/ }), /reported symptom/);
});

test('a fix that leaves the test red is reported as not fixed', t => {
  const { repo, write } = project(t);
  write('src/total.mjs', `${wrongFix}${taxSource}`);
  const result = evidence(repo);
  assert.equal(result.verdict, 'not_fixed');
  assert.match(result.reason, /still fails at the candidate/);
});

test('a fix that breaks a test outside the selection keeps that failure', t => {
  const { repo, write } = project(t);
  write('src/total.mjs', breaksTax);
  const result = evidence(repo);
  assert.equal(result.verdict, 'breaks_other_tests');
  assert.equal(result.regressions.length, 1);
  assert.match(result.regressions[0], /tax of 100 is 21/);
});

test('a test that passed at the base and fails at the candidate', t => {
  const { repo, write } = project(t, { testFile: `${header}test('order total of two lines', () => { assert.equal(order.total([1, 2]), 3); });\n` });
  write('src/total.mjs', `export const total = () => 0;\n${taxSource}`);
  assert.equal(evidence(repo).verdict, 'candidate_fails');
});

test('no selected test, a skipped test, a timeout and a missing report are inconclusive', t => {
  const { repo, write } = project(t);
  write('src/total.mjs', `${fixed}${taxSource}`);

  const nothing = evidence(repo, { select: /no such test/ });
  assert.equal(nothing.verdict, 'inconclusive');
  assert.match(nothing.reason, /no test matched/);

  const noReport = evidence(repo, { command: [process.execPath, '-e', 'process.exit(1)'] });
  assert.equal(noReport.verdict, 'inconclusive');
  assert.match(noReport.reason, /no JUnit report was written \(exit 1\)/);

  write('tests/total.test.mjs', regressionTest.replace("test('order", "test.skip('order"));
  const skipped = evidence(repo);
  assert.equal(skipped.verdict, 'inconclusive');
  assert.match(skipped.reason, /skipped: .*order total/);

  write('tests/total.test.mjs', `${header}test('order total of small amounts', async () => { await new Promise(resolve => setTimeout(resolve, 5_000)); });\n`);
  const slow = evidence(repo, { timeoutMs: 500 });
  assert.equal(slow.verdict, 'inconclusive');
  assert.match(slow.reason, /base: the run timed out/);
});

test('a test file that does not load at the base selects different tests', t => {
  const { repo, write } = project(t, {
    testFile: `${header}import { fixture } from './fixture.mjs';\ntest('order total of small amounts', () => { assert.equal(order.total(fixture), 0.3); });\n`,
  });
  write('tests/fixture.mjs', 'export const fixture = [0.1, 0.2];\n');
  write('src/total.mjs', `${fixed}${taxSource}`);
  // fixture.mjs is not frozen, so the base worktree has no such file.
  const result = evidence(repo, { select: /total/ });
  assert.equal(result.verdict, 'inconclusive', result.reason);
  assert.match(result.reason, /different tests|no test matched|failed without the symptom/);
  // Freezing the fixture with the test makes the same pair conclusive.
  assert.equal(evidence(repo, { tests: ['tests/total.test.mjs', 'tests/fixture.mjs'] }).verdict, 'distinguishes');
});

test('a test that edits the code or itself while it runs is tampering', t => {
  const patches = `${header}import fs from 'node:fs';\n`
    + `fs.appendFileSync(new URL('../src/total.mjs', import.meta.url), '\\n// touched by the test\\n');\n`
    + `test('order total of small amounts', () => { assert.equal(order.total([0.1, 0.2]), 0.3); });\n`;
  const { repo, write } = project(t, { testFile: patches });
  const result = evidence(repo);
  assert.equal(result.verdict, 'tampered');
  assert.match(result.reason, /base: a tracked file changed while the tests ran/);

  write('tests/total.test.mjs', `${regressionTest}import fs from 'node:fs';\nfs.appendFileSync(new URL(import.meta.url), '\\n');\n`);
  const self = evidence(repo);
  assert.equal(self.verdict, 'tampered');
  assert.match(self.reason, /tests\/total\.test\.mjs changed while the tests ran/);
});

test('a source file named among the tests carries the fix to the base', t => {
  const { repo, write } = project(t);
  write('src/total.mjs', `${fixed}${taxSource}`);
  const result = evidence(repo, { tests: ['tests/total.test.mjs', 'src/total.mjs'] });
  assert.equal(result.verdict, 'does_not_distinguish');
  assert.deepEqual(result.frozen.map(item => item.file), ['tests/total.test.mjs', 'src/total.mjs']);
});

test('prepare runs in each tree and its failure stops the run', t => {
  const { repo, write } = project(t);
  write('src/total.mjs', `${fixed}${taxSource}`);
  const marker = path.join(repo, '..', `${path.basename(repo)}-prepared`);
  t.after(() => fs.rmSync(marker, { force: true }));
  const ok = evidence(repo, { prepare: [process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(marker)}, process.cwd() + '\\n')`] });
  assert.equal(ok.verdict, 'distinguishes', ok.reason);
  assert.equal(new Set(fs.readFileSync(marker, 'utf8').trim().split('\n')).size, 2);
  assert.throws(() => evidence(repo, { prepare: [process.execPath, '-e', 'process.exit(3)'] }), /failed at HEAD/);
  assert.throws(() => evidence(repo, { tests: [] }), /Name the test files/);
});

test('readJUnit reads real Playwright and pytest reports', () => {
  const fixture = name => fs.readFileSync(fileURLToPath(new URL(`./fixtures/junit/${name}`, import.meta.url)), 'utf8');
  const playwright = readJUnit(fixture('playwright-1.62.1.xml'));
  assert.deepEqual(playwright.map(item => [item.name, item.status]), [
    ['sample.spec.mjs › order total › sums three lines <exactly> & "quoted"', 'failed'],
    ['sample.spec.mjs › order total › keeps the currency', 'passed'],
    ['sample.spec.mjs › order total › rounds half up', 'skipped'],
    ['sample.spec.mjs › order total › reads the fixture', 'failed'],
  ]);
  assert.match(playwright[0].message, /Received: 0\.30000000000000004/);
  assert.match(playwright[3].message, /formatTotal is not a function/);
  assert.equal(playwright[1].message, '');

  const pytest = readJUnit(fixture('pytest-9.2.0.xml'));
  assert.deepEqual(pytest.map(item => [item.name, item.status]), [
    ['test_total › test_sums_three_lines', 'failed'],
    ['test_total › test_keeps_currency', 'passed'],
    ['test_total › test_rounds_half_up', 'skipped'],
    ['test_total › test_reads_fixture', 'failed'],
  ]);
  assert.match(pytest[0].message, /AssertionError: total <wrong> & "quoted"\nassert \(0\.1 \+ 0\.2\) == 0\.3/);
  assert.match(pytest[3].message, /RuntimeError: database not started/);
  assert.deepEqual(readJUnit('<testsuites></testsuites>'), []);
});
