import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { renderInEmailClients } from '@hyper-elements/email-clients';
import { loadFunctions } from '../examples/snippets.mjs';

const { checkInEmailClients } = loadFunctions('skills/email-testing/references/client-rendering.md',
  'function checkInEmailClients(', ['checkInEmailClients'],
  { mkdir, writeFile, path, pathToFileURL, renderInEmailClients });

// A table layout with inline styles: what survives classic Outlook and Gmail. It declares
// itself light-only, so Apple Mail's dark mode leaves its colors as written.
const lightOnly = '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">';
const healthy = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">${lightOnly}<title>Reset your password</title></head>
<body>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f4" style="background:#f4f4f4"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;background:#ffffff">
<tr><td style="padding:32px;font-family:Arial,sans-serif;font-size:16px;line-height:24px;color:#222222">
<h1 style="margin:0 0 16px;font-size:24px;line-height:32px">Reset your password</h1>
<p style="margin:0 0 24px">Use the button below to choose a new password.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1a56db" style="padding:12px 24px">
<a href="https://staging.example.test/reset?token=abc" style="color:#ffffff;font-weight:bold;text-decoration:none">Reset password</a>
</td></tr></table>
</td></tr></table>
</td></tr></table>
</body></html>`;

// The same email built like a web page: flex, absolute position, rounded corners, a <style> in the body.
const broken = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Reset your password</title></head>
<body style="margin:0">
<div style="display:flex;gap:24px;padding:32px;font-family:Arial,sans-serif">
<div style="position:absolute;top:0;left:0">Limited offer</div>
<h1 style="font-size:24px">Reset your password</h1>
<a href="https://staging.example.test/reset?token=abc" style="display:inline-block;padding:12px 24px;border-radius:8px;background:#1a56db;color:#ffffff">Reset password</a>
</div>
<style>.note{color:#666666}</style>
</body></html>`;

let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.QA_BROWSER_EXECUTABLE, headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t) {
  const context = await browser.newContext();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'email-clients-'));
  t.after(async () => { await context.close(); await rm(dir, { recursive: true, force: true }); });
  // Previews are local files; nothing they draw may reach the network.
  await context.route(/^https?:/, route => route.abort());
  return { page: await context.newPage(), dir };
}

test('a table-layout email passes in every client and leaves a preview per client', async t => {
  const { page, dir } = await fixture(t);
  const { files } = await checkInEmailClients(page, healthy, dir);
  const written = (await readdir(dir)).sort();
  for (const name of ['outlook.html', 'outlook-com.html', 'outlook-mac.html', 'gmail.html', 'gmail-app.html',
    'gmail-app-other.html', 'apple-mail.html', 'apple-mail.dark.html', 'yahoo.html', 'aol.html']) {
    assert.ok(written.includes(name), `missing ${name} in ${written}`);
  }
  assert.equal(files.length, written.length);
});

test('a web-page layout fails, naming what Outlook and Gmail remove and the line', async t => {
  const { page, dir } = await fixture(t);
  await assert.rejects(checkInEmailClients(page, broken, dir), error => {
    assert.match(error.message, /outlook: removes position/);
    assert.match(error.message, /outlook: removes border-radius/);
    assert.match(error.message, /gmail: removes <style> in <body>/);
    assert.match(error.message, /display: flex.*\(line 4\)/);
    return true;
  });
  // The previews are written before the failure, so CI can attach them.
  assert.ok((await readdir(dir)).includes('outlook.html'));
});

test('claiming dark mode support without dark styles fails on unreadable text', async t => {
  const { page, dir } = await fixture(t);
  const claimsDark = healthy.replace(lightOnly,
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">');
  await assert.rejects(checkInEmailClients(page, claimsDark, dir, { clients: ['apple-mail'] }),
    /apple-mail\.dark: email\/dark-contrast: .*1\.1:1/);
});

test('only differences listed in accept pass; each must still be found', async t => {
  const { page, dir } = await fixture(t);
  await assert.rejects(checkInEmailClients(page, broken, dir, { accept: ['border-radius'] }),
    error => !/border-radius/.test(error.message) && /removes position/.test(error.message));
  await assert.rejects(checkInEmailClients(page, healthy, dir, { accept: ['border-radius'] }),
    /accepted, but no longer found: border-radius/);
});

test('a client with no preview fails instead of passing unchecked', async t => {
  const { page, dir } = await fixture(t);
  await assert.rejects(checkInEmailClients(page, healthy, dir, { clients: ['outlook', 'thunderbird'] }),
    /No preview for thunderbird/);
});

test('a text-only message, a fragment, or the Text part is refused', async t => {
  const { page, dir } = await fixture(t);
  await assert.rejects(checkInEmailClients(page, '', dir), /no HTML part/);
  await assert.rejects(checkInEmailClients(page, '<p>Reset your password</p>', dir), TypeError);
  await assert.rejects(checkInEmailClients(page, 'Your code: 654321', dir), TypeError);
});

test('a preview that fails to draw is a failure, not a pass', async t => {
  const { page, dir } = await fixture(t);
  const failing = async (html, options) => {
    const result = await renderInEmailClients(html, options);
    // A policy that refuses WebAssembly stops the client models, so the preview reports ready="error".
    return { ...result, previews: result.previews.map(p => ({ ...p, html: p.html.replace(" 'wasm-unsafe-eval'", '') })) };
  };
  const { checkInEmailClients: check } = loadFunctions('skills/email-testing/references/client-rendering.md',
    'function checkInEmailClients(', ['checkInEmailClients'],
    { mkdir, writeFile, path, pathToFileURL, renderInEmailClients: failing });
  await assert.rejects(check(page, healthy, dir, { clients: ['gmail'], dark: false }), /The gmail preview failed/);
});
