import { test, expect } from '../../support/fixtures.mjs';
import { todoUI } from './todo-ui.mjs';

// Scenario: SC-001; Requirements: REQ-1, REQ-6, REQ-8.
test('creates trimmed nonblank titles in order and clears the entry field', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await expect(ui.rows).toHaveCount(0);
  await expect(ui.main).toBeHidden();
  await expect(ui.footer).toBeHidden();
  await ui.add('   ');
  await expect(ui.rows).toHaveCount(0);
  await ui.add('  Buy café beans  ');
  await expect(ui.input).toHaveValue('');
  await expect(ui.titles).toHaveText(['Buy café beans']);
  await expect(ui.count).toHaveText('1 item left');
  await ui.add('Call Mei & book <tickets>', 'Walk the dog 🐕');
  await expect(ui.input).toHaveValue('');
  await ui.add('   ');
  await expect(ui.titles).toHaveText(['Buy café beans', 'Call Mei & book <tickets>', 'Walk the dog 🐕']);
  await expect(ui.count).toHaveText('3 items left');
  await expect(ui.clear).toBeHidden();
  await expect(ui.main).toBeVisible();
  await expect(ui.footer).toBeVisible();
});

// Scenario: SC-002; Requirements: REQ-2, REQ-3, REQ-5, REQ-6.
test('duplicate titles remain independent through complete edit and delete', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Buy milk', 'Buy milk', 'Keep receipt');
  await expect(ui.titles).toHaveText(['Buy milk', 'Buy milk', 'Keep receipt']);
  await ui.rows.nth(1).getByRole('checkbox').check();
  await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).toBeChecked();
  await expect(ui.count).toHaveText('2 items left');
  await ui.edit(1, 'Buy oat milk');
  await expect(ui.titles).toHaveText(['Buy milk', 'Buy oat milk', 'Keep receipt']);
  await expect(ui.rows.nth(1).getByRole('checkbox')).toBeChecked();
  await ui.edit(1, 'Buy milk');
  await ui.remove(1);
  await expect(ui.titles).toHaveText(['Buy milk', 'Keep receipt']);
  await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.count).toHaveText('2 items left');
});

// Scenario: SC-003; Requirements: REQ-3, REQ-4.
test('individual completion and restoration keep the active count global under filters', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Call dentist', 'Pick up parcel', 'Water plants');
  await ui.rows.nth(1).getByRole('checkbox').check();
  await ui.filter('Completed').click();
  await expect(ui.titles).toHaveText(['Pick up parcel']);
  await expect(ui.count).toHaveText('2 items left');
  await expect(ui.rows.first().getByRole('checkbox')).toBeChecked();
  // A filtered transition removes the clicked row; assert outcomes instead of check() postconditions.
  await ui.rows.first().getByRole('checkbox').click();
  await expect(ui.rows).toHaveCount(0);
  await expect(ui.count).toHaveText('3 items left');
  await expect(ui.footer).toBeVisible();
  await ui.filter('Active').click();
  await expect(ui.titles).toHaveText(['Call dentist', 'Pick up parcel', 'Water plants']);
  await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  await ui.rows.nth(0).getByRole('checkbox').click();
  await expect(ui.titles).toHaveText(['Pick up parcel', 'Water plants']);
  await expect(ui.count).toHaveText('2 items left');
  await ui.filter('All').click();
  await expect(ui.titles).toHaveText(['Call dentist', 'Pick up parcel', 'Water plants']);
  await expect(ui.rows.nth(0).getByRole('checkbox')).toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(2).getByRole('checkbox')).not.toBeChecked();
});

// Scenario: SC-004; Requirements: REQ-3, REQ-4.
test('bulk toggle affects hidden records and works from an empty filtered view', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Plan meals', 'Buy groceries', 'Cook dinner');
  await ui.rows.nth(0).getByRole('checkbox').check();
  await ui.filter('Active').click();
  await expect(ui.titles).toHaveText(['Buy groceries', 'Cook dinner']);
  await ui.allLabel.click();
  await expect(ui.rows).toHaveCount(0);
  await expect(ui.count).toHaveText('0 items left');
  await expect(ui.allCheckbox).toBeChecked();
  await ui.filter('Completed').click();
  await expect(ui.titles).toHaveText(['Plan meals', 'Buy groceries', 'Cook dinner']);
  await ui.allLabel.click();
  await expect(ui.rows).toHaveCount(0);
  await expect(ui.count).toHaveText('3 items left');
  await expect(ui.allCheckbox).not.toBeChecked();
  // No rows are currently displayed; all three must still be completed.
  await ui.allLabel.click();
  await expect(ui.titles).toHaveText(['Plan meals', 'Buy groceries', 'Cook dinner']);
  for (let i = 0; i < 3; i++) await expect(ui.rows.nth(i).getByRole('checkbox')).toBeChecked();
  await ui.allLabel.click();
  await ui.filter('All').click();
  await expect(ui.titles).toHaveText(['Plan meals', 'Buy groceries', 'Cook dinner']);
  for (let i = 0; i < 3; i++) await expect(ui.rows.nth(i).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.count).toHaveText('3 items left');
});

// Scenario: SC-005; Requirement: REQ-4.
test('filters visibly select the correct subset without losing or duplicating records', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Read chapter', 'Return book', 'Reserve sequel');
  await ui.rows.nth(1).getByRole('checkbox').check();
  for (const [name, titles] of [
    ['Active', ['Read chapter', 'Reserve sequel']],
    ['Completed', ['Return book']],
    ['All', ['Read chapter', 'Return book', 'Reserve sequel']],
  ]) {
    await ui.filter(name).click();
    await expect(ui.titles).toHaveText(titles);
    // Observed legacy UI uses selected class, not aria-current, for its visible border.
    await expect(ui.filter(name)).toHaveClass(/selected/);
    for (const other of ['All', 'Active', 'Completed'].filter(x => x !== name))
      await expect(ui.filter(other)).not.toHaveClass(/selected/);
    await expect(ui.count).toHaveText('2 items left');
  }
  await ui.rows.nth(1).getByRole('checkbox').uncheck();
  await ui.filter('Completed').click();
  await expect(ui.rows).toHaveCount(0);
  await expect(ui.footer).toBeVisible();
  await ui.filter('All').click();
  await expect(ui.titles).toHaveText(['Read chapter', 'Return book', 'Reserve sequel']);
});

// Scenario: SC-006; Requirements: REQ-5, REQ-7, REQ-8.
test('Enter and blur save edits while Escape preserves the saved title on reload', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Book train', 'Pack bag');
  await ui.rows.nth(0).getByRole('checkbox').check();
  await ui.edit(0, '  Book evening train  ');
  await expect(ui.titles).toHaveText(['Book evening train', 'Pack bag']);
  await ui.edit(1, 'Pack overnight bag', 'blur');
  await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  await ui.edit(1, 'Discard this draft', 'Escape');
  await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  await ui.edit(0, '', 'Escape');
  await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  await page.reload();
  await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  await expect(ui.rows.nth(0).getByRole('checkbox')).toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.count).toHaveText('1 item left');
});

// Scenario: SC-007; Requirements: REQ-2, REQ-5, REQ-6.
test('whitespace Enter and empty blur edits remove only their targeted records', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Check mailbox', 'Check mailbox', 'Keep stamped letter');
  await ui.rows.nth(2).getByRole('checkbox').check();
  await ui.edit(1, '   ');
  await expect(ui.titles).toHaveText(['Check mailbox', 'Keep stamped letter']);
  await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).toBeChecked();
  await ui.edit(0, '', 'blur');
  await expect(ui.titles).toHaveText(['Keep stamped letter']);
  await expect(ui.rows.first().getByRole('checkbox')).toBeChecked();
  await expect(ui.count).toHaveText('0 items left');
  await page.reload();
  await expect(ui.titles).toHaveText(['Keep stamped letter']);
});

// Scenario: SC-008; Requirements: REQ-6, REQ-8.
test('delete and clear completed preserve active rows and empty controls recover', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Keep active', 'Remove row', 'Finish report');
  await ui.rows.nth(2).getByRole('checkbox').check();
  await ui.remove(1);
  await expect(ui.titles).toHaveText(['Keep active', 'Finish report']);
  await ui.filter('Active').click();
  await ui.clear.click();
  await expect(ui.titles).toHaveText(['Keep active']);
  await expect(ui.count).toHaveText('1 item left');
  await expect(ui.clear).toBeHidden();
  await ui.filter('All').click();
  await expect(ui.titles).toHaveText(['Keep active']);
  await ui.remove(0);
  await expect(ui.rows).toHaveCount(0);
  await expect(ui.main).toBeHidden();
  await expect(ui.footer).toBeHidden();
  await ui.add('Start again');
  await expect(ui.titles).toHaveText(['Start again']);
  await expect(ui.main).toBeVisible();
  await expect(ui.footer).toBeVisible();
  await expect(ui.input).toHaveValue('');
  await expect(ui.count).toHaveText('1 item left');
  await ui.rows.first().getByRole('checkbox').check();
  await ui.clear.click();
  await expect(ui.rows).toHaveCount(0);
  await expect(ui.main).toBeHidden();
  await expect(ui.footer).toBeHidden();
});

// Scenario: SC-009; Requirements: REQ-7, REQ-8.
test('saved edits completion order and removals persist through reload and further keyboard input', async ({ page, todo }) => {
  await page.goto(todo.baseURL);
  const ui = todoUI(page);
  await ui.add('Pay rent', 'Water plants', 'Archive notes', 'Draft outline');
  await ui.edit(1, 'Water balcony plants');
  await ui.rows.nth(0).getByRole('checkbox').check();
  await ui.rows.nth(2).getByRole('checkbox').check();
  await ui.remove(3);
  await ui.clear.click();
  await ui.add('Walk dog', 'Call family');
  await ui.rows.nth(1).getByRole('checkbox').check();
  await expect(ui.titles).toHaveText(['Water balcony plants', 'Walk dog', 'Call family']);
  await page.reload();
  await expect(ui.titles).toHaveText(['Water balcony plants', 'Walk dog', 'Call family']);
  await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.rows.nth(1).getByRole('checkbox')).toBeChecked();
  await expect(ui.rows.nth(2).getByRole('checkbox')).not.toBeChecked();
  await expect(ui.count).toHaveText('2 items left');
  await ui.edit(2, 'Call parents');
  await ui.edit(0, 'Canceled after reload', 'Escape');
  await ui.add('Set alarm');
  await expect(ui.titles).toHaveText(['Water balcony plants', 'Walk dog', 'Call parents', 'Set alarm']);
  await expect(ui.count).toHaveText('3 items left');
  await expect(ui.input).toHaveValue('');
});
