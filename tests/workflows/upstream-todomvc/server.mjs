import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { faultNames, mutateSource } from './faults/mutations.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sourcePrefix = 'upstream/examples/vanillajs/';
const assetPaths = new Map([
  ['/', `${sourcePrefix}index.html`],
  ['/index.html', `${sourcePrefix}index.html`],
  ...['app', 'controller', 'helpers', 'model', 'store', 'template', 'view']
    .map(name => [`/js/${name}.js`, `${sourcePrefix}js/${name}.js`]),
  ['/node_modules/todomvc-common/base.js', 'vendor/todomvc-common/1.0.5/base.js'],
  ['/node_modules/todomvc-common/base.css', 'vendor/todomvc-common/1.0.5/base.css'],
  ['/node_modules/todomvc-app-css/index.css', 'vendor/todomvc-app-css/2.4.1/index.css'],
]);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };

export async function startTodoServer({ port = 0, fault = 'none', readyFile } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  // Faults stack with '+': 'redesign-classes+persistence-lost' serves the redesigned
  // build with a behaviour defect, so a regenerated suite can be checked for detection.
  // The rename is always applied last so that code a behaviour fault injects follows it.
  const faults = fault.split('+').sort((a, b) => Number(a === 'redesign-classes') - Number(b === 'redesign-classes'));
  for (const name of faults) if (!faultNames.includes(name)) throw new Error(`Unknown TodoMVC fault: ${name}`);
  const provenance = JSON.parse(await readFile(resolve(root, 'provenance.json'), 'utf8'));
  const originals = new Map();
  for (const record of provenance.files) {
    const bytes = await readFile(resolve(root, record.path));
    if (createHash('sha256').update(bytes).digest('hex') !== record.sha256)
      throw new Error(`Upstream bytes changed: ${record.path}`);
    originals.set(record.path, bytes);
  }
  const routes = new Map([...assetPaths].map(([url, path]) => {
    const bytes = originals.get(path);
    if (!bytes) throw new Error(`Missing upstream asset: ${path}`);
    return [url, faults.reduce((current, name) => mutateSource(url, current, name), bytes)];
  }));
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/learn.json' || path === '/favicon.ico') {
      // Optional online informational sidebar is excluded from this offline fixture.
      response.writeHead(204).end(); return;
    }
    if (path === '/__health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ready: true, application: 'todomvc' }));
      return;
    }
    const bytes = routes.get(path);
    if (!bytes) { response.writeHead(404).end(); return; }
    const extension = path === '/' ? '.html' : path.slice(path.lastIndexOf('.'));
    response.writeHead(200, { 'Content-Type': `${types[extension] || 'application/octet-stream'}; charset=utf-8`, 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((yes, no) => {
    server.once('error', no);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', no); yes(); });
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    const done = new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
    server.closeAllConnections();
    await done;
  };
  if (readyFile) {
    try {
      await mkdir(dirname(resolve(readyFile)), { recursive: true });
      await writeFile(`${readyFile}.tmp`, JSON.stringify({ base_url: baseURL, port: server.address().port, pid: process.pid }) + '\n');
      await rename(`${readyFile}.tmp`, readyFile);
    } catch (error) { await close(); throw error; }
  }
  return { baseURL, server, close };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!value || !['--port', '--ready-file', '--fault'].includes(key)) throw new Error(`Invalid argument: ${key}`);
    if (key === '--port') options.port = Number(value);
    if (key === '--ready-file') options.readyFile = value;
    if (key === '--fault') options.fault = value;
  }
  const app = await startTodoServer(options);
  process.stdout.write(JSON.stringify({ base_url: app.baseURL }) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    app.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
  });
}
