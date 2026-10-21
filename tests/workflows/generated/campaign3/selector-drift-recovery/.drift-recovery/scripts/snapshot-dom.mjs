// Port of references/recovery-scripts.md §1 "scripts/snapshot-dom.ts" to ESM JavaScript.
// Differences from the recipe: (1) the build is started by the lab runtime (startTodo) instead
// of a baseUrl argument; (2) TodoMVC is one route with several UI states, so the loop is keyed
// by state, not by route; (3) readiness = the entry textbox is visible (the app's own contract),
// not a data-testid="app-ready" element, which this app does not have.
// Usage: QA_TODO_FAULT=<fault|unset> node snapshot-dom.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startTodo } from '/Users/petr/projects/qa-skills/tests/workflows/support/runtime.mjs';

const { chromium } = createRequire('/Users/petr/projects/qa-skills/package.json')('@playwright/test');
const [, , outDir] = process.argv;
if (!outDir) throw new Error('usage: snapshot-dom.mjs <outDir>');
const serverDir = path.join(process.env.QA_SNAPSHOT_SERVER_DIR ?? '/private/tmp/claude-501/-Users-petr-projects-qa-skills/330613cb-1d3d-4f56-8281-040899b2df5a/scratchpad', `todo-snapshot-${process.pid}`);

const ready = async page => {
  await page.getByRole('textbox').first().waitFor({ state: 'visible' });
};
// Compact structural outline of the app subtree: tag, id, class, data-*, aria-*, role. The aria
// snapshot deliberately hides class/attribute churn, but the broken locators ARE class-based,
// so the mapping needs this view too (the recipe only keeps aria.yml + raw html).
const outline = page => page.evaluate(() => {
  const root = document.querySelector('section, main, body > *') ? document.body : document.body;
  const lines = [];
  const walk = (el, depth) => {
    if (el.nodeType !== 1) return;
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE'].includes(el.tagName)) return;
    const attrs = [...el.attributes]
      .filter(a => ['id', 'class', 'role', 'placeholder', 'type', 'for', 'href', 'autofocus'].includes(a.name) || a.name.startsWith('data-') || a.name.startsWith('aria-'))
      .map(a => `${a.name}="${a.value}"`).join(' ');
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
    const style = getComputedStyle(el);
    const hidden = style.display === 'none' || style.visibility === 'hidden' ? ' [hidden]' : '';
    lines.push(`${'  '.repeat(depth)}<${el.tagName.toLowerCase()}${attrs ? ' ' + attrs : ''}>${text ? ' "' + text + '"' : ''}${hidden}`);
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return lines.join('\n');
});

const states = {
  // Fresh context: no todos; main controls and footer hidden per contract §6.
  async empty() {},
  // Three todos, second completed: list, count, filters, clear-completed all present.
  async items(page) {
    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      const input = page.getByRole('textbox').first();
      await input.fill(title);
      await input.press('Enter');
    }
    await page.getByRole('listitem').nth(1).getByRole('checkbox').check();
  },
  // First row hovered: the per-row delete control is shown on hover in the old design.
  async hover(page) {
    await page.getByRole('listitem').first().hover();
  },
  // Editing the first row's title (dblclick on the visible title).
  async editing(page) {
    const row = page.getByRole('listitem').first();
    await row.getByText('Alpha', { exact: true }).dblclick();
    await row.getByRole('textbox').waitFor({ state: 'visible' });
  },
  async 'filter-active'(page) {
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Active', exact: true }).click();
  },
  async 'filter-completed'(page) {
    await page.getByRole('link', { name: 'Completed', exact: true }).click();
  },
};

const service = await startTodo(serverDir);
console.log(`build=${process.env.QA_TODO_FAULT ?? '(default/old)'} baseURL=${service.baseURL} outDir=${outDir}`);
try {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  fs.mkdirSync(outDir, { recursive: true });
  await page.goto(service.baseURL);
  await ready(page);
  for (const [name, arrange] of Object.entries(states)) {
    await arrange(page);
    const aria = await page.locator('body').ariaSnapshot();
    fs.writeFileSync(`${outDir}/${name}.aria.yml`, aria + '\n');
    fs.writeFileSync(`${outDir}/${name}.html`, await page.content());
    fs.writeFileSync(`${outDir}/${name}.outline.txt`, await outline(page) + '\n');
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log(`  wrote ${name}: aria ${aria.split('\n').length} lines`);
  }
  await browser.close();
} finally {
  await service.stop();
  fs.rmSync(serverDir, { recursive: true, force: true });
}
