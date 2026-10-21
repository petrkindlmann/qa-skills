// Page helper for the migrated TodoMVC suite. Locators are role- or text-based wherever the
// served markup exposes a role; the one CSS anchor (`.todo-list`) exists because the page has
// two unlabelled <ul> elements (the todo list and the filter bar) that both carry role=list.
import { expect } from '../../../../../support/fixtures.mjs';

export class TodoPage {
  constructor(page) {
    this.page = page;
    this.entry = page.getByRole('textbox', { name: 'What needs to be done?' });
    this.list = page.locator('.todo-list');
    this.rows = this.list.getByRole('listitem');
    // The accessible name is "❯ Mark all as complete" (CSS-generated prefix); substring match.
    this.toggleAll = page.getByRole('checkbox', { name: 'Mark all as complete' });
    this.clearCompleted = page.getByRole('button', { name: 'Clear completed' });
  }

  // Replaces the legacy beforeEach (visit + localStorage.clear() + reload). A Playwright test
  // runs in a fresh browser context, so storage is empty; the count guard proves it.
  async open(baseURL) {
    await this.page.goto(baseURL);
    await expect(this.entry).toBeVisible();
    await expect(this.rows).toHaveCount(0);
  }

  async reload() {
    await this.page.reload();
    await expect(this.entry).toBeVisible();
  }

  // Legacy: cy.get('.new-todo').type(`${title}{enter}`)
  async add(...titles) {
    for (const title of titles) {
      await this.entry.fill(title);
      await this.entry.press('Enter');
    }
  }

  row(index) {
    return this.rows.nth(index);
  }

  checkbox(index) {
    return this.row(index).getByRole('checkbox');
  }

  filter(name) {
    return this.page.getByRole('link', { name, exact: true });
  }

  // The remaining-count element has no role; its visible text is the user-facing contract.
  remaining(text) {
    return this.page.getByText(text, { exact: true });
  }

  // Legacy: find('label').dblclick(); find('.edit').clear().type('<title>{enter|esc}')
  async edit(index, currentTitle, newTitle, key) {
    const row = this.row(index);
    await row.getByText(currentTitle, { exact: true }).dblclick();
    const editor = row.getByRole('textbox');
    await editor.fill(newTitle);
    await editor.press(key);
    await expect(editor).toBeHidden();
  }

  // Legacy: find('.destroy').click({ force: true }). The × button is display:none until the
  // row is hovered, so hover first instead of forcing the click.
  async remove(index) {
    const row = this.row(index);
    await row.hover();
    await row.getByRole('button', { name: '×' }).click();
  }

  // Legacy titles() helper: exact textContent of every row, in order (deep.equal).
  // expect.poll + allTextContents keeps the raw textContent; toHaveText would normalise
  // whitespace and make the trimming assertion in the first test vacuous.
  async expectTitles(expected) {
    await expect
      .poll(() => this.rows.allTextContents(), { message: 'todo titles in order' })
      .toEqual(expected);
  }
}
