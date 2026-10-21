// Phase 3 manual triage: turns the collector's attempts into reviewed recovery targets.
// Evidence used: failure-inventory.json (reporter), error-context.md attachments, the helper
// source, old/new outline snapshots, and verify-locators.mjs live counts on both builds.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireVerifiedDrift } from './failure-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.resolve(root, '..', 'todo-ui.mjs');
const source = fs.readFileSync(helper, 'utf8').split('\n');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'failure-inventory.json'), 'utf8'));

const liveEvidence = 'verify-locators.mjs on QA_TODO_FAULT=redesign-classes: count=0 in empty, items and filtered states; ' +
  'same expression count=1 on the default (old) build; outline diff old/items.outline.txt vs new/items.outline.txt shows the class rename';
const targets = [
  { line: 4, oldLocator: "page.locator('.todo-list')", column: 16,
    intent: 'the todo list container (<ul>) whose list items are the todo rows; rows and titles derive from it',
    triageEvidence: 'All 9 retained attempts render this locator ("waiting for locator(\'.todo-list\')…", 0 elements); ' +
      'error-context aria snapshot shows the list with the expected rows present under a renamed class ul.task-list. ' + liveEvidence },
  { line: 10, oldLocator: "page.locator('.todo-count')", column: 12,
    intent: 'the remaining-active counter element whose text is "N item(s) left"',
    triageEvidence: 'Latent: not in the failure report because every test aborted earlier on the list. Found by inspecting the helper source; ' +
      'new build renders <span class="task-count">. ' + liveEvidence },
  { line: 11, oldLocator: "page.locator('.todoapp .main')", column: 11,
    intent: 'the main section (toggle-all control + list) that is hidden when no todos exist and visible otherwise',
    triageEvidence: 'Latent: toBeHidden() passed vacuously on 0 elements (SC-001 line 10) and no test reached toBeVisible(). ' +
      'Root section renamed .todoapp -> .taskapp; inner .main unchanged. ' + liveEvidence },
  { line: 12, oldLocator: "page.locator('.todoapp .footer')", column: 13,
    intent: 'the app footer (count, filter links, Clear completed) that is hidden when no todos exist and visible otherwise',
    triageEvidence: 'Latent, same mechanism as line 11. Root section renamed .todoapp -> .taskapp; inner .footer unchanged. ' + liveEvidence },
];

// The exact old expression must still be at the recorded line before it becomes an edit target.
for (const t of targets) {
  const text = source[t.line - 1] ?? '';
  if (!text.includes(t.oldLocator)) throw new Error(`${helper}:${t.line} no longer contains ${t.oldLocator}`);
  if (text.indexOf(t.oldLocator) + 1 !== t.column) throw new Error(`${helper}:${t.line} column mismatch (${text.indexOf(t.oldLocator) + 1})`);
}

const attempts = inventory.attempts.map(a => {
  const message = a.reporterResult.error?.message ?? '';
  const rendered = (message.match(/(?:waiting for|Locator:) (locator\('\.todo-list'\)[^\n]*)/) ?? [])[1] ?? null;
  return {
    attemptId: a.attemptId, testTitle: a.testTitle, status: a.status, retry: a.retry,
    reporterLocation: a.reporterResult.error?.location ?? null,
    renderedLocatorInError: rendered,
    triage: 'confirmed-selector-drift',
    recoveryTarget: `${path.relative(root, helper)}:4`,
    triageEvidence: 'Reporter location is the failing spec/POM line, not the locator definition; the rendered locator in the error is ' +
      'the POM list locator defined at todo-ui.mjs:4. Application state at failure (error-context.md) shows the expected rows present.',
  };
});
const reviewed = targets.map(t => ({
  attemptId: attempts.map(a => a.attemptId).join(','), // every attempt is evidence for the shared root cause
  file: helper, line: t.line, column: t.column, oldLocator: t.oldLocator, intent: t.intent, pageRoute: '/',
  triage: 'confirmed-selector-drift', triageEvidence: t.triageEvidence,
  foundBy: t.line === 4 ? 'failure report + source' : 'source inspection + live check (latent, not in report)',
}));

// Gate: known-good rows pass, deliberately incomplete rows are rejected.
for (const row of reviewed) { requireVerifiedDrift(row); console.log(`gate OK   ${path.basename(row.file)}:${row.line} ${row.oldLocator}`); }
const negatives = [
  ['triage unreviewed', { ...reviewed[0], triage: 'unreviewed' }],
  ['intent null', { ...reviewed[0], intent: null }],
  ['line 0', { ...reviewed[0], line: 0 }],
];
for (const [label, row] of negatives) {
  try { requireVerifiedDrift(row); throw new Error(`negative control "${label}" was accepted`); }
  catch (e) { if (/negative control/.test(e.message)) throw e; console.log(`gate REJECTS ${label}: ${e.message}`); }
}
fs.writeFileSync(path.join(root, 'reviewed-targets.json'), JSON.stringify({ attempts, targets: reviewed }, null, 2));
console.log(`wrote reviewed-targets.json: ${attempts.length} attempts -> ${reviewed.length} targets`);
