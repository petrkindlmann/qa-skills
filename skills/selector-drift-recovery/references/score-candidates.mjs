#!/usr/bin/env node
// Stability scorer for selector-drift-recovery.
// Reads candidates.json, prints the average score of APPLIED candidates and the
// count of applied rows below the stability floor (3). A non-zero count means a
// low-confidence selector leaked into the recovery — fix before opening the PR.
//
// Usage: node references/score-candidates.mjs .drift-recovery/candidates.json
// Exit code 1 if any applied candidate scores < 3 (so it can gate CI).

import fs from 'node:fs';
import path from 'node:path';

const FLOOR = 3;
const input = process.argv[2] || '.drift-recovery/candidates.json';

let candidates;
try {
  if (process.argv.length > 3) throw new Error('Usage: score-candidates.mjs [candidates.json]');
  const raw = fs.readFileSync(input);
  if (raw.length > 1024 * 1024) throw new Error('Candidate file exceeds 1 MiB');
  candidates = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('Expected a nonempty candidate array');
  const appliedLocations = new Set();
  for (const [index, row] of candidates.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Row ${index}: expected an object`);
    if (typeof row.applied !== 'boolean') throw new Error(`Row ${index}: applied must be boolean`);
    if (!Number.isInteger(row.score) || row.score < 0 || row.score > 5) throw new Error(`Row ${index}: score must be an integer from 0 to 5`);
    if (typeof row.file !== 'string' || !row.file.trim() || !Number.isInteger(row.line) || row.line < 1) {
      throw new Error(`Row ${index}: file and positive integer line are required`);
    }
    if (row.applied) {
      if (typeof row.selector !== 'string' || !row.selector.trim()) throw new Error(`Row ${index}: applied selector is missing`);
      const location = JSON.stringify([path.resolve(row.file), row.line]);
      if (appliedLocations.has(location)) throw new Error(`Row ${index}: multiple applied candidates target one source location`);
      appliedLocations.add(location);
    }
  }
  if (!candidates.some(row => row.applied)) throw new Error('No applied candidates to score');
} catch (e) {
  console.error(`Cannot score candidate input: ${e.message}`);
  process.exit(2);
}

const applied = candidates.filter((c) => c.applied);
const belowFloor = applied.filter((c) => c.score < FLOOR);
const avg = applied.reduce((s, c) => s + c.score, 0) / applied.length;

console.log(`applied candidates:      ${applied.length}`);
console.log(`average applied score:   ${avg.toFixed(2)}`);
console.log(`applied with score < ${FLOOR}:  ${belowFloor.length}`);
console.log(`unapplied candidates:    ${candidates.length - applied.length}`);
console.log('Scope: recorded score floor only; verify source changes, locator meaning, screenshots, and actual test results separately.');

if (belowFloor.length) {
  console.error('\nLow-confidence selectors were applied — revert these:');
  for (const c of belowFloor.slice(0, 20)) {
    console.error(`  ${JSON.stringify(c.file)}:${c.line}  score ${c.score}  ${JSON.stringify(c.selector)}`);
  }
  if (belowFloor.length > 20) console.error(`  ${belowFloor.length - 20} additional low-score rows omitted`);
  process.exit(1);
}
