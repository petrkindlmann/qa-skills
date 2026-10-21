import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { expect as playwrightExpect } from '@playwright/test';
import axe from '@axe-core/playwright';
import { loadFunctions, snippet } from '../examples/snippets.mjs';

const reference = 'skills/accessibility-testing/references/recipes.md';
const expect = playwrightExpect.configure({ timeout: 250 });
const { scanAccessibility, checkAccessibility } = loadFunctions(reference,
  'interface A11yOptions', ['scanAccessibility', 'checkAccessibility'],
  { expect, AxeBuilder: axe.default ?? axe });
const publishedCases = new Map();
const register = (name, run) => publishedCases.set(name, run);
register.describe = (_name, body) => body();
loadFunctions(reference, "test.describe('Accessibility - public pages'", [],
  { test: register, expect, checkAccessibility });

const shell = content => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home</title>
<style>body {background:#fff;color:#111;font:18px sans-serif;}button,input{font:inherit;min-width:32px;min-height:32px;margin:8px;}</style>
</head><body><main>${content}</main></body></html>`;
const form = broken => `<h1>Home</h1><div data-testid="page-home-ready" data-state="ready"></div>
<label>Email<input type="email" autocomplete="${broken ? 'invalid-field-name' : 'email'}"></label>
<button${broken ? ' aria-label="Delete"' : ''}>Save</button>`;
let server, browser, origin, mode;
before(async () => {
  server = createServer((request, response) => {
    if (mode === 'redirect' && request.url !== '/blank') {
      response.writeHead(302, { Location: '/blank' }); return response.end();
    }
    response.setHeader('Content-Type', 'text/html');
    const content = mode === 'blank' || mode === 'redirect' ? '' : mode === 'known-gap'
      ? '<h1>todos</h1><ul class="todo-list"><li><input type="checkbox"><button></button></li><li><input type="checkbox"><button></button></li></ul>'
      : form(mode === 'broken').replace('data-state="ready"', `data-state="${mode === 'loading' ? 'loading' : 'ready'}"`);
    response.end(shell(content));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}),
  });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function withPage(nextMode, work) {
  mode = nextMode;
  const context = await browser.newContext();
  const page = await context.newPage();
  const attachments = [];
  const testInfo = { attach: async (name, value) => attachments.push({ name, ...value }) };
  try { await work({ page, testInfo, attachments }); }
  finally { await context.close(); }
}
const options = page => ({ expectedURL: `${origin}/`, ready: async () => {
  await expect(page.getByTestId('page-home-ready')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
} });

test('published a11y scanner passes the healthy form and attaches the actual rule results', async () => {
  await withPage('healthy', async ({ page, testInfo, attachments }) => {
    await page.goto(origin);
    await checkAccessibility(page, testInfo, options(page));
    assert.equal(attachments.length, 1);
    const result = JSON.parse(attachments[0].body);
    assert.equal(result.violations.length, 0);
    assert.ok(result.passes.length > 0);
  });
});

test('published default tags detect WCAG 2.1 autocomplete and accessible-name defects', async () => {
  await withPage('broken', async ({ page, testInfo }) => {
    await page.goto(origin);
    const violations = await scanAccessibility(page, testInfo, options(page));
    assert.deepEqual(violations.map(item => item.rule).sort(), ['autocomplete-valid', 'label-content-name-mismatch']);
    await assert.rejects(checkAccessibility(page, testInfo, options(page)), /2 a11y violations/);
  });
});

test('published scanner rejects missing target and readiness contracts', async () => {
  await withPage('healthy', async ({ page, testInfo, attachments }) => {
    await page.goto(origin);
    await assert.rejects(scanAccessibility(page, testInfo), /requires expectedURL/);
    await assert.rejects(scanAccessibility(page, testInfo, { expectedURL: `${origin}/` }), /readiness assertion/);
    assert.equal(attachments.length, 0);
  });
});

for (const condition of ['healthy', 'redirect', 'blank', 'loading']) {
  test(`actual public-page recipe ${condition === 'healthy' ? 'accepts' : 'rejects'} ${condition} application state`, async () => {
    await withPage(condition, async ({ page, testInfo, attachments }) => {
      const run = publishedCases.get('Home page has no a11y violations');
      assert.equal(typeof run, 'function');
      if (condition === 'healthy') {
        await run({ page, baseURL: origin }, testInfo);
        assert.equal(attachments.length, 1);
      } else {
        await assert.rejects(run({ page, baseURL: origin }, testInfo));
        // A scanner pass on the wrong state must never become the test's evidence.
        assert.equal(attachments.length, 0);
      }
    });
  });
}

test('actual known-gap recipe imports the published scanner and asserts the observed rule set', async () => {
  await withPage('known-gap', async ({ page, testInfo, attachments }) => {
    await page.goto(origin);
    const source = stripTypeScriptTypes(snippet(reference, 'const upstreamGaps'), { mode: 'strip' })
      .replace(/^import[^\n]+\n/gm, '');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const execute = new AsyncFunction('page', 'testInfo', 'baseURL', 'scanAccessibility', 'expect', source);
    await execute(page, testInfo, origin, scanAccessibility, expect);
    assert.equal(attachments.length, 1);
    assert.deepEqual(JSON.parse(attachments[0].body).violations.map(item => item.id).sort(), ['button-name', 'label']);
  });
});
