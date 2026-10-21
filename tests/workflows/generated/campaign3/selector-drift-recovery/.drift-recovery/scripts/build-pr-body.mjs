// Port of references/recovery-scripts.md §6 "scripts/build-pr-body.ts" (types removed, paths explicit).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeRecovery } from './recovery-summary.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = JSON.parse(fs.readFileSync(path.join(root, 'candidates.json'), 'utf8'));
const { recovered, flagged } = summarizeRecovery(c);
const short = f => path.relative(path.resolve(root, '..'), f);
const perFile = Object.entries(
  recovered.reduce((m, r) => ((m[short(r.file)] ||= []).push(r), m), {})
).map(([file, rows]) =>
  `### ${file}\n| Line | Old | New | Score | Shot |\n|---|---|---|---|---|\n` +
  rows.map(r => `| ${r.line} | \`${r.oldLocator}\` | \`${r.selector}\` | ${r.score} | ![](${r.screenshotPath}) |`).join('\n')
).join('\n\n');
fs.writeFileSync(path.join(root, 'pr-body.md'), `## Trigger
<Link to refactor PR>

## Summary
- ${recovered.length} selectors recovered
- ${new Set(recovered.map(r => r.file)).size} test files updated
- ${flagged.length} flagged for manual review

## Per-file changes
${perFile}

## Flagged for review
${flagged.map(f => `- ${short(f.file)}:${f.line} — ${f.oldLocator} (${f.rationale})`).join('\n')}

## How to review
- Check each screenshot: does \`new\` point at the same element as \`old\`?
- For score-3 candidates, verify the region scope is meaningful in the new design.
- For flagged tests, decide: rewrite, delete, or accept a manual update.
`);
console.log(`recovered=${recovered.length} flagged=${flagged.length}`);
