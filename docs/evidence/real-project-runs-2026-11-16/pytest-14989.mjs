// The shipped regressionEvidence helper on pytest PR #14989 (issue #14552), three ways.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadFunctions } from '../../../tests/examples/snippets.mjs';

const { regressionEvidence } = loadFunctions('skills/bug-reproduction/references/regression-evidence.md', 'function regressionEvidence(',
  ['readJUnit', 'regressionVerdict', 'regressionEvidence'], { spawnSync, createHash, fs, os, path });
const ROOT = path.resolve(process.env.REAL_RUNS_DIR ?? 'real-runs');   // holds repos/, venvs/ and out/
const clone = path.join(ROOT, 'repos/pytest'), repo = path.join(ROOT, 'work-14989');
const git = (cwd, ...args) => { const run = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (run.status) throw new Error(run.stderr); return run.stdout; };
const FIX = 'f8ad1f6f95', test = 'testing/test_assertrewrite.py';
spawnSync('git', ['worktree', 'remove', '--force', repo], { cwd: clone });
git(clone, 'worktree', 'add', '--detach', repo, FIX);
const run = (label, symptom) => {
  const evidence = regressionEvidence({
    repo, tests: [test], base: `${FIX}^1`, candidate: null, symptom, select: /test_moved_test_file_updates_code_filename/, timeoutMs: 150_000,
    prepare: ['sh', '-c', `[ -e src/_pytest/_version.py ] || cp ${path.join(clone, 'src/_pytest/_version.py')} src/_pytest/_version.py`],
    command: ['sh', '-c', 'PYTHONPATH="$PWD/src" exec "$0" "$@"', path.join(ROOT, 'venvs/pytest/bin/python'), '-m', 'pytest', '-q', '-p', 'no:cacheprovider',
      '-o', 'junit_family=xunit1', '--junitxml={report}', test],
  });
  console.log(`${label}\n  symptom ${symptom}\n  verdict: ${evidence.verdict}\n  reason:  ${evidence.reason.slice(0, 260)}`);
  for (const side of ['base', 'candidate']) console.log(`  ${side}: ${evidence[side].tests?.filter(item => /test_moved_test_file/.test(item.name)).map(item => `${item.name.split(' › ').pop()}=${item.status}`).join(', ')}`);
};
try {
  // The report (issue #14552): after the directory is moved, the second run fails with
  // AssertionError: assert '...st1/test_a.py' == '...st2/test_a.py'. Seen from the test, the second run has one failure.
  const reported = /'failed': 1|st1\/test_a\.py' == /;
  run('1. test as committed, symptom from the report', reported);
  run('2. test as committed, symptom written as a keyword from the title', /co_filename/);
  const source = fs.readFileSync(path.join(repo, test), 'utf8');
  const committed = `        from _pytest.assertion.rewrite import (  # type: ignore[attr-defined]\n            _imp_fix_co_filename,\n        )\n`;
  if (!source.includes(committed)) throw new Error('the import to replace was not found');
  fs.writeFileSync(path.join(repo, test), source.replace(committed,
    `        import _pytest.assertion.rewrite as rewrite_module\n\n        _imp_fix_co_filename = getattr(rewrite_module, "_imp_fix_co_filename", object())\n`));
  run('3. import of the new helper made tolerant, symptom from the report', reported);
} finally {
  spawnSync('git', ['checkout', '--', test], { cwd: repo });
  spawnSync('git', ['worktree', 'remove', '--force', repo], { cwd: clone });
}
