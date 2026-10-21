import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBounded } from '../../tests/workflows/support/process.mjs';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/qa.mjs');
const page = body => `<!doctype html><html lang="en"><head><title>Account settings</title><style>body{font:18px sans-serif;color:#111;background:#fff}input,button{padding:12px}</style></head><body>${body}</body></html>`;
const healthy = page('<main data-ready="true"><h1>Account settings</h1><form><label for="name">Name</label><input id="name" name="name" autocomplete="name"><button type="button">Save</button></form></main>');

test('real browser CLI distinguishes healthy, inaccessible, redirected blank, and absent-readiness pages', async t => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/blank' }); response.end(); return; }
    if (request.url === '/blank') response.end(page(''));
    else if (request.url === '/inaccessible') response.end(page('<main data-ready="true"><h1>Account settings</h1><input autocomplete="invalid-token"><button>Save</button></main>'));
    else response.end(healthy);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [route, selector, status, targetCheck] of [
    ['/healthy', '[data-ready="true"]', 'passed', 'browser-accessibility'],
    ['/inaccessible', '[data-ready="true"]', 'failed', 'browser-accessibility'],
    ['/redirect', '[data-ready="true"]', 'failed', 'browser-application-readiness'],
    ['/healthy', null, 'blocked', 'browser-application-readiness'],
  ]) {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-browser-'));
    t.after(() => fs.rm(project, { recursive: true, force: true }));
    const args = [cli, 'run', '--project', project, '--url', `${base}${route}`];
    if (selector) args.push('--ready-selector', selector);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const execution = await runBounded({ command: process.execPath, args, env, timeoutMs: 25_000, killGraceMs: 200, settlementGraceMs: 200 });
    assert.equal(execution.code, status === 'passed' ? 0 : status === 'failed' ? 1 : 2, execution.log);
    const [run] = await fs.readdir(path.join(project, 'qa-results'));
    const result = JSON.parse(await fs.readFile(path.join(project, 'qa-results', run, 'result.json'), 'utf8'));
    assert.equal(result.summary.status, status);
    assert.equal(result.checks.find(check => check.id === targetCheck).status, status);
    if (route === '/inaccessible') assert.ok(result.checks.find(check => check.id === targetCheck).observed.violations.some(item => item.id === 'autocomplete-valid'));
    if (route === '/redirect') assert.ok(!result.checks.some(check => check.id === 'browser-accessibility'));
  }
});

test('real Playwright JSON reports retain healthy and failed HTTP assertions', async t => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  for (const broken of [false, true]) {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-playwright-'));
    t.after(() => fs.rm(project, { recursive: true, force: true }));
    await fs.writeFile(path.join(project, 'playwright.config.mjs'), "export default { testDir: '.', testMatch: '*.spec.mjs', retries: 0, workers: 1, timeout: 5000 };\n");
    await fs.writeFile(path.join(project, 'prices.spec.mjs'), `
import { test, expect } from ${JSON.stringify(path.join(repo, 'node_modules/@playwright/test/index.mjs'))};
import http from 'node:http';
let server, base;
test.beforeAll(async()=>{
  server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({unitPrice:${broken ? 1500 : 1200},currency:'CZK'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); base='http://127.0.0.1:'+server.address().port;
});
test.afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});
test('unit price is independent of basket total',async({request})=>{const res=await request.get(base);expect(res.status()).toBe(200);expect((await res.json()).unitPrice).toBe(1200);});
test('currency contract',async({request})=>{const res=await request.get(base);expect((await res.json()).currency).toBe('CZK');});
`);
    await fs.writeFile(path.join(project, 'qa.config.json'), JSON.stringify({ version: 1, checks: [{ id: 'http-contract',
      command: [process.execPath, path.join(repo, 'node_modules/playwright/cli.js'), 'test', '--config', 'playwright.config.mjs', '--reporter=json'], reporter: 'playwright-json' }] }));
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const execution = await runBounded({ command: process.execPath, args: [cli, 'run', '--project', project], env, timeoutMs: 20_000, killGraceMs: 200, settlementGraceMs: 200 });
    assert.equal(execution.code, broken ? 1 : 0, execution.log);
    const [run] = await fs.readdir(path.join(project, 'qa-results'));
    const result = JSON.parse(await fs.readFile(path.join(project, 'qa-results', run, 'result.json'), 'utf8'));
    assert.equal(result.summary.tests.observed, 2);
    assert.equal(result.summary.tests.failed, broken ? 1 : 0);
    assert.equal(result.summary.tests.passed, broken ? 1 : 2);
  }
});
