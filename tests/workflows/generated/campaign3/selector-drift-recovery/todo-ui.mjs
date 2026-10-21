// Observed live DOM (redesign build): list/count/control containers still have no names or test ids.
// Role-first where a role exists (the todo list is the <ul> without filter links); the counter is
// located by its own text; .main/.footer keep their unchanged classes under the renamed root section.
export function todoUI(page) {
  const list = page.getByRole('list').filter({ hasNot: page.getByRole('link') });
  const rows = list.getByRole('listitem');
  return {
    input: page.getByPlaceholder('What needs to be done?'),
    rows,
    titles: list.locator('label'),
    count: page.getByText(/^\d+ items? left$/),
    main: page.locator('section.main'),
    footer: page.locator('footer.footer'),
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
