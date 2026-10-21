import { test, expect } from './helpers.mjs';
import { todoUI } from '../baseline-todo/todo-ui.mjs';

// Lab budgets on a loopback static page. They are far looser than production targets so
// a slow CI runner passes, and far tighter than the injected regressions so those fail.
const LCP_BUDGET_MS = 1500;
const CLS_BUDGET = 0.1;

// Largest Contentful Paint keeps updating until user input; read the latest entry.
const largestContentfulPaint = page => page.evaluate(() => new Promise(resolve => {
  let latest = null;
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) latest = { startTime: entry.startTime, element: entry.element?.outerHTML?.slice(0, 80) ?? null };
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  setTimeout(() => resolve(latest), 500);
}));

// Cumulative Layout Shift: sum of shifts not preceded by recent input, over a bounded window.
const cumulativeLayoutShift = (page, windowMs) => page.evaluate(ms => new Promise(resolve => {
  const shifts = [];
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) shifts.push({ value: entry.value, startTime: entry.startTime });
  }).observe({ type: 'layout-shift', buffered: true });
  setTimeout(() => resolve({ score: shifts.reduce((sum, shift) => sum + shift.value, 0), shifts }), ms);
}), windowMs);

test('TodoMVC paints its largest content within the lab budget', async ({ todo, page }, testInfo) => {
  await page.goto(todo.baseURL);
  await expect(page.getByRole('heading', { name: 'todos' })).toBeVisible({ timeout: 8000 });
  const lcp = await largestContentfulPaint(page);
  await testInfo.attach('lcp', { body: JSON.stringify(lcp, null, 2), contentType: 'application/json' });
  expect(lcp, 'no LCP entry was observed').not.toBeNull();
  expect(lcp.startTime).toBeGreaterThan(0);
  expect(lcp.startTime, `LCP ${Math.round(lcp.startTime)}ms for ${lcp.element}`).toBeLessThan(LCP_BUDGET_MS);
});

test('TodoMVC layout stays stable after load and while listing items', async ({ todo, page }, testInfo) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await expect(ui.input).toBeVisible();
  // CLS weights a shift by the area it moves. A small app on a wide viewport can jump a
  // long way and still score under 0.1, so the entry field is also anchored to where it
  // first rendered: no late banner or ad slot may move it without user input.
  const firstRendered = await ui.input.boundingBox();
  const settled = await cumulativeLayoutShift(page, 1500);
  await testInfo.attach('cls-after-load', { body: JSON.stringify(settled, null, 2), contentType: 'application/json' });
  expect(settled.score, JSON.stringify(settled.shifts)).toBeLessThan(CLS_BUDGET);
  expect(await ui.input.boundingBox(), 'entry field moved after first render').toEqual(firstRendered);

  // Adding rows is user-initiated; it must not shift the entry field the user is typing in.
  const before = await ui.input.boundingBox();
  await ui.add('Measure first', 'Measure second', 'Measure third');
  await expect(ui.titles).toHaveText(['Measure first', 'Measure second', 'Measure third']);
  const after = await ui.input.boundingBox();
  expect(after).toEqual(before);
});
