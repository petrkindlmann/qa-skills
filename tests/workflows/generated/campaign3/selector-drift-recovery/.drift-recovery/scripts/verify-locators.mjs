// Phase 3 triage evidence: resolve every old helper locator and each proposed replacement on the
// LIVE build (old or new, per QA_TODO_FAULT) in three states and print match counts, tag/class
// of the match and visibility. Locator expressions are typed here, never evaluated from data.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startTodo } from '/Users/petr/projects/qa-skills/tests/workflows/support/runtime.mjs';
const { chromium } = createRequire('/Users/petr/projects/qa-skills/package.json')('@playwright/test');
const serverDir = path.join('/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad', `todo-verify-${process.pid}`);

const locators = {
  'OLD list .todo-list':            p => p.locator('.todo-list'),
  'OLD count .todo-count':          p => p.locator('.todo-count'),
  'OLD main .todoapp .main':        p => p.locator('.todoapp .main'),
  'OLD footer .todoapp .footer':    p => p.locator('.todoapp .footer'),
  'OLD input placeholder':          p => p.getByPlaceholder('What needs to be done?'),
  'OLD allCheckbox role+name':      p => p.getByRole('checkbox', { name: /Mark all as complete/ }),
  'OLD allLabel text exact':        p => p.getByText('Mark all as complete', { exact: true }),
  'OLD filter link Active':         p => p.getByRole('link', { name: 'Active', exact: true }),
  'OLD clear button':               p => p.getByRole('button', { name: /Clear completed/ }),
  'NEW? list role list (bare)':     p => p.getByRole('list'),
  'NEW list role list hasNot link': p => p.getByRole('list').filter({ hasNot: p.getByRole('link') }),
  'NEW list role list has checkbox':p => p.getByRole('list').filter({ has: p.getByRole('checkbox') }),
  'NEW list css .task-list':        p => p.locator('.task-list'),
  'NEW count text anchored':        p => p.getByText(/^\d+ items? left$/),
  'NEW count text loose':           p => p.getByText(/items? left/),
  'NEW count css .task-count':      p => p.locator('.task-count'),
  'NEW main css section.main':      p => p.locator('section.main'),
  'NEW main css .taskapp .main':    p => p.locator('.taskapp .main'),
  'NEW footer css footer.footer':   p => p.locator('footer.footer'),
  'NEW footer css .taskapp .footer':p => p.locator('.taskapp .footer'),
  'rows via hasNot-link list':      p => p.getByRole('list').filter({ hasNot: p.getByRole('link') }).getByRole('listitem'),
  'titles via hasNot-link list':    p => p.getByRole('list').filter({ hasNot: p.getByRole('link') }).locator('label'),
};
const describe = async loc => {
  const n = await loc.count();
  if (n === 0) return 'count=0';
  const parts = [];
  for (let i = 0; i < Math.min(n, 3); i++) {
    const h = loc.nth(i);
    const info = await h.evaluate(el => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''}`);
    parts.push(`${info}${await h.isVisible() ? '' : '(hidden)'}`);
  }
  return `count=${n} [${parts.join(', ')}${n > 3 ? ', …' : ''}]`;
};
const service = await startTodo(serverDir);
console.log(`build=${process.env.QA_TODO_FAULT ?? '(default/old)'} ${service.baseURL}`);
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(service.baseURL);
  await page.getByRole('textbox').first().waitFor();
  const states = {
    empty: async () => {},
    items: async () => {
      for (const t of ['Alpha', 'Beta', 'Gamma']) { const i = page.getByRole('textbox').first(); await i.fill(t); await i.press('Enter'); }
      await page.getByRole('listitem').nth(1).getByRole('checkbox').check();
    },
    'filter-active-after-complete-all': async () => {
      await page.getByText('Mark all as complete', { exact: true }).click();
      await page.getByRole('link', { name: 'Active', exact: true }).click();
    },
  };
  for (const [state, arrange] of Object.entries(states)) {
    await arrange();
    console.log(`\n## state: ${state}`);
    for (const [name, make] of Object.entries(locators)) console.log(`  ${name.padEnd(34)} ${await describe(make(page))}`);
  }
  await browser.close();
} finally { await service.stop(); fs.rmSync(serverDir, { recursive: true, force: true }); }
