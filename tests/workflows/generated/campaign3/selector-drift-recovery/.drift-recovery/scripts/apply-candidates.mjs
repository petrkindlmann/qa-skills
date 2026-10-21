// Phase 5 step 1: line-anchored apply (recipe §5). For each decision: re-read the file, require the
// exact old expression at the recorded line (exactly once on that line), replace only that
// occurrence, keep the rest of the line. Sets applied:true only on the row actually written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidatesPath = path.join(root, 'candidates.json');
const rows = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

// Reviewer decisions. Score >= 3 is auto-applied per the rubric; the sub-3 rows are applied only
// as an explicit reviewer decision ("accept a manual selector update") and say why.
const decisions = [
  { line: 4, selector: "page.getByRole('list').filter({ hasNot: page.getByRole('link') })", mode: 'auto (score 3)' },
  { line: 10, selector: 'page.getByText(/^\\d+ items? left$/)', mode: 'reviewer-accepted manual update (score 2): element has no role, label or testid; the asserted property IS its text' },
  { line: 11, selector: "page.locator('section.main')", mode: 'reviewer-accepted manual update (score 1): <section> without a name has no role; class .main unchanged, renamed root dropped' },
  { line: 12, selector: "page.locator('footer.footer')", mode: 'reviewer-accepted manual update (score 1): <footer> inside <section> has no landmark role; class .footer unchanged' },
];

for (const decision of decisions) {
  const row = rows.find(r => r.line === decision.line && r.selector === decision.selector && r.source === 'inspected-adapter');
  if (!row) throw new Error(`no candidate row for line ${decision.line} ${decision.selector}`);
  if (row.score < 3 && !/reviewer-accepted/.test(decision.mode)) throw new Error(`refusing to auto-apply score ${row.score} at line ${decision.line}`);
  const file = row.file;
  if (path.resolve(file) !== path.resolve(root, '..', 'todo-ui.mjs')) throw new Error(`refusing to edit outside the suite: ${file}`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const text = lines[row.line - 1];
  const first = text.indexOf(row.oldLocator);
  if (first === -1) throw new Error(`${file}:${row.line} does not contain ${row.oldLocator} (stale target)`);
  if (text.indexOf(row.oldLocator, first + 1) !== -1) throw new Error(`${file}:${row.line} contains the old expression more than once; split before applying`);
  lines[row.line - 1] = text.slice(0, first) + row.selector + text.slice(first + row.oldLocator.length);
  fs.writeFileSync(file, lines.join('\n'));
  row.applied = true;
  row.appliedMode = decision.mode;
  row.newSourceLine = lines[row.line - 1];
  console.log(`applied ${path.basename(file)}:${row.line} [score ${row.score}] ${row.oldLocator} -> ${row.selector}`);
  console.log(`   ${decision.mode}`);
}
fs.writeFileSync(candidatesPath, JSON.stringify(rows, null, 2));
console.log(`candidates.json: ${rows.filter(r => r.applied).length} applied of ${rows.length}`);
