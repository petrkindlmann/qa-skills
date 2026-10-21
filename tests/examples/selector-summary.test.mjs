import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadFunctions } from './snippets.mjs';

const { summarizeRecovery } = loadFunctions(
  'skills/selector-drift-recovery/references/recovery-scripts.md',
  'function summarizeRecovery(', ['summarizeRecovery'], { path },
);
const row = { file: 'e2e/pay.ts', line: 12, score: 4, applied: false, rationale: 'unique role' };

test('high-scoring proposals awaiting review remain flagged', () => {
  const result = summarizeRecovery([row]);
  assert.equal(result.recovered.length, 0);
  assert.equal(result.flagged.length, 1);
});

test('applying one alternative resolves only its source location', () => {
  const result = summarizeRecovery([row, { ...row, file: './e2e/pay.ts', applied: true }, { ...row, line: 20, score: 0 }]);
  assert.equal(result.recovered.length, 1);
  assert.equal(result.flagged.length, 1);
  assert.equal(result.flagged[0].line, 20);
});

test('multiple unresolved proposals count as one source location', () => {
  assert.equal(summarizeRecovery([row, { ...row, rationale: 'unique region' }]).flagged.length, 1);
});

test('conflicting applied candidates cannot produce a success summary', () => {
  assert.throws(() => summarizeRecovery([{ ...row, applied: true }, { ...row, applied: true }]), /Multiple applied/);
});
