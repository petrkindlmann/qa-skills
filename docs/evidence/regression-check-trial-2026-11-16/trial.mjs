// Runs the shipped regression-check script over the surveyed fix commits with its defaults
// (test files found by the script, three base runs while a new test passes, no symptom).
// A commit the survey ran with dependencies as of its date gets the same dated environment.
// usage: node trial.mjs ../real-project-runs-2026-11-16/results.json [repo ...]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { regressionCheck } from '../../../skills/bug-reproduction/scripts/regression-check.mjs';

const ROOT = path.resolve(process.env.REAL_RUNS_DIR ?? 'real-runs');   // holds repos/, venvs/ and out/, as for survey.mjs
const [resultsFile, ...only] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(resultsFile, 'utf8')).filter(row => !['not_titled_fix', 'skipped_wide'].includes(row.result) && (!only.length || only.includes(row.repo)));
const dir = name => path.join(ROOT, 'repos', name);
const link = name => `[ -e node_modules ] || ln -s ${path.join(dir(name), 'node_modules')} node_modules`;
const nodeTest = () => ['node', '--test', '--test-timeout=30000', '--test-force-exit', '--test-reporter=junit', '--test-reporter-destination={report}', '{tests}'];
const mocha = (name, ...extra) => () => [path.join(dir(name), 'node_modules/.bin/mocha'), '--no-config', ...extra, '--timeout', '30000', '--reporter', 'xunit', '--reporter-option', 'output={report}', '{tests}'];
const pytest = (name, source, ...extra) => python => ['sh', '-c', `PYTHONPATH="$PWD/${source}" exec "$0" "$@"`, python ?? path.join(ROOT, 'venvs', name, 'bin', 'python'), '-m', 'pytest', '-q', '-p', 'no:cacheprovider',
  '-o', 'junit_family=xunit1', '--junitxml={report}', ...extra, '{tests}'];
const REPOS = {
  undici: { command: nodeTest, prepare: link('undici') },
  fastify: { command: nodeTest, prepare: link('fastify') },
  eslint: { command: mocha('eslint'), prepare: link('eslint') },
  express: { command: mocha('express', '--require', 'test/support/env', '--check-leaks'), prepare: link('express') },
  hono: { command: () => [path.join(dir('hono'), 'node_modules/.bin/vitest'), 'run', '--reporter=junit', '--outputFile={report}', '{tests}'], prepare: link('hono') },
  pytest: { command: pytest('pytest', 'src'), prepare: `[ -e src/_pytest/_version.py ] || cp ${path.join(dir('pytest'), 'src/_pytest/_version.py')} src/_pytest/_version.py` },
  click: { command: pytest('click', 'src') },
  fastapi: { command: pytest('fastapi', '.', '-p', 'no:randomly') },
  llm: { command: pytest('llm', '.') },
};
const env = { ...process.env, CI: '1' };
delete env.NODE_TEST_CONTEXT;
const out = path.join(ROOT, 'out', 'trial.jsonl');
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).commit) : []);

// The survey recorded "<install arguments> as of <day>" for a commit it ran with dated dependencies.
function datedPython(row) {
  const [install, day] = row.environment.split(' as of ');
  const target = path.join(ROOT, 'venvs', `${row.repo}-dated`);
  const checkout = spawnSync('git', ['checkout', '-q', '--detach', '--force', row.commit], { cwd: dir(row.repo), encoding: 'utf8' });
  if (checkout.status !== 0) throw new Error(`checkout: ${checkout.stderr}`);
  spawnSync('uv', ['venv', '-q', '--clear', '--python', '3.13', target], { encoding: 'utf8' });
  const result = spawnSync('uv', ['pip', 'install', '-q', '--python', path.join(target, 'bin', 'python'), '--exclude-newer', day, ...install.split(' ')], { cwd: dir(row.repo), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`no dated environment: ${result.stderr.slice(-400)}`);
  return path.join(target, 'bin', 'python');
}

for (const row of rows) {
  if (done.has(row.commit)) continue;
  const started = Date.now();
  const record = { repo: row.repo, commit: row.commit, survey: row.result, surveyAutomatic: row.automatic, environment: row.environment ?? null };
  try {
    const { command, prepare } = REPOS[row.repo];
    const python = row.environment ? datedPython(row) : undefined;
    const result = await regressionCheck({ repo: dir(row.repo), base: `${row.commit}^1`, candidate: row.commit, command: command(python), prepare, timeoutMs: 150_000, env });
    Object.assign(record, { verdict: result.verdict, reason: result.reason.slice(0, 300), summary: result.summary, baseRuns: result.baseRuns, frozen: result.frozen.map(item => item.file),
      surveyTests: row.tests, tests: result.tests.map(test => ({ name: test.name.slice(0, 160), status: test.status, base: test.base, missing: test.missing, message: test.message.slice(0, 200) })) });
  } catch (error) {
    record.error = String(error?.message ?? error).slice(0, 600);
  }
  record.seconds = Math.round((Date.now() - started) / 1000);
  fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
  console.log(`${row.repo} ${row.commit.slice(0, 10)} ${record.seconds}s survey=${row.result} -> ${record.verdict ?? `error: ${record.error.split('\n')[0].slice(0, 100)}`} ${record.summary ?? ''}`);
}
