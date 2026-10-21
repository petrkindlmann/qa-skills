const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { createMailpit, extractResetLink } = require('./mailpit_helpers.cjs');

const BASE = process.env.MAILPIT_URL;
const SMTP_PORT = Number(process.env.SMTP_PORT);
const ORIGIN = 'http://127.0.0.1:3000';
if (!BASE || !Number.isInteger(SMTP_PORT) || SMTP_PORT <= 0) {
  throw new Error('Start Mailpit and export MAILPIT_URL plus SMTP_PORT before running the verification');
}

function sendSmtp(messages, delayMs = 0) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3',
      [path.join(__dirname, 'smtp_send.py')], { timeout: 12000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`Real SMTP fixture failed: ${error.message}\n${stderr}`));
        try {
          const result = JSON.parse(stdout);
          if (result.accepted !== messages.length) throw new Error('Not all SMTP recipients were accepted');
          resolve(result);
        } catch (parseError) { reject(parseError); }
      });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ host: '127.0.0.1', port: SMTP_PORT, delay_ms: delayMs, messages }));
  });
}

function scope(request, testInfo) {
  const runId = randomUUID();
  const events = [];
  const log = event => {
    events.push(event);
    if (process.env.MAILPIT_TEST_VERBOSE === '1') console.log(JSON.stringify({ test: testInfo.title, runId, ...event }));
  };
  const mailpit = createMailpit(request, BASE, log);
  const recipients = new Map();
  const address = (label, ownerRunId = runId) => {
    const value = `${label}+${runId}@example.test`;
    recipients.set(value, ownerRunId);
    return value;
  };
  const fixture = (to, html, subject = 'Reset your password') => ({
    to, from: 'no-reply@example.test', subject, run_id: runId,
    text: 'Your reset link is in the HTML alternative. This is a synthetic account.', html,
  });
  const finish = async () => {
    const failures = [];
    for (const [recipient, ownerRunId] of recipients) {
      try { await mailpit.cleanupRecipient(recipient, ownerRunId); } catch (error) { failures.push(error); }
    }
    await testInfo.attach('mailpit-events.json', { body: JSON.stringify(events, null, 2), contentType: 'application/json' });
    if (failures.length) throw new AggregateError(failures, 'Owned-recipient cleanup failed');
  };
  return { runId, events, mailpit, address, fixture, finish };
}

test('captures delayed reset by exact recipient beyond the unfiltered first page', async ({ page, request }, testInfo) => {
  const s = scope(request, testInfo);
  const recipient = s.address('reset');
  const decoy = s.address('unrelated');
  const staleHTML = `<a href="${ORIGIN}/reset?token=stale-${s.runId}">Reset password</a>`;
  let delayed;
  try {
    await sendSmtp([s.fixture(recipient, staleHTML)]);
    await sendSmtp(Array.from({ length: 55 }, (_, index) =>
      s.fixture(decoy, `<a href="${ORIGIN}/reset?token=decoy-${index}">Decoy</a>`)));
    const inbox = await request.get(`${BASE}/api/v1/messages?limit=50`);
    expect(inbox.ok()).toBeTruthy();
    const firstPage = await inbox.json();
    expect(firstPage.messages).toHaveLength(50);
    expect(firstPage.messages.some(m => m.To.some(a => a.Address === recipient))).toBe(false);
    const stale = await s.mailpit.waitForEmail(recipient);
    expect(stale.To.map(a => a.Address)).toEqual([recipient]);
    const token = `new+/${s.runId}=`;
    const expectedURL = `${ORIGIN}/reset?source=email&token=${encodeURIComponent(token)}`;
    const escapedURL = expectedURL.replaceAll('&', '&amp;');
    const html = `<p>Account security</p><a href="${ORIGIN}/help">Help</a>` +
      `<a href="http://127.0.0.1:3001/reset?token=wrong-origin">Wrong origin</a>` +
      `<a href="${escapedURL}">Reset password</a>`;
    const subject = process.env.MAILPIT_TEST_BAD_SUBJECT === '1' ? 'Account newsletter' : 'Reset your password';
    delayed = sendSmtp([s.fixture(recipient, html, subject)], 450);
    // Begin condition polling while the real SMTP producer is intentionally delayed.
    const message = await s.mailpit.waitForEmail(recipient, { excludeIds: [stale.ID] });
    await delayed;
    expect(message.ID).not.toBe(stale.ID);
    expect(message.Subject).toBe('Reset your password');
    expect(message.From.Address).toBe('no-reply@example.test');
    expect(message.To.map(a => a.Address)).toEqual([recipient]);
    expect(message.ReplyTo.map(a => a.Address)).toEqual(['support@example.test']);
    const headers = await s.mailpit.headers(message.ID);
    const key = Object.keys(headers).find(name => name.toLowerCase() === 'x-test-run');
    expect(headers[key]).toEqual([s.runId]);
    const resetURL = await extractResetLink(page, message, ORIGIN);
    expect(resetURL).toBe(expectedURL);
    expect(new URL(resetURL).searchParams.get('token')).toBe(token);
    const capture = s.events.find(event => event.event === 'captured' && event.id === message.ID);
    expect(capture.attempts).toBeGreaterThan(1);
  } finally {
    try { if (delayed) await delayed; } finally { await s.finish(); }
  }
});

test('rejects real captured reset templates with missing, unsafe or ambiguous links', async ({ page, request }, testInfo) => {
  const s = scope(request, testInfo);
  const recipient = s.address('links');
  const seen = [];
  const good = `${ORIGIN}/reset?source=email&token=valid-${s.runId}`;
  const cases = [
    { name: 'known-good repeated equivalent links', html: `<a href="${good.replaceAll('&', '&amp;')}">Reset</a><a href="${good.replaceAll('&', '&#38;')}">Reset again</a>`, expected: good },
    { name: 'missing link', html: '<p>No reset link in this broken template.</p>' },
    { name: 'wrong origin', html: '<a href="http://127.0.0.1:3001/reset?token=wrong">Reset</a>' },
    { name: 'credentials in URL', html: '<a href="http://user:password@127.0.0.1:3000/reset?token=wrong">Reset</a>' },
    { name: 'two distinct reset links', html: `<a href="${ORIGIN}/reset?token=one">Reset</a><a href="${ORIGIN}/reset?token=two">Reset</a>` },
    { name: 'missing token', html: `<a href="${ORIGIN}/reset?source=email">Reset</a>` },
    { name: 'duplicate token parameters', html: `<a href="${ORIGIN}/reset?token=one&amp;token=two">Reset</a>` },
    { name: 'relative URL', html: '<a href="/reset?token=relative">Reset</a>' },
  ];
  try {
    for (const item of cases) {
      await sendSmtp([s.fixture(recipient, item.html, item.name)]);
      const message = await s.mailpit.waitForEmail(recipient, { excludeIds: seen });
      seen.push(message.ID);
      expect(message.Subject).toBe(item.name);
      if (item.expected) expect(await extractResetLink(page, message, ORIGIN)).toBe(item.expected);
      else await expect(extractResetLink(page, message, ORIGIN), item.name).rejects.toThrow('Expected exactly one reset link');
    }
  } finally { await s.finish(); }
});

test('bounded waits reject absent recipients and stale-only messages after observing real mail', async ({ request }, testInfo) => {
  const s = scope(request, testInfo);
  const recipient = s.address('stale');
  const missing = s.address('absent');
  try {
    await sendSmtp([s.fixture(recipient, `<a href="${ORIGIN}/reset?token=known">Reset</a>`)]);
    const observed = await s.mailpit.waitForEmail(recipient);
    expect(observed.ID).toBeTruthy();
    await expect(s.mailpit.waitForEmail(recipient, { excludeIds: [observed.ID], timeout: 350, intervals: [50, 100] }))
      .rejects.toThrow('No new email');
    await expect(s.mailpit.waitForEmail(missing, { timeout: 350, intervals: [50, 100] }))
      .rejects.toThrow('No new email');
    expect((await s.mailpit.get(observed.ID, recipient)).ID).toBe(observed.ID);
    await expect(s.mailpit.get('00000000-0000-4000-8000-000000000000', recipient)).rejects.toThrow('HTTP 404');
  } finally { await s.finish(); }
});

test('cleanup deletes only owned IDs and preserves another test recipient', async ({ request }, testInfo) => {
  const s = scope(request, testInfo);
  const mine = s.address('owned');
  const otherRunId = randomUUID();
  const other = s.address('other-test', otherRunId);
  try {
    await sendSmtp([s.fixture(mine, '<p>Owned fixture</p>'),
      { ...s.fixture(other, '<p>Other test sentinel</p>'), run_id: otherRunId }]);
    const own = await s.mailpit.waitForEmail(mine);
    const sentinel = await s.mailpit.waitForEmail(other);
    expect(own.ID).not.toBe(sentinel.ID);
    const deletesBefore = s.events.filter(e => e.event === 'delete-owned').length;
    expect(await s.mailpit.deleteOwned(mine, [], s.runId)).toEqual([]);
    expect(s.events.filter(e => e.event === 'delete-owned')).toHaveLength(deletesBefore);
    await expect(s.mailpit.deleteOwned(mine, [own.ID, sentinel.ID], s.runId)).rejects.toThrow('another message or recipient');
    expect((await s.mailpit.get(own.ID, mine)).ID).toBe(own.ID);
    expect((await s.mailpit.get(sentinel.ID, other)).ID).toBe(sentinel.ID);
    await expect(s.mailpit.deleteOwned(mine, [own.ID], 'different-owner')).rejects.toThrow('matching X-Test-Run owner');
    expect(await s.mailpit.deleteOwned(mine, [own.ID], s.runId)).toEqual([own.ID]);
    expect((await s.mailpit.get(sentinel.ID, other)).ID).toBe(sentinel.ID);
  } finally { await s.finish(); }
});
