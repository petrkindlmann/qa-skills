// Port of references/recovery-scripts.md §6 "scripts/recovery-summary.ts" (types removed).
import path from 'node:path';
export function summarizeRecovery(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([path.normalize(row.file), row.line]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const recovered = [], flagged = [];
  for (const group of groups.values()) {
    const applied = group.filter(row => row.applied === true);
    if (applied.length > 1) throw new Error('Multiple applied candidates for one source location');
    if (applied.length === 1) recovered.push(applied[0]);
    else flagged.push({ ...group[0], rationale: group.map(row => row.rationale).join('; ') });
  }
  return { recovered, flagged };
}
