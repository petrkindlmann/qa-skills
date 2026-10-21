import { test, expect, checkAccessibility, scanAccessibility } from './helpers.mjs';
import { todoUI } from '../baseline-todo/todo-ui.mjs';

// Scan every reachable state, not only the default load: sign-in, signed-in account, reset form.
test('Shop sign-in, account and reset pages have no WCAG 2.2 AA violations', async ({ app, page }, testInfo) => {
  await page.goto(app.baseURL);
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  await checkAccessibility(page, testInfo, { label: 'sign-in' });

  await page.getByLabel('Email', { exact: true }).fill(app.users.alice.email);
  await page.getByLabel('Password', { exact: true }).fill(app.users.alice.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(`Signed in as ${app.users.alice.email}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
  await checkAccessibility(page, testInfo, { label: 'account' });

  await page.goto(`${app.baseURL}/reset-password?token=not-a-real-token`);
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  await checkAccessibility(page, testInfo, { label: 'reset' });
});

test('Shop sign-in completes through the keyboard alone in document order', async ({ app, page }) => {
  await page.goto(app.baseURL);
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  const focusedName = () => page.evaluate(() => {
    const element = document.activeElement;
    const label = element?.closest('label');
    return (label ? label.textContent : element?.textContent ?? '').trim();
  });

  await page.keyboard.press('Tab');
  expect(await focusedName()).toBe('Email');
  await page.keyboard.type(app.users.alice.email);
  await page.keyboard.press('Tab');
  expect(await focusedName()).toBe('Password');
  await page.keyboard.type(app.users.alice.password);
  await page.keyboard.press('Tab');
  expect(await focusedName()).toBe('Sign in');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('status')).toHaveText('Signed in.');
  await expect(page.getByText(`Signed in as ${app.users.alice.email}`)).toBeVisible();
  // The focused control after submission must still be visible to a keyboard user.
  const stillVisible = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return true;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  });
  expect(stillVisible).toBe(true);
});

// The pinned upstream TodoMVC promises no WCAG conformance. Record its real gaps as an
// explicit baseline so a new rule failing, or a fixed one, changes this test.
const upstreamRowGaps = ['button-name', 'label'];

test('TodoMVC empty state is clean and populated rows expose only the documented upstream gaps', async ({ todo, page }, testInfo) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await expect(ui.input).toBeVisible();
  await checkAccessibility(page, testInfo, { label: 'todo-empty' });

  await ui.add('Review the scan', 'Fix the row controls');
  await expect(ui.titles).toHaveText(['Review the scan', 'Fix the row controls']);
  await ui.rows.nth(1).getByRole('checkbox').check();
  const violations = await scanAccessibility(page, testInfo, { label: 'todo-populated' });
  expect([...new Set(violations.map(v => v.rule))].sort(), JSON.stringify(violations, null, 2)).toEqual(upstreamRowGaps);
  for (const violation of violations) {
    // Each documented gap is a row control, never the entry field or the filters.
    expect(violation.elements.every(html => /class="(toggle|destroy)"/.test(html)), `${violation.rule}: ${violation.elements}`).toBe(true);
  }
});
