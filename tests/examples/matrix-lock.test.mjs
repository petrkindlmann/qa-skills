import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireMatrixLock } from '../workflows/support/matrix-lock.mjs';
import { runBounded } from '../workflows/support/process.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'qa-matrix-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('a second matrix cannot reuse a live owner output directory', async t => {
  const directory = await fixture(t);
  const owner = acquireMatrixLock(directory);
  assert.throws(() => acquireMatrixLock(directory), /in use/);
  owner.child(process.pid);
  assert.equal(JSON.parse(await readFile(path.join(directory, '.matrix.lock'))).childPid, process.pid);
  owner.release();
  const later = acquireMatrixLock(directory);
  later.release();
});

test('a dead parent with a live recorded child still blocks reuse', async t => {
  const directory = await fixture(t);
  const owner = acquireMatrixLock(directory);
  const file = path.join(directory, '.matrix.lock');
  const record = JSON.parse(await readFile(file));
  await writeFile(file, JSON.stringify({ ...record, pid: 2147483647, childPid: process.pid }));
  assert.throws(() => acquireMatrixLock(directory), /in use/);
  owner.release();
});

test('an actual departed owner can be reclaimed without waiting or overwriting a live lock', async t => {
  const directory = await fixture(t);
  const helper = fileURLToPath(new URL('../workflows/support/matrix-lock.mjs', import.meta.url));
  const script = path.join(directory, 'claim.mjs');
  await writeFile(script, `import { acquireMatrixLock } from ${JSON.stringify(helper)}; acquireMatrixLock(${JSON.stringify(directory)});`);
  const departed = await runBounded({ command: process.execPath, args: [script], timeoutMs: 3000 });
  assert.equal(departed.code, 0, departed.log);
  const before = JSON.parse(await readFile(path.join(directory, '.matrix.lock')));
  assert.notEqual(before.pid, process.pid);
  const current = acquireMatrixLock(directory);
  assert.throws(() => acquireMatrixLock(directory), /in use/);
  current.release();
});

test('unknown ownership fails promptly with a fresh-output remedy and preserves the record', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, '.matrix.lock');
  await writeFile(file, 'incomplete');
  assert.throws(() => acquireMatrixLock(directory), /fresh QA_MATRIX_OUTPUT/);
  assert.equal(await readFile(file, 'utf8'), 'incomplete');
});
