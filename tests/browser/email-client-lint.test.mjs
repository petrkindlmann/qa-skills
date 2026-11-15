import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loadFunctions } from '../examples/snippets.mjs';

const { lintEmailHtml, EMAIL_CLIENT_RULES } = loadFunctions(
  'skills/email-testing/references/client-compatibility.md', 'function lintEmailHtml(',
  ['lintEmailHtml', 'EMAIL_CLIENT_RULES']);

// A table layout with inline styles, a language, a title and absolute links.
const email = (body, head = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Reset your password</title>${head}</head>
<body><div lang="en" dir="ltr">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:32px;font-family:Arial,sans-serif;font-size:16px;color:#222222">
<h1 style="margin:0 0 16px;font-size:24px">Reset your password</h1>
<img src="https://staging.example.test/logo.png" alt="Example" width="120">
<a href="https://staging.example.test/reset?token=abc" style="color:#1a56db">Reset password</a>
${body}
</td></tr></table>
</div></body></html>`;
const healthy = email('');

// One minimal email per rule, so no rule ships without a case that fires it.
const samples = {
  'css-display-flex': email('<div style="display:flex">a</div>'),
  'css-display-grid': email('<div style="display:inline-grid">a</div>'),
  'css-flex-direction': email('<div style="flex-direction:column">a</div>'),
  'css-justify-content': email('', '<style>.row{justify-content:center}</style>'),
  'css-align-items': email('<div style="align-items:center">a</div>'),
  'css-position': email('<div style="position:absolute;top:0">a</div>'),
  'css-float': email('<div style="float:left">a</div>'),
  'css-transform': email('<div style="transform:rotate(3deg)">a</div>'),
  'css-visibility': email('<div style="visibility:hidden">a</div>'),
  'css-background-image': email('<div style="background:url(https://staging.example.test/hero.png)">a</div>'),
  'css-variables': email('<div style="background:var(--brand)">a</div>'),
  'css-unit-calc': email('', '<style>.col{width:calc(100% - 32px)}</style>'),
  'css-linear-gradient': email('<div style="background:linear-gradient(#fff,#eee)">a</div>'),
  'css-at-import': email('', '<style>@import url("https://staging.example.test/mail.css");</style>'),
  'html-style-in-body': email('<style>.note{color:#666666}</style>'),
  'html-style-16kb': email('', `<style>${'.a{color:#000000}'.repeat(1000)}</style>`),
  'html-svg': email('<svg width="16" height="16" role="img" aria-label="Lock"></svg>'),
  'html-link': email('', '<link rel="stylesheet" href="https://staging.example.test/mail.css">'),
  'image-base64': email('<img src="data:image/png;base64,iVBORw0KGgo=" alt="Lock">'),
  'image-webp': email('<img src="https://staging.example.test/hero.webp" alt="Hero">'),
  'gmail-clip-102kb': email(`<p>${'word '.repeat(21_000)}</p>`),
};

let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.QA_BROWSER_EXECUTABLE, headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const requests = [];
  await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  return { page: await context.newPage(), requests };
}
const failure = async promise => {
  try { await promise; } catch (error) { return error.message; }
  assert.fail('the lint passed');
};

test('a table-layout email passes and reports how much it linted', async t => {
  const { page } = await fixture(t);
  const result = await lintEmailHtml(page, healthy);
  assert.deepEqual(result.findings, []);
  assert.ok(result.elements >= 8, `linted only ${result.elements} elements`);
});

test('every rule fires on its own sample and names its clients', async t => {
  const { page } = await fixture(t);
  const ids = EMAIL_CLIENT_RULES.map(rule => rule.id ?? rule.feature);
  assert.deepEqual(Object.keys(samples).sort(), [...ids].sort(), 'a rule has no sample, or a sample has no rule');
  for (const rule of EMAIL_CLIENT_RULES) {
    const id = rule.id ?? rule.feature;
    const message = await failure(lintEmailHtml(page, samples[id]));
    assert.ok(message.includes(`- ${id} (${rule.clients.join(', ')})`), `${id}: ${message}`);
    // Nothing else may fire: each sample differs from the healthy email by one construct.
    assert.equal(message.split('\n').length, 2, `${id} sample raised more than its own finding:\n${message}`);
  }
});

test('a web-page layout fails with every finding, its clients and where it is', async t => {
  const { page } = await fixture(t);
  const web = `<html><head></head><body>
<div class="card" style="display:flex;justify-content:space-between;position:relative">
<svg width="16" height="16"></svg><img src="/logo.png">
<a href="/reset?token=abc"><img src="https://staging.example.test/arrow.png"></a>
<table><tr><td>Reset your password</td></tr></table></div>
<style>.note{color:#666666}</style></body></html>`;
  const message = await failure(lintEmailHtml(page, web));
  assert.match(message, /- css-display-flex \(outlook\.windows\) x1: <div\.card> display: flex/);
  assert.match(message, /- css-position \(outlook\.windows, gmail\.desktop-webmail, gmail\.ios, gmail\.android\)/);
  assert.match(message, /- html-svg \(.*yahoo\.desktop-webmail\)/);
  assert.match(message, /- url-not-absolute \(every client\) x2: <img>; <a>/);
  for (const id of ['css-justify-content', 'html-style-in-body', 'a11y-html-lang', 'a11y-title',
    'a11y-body-lang-dir', 'a11y-table-role', 'a11y-img-alt', 'a11y-link-text']) {
    assert.ok(message.includes(`- ${id} (`), `missing ${id} in:\n${message}`);
  }
});

test('a rule inside @media does not fire; the same rule outside it does', async t => {
  const { page } = await fixture(t);
  const responsive = email('', '<style>@media (max-width:600px){.col{display:flex;position:relative}}</style>');
  assert.deepEqual((await lintEmailHtml(page, responsive)).findings, []);
  const base = email('', '<style>.col{display:flex}@media (max-width:600px){.col{display:block}}</style>');
  assert.match(await failure(lintEmailHtml(page, base)), /css-display-flex \(outlook\.windows\) x1: \.col display: flex/);
});

test('values that do not use the feature pass', async t => {
  const { page } = await fixture(t);
  const plain = email('<div style="display:block;position:static;float:none;transform:none;visibility:visible;'
    + 'background-image:none;flex-direction:row">a</div><table><caption>Totals</caption><tr><th>Item</th></tr></table>'
    + '<a href="mailto:help@example.test">Help</a><a href="#top">Top</a><img src="cid:logo" alt="">');
  assert.deepEqual((await lintEmailHtml(page, plain)).findings, []);
});

test('clients narrows findings to the clients asked for', async t => {
  const { page } = await fixture(t);
  const flex = samples['css-display-flex'];
  assert.deepEqual((await lintEmailHtml(page, flex, { clients: ['gmail.desktop-webmail'] })).findings, []);
  const position = await failure(lintEmailHtml(page, samples['css-position'], { clients: ['gmail.ios', 'yahoo.desktop-webmail'] }));
  assert.match(position, /- css-position \(gmail\.ios\) x1/);
});

test('only accepted ids pass, and an accepted id must still be found', async t => {
  const { page } = await fixture(t);
  const two = email('<div style="display:flex;float:left">a</div>');
  const open = await failure(lintEmailHtml(page, two, { accept: ['css-float'] }));
  assert.match(open, /css-display-flex/);
  assert.doesNotMatch(open, /css-float/);
  const passed = await lintEmailHtml(page, two, { accept: ['css-float', 'css-display-flex'] });
  assert.deepEqual(passed.findings.map(finding => finding.id).sort(), ['css-display-flex', 'css-float']);
  assert.match(await failure(lintEmailHtml(page, healthy, { accept: ['css-float'] })),
    /accepted, but no longer found: css-float/);
});

test('structure checks can be switched off; link checks cannot', async t => {
  const { page } = await fixture(t);
  const bare = '<html><body><p>Reset your password: <a href="/reset">here</a></p></body></html>';
  const message = await failure(lintEmailHtml(page, bare, { a11y: false }));
  assert.doesNotMatch(message, /a11y-/);
  assert.match(message, /url-not-absolute/);
});

test('size limits fail just above the limit and pass just below it', async t => {
  const { page } = await fixture(t);
  const padded = bytes => { const base = email('<p></p>'); return base.replace('<p></p>', `<p>${'a'.repeat(bytes - Buffer.byteLength(base))}</p>`); };
  assert.deepEqual((await lintEmailHtml(page, padded(102 * 1024))).findings, []);
  assert.match(await failure(lintEmailHtml(page, padded(102 * 1024 + 1))), /gmail-clip-102kb \(gmail/);
  const styled = bytes => email('', `<style>${'/*' + 'x'.repeat(bytes - 4) + '*/'}</style>`);
  assert.deepEqual((await lintEmailHtml(page, styled(16 * 1024))).findings, []);
  assert.match(await failure(lintEmailHtml(page, styled(16 * 1024 + 1))), /html-style-16kb \(gmail\.desktop-webmail\)/);
});

test('a missing HTML part, plain text and an empty body are refused', async t => {
  const { page } = await fixture(t);
  await assert.rejects(lintEmailHtml(page, ''), /no HTML part/);
  await assert.rejects(lintEmailHtml(page, undefined), /no HTML part/);
  await assert.rejects(lintEmailHtml(page, 'Your code: 654321'), /no HTML part/);
  await assert.rejects(lintEmailHtml(page, '<html><head><title>x</title></head><body>  </body></html>'), /empty body/);
});

test('linting runs no email script, requests nothing and leaves the page where it was', async t => {
  const { page, requests } = await fixture(t);
  await page.setContent('<main id="app">checkout</main>');
  const hostile = email('<script>window.emailScriptRan=true</script><img src="https://tracker.example.test/open.gif" alt="">',
    '<style>@font-face{font-family:x;src:url(https://fonts.example.test/x.woff2)}</style>');
  await lintEmailHtml(page, hostile);
  assert.equal(await page.evaluate(() => window.emailScriptRan), undefined);
  assert.equal(await page.locator('#app').textContent(), 'checkout');
  assert.deepEqual(requests, []);
});
