// Phase 4 driver. Runs the recipe's proposeRecovery() AS WRITTEN for every reviewed target on the
// live new build, records what it produces, then runs an inspected adapter (the recipe says
// "Other accessible-name sources need their own inspected adapter") whose candidate expressions
// are typed here and scored on the SKILL.md rubric. Writes candidates.json (+ screenshots).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startTodo } from '/Users/petr/projects/qa-skills/tests/workflows/support/runtime.mjs';
import { generate, captureCandidate, proposeRecovery } from './recovery-candidates.mjs';
import { requireVerifiedDrift } from './failure-inventory.mjs';

const { chromium } = createRequire('/Users/petr/projects/qa-skills/package.json')('@playwright/test');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotDir = path.join(root, 'screenshots');
fs.mkdirSync(screenshotDir, { recursive: true });
const serverDir = path.join('/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad', `todo-candidates-${process.pid}`);
const { targets } = JSON.parse(fs.readFileSync(path.join(root, 'reviewed-targets.json'), 'utf8'));
targets.forEach(requireVerifiedDrift);
const rel = p => path.relative(root, p);

// Inspected adapter: role-first ladder for elements that have no accessible name. Each entry is
// (selector source expression, live locator, rubric score, rationale). Scored per SKILL.md:
// 5 testid / 4 unique role+name or label / 3 role scoped to exactly one / 2 text / 1 css.
const adapter = {
  4: page => [
    ['page.getByRole(\'list\')', page.getByRole('list'), 3, 'bare role: ambiguous if count > 1 (then NOT a 3)'],
    ['page.getByRole(\'list\').filter({ hasNot: page.getByRole(\'link\') })',
      page.getByRole('list').filter({ hasNot: page.getByRole('link') }), 3,
      'role list, scoped by structural filter (the filter list contains links, the todo list never does); unique'],
    ['page.getByRole(\'list\').filter({ has: page.getByRole(\'checkbox\') })',
      page.getByRole('list').filter({ has: page.getByRole('checkbox') }), 3,
      'role list scoped by content; rejected: resolves to 0 in an empty filtered view (verify-locators.mjs)'],
    ['page.locator(\'.task-list\')', page.locator('.task-list'), 1, 'renamed CSS class from outline diff'],
  ],
  10: page => [
    ['page.getByText(/^\\d+ items? left$/)', page.getByText(/^\d+ items? left$/), 2, 'visible text only; anchored to the counter pattern'],
    ['page.locator(\'.task-count\')', page.locator('.task-count'), 1, 'renamed CSS class from outline diff'],
  ],
  11: page => [
    ['page.locator(\'section.main\')', page.locator('section.main'), 1, 'CSS: element + unchanged class, no role/name available'],
    ['page.locator(\'.taskapp .main\')', page.locator('.taskapp .main'), 1, 'CSS: renamed root class + unchanged inner class'],
  ],
  12: page => [
    ['page.locator(\'footer.footer\')', page.locator('footer.footer'), 1, 'CSS: element + unchanged class; <footer> inside <section> has no landmark role'],
    ['page.locator(\'.taskapp .footer\')', page.locator('.taskapp .footer'), 1, 'CSS: renamed root class + unchanged inner class'],
  ],
};

const service = await startTodo(serverDir);
console.log(`build=${process.env.QA_TODO_FAULT ?? '(default/old)'} ${service.baseURL}`);
const rows = [];
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(service.baseURL);
  await page.getByRole('textbox').first().waitFor();
  // Populated state: three todos, second completed, so list/count/main/footer are all rendered.
  for (const t of ['Alpha', 'Beta', 'Gamma']) { const i = page.getByRole('textbox').first(); await i.fill(t); await i.press('Enter'); }
  await page.getByRole('listitem').nth(1).getByRole('checkbox').check();
  await page.mouse.move(0, 0);

  console.log('\n## recipe generate()/proposeRecovery() as written');
  for (const [index, target] of targets.entries()) {
    const raw = await generate(page, target.intent);
    console.log(`  ${rel(target.file)}:${target.line} intent="${target.intent.slice(0, 50)}…" generate() -> ${raw.length} candidate(s)` +
      (raw.length ? ': ' + raw.map(c => `${c.selector} [${c.score}]`).join('; ') : ''));
    const proposed = await proposeRecovery(page, target, screenshotDir, index);
    for (const p of proposed) {
      console.log(`    proposeRecovery -> score ${p.score} selector=${p.selector} rationale="${p.rationale}"`);
      rows.push({ ...p, file: target.file, source: 'recipe-generate' });
    }
  }

  console.log('\n## inspected adapter');
  for (const [index, target] of targets.entries()) {
    for (const [cIndex, [selector, locator, score, rationale]] of adapter[target.line](page).entries()) {
      const count = await locator.count();
      const effectiveScore = count === 1 ? score : 0;
      const row = { ...target, selector, score: effectiveScore, rationale: count === 1 ? rationale : `${rationale}; count=${count} so not unique -> score 0`,
        count, screenshotPath: null, applied: false, source: 'inspected-adapter' };
      if (count === 1) {
        const shot = path.join(screenshotDir, `target-${target.line}-${cIndex}.png`);
        try { Object.assign(row, await captureCandidate({ locator, selector, score: effectiveScore, rationale: row.rationale }, shot)); row.screenshotPath = rel(shot); }
        catch (error) { row.score = 0; row.rationale += `; evidence capture failed: ${String(error)}`; }
      }
      console.log(`  ${rel(target.file)}:${target.line} ${selector}  count=${count} score=${row.score}${row.screenshotPath ? ' shot=' + row.screenshotPath : ''}`);
      rows.push(row);
    }
  }
  await browser.close();
} finally { await service.stop(); fs.rmSync(serverDir, { recursive: true, force: true }); }
fs.writeFileSync(path.join(root, 'candidates.json'), JSON.stringify(rows, null, 2));
console.log(`\nwrote candidates.json: ${rows.length} rows (${rows.filter(r => r.score >= 3).length} at or above the score-3 floor)`);
