#!/usr/bin/env node
// Which of the tests that came with a fix fail on the code that still has the bug?
//
// Runs the candidate's test files at the base revision and at the candidate and reports
// every new or changed test: red at the base with the reported symptom, red for another
// reason, green at the base, flaky at the base. Needs Node 20+, git and a test runner
// that writes JUnit XML. No dependencies. See ../references/regression-evidence.md.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const help = `Usage: node regression-check.mjs [options] -- <test command>

  --base REV         Revision that has the bug (default: HEAD)
  --candidate REV    Revision that has the fix (default: the working tree)
  --tests FILE       Test file or test data to carry onto the base; repeat for more.
                     Default: files changed since the base whose path looks like a test
  --symptom REGEX    What the bug report says goes wrong, e.g. '0\\.30000000000000004'
  --repeat N         Base runs while a new test keeps passing there (default: 3)
  --prepare COMMAND  Shell command run in each worktree before its tests, e.g. 'npm ci'
  --timeout SECONDS  Limit for one run (default: 300)
  --json FILE        Write the full result as JSON
  --repo PATH        Repository (default: current directory)

In the test command, {report} becomes the path of the JUnit file to write and {tests}
the carried files that are code and not fixtures, helpers or snapshots. Spell the files
out in the command when that guess is wrong. PLAYWRIGHT_JUNIT_OUTPUT_FILE is set to the
report path as well.

  node regression-check.mjs --symptom '0\\.30000000000000004' -- \\
    node --test --test-reporter=junit --test-reporter-destination={report} {tests}
  node regression-check.mjs --base origin/main --candidate HEAD -- \\
    python -m pytest -q -o junit_family=xunit1 --junitxml={report} {tests}

Exit codes: 0 = a test fails at the base and passes at the candidate; 1 = no test shows
the bug, the candidate still fails, or it breaks another test; 2 = inconclusive.
`;

const TEST_DIR = /(^|\/)(tests?|__tests__|specs?|testing|e2e|cypress)\//i;
const TEST_NAME = /[._-](test|spec)\.[cm]?[jt]sx?$|\.test-d\.ts$|(^|\/)test_[^/]*\.py$|_test\.(py|go|rb)$|Tests?\.(java|kt|cs)$/i;
// Carried with the tests and not handed to the runner as a test file, unless its name says it is one:
// src/utils/url.test.ts is a test, tests/utils/server.js is not.
const SUPPORT = /(^|\/)(fixtures?|__fixtures__|__snapshots__|snapshots|helpers?|utils?|support|mocks?|__mocks__|data|testdata)\/|(^|\/)conftest\.py$|\.d\.ts$/i;
const CODE = /\.([cm]?[jt]sx?|py|rb|go|java|kt|cs|php|rs|swift)$/i;

// Names a failure says are missing. A test that needs one the candidate adds is red at the
// base whatever the bug is.
const MISSING = [
  /cannot import name '([\w$]+)'/, /does not provide an export named '([\w$]+)'/, /has no attribute '([\w$]+)'/,
  /(?:^|[\s.(])([\w$]+) is not a (?:function|constructor)/, /name '([\w$]+)' is not defined/, /\b([\w$]+) is not defined/,
  /No module named '(?:[\w$]+\.)*([\w$]+)'/, /Cannot find module '(?:[^']*\/)?([\w$-]+)(?:\.\w+)?'/,
  /unexpected keyword argument '([\w$]+)'/, /fixture '([\w$]+)' not found/, /Property '([\w$]+)' does not exist/,
];

const unescape = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex, code) => String.fromCodePoint(parseInt(code, hex ? 16 : 10))).replace(/&amp;/g, '&');

export function readJUnit(xml) {
  const attribute = (source, name) => unescape(new RegExp(`\\s${name}="([^"]*)"`).exec(source)?.[1] ?? '');
  const cases = [];
  for (const [, attributes, body = ''] of xml.matchAll(/<testcase\b((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const problem = /<(failure|error)\b((?:[^>"]|"[^"]*")*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(body);
    cases.push({
      name: [attribute(attributes, 'classname'), attribute(attributes, 'name')].filter(Boolean).join(' › '),
      status: problem ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed',
      message: problem ? unescape(`${attribute(problem[2], 'message')}\n${(problem[3] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')}`) : '',
    });
  }
  return cases;
}

// Runs one command in its own process group and removes the whole group afterwards, so
// workers that a buggy revision leaves hanging do not outlive the check.
const running = new Set();
let interrupted = false;
function execute(command, { cwd, env, timeoutMs, shell = false }) {
  return new Promise((resolve, reject) => {
    const posix = process.platform !== 'win32';
    const child = spawn(command[0], command.slice(1), { cwd, env, shell, detached: posix, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, done = false;
    const killGroup = () => {
      try { posix ? process.kill(-child.pid, 'SIGKILL') : spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']); } catch { /* nothing left */ }
    };
    const finish = exitCode => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(linger);
      running.delete(killGroup);
      if (interrupted) reject(new Error('interrupted'));
      else resolve({ exitCode, timedOut, output });
    };
    let linger;
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    running.add(killGroup);
    const keep = chunk => { output = `${output}${chunk}`.slice(-8000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', error => { output = `${output}${error.message}`; finish(null); });
    child.on('exit', exitCode => { killGroup(); linger = setTimeout(() => finish(exitCode), 2_000); });
    child.on('close', exitCode => finish(exitCode));
  });
}

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Duplicate names (a parameterized title, the same test in two files) get a suffix.
function byName(tests) {
  const seen = new Map(), rows = new Map();
  for (const test of tests) {
    const count = (seen.get(test.name) ?? 0) + 1;
    seen.set(test.name, count);
    rows.set(count > 1 ? `${test.name} #${count}` : test.name, test);
  }
  return rows;
}

export async function regressionCheck({ repo = process.cwd(), base = 'HEAD', candidate = null, tests = null, command, symptom = null,
  repeat = 3, prepare = null, timeoutMs = 300_000, env = process.env, log = () => {} }) {
  if (!command?.length) throw new Error('Give the test command after --');
  if (symptom !== null && !(symptom instanceof RegExp)) throw new Error('symptom is a RegExp');
  const tryGit = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 1 << 28 });
  const git = (cwd, ...args) => {
    const result = tryGit(cwd, ...args);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  };
  const root = String(git(repo, 'rev-parse', '--show-toplevel')).trim();
  const baseSha = String(git(root, 'rev-parse', '--verify', `${base}^{commit}`)).trim();
  const candidateSha = candidate ? String(git(root, 'rev-parse', '--verify', `${candidate}^{commit}`)).trim() : null;
  const lines = buffer => String(buffer).split('\n').filter(Boolean);

  if (!tests?.length) {
    const changed = candidateSha
      ? lines(git(root, 'diff', '--name-only', '--diff-filter=AMR', baseSha, candidateSha))
      : [...lines(git(root, 'diff', '--name-only', '--diff-filter=AMR', baseSha)), ...lines(git(root, 'ls-files', '--others', '--exclude-standard'))];
    tests = changed.filter(file => TEST_DIR.test(file) || TEST_NAME.test(file));
    if (!tests.length) throw new Error(`No changed file since ${base} looks like a test; name the test files with --tests`);
  }
  const frozen = tests.map(file => {
    const bytes = candidateSha ? git(root, 'show', `${candidateSha}:${file}`) : fs.readFileSync(path.join(root, file));
    return { file, bytes, sha256: sha256(bytes) };
  });

  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'regression-'));
  const trees = [];
  const worktree = async (name, revision) => {
    const cwd = path.join(scratch, name);
    git(root, 'worktree', 'add', '--detach', cwd, revision);
    trees.push(cwd);
    if (prepare) {
      const ready = await execute([prepare], { cwd, env, timeoutMs, shell: true });
      if (ready.exitCode !== 0) throw new Error(`"${prepare}" failed at ${revision.slice(0, 10)}: ${ready.output.slice(-600)}`);
    }
    return cwd;
  };
  let reports = 0;
  const runTests = async (cwd, files, watch = []) => {
    const report = path.join(scratch, `junit-${reports += 1}.xml`);
    const tracked = () => sha256(git(cwd, 'diff', 'HEAD'));
    const before = tracked();
    const argv = command.flatMap(part => part === '{tests}' ? files : [part.replaceAll('{report}', report).replaceAll('{tests}', files.join(' '))]);
    const result = await execute(argv, { cwd, env: { ...env, PLAYWRIGHT_JUNIT_OUTPUT_FILE: report }, timeoutMs });
    const changed = watch.filter(({ file, sha256: expected }) => !fs.existsSync(path.join(cwd, file)) || sha256(fs.readFileSync(path.join(cwd, file))) !== expected)
      .map(({ file }) => file);
    if (tracked() !== before) changed.push('a tracked file');
    return { ...result, changed, tests: fs.existsSync(report) ? readJUnit(fs.readFileSync(report, 'utf8')) : null };
  };

  try {
    // The base as it is: which test names existed before the change.
    log(`base ${baseSha.slice(0, 10)}: its own tests`);
    const baseTree = await worktree('base', baseSha);
    const files = frozen.map(({ file }) => file).filter(file => CODE.test(file) && (TEST_NAME.test(file) || !SUPPORT.test(file)));
    if (!files.length) throw new Error(`None of ${frozen.map(({ file }) => file).join(', ')} looks like a test file to run; name the test files with --tests`);
    const existed = files.filter(file => fs.existsSync(path.join(baseTree, file)));
    const native = existed.length ? await runTests(baseTree, existed) : { tests: [] };
    for (const { file, bytes } of frozen) {
      fs.mkdirSync(path.dirname(path.join(baseTree, file)), { recursive: true });
      fs.writeFileSync(path.join(baseTree, file), bytes);
    }
    log(`base ${baseSha.slice(0, 10)}: the candidate's tests`);
    const baseRuns = [await runTests(baseTree, files, frozen)];
    log(`candidate ${candidateSha?.slice(0, 10) ?? 'working tree'}`);
    const after = await runTests(candidateSha ? await worktree('candidate', candidateSha) : root, files, frozen);

    const result = {
      base: baseSha, candidate: candidateSha ?? `${String(git(root, 'rev-parse', 'HEAD')).trim()} + working tree`,
      frozen: frozen.map(({ file, sha256: hash }) => ({ file, sha256: hash })), symptom: symptom ? String(symptom) : null,
    };
    const stop = (verdict, reason) => ({ ...result, verdict, reason, tests: [], baseRuns: baseRuns.length });
    // Some runners write no report when a test file cannot be loaded. If the same command
    // wrote one for the base's own tests and for the candidate, that is what happened here.
    const crashed = !baseRuns[0].tests && !baseRuns[0].timedOut && native.tests && after.tests ? baseRuns[0].output.trim().slice(-2000) : null;
    if (crashed !== null) baseRuns[0].tests = [];
    for (const [label, run] of [['base', baseRuns[0]], ['candidate', after]]) {
      if (run.changed.length) return stop('tampered', `${label}: ${run.changed.join(', ')} changed while the tests ran`);
      if (run.timedOut) return stop('inconclusive', `${label}: the run timed out after ${timeoutMs / 1000} s`);
      if (!run.tests) return stop('inconclusive', `${label}: no JUnit report was written (exit ${run.exitCode}); put {report} where the runner takes its JUnit path. Output: ${run.output.trim().slice(-400)}`);
    }
    if (!after.tests.length) return stop('inconclusive', 'candidate: the report holds no test');

    const before = native.tests ? byName(native.tests) : null;   // null: the base's own tests wrote no report
    const now = byName(after.tests);
    const isNew = name => before ? !before.has(name) : null;
    const passesNow = name => now.get(name).status === 'passed';
    // A new test that passes at the base may be flaky there. Run the base again while one still does.
    const stillGreen = () => [...now.keys()].some(name => isNew(name) && passesNow(name) && baseRuns.every(run => byName(run.tests).get(name)?.status === 'passed'));
    while (baseRuns.length < repeat && stillGreen()) {
      log(`base ${baseSha.slice(0, 10)}: again, a new test passed there (${baseRuns.length + 1} of ${repeat})`);
      const again = await runTests(baseTree, files, frozen);
      if (!again.tests) break;
      baseRuns.push(again);
    }

    const excludes = frozen.map(({ file }) => `:(exclude)${file}`);
    const grep = (...args) => tryGit(root, 'grep', '-q', '-w', '-F', ...args, '--', '.', ...excludes).status;
    const addedByCandidate = message => {
      for (const pattern of MISSING) {
        const name = pattern.exec(message)?.[1];
        if (!name || grep(name, baseSha) !== 1) continue;
        if ((candidateSha ? grep(name, candidateSha) : grep('--untracked', name)) === 0) return name;
      }
      return null;
    };
    const matches = message => new RegExp(symptom.source, symptom.flags.replace(/[gy]/g, '')).test(message);
    // The start of a failure: a few lines, because some runners put the values on the second one.
    const first = message => message.split('\n').map(line => line.trim()).filter(Boolean).slice(crashed !== null && message === crashed ? -4 : 0).slice(0, 4).join(' | ').slice(0, 300);
    const atBase = baseRuns.map(run => byName(run.tests));
    // Failures at the base that belong to no test of the candidate: a file that did not load.
    const loadErrors = crashed !== null ? [crashed] : [...atBase[0]].filter(([name, test]) => test.status === 'failed' && !now.has(name)).map(([, test]) => test.message);

    const rows = [], regressions = [], alreadyFailing = [];
    for (const [name, test] of now) {
      const seen = atBase.map(run => run.get(name)?.status ?? 'absent');
      const failed = seen.filter(status => status === 'failed').length, passed = seen.filter(status => status === 'passed').length;
      const absent = seen.every(status => status === 'absent');
      // Failed before the change with the base's own tests and still fails: not about this change.
      if (test.status === 'failed' && before?.get(name)?.status === 'failed') { alreadyFailing.push(name); continue; }
      if (isNew(name) !== true && !failed && !absent) {
        if (test.status === 'failed' && passed) regressions.push(name);
        continue;
      }
      const message = failed ? atBase.find(run => run.get(name)?.status === 'failed').get(name).message : absent ? loadErrors.join('\n') : '';
      const row = { name, new: isNew(name), base: seen, candidate: test.status, message: first(message) };
      const missing = message ? addedByCandidate(message) : null;
      if (test.status === 'skipped' || seen.includes('skipped')) row.status = 'skipped';
      else if (test.status === 'failed') { row.status = 'fails_at_candidate'; row.message = first(test.message); }
      else if (failed && passed) row.status = 'flaky_at_base';
      else if (passed) row.status = 'green_at_base';
      else if (missing) { row.status = 'missing_at_base'; row.missing = missing; }
      else if (!failed) row.status = symptom && matches(message) ? 'shows_the_bug' : 'did_not_load';
      else row.status = !symptom ? 'red_then_green' : matches(message) ? 'shows_the_bug' : 'red_without_symptom';
      rows.push(row);
    }

    const count = status => rows.filter(row => row.status === status).length;
    const good = count('shows_the_bug') + count('red_then_green');
    const summary = ['shows_the_bug', 'red_then_green', 'red_without_symptom', 'missing_at_base', 'did_not_load', 'green_at_base', 'flaky_at_base', 'fails_at_candidate', 'skipped']
      .filter(count).map(status => `${count(status)} ${status}`).join(', ');
    const [verdict, reason] = regressions.length ? ['breaks_other_tests', `${regressions.length} test(s) that passed at the base fail at the candidate: ${regressions.slice(0, 3).join(', ')}`]
      : count('fails_at_candidate') ? ['not_fixed', `${count('fails_at_candidate')} new or changed test(s) fail at the candidate`]
      : !rows.length ? ['inconclusive', `no new or changed test was found in ${files.join(', ')}`]
      : count('skipped') === rows.length ? ['inconclusive', `the ${rows.length} new or changed test(s) were skipped, so none ran at both revisions`]
      : good && symptom ? ['shows_the_bug', `${good} test(s) fail at the base with the symptom and pass at the candidate`]
      : good ? ['red_then_green', `${good} test(s) fail at the base and pass at the candidate; no symptom was given, so read the base failures below`]
      : ['no_test_shows_the_bug', `none of the ${rows.length} new or changed test(s) fails at the base ${symptom ? 'with the symptom' : 'on the behaviour'}`];
    return { ...result, verdict, reason, summary, regressions, alreadyFailing, baseRuns: baseRuns.length, newTestsKnown: before !== null, tests: rows };
  } finally {
    for (const cwd of trees) {
      if (tryGit(root, 'worktree', 'remove', '--force', cwd).status !== 0) {
        // A buggy revision can leave directories nobody may enter.
        if (process.platform !== 'win32') spawnSync('chmod', ['-R', 'u+rwx', cwd]);
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    }
    fs.rmSync(scratch, { recursive: true, force: true });
    tryGit(root, 'worktree', 'prune');
  }
}

const NOTES = {
  shows_the_bug: 'fails at the base with the symptom, passes at the candidate',
  red_then_green: 'fails at the base, passes at the candidate; compare the failure with the bug report',
  red_without_symptom: 'fails at the base, but not with the symptom',
  missing_at_base: 'fails at the base because something the candidate adds does not exist there, so the behaviour was not reached (test support files are carried with --tests)',
  did_not_load: 'did not run at the base: its file failed to load there',
  green_at_base: 'new, and passes at the base: it never showed this bug (a neighbouring case, or the base needs another runtime, older dependencies or the type checker)',
  flaky_at_base: 'passes in some base runs and fails in others',
  fails_at_candidate: 'fails at the candidate',
  skipped: 'skipped in one of the runs',
};

export function format(result) {
  const out = [`base      ${result.base}`, `candidate ${result.candidate}`, ...result.frozen.map(item => `test file ${item.file}  sha256 ${item.sha256.slice(0, 16)}`), ''];
  for (const [status, note] of Object.entries(NOTES)) {
    const rows = result.tests.filter(row => row.status === status);
    if (!rows.length) continue;
    out.push(`${status} (${rows.length}): ${note}`);
    for (const row of rows.slice(0, 20)) {
      out.push(`  ${row.name}`);
      const detail = status === 'missing_at_base' ? `needs ${row.missing}: ${row.message}`
        : status === 'flaky_at_base' ? `failed in ${row.base.filter(item => item === 'failed').length} of ${row.base.length} base runs: ${row.message}`
        : status === 'green_at_base' ? `passed in ${row.base.length} of ${row.base.length} base run(s)` : row.message;
      if (detail) out.push(`      ${detail}`);
    }
    if (rows.length > 20) out.push(`  ... and ${rows.length - 20} more`);
    out.push('');
  }
  if (result.alreadyFailing?.length) out.push(`${result.alreadyFailing.length} test(s) fail at the base with its own tests and at the candidate, and were left out: ${result.alreadyFailing.slice(0, 3).join(', ')}`, '');
  if (result.newTestsKnown === false) out.push('The base wrote no report with its own tests, so new tests that pass at the base could not be told from old ones.', '');
  out.push(`verdict: ${result.verdict}`, `  ${result.reason}`);
  return `${out.join('\n')}\n`;
}

export const exitCode = verdict => ['shows_the_bug', 'red_then_green'].includes(verdict) ? 0 : ['inconclusive', 'tampered'].includes(verdict) ? 2 : 1;

export async function main(argv = process.argv.slice(2), write = text => process.stdout.write(text)) {
  const split = argv.indexOf('--');
  const args = split < 0 ? [...argv] : argv.slice(0, split), command = split < 0 ? [] : argv.slice(split + 1);
  if (args.includes('--help') || !argv.length) { write(help); return 0; }
  const options = { command, tests: [] };
  const valued = { '--base': 'base', '--candidate': 'candidate', '--symptom': 'symptom', '--repeat': 'repeat', '--prepare': 'prepare', '--timeout': 'timeout', '--json': 'json', '--repo': 'repo' };
  const stop = () => { interrupted = true; for (const kill of running) kill(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    for (let index = 0; index < args.length; index += 1) {
      const name = args[index], value = args[index + 1];
      if (name !== '--tests' && !valued[name]) throw new Error(`Unknown option: ${name}`);
      if (value === undefined) throw new Error(`Missing value for ${name}`);
      if (name === '--tests') options.tests.push(value); else options[valued[name]] = value;
      index += 1;
    }
    const pattern = /^\/(.+)\/([a-z]*)$/s.exec(options.symptom ?? '');
    const number = (name, fallback) => {
      const value = options[name] === undefined ? fallback : Number(options[name]);
      if (!Number.isFinite(value) || value < 1) throw new Error(`--${name} takes a number of 1 or more`);
      return value;
    };
    const result = await regressionCheck({
      ...options, repo: options.repo ?? process.cwd(), repeat: number('repeat', 3), timeoutMs: number('timeout', 300) * 1000,
      symptom: options.symptom ? (pattern ? new RegExp(pattern[1], pattern[2]) : new RegExp(options.symptom)) : null,
      log: message => process.stderr.write(`${message}\n`),
    });
    if (options.json) fs.writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`);
    write(format(result));
    return exitCode(result.verdict);
  } catch (error) {
    process.stderr.write(`regression-check: ${error.message}\n`);
    return 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
