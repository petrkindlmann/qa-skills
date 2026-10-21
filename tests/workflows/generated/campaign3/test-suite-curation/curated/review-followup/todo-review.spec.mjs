import { oracle } from '../../../../../support/oracle.mjs';
import { test, expect } from '../../../../../support/fixtures.mjs';
import { todoUI } from '../baseline-todo/todo-ui.mjs';

// Review finding 2: no subsequent data mutation may save the removal for us.
test('single delete persists immediately with survivor order and completion intact', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Keep first', 'Delete second', 'Keep third', 'Keep completed');
  await expect(ui.titles).toHaveText(['Keep first', 'Delete second', 'Keep third', 'Keep completed']);
  await ui.rows.nth(3).getByRole('checkbox').check();
  await expect(ui.rows.nth(3).getByRole('checkbox')).toBeChecked();
  await expect(ui.count).toHaveText('3 items left');

  await ui.remove(1);
  await page.reload();

  await oracle('todo-removal-persistence', 'toHaveText', () => expect(ui.titles).toHaveText(['Keep first', 'Keep third', 'Keep completed']));
  await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(2).getByRole('checkbox')).toBeChecked();
  await expect(ui.count).toHaveText('2 items left');
});

test('clear completed persists immediately and preserves active titles and order', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Active first', 'Completed second', 'Active third', 'Completed fourth');
  await expect(ui.titles).toHaveText(['Active first', 'Completed second', 'Active third', 'Completed fourth']);
  await ui.rows.nth(1).getByRole('checkbox').check();
  await ui.rows.nth(3).getByRole('checkbox').check();
  await expect(ui.rows.nth(1).getByRole('checkbox')).toBeChecked();
  await expect(ui.rows.nth(3).getByRole('checkbox')).toBeChecked();
  await expect(ui.count).toHaveText('2 items left');

  await ui.clear.click();
  await page.reload();

  await expect(ui.titles).toHaveText(['Active first', 'Active third']);
  await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.count).toHaveText('2 items left');
  await expect(ui.clear).toBeHidden();
  await expect(ui.main).toBeVisible();
  await expect(ui.footer).toBeVisible();
});

test('clearing the final completed item persists the empty state immediately', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Final item');
  await expect(ui.titles).toHaveText(['Final item']);
  await ui.rows.nth(0).getByRole('checkbox').check();
  await expect(ui.rows.nth(0).getByRole('checkbox')).toBeChecked();
  await expect(ui.clear).toBeVisible();
  await expect(ui.main).toBeVisible();
  await expect(ui.footer).toBeVisible();

  await ui.clear.click();
  await page.reload();

  await expect(ui.rows).toHaveCount(0);
  await expect(ui.main).toBeHidden();
  await expect(ui.footer).toBeHidden();
  await expect(ui.input).toBeVisible();
  await expect(ui.input).toHaveValue('');
});
