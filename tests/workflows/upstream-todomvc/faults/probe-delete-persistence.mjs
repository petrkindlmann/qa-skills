// Evaluator-only proof of fixture behavior; not a fresh-agent-authored suite.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { startTodoServer } from '../server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const browser = await chromium.launch({ headless: true,
  ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}) });
const evidence = {
  classification: 'Controlled fixture probes, not generated-suite evaluation',
  command: 'QA_BROWSER_EXECUTABLE=/tmp/qa-skills-chrome/opt/google/chrome/chrome node tests/workflows/upstream-todomvc/faults/probe-delete-persistence.mjs',
  createdAt: new Date().toISOString(),
  upstreamCommit: '25a9e31eb32db752d959df18e4d214295a2875e8',
  runtime: { browser: browser.version(), node: process.version, playwright: require('playwright/package.json').version },
  sourceHashes: {},
  results: [],
};
for (const file of ['server.mjs', 'faults/mutations.mjs', 'faults/delete-persistence-lost.mjs', 'faults/probe-delete-persistence.mjs'])
  evidence.sourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');

async function add(page, title) {
  const rows = page.locator('.todo-list li');
  const count = await rows.count();
  const input = page.getByPlaceholder('What needs to be done?');
  await input.fill(title);
  await input.press('Enter');
  await expect(rows).toHaveCount(count + 1);
}

async function probe(action, fault, interveningWrite) {
  const app = await startTodoServer({ fault });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  const externalRequests = [], pageErrors = [];
  let requests = 0;
  page.on('request', request => {
    requests++;
    if (new URL(request.url()).origin !== app.baseURL) externalRequests.push(request.url());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto(app.baseURL);
    await add(page, 'Keep active');
    await add(page, 'Remove first');
    if (action === 'clear-completed') await add(page, 'Remove second');
    const labels = page.locator('.todo-list li label');
    const beforeRemoval = await labels.allTextContents();
    if (action === 'single-delete') {
      const row = page.locator('.todo-list li').filter({ hasText: 'Remove first' });
      await row.hover();
      await row.locator('.destroy').click();
    } else {
      await page.locator('.todo-list li').filter({ hasText: 'Remove first' }).locator('.toggle').check();
      await page.locator('.todo-list li').filter({ hasText: 'Remove second' }).locator('.toggle').check();
      await page.getByRole('button', { name: 'Clear completed', exact: true }).click();
    }
    await expect(labels).toHaveText(['Keep active']);
    const afterRemovalBeforeAnyWrite = await labels.allTextContents();
    if (interveningWrite) await add(page, 'Unrelated later write');
    // No page actions or writes intervene between this checkpoint and reload.
    const beforeReload = await labels.allTextContents();
    await page.reload();
    const expected = fault === 'delete-persistence-lost' && !interveningWrite ? beforeRemoval : beforeReload;
    await expect(labels).toHaveText(expected);
    const afterReload = await labels.allTextContents();
    assert.deepEqual(externalRequests, [], 'No external service should be requested');
    assert.deepEqual(pageErrors, [], 'A JavaScript error must not masquerade as a working fault');
    const deletionPersisted = !afterReload.some(title => title.startsWith('Remove '));
    assert.equal(deletionPersisted, fault === 'none' || interveningWrite);
    const result = { action, fault, interveningWrite, beforeRemoval, afterRemovalBeforeAnyWrite, beforeReload, afterReload,
      deletionPersisted, matchedControlledExpectation: true, requests, externalRequests, pageErrors };
    evidence.results.push(result);
    console.log(JSON.stringify(result));
  } finally { await context.close(); await app.close(); }
}

try {
  for (const action of ['single-delete', 'clear-completed']) {
    await probe(action, 'none', false);
    await probe(action, 'delete-persistence-lost', false);
    await probe(action, 'delete-persistence-lost', true);
  }
  await writeFile(resolve(root, 'observations/delete-persistence-results.json'), JSON.stringify(evidence, null, 2) + '\n');
} finally { await browser.close(); }
