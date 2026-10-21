import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '../../../../../support/fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Shared capture options. The lab config is read-only, so the global
// expect.toHaveScreenshot block the skill recommends lives here instead.
// Strict by design: one machine, one Chromium, no webfonts, so any pixel is a change.
export const VISUAL = {
  animations: 'disabled',
  caret: 'hide',
  stylePath: path.join(here, 'screenshot.css'),
  maxDiffPixels: 0,
};

// The mixed seed every filter view and the mobile test share: three items, the middle one done.
export const MIXED = { titles: ['Buy milk', 'Walk the dog', 'Read a book'], completedIndex: 1 };

export async function openTodo(page, todo) {
  await page.goto(`${todo.baseURL}/`);
  await expect(page.locator('.new-todo')).toBeVisible();
}

export async function addTodos(page, titles) {
  const input = page.locator('.new-todo');
  for (const title of titles) {
    await input.fill(title);
    await input.press('Enter');
  }
  await expect(page.locator('.todo-list li')).toHaveCount(titles.length);
  await expect(page.locator('.todo-list li label')).toHaveText(titles);
}

export async function seedMixed(page, todo) {
  await openTodo(page, todo);
  await addTodos(page, MIXED.titles);
  const row = page.locator('.todo-list li').nth(MIXED.completedIndex);
  await row.locator('.toggle').check();
  await expect(row).toHaveClass(/completed/);
  await expect(page.locator('.todo-count')).toHaveText(`${MIXED.titles.length - 1} items left`);
}

// Remove the traces of how a state was reached. The pointer rests on whatever was
// clicked last (TodoMVC reveals the delete control and recolours filter links on hover)
// and the clicked control keeps focus (a red box-shadow). Neither is part of the state.
export async function settle(page, { keepFocus = false, keepPointer = false } = {}) {
  if (!keepFocus) await page.evaluate(() => document.activeElement?.blur());
  if (!keepPointer) await page.mouse.move(0, 0);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
}
