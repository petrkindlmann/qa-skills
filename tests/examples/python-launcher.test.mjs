import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pythonExecutable, runPython } from '../../scripts/run-python.mjs';

test('Python selection honors an exact executable override and platform defaults', () => {
  assert.equal(pythonExecutable({ QA_PYTHON: '/custom path/python' }, 'linux'), '/custom path/python');
  assert.equal(pythonExecutable({}, 'darwin'), 'python3');
  assert.equal(pythonExecutable({}, 'linux'), 'python3');
  assert.equal(pythonExecutable({}, 'win32'), 'python');
  assert.throws(() => pythonExecutable({ QA_PYTHON: ' ' }), /must name/);
});

test('an executable override works without python3 on PATH and preserves literal arguments', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qa-python-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'custom python');
  await symlink(process.execPath, executable);
  const script = path.join(directory, 'argv.mjs');
  await writeFile(script, 'console.log(JSON.stringify(process.argv.slice(2)));');
  const args = ['argument with spaces', '$(not a command)', '`also literal`'];
  const result = await runPython([script, ...args], { env: { ...process.env, QA_PYTHON: executable, PATH: directory }, timeoutMs: 3000 });
  assert.equal(result.code, 0, result.log);
  assert.deepEqual(JSON.parse(result.log), args);
});

test('missing Python and bounded stalled executions cannot claim success', async () => {
  const missing = await runPython(['script.py'], { env: { ...process.env, QA_PYTHON: '/no-such-python' }, timeoutMs: 500 });
  assert.match(missing.launchError, /ENOENT/);
  assert.equal(missing.code, null);
  const stalled = await runPython(['-e', 'setInterval(()=>{},1000)'], { env: { ...process.env, QA_PYTHON: process.execPath }, timeoutMs: 100 });
  assert.equal(stalled.timedOut, true);
  await assert.rejects(runPython([], {}), /Usage/);
  await assert.rejects(runPython(['x'], { timeoutMs: Infinity }), /timeout/);
});
