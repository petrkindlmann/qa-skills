import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFunctions } from './snippets.mjs';

const { normalizeSpanStatus } = loadFunctions(
  'skills/observability-driven-testing/references/trace-assertions.md',
  'function normalizeSpanStatus', ['normalizeSpanStatus'],
);

test('OTLP numeric error status cannot pass an error-free trace assertion', () => {
  const spans = [{ status: { code: 0 } }, { status: { code: 2 } }];
  assert.equal(spans.filter(s => normalizeSpanStatus(s.status?.code) === 'error').length, 1);
});

test('OTLP string and explicitly normalized short error names are detected', () => {
  for (const code of ['STATUS_CODE_ERROR', 'ERROR']) {
    assert.equal(normalizeSpanStatus(code), 'error');
  }
});

test('known healthy and unset statuses remain valid', () => {
  for (const code of [undefined, 0, 'STATUS_CODE_UNSET', 'UNSET']) {
    assert.equal(normalizeSpanStatus(code), 'unset');
  }
  for (const code of [1, 'STATUS_CODE_OK', 'OK']) {
    assert.equal(normalizeSpanStatus(code), 'ok');
  }
});

test('unknown supplied status encodings fail instead of hiding errors', () => {
  for (const code of [null, '2', 'success', 3, {}, [], NaN]) {
    assert.throws(() => normalizeSpanStatus(code), /Unknown span status encoding/);
  }
});
