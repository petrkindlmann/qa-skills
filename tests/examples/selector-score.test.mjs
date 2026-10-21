import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.env.QA_SKILLS_ROOT ?? new URL('../../', import.meta.url).pathname;
const script = path.join(root, 'skills/selector-drift-recovery/references/score-candidates.mjs');
const good = { file: 'e2e/checkout.spec.ts', line: 12, selector: 'getByRole("button")', score: 4, applied: true };
function run(t, content, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-score-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'candidates.json');
  fs.writeFileSync(file, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  const stdoutPath = path.join(dir, 'stdout.txt'), stderrPath = path.join(dir, 'stderr.txt');
  const out = fs.openSync(stdoutPath, 'w'), err = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, [script, file, ...extra], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', out, err],
    });
  } finally { fs.closeSync(out); fs.closeSync(err); }
  assert.equal(result.error, undefined, `Scorer process failed to execute: ${result.error}`);
  return { ...result, stdout: fs.readFileSync(stdoutPath, 'utf8'), stderr: fs.readFileSync(stderrPath, 'utf8') };
}

test('recorded applied scores pass only when every score meets the floor', t => {
  const r = run(t, [good, { ...good, line: 13, score: 3 }]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /3\.50/);
});
test('a low score fails even when other high scores raise the average', t => {
  const r = run(t, [good, { ...good, line: 13, score: 5 }, { ...good, line: 14, score: 2 }]);
  assert.equal(r.status, 1, r.stderr);
});
test('empty or non-array inputs cannot report a passing gate', t => {
  for (const input of [[], {}, null, 'null']) assert.equal(run(t, input).status, 2);
});
test('malformed JSON and invalid UTF-8 are input errors', t => {
  for (const input of ['{broken', Buffer.from([0xff, 0xfe])]) assert.equal(run(t, input).status, 2);
});
test('missing applied boolean or nonnumeric scores are input errors', t => {
  for (const change of [{ applied: 'false' }, { applied: undefined }, { score: '5' }, { score: null }, { score: 9 }, { score: 3.5 }]) {
    assert.equal(run(t, [{ ...good, ...change }]).status, 2, JSON.stringify(change));
  }
});
test('invalid candidate rows and missing source coordinates cannot pass', t => {
  for (const row of ['bad', {}, { ...good, file: '' }, { ...good, line: 0 }, { ...good, selector: null }]) {
    assert.equal(run(t, [row]).status, 2, JSON.stringify(row));
  }
});
test('no applied edits is reported as unscorable rather than passing', t => {
  assert.equal(run(t, [{ ...good, applied: false }]).status, 2);
});
test('two applied candidates for the same source location are rejected', t => {
  assert.equal(run(t, [good, { ...good, file: './e2e/checkout.spec.ts' }]).status, 2);
});
test('unexpected CLI arguments cannot be silently ignored', t => {
  assert.equal(run(t, [good], ['unexpected']).status, 2);
});
