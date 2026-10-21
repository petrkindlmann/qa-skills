// Builds curated/ from decisions.mjs: copies kept specs and the helpers, recordings and
// snapshots they need, rewrites the lab-support import depth, and turns each quarantined test
// in a partially kept file into test.skip with its audit row (destructive-safety.md step 1).
// Whole-file duplicates are not copied; their original folder is the quarantine location.
//
//   node tools/build-curated.mjs <workdir>
import fs from 'node:fs';
import path from 'node:path';
import { decisions } from './decisions.mjs';

const GENERATED = '/Users/petr/projects/qa-skills/tests/workflows/generated';
const WORKFLOWS = '/Users/petr/projects/qa-skills/tests/workflows';
const CUR = path.join(GENERATED, 'campaign3/test-suite-curation/curated');
const WORK = process.argv[2];
const tables = JSON.parse(fs.readFileSync(path.join(WORK, 'tables.json'), 'utf8'));

fs.rmSync(CUR, { recursive: true, force: true });
fs.mkdirSync(CUR, { recursive: true });

// source (relative to generated/) -> destination (relative to curated/). Suites are flattened one
// level (campaign3/<suite> -> <suite>) so the three cross-suite imports keep working as siblings.
const manifest = [
  ['baseline-shop/shop.spec.mjs'], ['baseline-shop/helpers.mjs'],
  ['baseline-todo/todomvc.spec.mjs'],
  ['campaign3/selector-drift-recovery/todo-ui.mjs', 'baseline-todo/todo-ui.mjs'],
  ['review-followup/shop-review.spec.mjs'], ['review-followup/todo-review.spec.mjs'], ['review-followup/helpers.mjs'],
  ['addons/accessibility.spec.mjs'], ['addons/database.spec.mjs'], ['addons/performance.spec.mjs'], ['addons/security.spec.mjs'], ['addons/helpers.mjs'],
  ['campaign3/analytics-tracking-testing/login-events.spec.mjs'], ['campaign3/analytics-tracking-testing/purchase-events.spec.mjs'],
  ['campaign3/analytics-tracking-testing/helpers/datalayer.mjs'], ['campaign3/analytics-tracking-testing/helpers/plan.mjs'],
  ['campaign3/analytics-tracking-testing/helpers/shop.mjs'], ['campaign3/analytics-tracking-testing/helpers/validate.mjs'],
  ['campaign3/analytics-tracking-testing/tracking-plan.json'], ['campaign3/analytics-tracking-testing/selfcheck-validator.mjs'],
  ['campaign3/bug-reproduction/report-1-session-revocation.spec.mjs'], ['campaign3/bug-reproduction/report-2-idempotency-conflict.spec.mjs'],
  ['campaign3/bug-reproduction/helpers.mjs'], ['campaign3/bug-reproduction/oracle-sensitivity.mjs'],
  ['campaign3/service-virtualization/stub-fidelity.spec.mjs'], ['campaign3/service-virtualization/virtualized-ui.spec.mjs'],
  ['campaign3/service-virtualization/cassette.mjs'], ['campaign3/service-virtualization/scenario.mjs'], ['campaign3/service-virtualization/virtual-api.mjs'], ['campaign3/service-virtualization/record.mjs'],
  ...fs.readdirSync(path.join(GENERATED, 'campaign3/service-virtualization/recordings')).map(f => [`campaign3/service-virtualization/recordings/${f}`]),
  ['campaign3/synthetic-monitoring/health.probe.spec.mjs'], ['campaign3/synthetic-monitoring/order-journey.probe.spec.mjs'], ['campaign3/synthetic-monitoring/password-reset-email.probe.spec.mjs'],
  ['campaign3/synthetic-monitoring/sign-in.probe.spec.mjs'], ['campaign3/synthetic-monitoring/storefront.probe.spec.mjs'],
  ['campaign3/synthetic-monitoring/probe-support.mjs'], ['campaign3/synthetic-monitoring/probes.mjs'],
  ['campaign3/test-migration/todomvc.spec.mjs'], ['campaign3/test-migration/todo-page.mjs'],
  ['campaign3/visual-testing/todomvc-visual.spec.mjs'], ['campaign3/visual-testing/visual-helpers.mjs'], ['campaign3/visual-testing/screenshot.css'],
  ...fs.readdirSync(path.join(GENERATED, 'campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots')).map(f => [`campaign3/visual-testing/todomvc-visual.spec.mjs-snapshots/${f}`]),
];

const quarantined = tables.quarantined.filter(d => d.disposition !== 'delete-obsolete');
const log = [];
for (const [src, destRel = src.replace(/^campaign3\//, '')] of manifest) {
  const from = path.join(GENERATED, src), to = path.join(CUR, destRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!/\.(mjs|js)$/.test(src)) { fs.copyFileSync(from, to); log.push({ src, dest: destRel, changes: [] }); continue; }
  let text = fs.readFileSync(from, 'utf8');
  const changes = [];
  // 1. lab-support imports: recompute the depth from the destination.
  const up = path.relative(path.dirname(to), WORKFLOWS).split(path.sep).join('/');
  text = text.replace(/(['"])((?:\.\.\/)+)support\//g, (m, q, dots) => { if (dots !== `${up}/`) changes.push(`support import ${dots}support/ -> ${up}/support/`); return `${q}${up}/support/`; });
  // 2. quarantined tests in this file become test.skip with the audit row.
  for (const d of quarantined.filter(d => d.file === src)) {
    const needle = `test('${d.title}', async`;
    const count = text.split(needle).length - 1;
    if (count !== 1) throw new Error(`expected exactly one declaration of "${d.title}" in ${src}, found ${count}`);
    const description = `${d.row} ${d.disposition}: superseded by ${d.supersededBy}. Restore: remove .skip here or copy tests/workflows/generated/${src}`;
    text = text.replace(needle, `test.skip('${d.title}', { annotation: { type: 'curation', description: ${JSON.stringify(description)} } }, async`);
    changes.push(`${d.row}: test.skip "${d.title}"`);
  }
  fs.writeFileSync(to, text);
  log.push({ src, dest: destRel, changes });
}

const expectedSkips = quarantined.filter(d => manifest.some(([src]) => src === d.file)).length;
const md = ['# curated/ manifest', '', `Built 2026-10-21 by tools/build-curated.mjs from decisions.mjs. ${manifest.length} files copied; ${expectedSkips} tests quarantined in place with test.skip; whole-file duplicates (campaign3/selector-drift-recovery/todomvc.spec.mjs, baseline-shop/probe.mjs) not copied.`, '',
  'Run from the repo root:', '```', 'QA_WORKFLOW_SUITE=/Users/petr/projects/qa-skills/tests/workflows/generated/campaign3/test-suite-curation/curated QA_WORKFLOW_OUTPUT=<out> node node_modules/playwright/cli.js test --config tests/workflows/playwright.config.mjs --workers 2', '```', '',
  '| source (tests/workflows/generated/) | destination (curated/) | changes |', '|---|---|---|',
  ...log.map(l => `| ${l.src} | ${l.dest} | ${l.changes.join('; ') || 'byte-identical copy'} |`)];
fs.writeFileSync(path.join(CUR, 'MANIFEST.md'), md.join('\n') + '\n');
console.log(`copied ${manifest.length} files into ${CUR}; ${log.filter(l => l.changes.length).length} with changes; ${expectedSkips} test.skip insertions`);
