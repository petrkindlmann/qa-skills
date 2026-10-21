// Port of references/recovery-scripts.md §3 "scripts/identify-drift.ts" (paths made explicit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFailureInventory } from './failure-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(path.join(root, 'results.json')));
const inventory = collectFailureInventory(JSON.parse(raw));
fs.writeFileSync(path.join(root, 'failure-inventory.json'), JSON.stringify(inventory, null, 2));
console.log(`Observed ${inventory.observedResults} results; retained ${inventory.attempts.length} failed/incomplete attempts ` +
  `and ${inventory.runErrors.length} run-level errors. Manual triage is still required.`);
