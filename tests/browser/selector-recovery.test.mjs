import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadFunctions } from '../examples/snippets.mjs';

const { generate, captureCandidate, proposeRecovery } = loadFunctions(
  'skills/selector-drift-recovery/references/recovery-scripts.md',
  'function generate(', ['generate', 'captureCandidate', 'proposeRecovery'],
);
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.QA_BROWSER_EXECUTABLE, headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, html) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(300);
  await page.setContent(html);
  return page;
}

test('a generated role locator produces real screenshot evidence', async t => {
  const page = await fixture(t, '<button>Pay</button>');
  const candidates = await generate(page, 'Pay');
  const chosen = candidates.find(c => c.score === 4);
  assert.ok(chosen);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-selector-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const shot = path.join(directory, 'candidate.png');
  const row = await captureCandidate(chosen, shot);
  assert.equal(row.screenshotPath, shot);
  assert.equal(row.applied, false);
  assert.equal('locator' in row, false);
  assert.ok((await fs.stat(shot)).size > 0);
});

test('duplicate test IDs cannot receive a unique score-five candidate', async t => {
  const page = await fixture(t, '<button data-testid="pay">Pay</button><button data-testid="pay">Pay</button>');
  assert.equal((await generate(page, 'Pay')).some(c => c.score >= 3), false);
});

test('ambiguous names become distinct region-scoped proposals without choosing first', async t => {
  const page = await fixture(t, '<section aria-label="Personal"><button>Pay</button></section><section aria-label="Business"><button>Pay</button></section>');
  const candidates = await generate(page, 'Pay');
  assert.equal(candidates.filter(c => c.score === 3).length, 2);
  assert.equal(candidates.some(c => c.score >= 4), false);
  for (const candidate of candidates) assert.equal(await candidate.locator.count(), 1);
});

test('duplicate region names do not disguise an ambiguous scoped selector', async t => {
  const page = await fixture(t, '<section aria-label="Billing"><button>Pay</button></section><section aria-label="Billing"><button>Pay</button></section>');
  assert.equal((await generate(page, 'Pay')).some(c => c.score >= 3), false);
});

test('regex metacharacters in intent are literal accessible-name data', async t => {
  const page = await fixture(t, '<button>Pay (USD) + / [1]</button><button>Pay USD</button>');
  const candidate = (await generate(page, 'Pay (USD) + / [1]')).find(c => c.score === 4);
  assert.ok(candidate);
  assert.equal(await candidate.locator.innerText(), 'Pay (USD) + / [1]');
  assert.ok(candidate.selector.includes('new RegExp('));
});

test('quotes and code-like text in a test ID are safely quoted, never executed', async t => {
  const page = await fixture(t, '<button>Pay</button>');
  const id = 'pay\'); globalThis.injected = true; // "';
  await page.getByRole('button').evaluate((el, value) => el.setAttribute('data-testid', value), id);
  const candidate = (await generate(page, 'Pay')).find(c => c.score === 5);
  assert.equal(candidate.selector, `getByTestId(${JSON.stringify(id)})`);
  assert.equal(await candidate.locator.count(), 1);
  assert.equal(await page.evaluate(() => globalThis.injected), undefined);
});

test('empty or missing intent is an input failure', async t => {
  const page = await fixture(t, '<button>Pay</button>');
  for (const value of ['', '  ', undefined, null]) await assert.rejects(generate(page, value), /intent/);
});

test('a candidate that became ambiguous cannot create screenshot evidence', async t => {
  const page = await fixture(t, '<button>Pay</button>');
  const candidate = (await generate(page, 'Pay')).find(c => c.score === 4);
  await page.setContent('<button>Pay</button><button>Pay</button>');
  await assert.rejects(captureCandidate(candidate, '/tmp/qa-should-not-be-written.png'), /no longer unique/);
});

test('screenshot failures propagate instead of recording a nonexistent artifact', async t => {
  const page = await fixture(t, '<button data-testid="pay" style="display:none">Pay</button>');
  const candidate = (await generate(page, 'Pay')).find(c => c.score === 5);
  await assert.rejects(captureCandidate(candidate, '/tmp/qa-hidden-should-not-be-written.png'), /Timeout/);
});

test('missing, ambiguous and text-only candidates retain an unresolved failure row', async t => {
  const failure = { file: 'e2e/pay.spec.ts', line: 12, intent: 'Pay', oldLocator: 'old' };
  const page = await fixture(t, '<p>No matching action</p>');
  for (const html of ['<p>No matching action</p>', '<button>Pay</button><button>Pay</button>', '<p>Pay</p>']) {
    await page.setContent(html);
    const rows = await proposeRecovery(page, failure, '/unused', 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].file, failure.file);
    assert.equal(rows[0].line, failure.line);
    assert.equal(rows[0].score, 0);
    assert.equal(rows[0].applied, false);
    assert.equal(rows[0].screenshotPath, null);
  }
});

test('generation and screenshot errors remain visible in the recovery record', async t => {
  const page = await fixture(t, '<button>Pay</button>');
  const missingIntent = await proposeRecovery(page, { file: 'pay.ts', line: 1 }, '/unused', 0);
  assert.equal(missingIntent.length, 1);
  assert.match(missingIntent[0].rationale, /generation failed/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-selector-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const blocked = path.join(dir, 'file-not-directory');
  await fs.writeFile(blocked, 'occupied');
  const rows = await proposeRecovery(page, { file: 'pay.ts', line: 1, intent: 'Pay' }, blocked, 0);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.score === 0 && row.screenshotPath === null && row.applied === false));
  assert.ok(rows.every(row => /Evidence capture failed/.test(row.rationale)));
});
