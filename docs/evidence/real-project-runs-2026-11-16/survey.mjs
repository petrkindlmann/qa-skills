// Runs the shipped regressionEvidence helper over real fix commits of a cloned repository.
// usage: node survey.mjs <repo> [newest=30] [agentCap=40]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadFunctions } from '../../../tests/examples/snippets.mjs';

const { readJUnit, regressionEvidence } = loadFunctions(
  'skills/bug-reproduction/references/regression-evidence.md', 'function regressionEvidence(',
  ['readJUnit', 'regressionVerdict', 'regressionEvidence'], { spawnSync, createHash, fs, os, path });

const ROOT = path.resolve(process.env.REAL_RUNS_DIR ?? 'real-runs');   // holds repos/, venvs/ and out/
const [name, newest = '30', agentCap = '40'] = process.argv.slice(2);
const dir = path.join(ROOT, 'repos', name);
let venv = path.join(ROOT, 'venvs', name, 'bin', 'python');
const linkModules = ['sh', '-c', `[ -e node_modules ] || ln -s ${path.join(dir, 'node_modules')} node_modules`];
const nodeTest = files => ['node', '--test', '--test-timeout=30000', '--test-force-exit', '--test-reporter=junit', '--test-reporter-destination={report}', ...files];
const mocha = (...extra) => files => [path.join(dir, 'node_modules/.bin/mocha'), '--no-config', ...extra, '--timeout', '30000',
  '--reporter', 'xunit', '--reporter-option', 'output={report}', ...files];
// PYTHONPATH is made absolute in each tree: a test that starts Python in another directory must
// still import the tree under test, not a copy installed in the environment.
const pytest = (source, ...extra) => files => ['sh', '-c', `PYTHONPATH="$PWD/${source}" exec "$0" "$@"`, venv, '-m', 'pytest', '-q', '-p', 'no:cacheprovider',
  '-o', 'junit_family=xunit1', '--junitxml={report}', ...extra, ...files];
const code = /\.(m?[jt]sx?|cjs|py)$/;

const REPOS = {
  undici: { frozen: /^test\//, runnable: /^test\/(?!fixtures\/|wpt\/|utils\/|types\/|imports\/).*\.m?js$/, source: /^(lib\/|index\.js$)/, command: nodeTest, prepare: linkModules },
  fastify: { frozen: /^test\//, runnable: /^test\/.*\.test\.m?js$/, source: /^(lib\/|fastify\.js$)/, command: nodeTest, prepare: linkModules },
  eslint: { frozen: /^tests\//, runnable: /^tests\/lib\/.*\.js$/, source: /^lib\//, command: mocha(), prepare: linkModules },
  express: { frozen: /^test\//, runnable: /^test\/[^/]+\.js$/, source: /^(lib\/|index\.js$)/, command: mocha('--require', 'test/support/env', '--check-leaks'), prepare: linkModules },
  hono: { frozen: /^src\/.*\.test\.tsx?$|^src\/.*__snapshots__\//, runnable: /^src\/.*\.test\.tsx?$/, source: /^src\/(?!.*\.test\.)/,
    command: files => [path.join(dir, 'node_modules/.bin/vitest'), 'run', '--reporter=junit', '--outputFile={report}', ...files], prepare: linkModules },
  pytest: { frozen: /^testing\//, runnable: /^testing\/.*test_[^/]*\.py$/, source: /^src\//, command: pytest('src'),
    prepare: ['sh', '-c', `[ -e src/_pytest/_version.py ] || cp ${path.join(dir, 'src/_pytest/_version.py')} src/_pytest/_version.py`] },
  click: { frozen: /^tests\//, runnable: /^tests\/test_[^/]*\.py$/, source: /^src\//, command: pytest('src') },
  fastapi: { install: [['.[all]', '--group', 'pyproject.toml:tests'], ['.[all]', '-r', 'requirements-tests.txt']], frozen: /^(tests|docs_src)\//, runnable: /^tests\/.*test_[^/]*\.py$/, source: /^fastapi\//, command: pytest('.', '-p', 'no:randomly') },
  llm: { install: [['.', '--group', 'pyproject.toml:dev'], ['.[test]']], frozen: /^tests\//, runnable: /^tests\/test_[^/]*\.py$/, source: /^llm\//, command: pytest('.') },
  aider: { frozen: /^tests\//, runnable: /^tests\/.*test_[^/]*\.py$/, source: /^aider\//, command: pytest('.') },
};
const config = REPOS[name];
if (!config) throw new Error(`unknown repo ${name}`);
const env = { ...process.env, ...config.env, CI: '1' };
delete env.NODE_TEST_CONTEXT;

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
};
const tryGit = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });

const AGENT = /co-authored-by:[^\n]*(claude|copilot|cursor|codex|devin|gemini|openhands|aider)|generated with \[?claude code|\(aider\)/i;
const FIX = /\bfix(es|ed)?\b/i;
const NOT_BEHAVIOR = /^(docs?|chore|ci|build|style|tests?|refactor|perf)(\([^)]*\))?!?:|\btypos?\b|fix(es|ed)?\s+(the\s+|a\s+|some\s+)?(flak|lint|ci\b|tests?\b|docs?\b|types?\b|typing|comment|changelog|link)|^fix\((types?|docs?|ci|test|tests|lint)\)|^(📝|👷|🔧|✅)/i;

const head = git('rev-parse', 'HEAD').trim();
const origin = tryGit('symbolic-ref', '-q', '--short', 'HEAD').stdout.trim() || head;
const log = git('log', '--first-parent', '--format=%H%x1f%P%x1f%an%x1f%cs%x1f%s%x1f%b%x1e').split('\x1e').map(entry => entry.trim()).filter(Boolean)
  .map(entry => { const [sha, parents, author, date, subject, body] = entry.split('\x1f'); return { sha, parents: parents.split(' ').filter(Boolean), author, date, subject, body }; });

const candidates = [];
for (const commit of log) {
  if (!commit.parents.length || tryGit('cat-file', '-e', `${commit.parents[0]}^{commit}`).status !== 0) continue;
  const merged = commit.parents.length > 1 ? git('log', '--format=%an %s%n%b', `${commit.parents[0]}..${commit.sha}`) : '';
  const title = commit.parents.length > 1 ? `${commit.subject}\n${commit.body.split('\n')[0]}\n${merged.split('\n').filter(line => FIX.test(line))[0] ?? ''}` : commit.subject;
  if (!FIX.test(title) || NOT_BEHAVIOR.test(commit.subject) || (commit.parents.length > 1 && NOT_BEHAVIOR.test(commit.body.split('\n')[0]))) continue;
  const changed = git('diff', '--no-renames', '--name-status', commit.parents[0], commit.sha).trim().split('\n').filter(Boolean).map(line => line.split('\t'));
  const live = changed.filter(([status]) => status !== 'D').map(([, file]) => file);
  const frozen = live.filter(file => config.frozen.test(file));
  const runnable = frozen.filter(file => config.runnable.test(file));
  const source = live.filter(file => config.source.test(file) && code.test(file) && !config.frozen.test(file));
  if (!runnable.length || !source.length) continue;
  candidates.push({ ...commit, title: title.trim().split('\n').filter(Boolean).join(' | '), agent: AGENT.test(`${commit.author}\n${commit.subject}\n${commit.body}\n${merged}`), frozen, runnable, source,
    existed: runnable.filter(file => changed.find(([status, path_]) => path_ === file)?.[0] === 'M') });
}
const picked = new Map();
const only = process.env.ONLY?.split(',').filter(Boolean);
if (only) for (const commit of candidates.filter(commit => only.some(sha => commit.sha.startsWith(sha)))) picked.set(commit.sha, commit);
else {
  for (const commit of candidates.slice(0, Number(newest))) picked.set(commit.sha, commit);
  for (const commit of candidates.filter(commit => commit.agent).slice(0, Number(agentCap))) picked.set(commit.sha, commit);
}
// DATED=1: a fresh environment per commit, with dependencies resolved as of the day after the commit.
function datedEnvironment(commit) {
  const target = path.join(ROOT, 'venvs', `${name}-dated`);
  const day = new Date(Date.parse(commit.date) + 86_400_000).toISOString().slice(0, 10);
  let last = '';
  for (const install of config.install) {
    spawnSync('uv', ['venv', '-q', '--clear', '--python', '3.13', target], { encoding: 'utf8' });
    const result = spawnSync('uv', ['pip', 'install', '-q', '--python', path.join(target, 'bin', 'python'), '--exclude-newer', day, ...install], { cwd: dir, encoding: 'utf8' });
    if (result.status === 0) { venv = path.join(target, 'bin', 'python'); return `${install.join(' ')} as of ${day}`; }
    last = result.stderr.slice(-400);
  }
  throw new Error(`no dated environment: ${last}`);
}
console.log(`${name}: ${log.length} commits, ${candidates.length} fix commits with a source and a test change (${candidates.filter(commit => commit.agent).length} agent co-authored), running ${picked.size}`);

const out = path.join(ROOT, 'out', `${name}${process.env.SUFFIX ?? (process.env.DATED || process.env.RERUN ? '.dated' : '')}.jsonl`);
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).sha) : []);
const slim = tests => tests?.map(test => ({ name: test.name, status: test.status, message: test.message.trim().slice(0, 500) })) ?? null;

// The parent with its own tests: which test names existed before the commit.
function nativeRun(revision, files) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'native-'));
  const cwd = path.join(scratch, 'tree');
  try {
    git('worktree', 'add', '--detach', cwd, revision);
    if (config.prepare) spawnSync(config.prepare[0], config.prepare.slice(1), { cwd, env });
    const report = path.join(scratch, 'junit.xml');
    const [program, ...args] = config.command(files).map(part => part.replaceAll('{report}', report));
    const result = spawnSync(program, args, { cwd, env, encoding: 'utf8', timeout: 150_000, maxBuffer: 1 << 28 });
    return { exitCode: result.status, timedOut: result.error?.code === 'ETIMEDOUT', tests: fs.existsSync(report) ? readJUnit(fs.readFileSync(report, 'utf8')) : null,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-1500) };
  } finally {
    if (fs.existsSync(cwd)) tryGit('worktree', 'remove', '--force', cwd);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

try {
  for (const commit of picked.values()) {
    if (done.has(commit.sha)) continue;
    const started = Date.now();
    const record = { repo: name, sha: commit.sha, date: commit.date, title: commit.title, agent: commit.agent, merge: commit.parents.length > 1,
      runnable: commit.runnable, frozen: commit.frozen, source: commit.source };
    try {
      if (commit.runnable.length > 8) { record.skipped = `${commit.runnable.length} test files changed`; continue; }
      git('checkout', '-q', '--detach', '--force', commit.sha);
      if (process.env.DATED) record.environment = datedEnvironment(commit);
      record.native = commit.existed.length ? nativeRun(commit.parents[0], commit.existed) : { tests: [], none: true };
      record.native.tests = slim(record.native.tests);
      const evidence = regressionEvidence({ repo: dir, tests: commit.frozen, command: config.command(commit.runnable), symptom: /[\s\S]*/,
        base: commit.parents[0], candidate: null, prepare: config.prepare ?? null, timeoutMs: 150_000, env });
      record.helperVerdict = evidence.verdict;
      record.helperReason = evidence.reason.slice(0, 300);
      for (const side of ['base', 'candidate']) {
        const run = evidence[side];
        record[side] = { revision: run.revision, exitCode: run.exitCode, timedOut: run.timedOut, changed: run.changed, tests: slim(run.tests), output: run.tests ? undefined : run.output.slice(-1500) };
      }
    } catch (error) {
      record.error = String(error?.message ?? error).slice(0, 1500);
    } finally {
      record.seconds = Math.round((Date.now() - started) / 1000);
      fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
      console.log(`${commit.sha.slice(0, 9)} ${record.seconds}s ${record.skipped ?? record.error?.split('\n')[0] ?? `${record.base?.tests?.length ?? 'no'} / ${record.candidate?.tests?.length ?? 'no'} tests`} | ${commit.title.slice(0, 70)}`);
    }
  }
} finally {
  tryGit('checkout', '-q', '--force', origin);
  tryGit('worktree', 'prune');
}
