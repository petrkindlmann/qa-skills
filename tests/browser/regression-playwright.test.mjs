import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFunctions } from '../examples/snippets.mjs';
import { regressionCheck } from '../../skills/bug-reproduction/scripts/regression-check.mjs';

const { regressionEvidence } = loadFunctions('skills/bug-reproduction/references/regression-evidence.md', 'function regressionEvidence(',
  ['readJUnit', 'regressionVerdict', 'regressionEvidence'], { spawnSync, createHash, fs, os, path });

const modules = fileURLToPath(new URL('../../node_modules', import.meta.url));
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
delete env.PLAYWRIGHT_JUNIT_OUTPUT_FILE;

// Playwright's JUnit reporter takes its file from the environment, not from the command line.
test('a Playwright test is read at both revisions by the script and by the function', async t => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-regression-playwright-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'user.name=qa', '-c', 'user.email=qa@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  git('init', '-q', '-b', 'main');
  write('.gitignore', 'node_modules\ntest-results\n');
  write('package.json', '{ "type": "module" }\n');
  write('src/total.mjs', 'export const total = lines => lines.reduce((sum, line) => sum + line, 0);\n');
  git('add', '.');
  git('commit', '-q', '-m', 'order total');
  write('src/total.mjs', 'export const total = lines => lines.reduce((sum, line) => sum + Math.round(line * 100), 0) / 100;\n');
  write('e2e/total.spec.mjs', `import { test, expect } from '@playwright/test';\nimport { total } from '../src/total.mjs';\n`
    + `test('order total of small amounts', () => { expect(total([0.1, 0.2])).toBe(0.3); });\n`);
  const link = `[ -e node_modules ] || ln -s ${JSON.stringify(modules)} node_modules`;
  spawnSync('sh', ['-c', link], { cwd: repo });
  const playwright = [process.execPath, 'node_modules/playwright/cli.js', 'test', '--reporter=junit'];

  const checked = await regressionCheck({ repo, command: [...playwright, '{tests}'], symptom: /0\.30000000000000004/, prepare: link, env, timeoutMs: 90_000 });
  assert.equal(checked.verdict, 'shows_the_bug', `${checked.reason} ${JSON.stringify(checked.tests)}`);
  assert.match(checked.tests[0].name, /order total of small amounts/);

  const evidence = regressionEvidence({ repo, tests: ['e2e/total.spec.mjs'], command: [...playwright, 'e2e/total.spec.mjs'], symptom: /0\.30000000000000004/,
    select: /order total/, prepare: ['sh', '-c', link], env, timeoutMs: 90_000 });
  assert.equal(evidence.verdict, 'distinguishes', evidence.reason);
});
