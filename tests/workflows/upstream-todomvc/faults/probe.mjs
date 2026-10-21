// Evaluator-only fixture probes, not the fresh agent's authored regression suite.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { startTodoServer } from '../server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true,
  ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const results = [];
const runtime = { browser: browser.version(), node: process.version };

async function add(page, title) {
  const count = await page.locator('.todo-list li').count();
  await page.getByPlaceholder('What needs to be done?').fill(title);
  await page.getByPlaceholder('What needs to be done?').press('Enter');
  await expect(page.locator('.todo-list li')).toHaveCount(count + 1);
}

async function observe(name, fault, operation, expected) {
  const server = await startTodoServer({ fault });
  const context = await browser.newContext();
  const page = await context.newPage();
  const externalRequests = [], pageErrors = [];
  let requests = 0;
  page.on('request', request => {
    requests++;
    if (new URL(request.url()).origin !== server.baseURL) externalRequests.push(request.url());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto(server.baseURL);
    const observed = await operation(page);
    assert.deepEqual(pageErrors, [], 'Fixture must not pass through a JavaScript error');
    assert.deepEqual(externalRequests, [], 'Fixture must not call an external service');
    assert.deepEqual(observed, expected);
    const result = { name, fault, observed, expected, matched: true, requests, externalRequests, pageErrors };
    results.push(result); console.log(JSON.stringify(result));
  } finally { await context.close(); await server.close(); }
}

const operations = {
  'persistence-lost': async page => {
    await add(page, 'Persist this task'); await page.reload();
    return page.locator('.todo-list li label').allTextContents();
  },
  'delete-wrong-duplicate': async page => {
    await add(page, 'Same title'); await add(page, 'Same title');
    const rows = page.locator('.todo-list li');
    await rows.nth(0).locator('.toggle').check();
    await rows.nth(1).hover(); await rows.nth(1).locator('.destroy').click();
    await expect(rows).toHaveCount(1); await page.reload();
    await expect(rows).toHaveCount(1);
    return { title: await rows.locator('label').textContent(), completed: await rows.locator('.toggle').isChecked() };
  },
  'filter-state-error': async page => {
    await add(page, 'Still active'); await add(page, 'Already complete');
    await page.locator('.todo-list li').nth(1).locator('.toggle').check();
    await page.getByRole('link', { name: 'Active', exact: true }).click();
    return page.locator('.todo-list li label').allTextContents();
  },
  'escape-commits-edit': async page => {
    await add(page, 'Saved title');
    await page.locator('.todo-list li label').dblclick();
    await page.locator('input.edit').fill('Canceled title');
    await page.locator('input.edit').press('Escape');
    await expect(page.locator('input.edit')).toHaveCount(0);
    await page.reload(); return page.locator('.todo-list li label').allTextContents();
  },
};

try {
  await observe('ordinary user journey', 'none', async page => {
    const input = page.getByPlaceholder('What needs to be done?');
    await input.fill('   '); await input.press('Enter');
    await expect(page.locator('.todo-list li')).toHaveCount(0);
    await add(page, '  First task  '); await add(page, 'Second task');
    await expect(page.locator('.todo-list li label')).toHaveText(['First task', 'Second task']);
    await page.locator('.todo-list li label').first().dblclick();
    await page.locator('input.edit').fill('Edited first'); await page.locator('input.edit').press('Enter');
    await expect(page.locator('input.edit')).toHaveCount(0);
    await page.locator('label[for="toggle-all"]').click();
    await expect(page.locator('.todo-count')).toHaveText('0 items left');
    await page.getByRole('link', { name: 'Active', exact: true }).click();
    await expect(page.locator('.todo-list li')).toHaveCount(0);
    await page.locator('label[for="toggle-all"]').click();
    await expect(page.locator('.todo-list li')).toHaveCount(2);
    await page.getByRole('link', { name: 'All', exact: true }).click();
    await page.locator('.todo-list li label').first().dblclick();
    await page.locator('input.edit').fill('   '); await page.locator('input.edit').press('Enter');
    await expect(page.locator('.todo-list li label')).toHaveText(['Second task']);
    await page.locator('.todo-list li .toggle').check();
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(page.locator('.main')).toBeHidden();
    await expect(page.locator('.footer')).toBeHidden();
    return { remaining: await page.locator('.todo-list li').count() };
  }, { remaining: 0 });
  const expectations = {
    'persistence-lost': [['Persist this task'], []],
    'delete-wrong-duplicate': [{ title: 'Same title', completed: true }, { title: 'Same title', completed: false }],
    'filter-state-error': [['Still active'], ['Already complete']],
    'escape-commits-edit': [['Saved title'], ['Canceled title']],
  };
  for (const [fault, operation] of Object.entries(operations)) {
    await observe(`${fault} control`, 'none', operation, expectations[fault][0]);
    await observe(`${fault} counterexample`, fault, operation, expectations[fault][1]);
  }
  // Independent observation of the untouched current ES5 distribution.
  const currentRoot = resolve(root, 'observations/current-es5/examples/javascript-es5/dist');
  const names = new Set(['index.html', 'app.js', 'base.css', 'base.js', 'controller.js', 'helpers.js', 'index.css', 'model.js', 'store.js', 'template.js', 'view.js']);
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const name = path === '/' ? 'index.html' : basename(path);
    if (path === '/learn.json' || path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (!names.has(name)) { response.writeHead(404).end(); return; }
    const bytes = await readFile(resolve(currentRoot, name));
    response.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html' });
    response.end(bytes);
  });
  await new Promise(yes => server.listen(0, '127.0.0.1', yes));
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await add(page, 'Current revision task');
    const before = await page.locator('.todo-list li').count(); await page.reload();
    const after = await page.locator('.todo-list li').count();
    assert.deepEqual({ before, after }, { before: 1, after: 0 });
    const result = { name: 'current upstream ES5 reload observation', commit: 'ff43b02e59dfa604386bb382034b2cd07c2bcd8a', before, after, classification: 'Observed in-memory behavior; not an upstream defect claim' };
    results.push(result); console.log(JSON.stringify(result));
  } finally { await context.close(); await new Promise(yes => server.close(yes)); }
  await writeFile(resolve(root, 'observations/probe-results.json'), JSON.stringify({ runtime, results }, null, 2) + '\n');
} finally { await browser.close(); }
