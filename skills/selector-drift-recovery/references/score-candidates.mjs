#!/usr/bin/env node
// Stability scorer for selector-drift-recovery.
// Reads candidates.json, prints the average score of APPLIED candidates and the
// count of applied rows below the stability floor (3). A non-zero count means a
// low-confidence selector leaked into the recovery — fix before opening the PR.
//
// Usage: node references/score-candidates.mjs .drift-recovery/candidates.json
// Exit code 1 if any applied candidate scores < 3 (so it can gate CI).

import fs from 'node:fs';

const FLOOR = 3;
const path = process.argv[2] || '.drift-recovery/candidates.json';

let candidates;
try {
  candidates = JSON.parse(fs.readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${path}: ${e.message}`);
  process.exit(2);
}

const applied = candidates.filter((c) => c.applied);
const belowFloor = applied.filter((c) => (c.score ?? 0) < FLOOR);
const avg = applied.length
  ? applied.reduce((s, c) => s + (c.score ?? 0), 0) / applied.length
  : 0;

console.log(`applied candidates:      ${applied.length}`);
console.log(`average applied score:   ${avg.toFixed(2)}`);
console.log(`applied with score < ${FLOOR}:  ${belowFloor.length}`);

if (belowFloor.length) {
  console.error('\nLow-confidence selectors were applied — revert these:');
  for (const c of belowFloor) {
    console.error(`  ${c.file}:${c.line}  score ${c.score}  ${c.selector ?? '(none)'}`);
  }
  process.exit(1);
}
