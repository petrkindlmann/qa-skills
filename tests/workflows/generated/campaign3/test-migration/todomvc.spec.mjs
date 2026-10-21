// Migrated from legacy/todomvc.cy.js (Cypress 12). Test names are kept verbatim so the
// parity sheet in migration-map.md maps one to one.
import { test as base, expect } from '../../../support/fixtures.mjs';
import { TodoPage } from './todo-page.mjs';
import { oracle } from '../../../support/oracle.mjs';

const test = base.extend({
  todoPage: async ({ page, todo }, use) => {
    const app = new TodoPage(page);
    await app.open(todo.baseURL);
    await use(app);
  },
});

test.describe('TodoMVC (migrated from the legacy Cypress suite)', () => {
  test('creates trimmed non-blank titles in order and clears the entry field', async ({ todoPage: app }) => {
    await app.add('   ');
    await expect(app.rows).toHaveCount(0);
    await app.add('  Buy café beans  ', 'Call Mei & book <tickets>');
    await expect(app.entry).toHaveValue('');
    await app.expectTitles(['Buy café beans', 'Call Mei & book <tickets>']);
    await expect(app.remaining('2 items left')).toBeVisible();
  });

  test('duplicate titles remain independent through complete, edit and delete', async ({ todoPage: app }) => {
    await app.add('Buy milk', 'Buy milk', 'Keep receipt');
    await app.checkbox(1).check();
    await expect(app.checkbox(0)).not.toBeChecked();
    await expect(app.remaining('2 items left')).toBeVisible();
    await app.edit(1, 'Buy milk', 'Buy oat milk', 'Enter');
    await expect(app.row(1)).toHaveText('Buy oat milk');
    await app.remove(1);
    await oracle('c3-mig-duplicates', 'toEqual', () => app.expectTitles(['Buy milk', 'Keep receipt']));
    await expect(app.remaining('2 items left')).toBeVisible();
  });

  test('filters visibly select the correct subset', async ({ todoPage: app }) => {
    await app.add('Read chapter', 'Return book', 'Reserve sequel');
    await app.checkbox(1).check();
    await app.filter('Active').click();
    await oracle('c3-mig-filter', 'toEqual', () => app.expectTitles(['Read chapter', 'Reserve sequel']));
    await expect(app.filter('Active')).toContainClass('selected');
    await app.filter('Completed').click();
    await app.expectTitles(['Return book']);
    await app.filter('All').click();
    await expect(app.rows).toHaveCount(3);
    await expect(app.remaining('2 items left')).toBeVisible();
  });

  test('Enter saves an edit and Escape preserves the saved title', async ({ todoPage: app }) => {
    await app.add('Book train', 'Pack bag');
    await app.edit(0, 'Book train', 'Book evening train', 'Enter');
    await expect(app.row(0)).toHaveText('Book evening train');
    await app.edit(1, 'Pack bag', 'Discard this draft', 'Escape');
    await oracle('c3-mig-cancel', 'toHaveText', () => expect(app.row(1)).toHaveText('Pack bag'));
    await app.reload();
    await app.expectTitles(['Book evening train', 'Pack bag']);
  });

  test('items and their completion persist through reload', async ({ todoPage: app }) => {
    await app.add('Water plants', 'Call dentist');
    await app.checkbox(0).check();
    await app.reload();
    await oracle('c3-mig-persistence', 'toHaveCount', () => expect(app.rows).toHaveCount(2));
    await expect(app.checkbox(0)).toBeChecked();
    await expect(app.checkbox(1)).not.toBeChecked();
    await expect(app.remaining('1 item left')).toBeVisible();
  });

  test('a deleted item stays deleted after reload', async ({ todoPage: app }) => {
    await app.add('Keep me', 'Delete me');
    await app.remove(1);
    await expect(app.rows).toHaveCount(1);
    await app.reload();
    await app.expectTitles(['Keep me']);
  });

  test('mark-all completes and restores every item', async ({ todoPage: app }) => {
    await app.add('Plan meals', 'Buy groceries', 'Cook dinner');
    await app.toggleAll.check();
    const boxes = app.list.getByRole('checkbox');
    await expect(boxes).toHaveCount(3);
    for (const box of await boxes.all()) await expect(box).toBeChecked();
    await expect(app.remaining('0 items left')).toBeVisible();
    await expect(app.clearCompleted).toBeVisible();
    await app.toggleAll.uncheck();
    await expect(boxes).toHaveCount(3);
    for (const box of await boxes.all()) await expect(box).not.toBeChecked();
    await expect(app.remaining('3 items left')).toBeVisible();
  });
});
