import { spawn } from 'node:child_process';

// Own a process group on POSIX. Even inherited output pipes cannot keep this
// promise pending beyond timeout + kill grace + settlement grace.
export function runBounded({ command, args = [], cwd, env = process.env,
  timeoutMs = 90000, killGraceMs = 3000, settlementGraceMs = 1000, maxOutputBytes = 8 * 1024 * 1024 }) {
  return new Promise(resolve => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { cwd, env, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    let settled = false;
    let timedOut = false;
    let exitCode = null;
    let exitSignal = null;
    const timers = [];
    const collect = data => {
      const available = Math.max(0, maxOutputBytes - bytes);
      if (data.length > available) truncated = true;
      if (available) { const part = data.subarray(0, available); chunks.push(part); bytes += part.length; }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const kill = signal => {
      if (!child.pid) return;
      try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') collect(Buffer.from(`\nProcess cleanup: ${error.message}\n`)); }
    };
    const finish = extra => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve({ code: exitCode, signal: exitSignal, timedOut, outputTruncated: truncated,
        log: Buffer.concat(chunks).toString('utf8'), ...extra });
    };
    child.once('error', error => finish({ launchError: error.message }));
    child.once('exit', (code, signal) => { exitCode = code; exitSignal = signal; });
    child.once('close', (code, signal) => { exitCode = code; exitSignal = signal; finish({}); });
    timers.push(setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      timers.push(setTimeout(() => kill('SIGKILL'), killGraceMs));
      timers.push(setTimeout(() => {
        kill('SIGKILL');
        finish({ forcedSettlement: true });
      }, killGraceMs + settlementGraceMs));
    }, timeoutMs));
  });
}
