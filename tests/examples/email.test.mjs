import test from 'node:test';
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { loadFunctions } from './snippets.mjs';

const source = 'skills/email-testing/references/mailpit-playwright.md';
const { extractOtp } = loadFunctions(source, 'function extractOtp(', ['extractOtp'], { expect });
const { waitForEmail } = loadFunctions(source, 'function waitForEmail(', ['waitForEmail'], { expect });
const recipient = 'reset+attempt-123@example.test';
const message = (id, to = recipient) => ({ ID: id, To: [{ Address: to }], Subject: 'Reset', Text: 'Code: 654321', HTML: '' });
const response = (body, status = 200) => ({ ok: () => status >= 200 && status < 300, status: () => status, json: async () => body });

test('OTP is selected by label rather than an earlier order number', () => {
  assert.equal(extractOtp('Order 123456. Your code: 654321.'), '654321');
});
test('missing and ambiguous OTPs fail instead of guessing', () => {
  for (const text of ['Order 123456.', 'Code: 1234567', 'Code: 123456. Old code: 654321.']) {
    assert.throws(() => extractOtp(text));
  }
});
test('a repeated rendering of the same OTP is unambiguous', () => {
  assert.equal(extractOtp('Code: 123456. CODE IS 123456.'), '123456');
});
test('localized template can specify its label without changing extraction logic', () => {
  assert.equal(extractOtp('Objednávka 123456. Kód: 654321.', /Kód:\s*(\d{6})\b/i), '654321');
});

test('Mailpit uses search endpoint and exact recipient, then fetches matching body', async () => {
  const calls = [];
  const api = { get: async raw => {
    const url = new URL(raw); calls.push(url);
    if (url.pathname === '/api/v1/search') return response({ messages: [message('other', 'other@example.test'), message('target')] });
    if (url.pathname === '/api/v1/message/target') return response(message('target'));
    return response({ error: 'wrong endpoint' }, 404);
  } };
  assert.equal((await waitForEmail(api, recipient, { timeout: 100, intervals: [1] })).ID, 'target');
  assert.equal(calls[0].searchParams.get('query'), `to:${recipient}`);
});

test('a second request for the same account excludes previously seen mail', async () => {
  const api = { get: async raw => new URL(raw).pathname === '/api/v1/search'
    ? response({ messages: [message('old'), message('new')] }) : response(message('new')) };
  assert.equal((await waitForEmail(api, recipient, { excludeIds: ['old'], timeout: 100, intervals: [1] })).ID, 'new');
});

test('delayed delivery is polled without an arbitrary browser sleep', async () => {
  let reads = 0;
  const api = { get: async raw => {
    if (new URL(raw).pathname === '/api/v1/search') return response({ messages: ++reads < 3 ? [] : [message('arrived')] });
    return response(message('arrived'));
  } };
  assert.equal((await waitForEmail(api, recipient, { timeout: 100, intervals: [1] })).ID, 'arrived');
  assert.equal(reads, 3);
});

test('server errors and malformed search responses are visible failures', async () => {
  for (const result of [response({ messages: [message('target')] }, 503), response({ message: 'wrong schema' })]) {
    await assert.rejects(waitForEmail({ get: async () => result }, recipient, { timeout: 30, intervals: [1] }));
  }
});

test('detail response cannot substitute another recipient or message ID', async () => {
  for (const detail of [message('wrong-id'), message('target', 'victim@example.test')]) {
    const api = { get: async raw => new URL(raw).pathname === '/api/v1/search'
      ? response({ messages: [message('target')] }) : response(detail) };
    await assert.rejects(waitForEmail(api, recipient, { timeout: 100, intervals: [1] }), /different message or recipient/);
  }
});

test('missing mail times out rather than becoming an empty successful result', async () => {
  await assert.rejects(waitForEmail({ get: async () => response({ messages: [] }) }, recipient,
    { timeout: 20, intervals: [1] }));
});

const { deleteOwnMessages } = loadFunctions(source, 'function deleteOwnMessages(', ['deleteOwnMessages'], { expect });
test('per-test cleanup never sends an empty ID list, which would empty the shared inbox', async () => {
  const calls = [];
  const api = { delete: async (url, options) => { calls.push({ url, options }); return response({}); } };
  await deleteOwnMessages(api, []);
  assert.equal(calls.length, 0);
  await deleteOwnMessages(api, ['a', 'b']);
  assert.deepEqual(calls, [{ url: '/api/v1/messages', options: { data: { IDs: ['a', 'b'] } } }]);
});
test('a refused cleanup fails instead of passing silently', async () => {
  const api = { delete: async () => response({}, 500) };
  await assert.rejects(deleteOwnMessages(api, ['a']), /Mailpit delete returned 500/);
});
