import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loadFunctions } from '../examples/snippets.mjs';

const { extractLink } = loadFunctions('skills/email-testing/references/mailpit-playwright.md',
  'function extractOtp(', ['extractLink']);
const origin = 'https://staging.example.test';
const accepts = url => url.pathname === '/reset' && Boolean(url.searchParams.get('token'));
let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.QA_BROWSER_EXECUTABLE, headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', route => route.abort());
  return context.newPage();
}

test('HTML href is parsed without closing markup and with entity decoding', async t => {
  const page = await fixture(t);
  const url = await extractLink(page, { Text: '', HTML: '<a href="https://staging.example.test/reset?next=%2F&amp;token=abc">Reset</a>' }, origin, accepts);
  assert.equal(url, `${origin}/reset?next=%2F&token=abc`);
});

test('valid token punctuation is preserved instead of trimmed', async t => {
  const page = await fixture(t);
  const url = await extractLink(page, { Text: '', HTML: `<a href="${origin}/reset?token=abc.">Reset</a>` }, origin, accepts);
  assert.equal(new URL(url).searchParams.get('token'), 'abc.');
});

test('wrong origins, suffix lookalikes, credentials and schemes cannot become navigation', async t => {
  const page = await fixture(t);
  for (const href of [
    'https://evil-staging.example.test/reset?token=abc',
    'https://staging.example.test.attacker.test/reset?token=abc',
    'http://staging.example.test/reset?token=abc',
    'https://user:password@staging.example.test/reset?token=abc',
    '/reset?token=abc', 'javascript:alert(1)',
  ]) {
    await assert.rejects(extractLink(page, { Text: '', HTML: `<a href="${href}">Reset</a>` }, origin, accepts));
  }
});

test('two distinct matching links fail rather than choosing an account/token', async t => {
  const page = await fixture(t);
  const HTML = `<a href="${origin}/reset?token=first">Reset</a><a href="${origin}/reset?token=second">Reset</a>`;
  await assert.rejects(extractLink(page, { Text: '', HTML }, origin, accepts), /exactly one/);
});

test('repeated display of the same exact link remains unambiguous', async t => {
  const page = await fixture(t);
  const href = `${origin}/reset?token=abc`;
  const HTML = `<a href="${href}">Reset</a><a href="${href}">Try again</a>`;
  assert.equal(await extractLink(page, { Text: '', HTML }, origin, accepts), href);
});

test('plain text URL with explicit delimiters is accepted', async t => {
  const page = await fixture(t);
  const href = `${origin}/reset?token=abc`;
  assert.equal(await extractLink(page, { Text: `Reset here: <${href}>`, HTML: '' }, origin, accepts), href);
});

test('wrong path and missing token are rejected', async t => {
  const page = await fixture(t);
  for (const href of [`${origin}/account?token=abc`, `${origin}/reset`, `${origin}/reset?token=`]) {
    await assert.rejects(extractLink(page, { Text: href, HTML: '' }, origin, accepts));
  }
});

test('reading an email does not execute its script in the test page', async t => {
  const page = await fixture(t);
  const HTML = `<script>window.emailScriptRan=true</script><a href="${origin}/reset?token=abc">Reset</a>`;
  await extractLink(page, { Text: '', HTML }, origin, accepts);
  assert.equal(await page.evaluate(() => window.emailScriptRan), undefined);
});
