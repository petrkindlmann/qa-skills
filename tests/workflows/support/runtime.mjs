import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { pythonExecutable } from '../../../scripts/run-python.mjs';

export const repository = fileURLToPath(new URL('../../../', import.meta.url));
// CI images expose both names; macOS ships python3 only. QA_PYTHON overrides either.
export const python = pythonExecutable();

// The services run over real loopback sockets. This helper never fulfills requests.
export async function launchService({ command, args, directory, readyFile, env = {}, timeoutMs = 15000 }) {
  await mkdir(directory, { recursive: true });
  await rm(readyFile, { force: true });
  const log = createWriteStream(path.join(directory, 'service.log'), { flags: 'a' });
  const child = spawn(command, args, {
    cwd: repository,
    env: { ...process.env, PYTHONUNBUFFERED: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let launchError;
  let exited = false;
  let exitCode;
  child.once('error', error => { launchError = error; });
  child.once('exit', code => { exited = true; exitCode = code; });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    if (!exited) child.kill('SIGTERM');
    const deadline = Date.now() + 4000;
    while (!exited && Date.now() < deadline) await pause(25);
    if (!exited) {
      child.kill('SIGKILL');
      const killDeadline = Date.now() + 2000;
      while (!exited && Date.now() < killDeadline) await pause(25);
    }
    log.end();
    if (!exited && !launchError) throw new Error(`Service ${command} did not exit after termination`);
  }
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (exited) throw new Error(`Service ${command} exited before readiness, code ${exitCode}`);
      try {
        const ready = JSON.parse(await readFile(readyFile, 'utf8'));
        const url = new URL(ready.base_url ?? ready.http_url ?? ready.MAILPIT_URL);
        if (url.hostname !== '127.0.0.1' || !url.port) throw new Error('Service must advertise a loopback port');
        return { child, ready, stop, logPath: path.join(directory, 'service.log') };
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      await pause(30);
    }
    throw new Error(`Service ${command} did not become ready within ${timeoutMs}ms; see ${directory}/service.log`);
  } catch (error) {
    await stop().catch(stopError => { error.message += `; cleanup: ${stopError.message}`; });
    throw error;
  }
}

export async function startMailpit(directory) {
  const instance = `workflow-${process.pid}-${randomUUID()}`;
  const service = await launchService({
    command: python,
    args: ['tests/workflows/mailpit/mailpit_service.py', 'serve', '--instance', instance,
      '--ttl', '900', '--ready-file', path.join(directory, 'ready.json')],
    directory, readyFile: path.join(directory, 'ready.json'), timeoutMs: 30000,
  });
  return { ...service, baseURL: service.ready.base_url, smtpPort: service.ready.smtp_port };
}

export async function startShop({ directory, smtpPort, failFulfillmentOnce = false }) {
  await mkdir(directory, { recursive: true });
  const namespace = randomUUID().replaceAll('-', '');
  const db = path.join(directory, 'shop.sqlite');
  let port = 0;
  let current;
  async function launch(failOnce) {
    const args = ['tests/workflows/fixture-app/server.py', '--port', String(port), '--db', db,
      '--ready-file', path.join(directory, 'ready.json'), '--smtp-port', String(smtpPort),
      '--email-suffix', namespace, '--test-mode'];
    if (failOnce) args.push('--fail-fulfillment-once');
    current = await launchService({ command: python, args, directory,
      readyFile: path.join(directory, 'ready.json'), env: { APP_FAULT: process.env.QA_SHOP_FAULT ?? '' } });
    port = Number(new URL(current.ready.base_url).port);
  }
  await launch(failFulfillmentOnce);
  const users = {};
  for (const user of current.ready.seeded_users) {
    users[user.id] = { ...user, password: user.id === 'alice' ? 'Alice-secret-123!' : 'Bob-secret-456!' };
  }
  return {
    baseURL: current.ready.base_url,
    users, namespace, databasePath: db,
    paymentSecret: 'local-payment-secret', testAdminKey: 'local-test-admin',
    restart: async ({ failFulfillmentOnce = false } = {}) => {
      await current.stop();
      await launch(failFulfillmentOnce);
    },
    stop: async () => current.stop(),
  };
}

export async function startTodo(directory) {
  const args = ['tests/workflows/upstream-todomvc/server.mjs', '--port', '0',
    '--ready-file', path.join(directory, 'ready.json')];
  if (process.env.QA_TODO_FAULT) args.push('--fault', process.env.QA_TODO_FAULT);
  const service = await launchService({ command: process.execPath, args, directory,
    readyFile: path.join(directory, 'ready.json') });
  return { ...service, baseURL: service.ready.base_url };
}
