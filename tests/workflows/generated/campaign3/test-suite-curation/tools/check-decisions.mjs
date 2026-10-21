// Validates decisions.mjs against the collected inventory and the hard constraint of the task:
// every clause some original test guards must still be guarded by a kept test. Emits the
// markdown tables that curation.md embeds (inventory, decisions, behaviour map, audit rows).
//
//   node tools/check-decisions.mjs <workdir>
import fs from 'node:fs';
import path from 'node:path';
import { clauses, decisions, nonTestFiles } from './decisions.mjs';

const WORK = process.argv[2];
const rows = JSON.parse(fs.readFileSync(path.join(WORK, 'inventory-rows.json'), 'utf8'));
const analysis = JSON.parse(fs.readFileSync(path.join(WORK, 'analysis.json'), 'utf8'));
const fp = JSON.parse(fs.readFileSync(path.join(WORK, 'fingerprints.json'), 'utf8'));

const key = (file, title) => `${file}\u0000${title}`;
const byKey = new Map(decisions.map(d => [key(d.file, d.title), d]));
const problems = [];
for (const r of rows) if (!byKey.has(key(r.file, r.title))) problems.push(`no decision for ${r.file}: ${r.title}`);
for (const d of decisions) if (!rows.some(r => r.file === d.file && r.title === d.title)) problems.push(`decision for a test that is not collected: ${d.file}: ${d.title}`);
if (decisions.length !== rows.length) problems.push(`decisions ${decisions.length} != collected ${rows.length}`);
for (const d of decisions) for (const c of d.clauses) if (!clauses[c]) problems.push(`unknown clause ${c} in ${d.title}`);
const KEPT = new Set(['keep', 'merge', 'rewrite']);
for (const d of decisions) if (!KEPT.has(d.disposition) && !/^(quarantine-redundant|quarantine-low-value|delete-obsolete)$/.test(d.disposition)) problems.push(`bad disposition ${d.disposition}`);
for (const d of decisions) if (d.disposition === 'quarantine-redundant' && !(d.supersededBy && d.mutationCheck && d.risk)) problems.push(`audit row incomplete for ${d.title}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

// Clause coverage before and after.
const guardedBy = {}; const keptBy = {};
for (const d of decisions) for (const c of d.clauses) { (guardedBy[c] ??= []).push(d); if (KEPT.has(d.disposition)) (keptBy[c] ??= []).push(d); }
const original = Object.keys(guardedBy).sort();
const missing = original.filter(c => !keptBy[c]);
const neverGuarded = Object.keys(clauses).filter(c => !guardedBy[c]);

// Per-test enrichment.
const enrich = d => {
  const r = rows.find(x => x.file === d.file && x.title === d.title);
  const a = analysis.tests.find(t => t.file === d.file && t.title === d.title);
  const f = fp.tests.find(t => t.file === d.file && t.title === d.title);
  return { ...d, line: r.line, app: a?.app, expects: a ? `${a.direct.expects}/${a.expanded.expects}` : '?', requests: f?.requests.length ?? '?', ms: f?.duration ?? '?', oracles: a?.oracles ?? [] };
};
const enriched = decisions.map(enrich);
let n = 0; for (const d of enriched) if (!KEPT.has(d.disposition)) d.row = `R-${String(++n).padStart(2, '0')}`;

const counts = {
  original: { tests: rows.length, files: new Set(rows.map(r => r.file)).size },
  kept: { tests: enriched.filter(d => KEPT.has(d.disposition)).length, files: new Set(enriched.filter(d => KEPT.has(d.disposition)).map(d => d.file)).size },
  byDisposition: Object.fromEntries([...new Set(enriched.map(d => d.disposition))].map(k => [k, enriched.filter(d => d.disposition === k).length])),
  byTier: Object.fromEntries([...new Set(enriched.map(d => d.tier))].map(k => [k, enriched.filter(d => d.tier === k).length])),
};

const esc = s => String(s).replace(/\|/g, '\\|');
const short = f => f.replace(/^campaign3\//, '').replace(/\.spec\.mjs$/, '');
const md = {};

md.inventory = ['| # | file:line | title | app | clauses guarded | expects (body/with helpers) | HTTP requests (trace) | ms | disposition |', '|---|---|---|---|---|---|---|---|---|',
  ...enriched.map((d, i) => `| ${i + 1} | ${short(d.file)}:${d.line} | ${esc(d.title)} | ${d.app} | ${d.clauses.join(' ') || '(credited to the baseline copy)'} | ${d.expects} | ${d.requests} | ${d.ms} | ${d.disposition}${d.row ? ' ' + d.row : ''} |`)].join('\n');

md.decisions = ['| file:line | title | disposition | tier | reason / evidence |', '|---|---|---|---|---|',
  ...enriched.map(d => `| ${short(d.file)}:${d.line} | ${esc(d.title)} | ${d.disposition}${d.row ? ' ' + d.row : ''} | ${d.tier} | ${esc(d.note || '')}${d.supersededBy ? ' Superseded by: ' + esc(d.supersededBy) + '.' : ''}${d.risk ? ' Risk: ' + esc(d.risk) + '.' : ''} |`)].join('\n');

md.audit = ['| row | test | category | reason | superseded_by | coverage_delta | mutation_check | quarantined_at | approver / approval_sha / window | restore |', '|---|---|---|---|---|---|---|---|---|---|',
  ...enriched.filter(d => d.row).map(d => `| ${d.row} | ${short(d.file)}:${d.line} ${esc(d.title)} | ${d.disposition.replace('quarantine-', '')} | ${esc(d.reason || 'every assertion this test makes is also made by the survivor, which asserts more (reading in mutation_check)')}${d.note ? '; ' + esc(d.note) : ''} | ${esc(d.supersededBy || '-')} | 0 clauses lost (behaviour map); request-set delta: see fingerprints | ${esc(d.mutationCheck || '-')} | not quarantined in the repo: the original file is untouched; omitted from curated/ (2026-10-21) | none yet: no approver named, no window served | copy tests/workflows/generated/${d.file} back, or remove the .skip in curated/ |`)].join('\n');

md.behaviourMap = ['| clause | behaviour | guarded before by | guarded after by (kept) |', '|---|---|---|---|',
  ...Object.keys(clauses).map(c => `| ${c} | ${esc(clauses[c])} | ${(guardedBy[c] || []).map(d => short(d.file) + ':' + enrich(d).line).join(', ') || '(none)'} | ${(keptBy[c] || []).map(d => short(d.file) + ':' + enrich(d).line).join(', ') || (guardedBy[c] ? '**LOST**' : '(none)')} |`)].join('\n');

md.tiers = ['| tier | tests | selection evidence |', '|---|---|---|',
  ...['smoke', 'core', 'extended', 'monitoring'].map(t => `| ${t} | ${enriched.filter(d => d.tier === t).map(d => short(d.file) + ':' + d.line).join(', ')} | see curation.md §7 |`)].join('\n');

md.nonTest = ['| file | disposition | reason | in curated/ |', '|---|---|---|---|', ...nonTestFiles.map(f => `| ${esc(f.file)} | ${f.disposition} | ${esc(f.reason)} | ${f.copied ? 'yes' : 'no'} |`)].join('\n');

md.summary = `original: ${counts.original.tests} tests in ${counts.original.files} files; kept: ${counts.kept.tests} tests in ${counts.kept.files} files; dispositions ${JSON.stringify(counts.byDisposition)}; tiers ${JSON.stringify(counts.byTier)}; clauses guarded before ${original.length}, lost after ${missing.length}${missing.length ? ' (' + missing.join(', ') + ')' : ''}; clauses never guarded by any test: ${neverGuarded.join(', ') || 'none'}`;

fs.writeFileSync(path.join(WORK, 'tables.json'), JSON.stringify({ md, counts, missing, neverGuarded, quarantined: enriched.filter(d => d.row) }, null, 1));
console.log(md.summary);
if (missing.length) { console.error('HARD CONSTRAINT VIOLATED'); process.exit(2); }
