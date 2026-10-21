// Observed live DOM: list/count/control containers have no names or test ids.
// CSS is limited to those stable, narrowly scoped legacy elements and title labels.
export function todoUI(page) {
  const list = page.locator('.todo-list');
  const rows = list.getByRole('listitem');
  return {
    input: page.getByPlaceholder('What needs to be done?'),
    rows,
    titles: list.locator('label'),
    count: page.locator('.todo-count'),
    main: page.locator('.todoapp .main'),
    footer: page.locator('.todoapp .footer'),
    allCheckbox: page.getByRole('checkbox', { name: /Mark all as complete/ }),
    // Click the visible label: the native global checkbox is visually hidden.
    allLabel: page.getByText('Mark all as complete', { exact: true }),
    filter: name => page.getByRole('link', { name, exact: true }),
    clear: page.getByRole('button', { name: /Clear completed/ }),
    async add(...titles) {
      for (const title of titles) {
        await this.input.fill(title);
        await this.input.press('Enter');
      }
    },
    async edit(index, value, key = 'Enter') {
      const row = rows.nth(index); // Position deliberately identifies equal-title records.
      await row.locator('label').dblclick();
      const input = row.getByRole('textbox');
      await input.fill(value);
      if (key === 'blur') await this.input.click();
      else await input.press(key);
    },
    async remove(index) {
      const row = rows.nth(index);
      await row.hover();
      await row.getByRole('button').click(); // The sole row button is unnamed in actual DOM.
    },
  };
}
