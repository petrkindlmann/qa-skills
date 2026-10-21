import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { runBounded } from '../workflows/support/process.mjs';

for (const naturalExit of [false, true]) {
  test(`owned descendants stop after ${naturalExit ? 'normal parent exit' : 'timeout parent exit'}`,
    { skip: process.platform === 'win32' ? 'POSIX process-group contract' : false }, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'qa-process-cleanup-'));
      const heartbeat = path.join(dir, 'heartbeat');
      const pidFile = path.join(dir, 'child.pid');
      const worker = path.join(dir, 'worker.mjs');
      const parent = path.join(dir, 'parent.mjs');
      await writeFile(worker, `import fs from 'node:fs';
process.on('SIGTERM', () => {});
fs.writeFileSync(${JSON.stringify(heartbeat)}, 'ready');
process.send('ready');
setInterval(() => fs.writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 20);
`);
      await writeFile(parent, `import {fork} from 'node:child_process';
import fs from 'node:fs';
const child = fork(${JSON.stringify(worker)}, [], {stdio: ['ignore','ignore','ignore','ipc']});
fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));
child.on('message', () => { ${naturalExit ? 'process.exit(0);' : ''} });
setInterval(() => {}, 1000);
`);
      try {
        const result = await runBounded({ command: process.execPath, args: [parent],
          timeoutMs: 700, killGraceMs: 150, settlementGraceMs: 100 });
        assert.equal(result.timedOut, !naturalExit);
        if (naturalExit) assert.equal(result.code, 0);
        await pause(350);
        const stopped = await readFile(heartbeat, 'utf8');
        await pause(100);
        assert.equal(await readFile(heartbeat, 'utf8'), stopped,
          'A child that ignores SIGTERM continued writing after the owner settled');
      } finally {
        try { process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL'); } catch (error) {
          if (!['ESRCH', 'ENOENT'].includes(error.code)) throw error;
        }
        await rm(dir, { recursive: true, force: true });
      }
    });
}
