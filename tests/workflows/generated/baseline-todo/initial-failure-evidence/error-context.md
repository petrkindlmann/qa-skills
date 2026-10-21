# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: todomvc.spec.mjs >> individual completion and restoration keep the active count global under filters
- Location: tests/workflows/generated/baseline-todo/todomvc.spec.mjs:49:1

# Error details

```
TimeoutError: locator.uncheck: Timeout 8000ms exceeded.
Call log:
  - waiting for locator('.todo-list').getByRole('listitem').first().getByRole('checkbox')
    - locator resolved to <input checked class="toggle" type="checkbox"/>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling
    - performing click action
    - click action done
    - waiting for scheduled navigations to finish
    - navigations have finished

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - heading "todos" [level=1] [ref=e4]
      - textbox "What needs to be done?" [ref=e5]
    - generic [ref=e6]:
      - checkbox "❯ Mark all as complete" [ref=e7]
      - generic [ref=e8]: ❯ Mark all as complete
      - list
    - generic [ref=e9]:
      - generic [ref=e10]:
        - strong [ref=e11]: "3"
        - text: items left
      - list [ref=e12]:
        - listitem [ref=e13]:
          - link "All" [ref=e14] [cursor=pointer]:
            - /url: "#/"
        - listitem [ref=e15]:
          - link "Active" [ref=e16] [cursor=pointer]:
            - /url: "#/active"
        - listitem [ref=e17]:
          - link "Completed" [ref=e18] [cursor=pointer]:
            - /url: "#/completed"
  - contentinfo [ref=e19]:
    - paragraph [ref=e20]: Double-click to edit a todo
    - paragraph [ref=e21]:
      - text: Created by
      - link "Oscar Godson" [ref=e22] [cursor=pointer]:
        - /url: http://twitter.com/oscargodson
    - paragraph [ref=e23]:
      - text: Refactored by
      - link "Christoph Burgmer" [ref=e24] [cursor=pointer]:
        - /url: https://github.com/cburgmer
    - paragraph [ref=e25]:
      - text: Part of
      - link "TodoMVC" [ref=e26] [cursor=pointer]:
        - /url: http://todomvc.com
```

# Test source

```ts
  1   | import { test, expect } from '../../support/fixtures.mjs';
  2   | import { todoUI } from './todo-ui.mjs';
  3   | 
  4   | // Scenario: SC-001; Requirements: REQ-1, REQ-6, REQ-8.
  5   | test('creates trimmed nonblank titles in order and clears the entry field', async ({ page, todo }) => {
  6   |   await page.goto(todo.baseURL);
  7   |   const ui = todoUI(page);
  8   |   await expect(ui.rows).toHaveCount(0);
  9   |   await expect(ui.main).toBeHidden();
  10  |   await expect(ui.footer).toBeHidden();
  11  |   await ui.add('   ');
  12  |   await expect(ui.rows).toHaveCount(0);
  13  |   await ui.add('  Buy café beans  ');
  14  |   await expect(ui.input).toHaveValue('');
  15  |   await expect(ui.titles).toHaveText(['Buy café beans']);
  16  |   await expect(ui.count).toHaveText('1 item left');
  17  |   await ui.add('Call Mei & book <tickets>', 'Walk the dog 🐕');
  18  |   await expect(ui.input).toHaveValue('');
  19  |   await ui.add('   ');
  20  |   await expect(ui.titles).toHaveText(['Buy café beans', 'Call Mei & book <tickets>', 'Walk the dog 🐕']);
  21  |   await expect(ui.count).toHaveText('3 items left');
  22  |   await expect(ui.clear).toBeHidden();
  23  |   await expect(ui.main).toBeVisible();
  24  |   await expect(ui.footer).toBeVisible();
  25  | });
  26  | 
  27  | // Scenario: SC-002; Requirements: REQ-2, REQ-3, REQ-5, REQ-6.
  28  | test('duplicate titles remain independent through complete edit and delete', async ({ page, todo }) => {
  29  |   await page.goto(todo.baseURL);
  30  |   const ui = todoUI(page);
  31  |   await ui.add('Buy milk', 'Buy milk', 'Keep receipt');
  32  |   await expect(ui.titles).toHaveText(['Buy milk', 'Buy milk', 'Keep receipt']);
  33  |   await ui.rows.nth(1).getByRole('checkbox').check();
  34  |   await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  35  |   await expect(ui.rows.nth(1).getByRole('checkbox')).toBeChecked();
  36  |   await expect(ui.count).toHaveText('2 items left');
  37  |   await ui.edit(1, 'Buy oat milk');
  38  |   await expect(ui.titles).toHaveText(['Buy milk', 'Buy oat milk', 'Keep receipt']);
  39  |   await expect(ui.rows.nth(1).getByRole('checkbox')).toBeChecked();
  40  |   await ui.edit(1, 'Buy milk');
  41  |   await ui.remove(1);
  42  |   await expect(ui.titles).toHaveText(['Buy milk', 'Keep receipt']);
  43  |   await expect(ui.rows.nth(0).getByRole('checkbox')).not.toBeChecked();
  44  |   await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  45  |   await expect(ui.count).toHaveText('2 items left');
  46  | });
  47  | 
  48  | // Scenario: SC-003; Requirements: REQ-3, REQ-4.
  49  | test('individual completion and restoration keep the active count global under filters', async ({ page, todo }) => {
  50  |   await page.goto(todo.baseURL);
  51  |   const ui = todoUI(page);
  52  |   await ui.add('Call dentist', 'Pick up parcel', 'Water plants');
  53  |   await ui.rows.nth(1).getByRole('checkbox').check();
  54  |   await ui.filter('Completed').click();
  55  |   await expect(ui.titles).toHaveText(['Pick up parcel']);
  56  |   await expect(ui.count).toHaveText('2 items left');
> 57  |   await ui.rows.first().getByRole('checkbox').uncheck();
      |                                               ^ TimeoutError: locator.uncheck: Timeout 8000ms exceeded.
  58  |   await expect(ui.rows).toHaveCount(0);
  59  |   await expect(ui.count).toHaveText('3 items left');
  60  |   await expect(ui.footer).toBeVisible();
  61  |   await ui.filter('Active').click();
  62  |   await expect(ui.titles).toHaveText(['Call dentist', 'Pick up parcel', 'Water plants']);
  63  |   await ui.rows.nth(0).getByRole('checkbox').check();
  64  |   await expect(ui.titles).toHaveText(['Pick up parcel', 'Water plants']);
  65  |   await expect(ui.count).toHaveText('2 items left');
  66  |   await ui.filter('All').click();
  67  |   await expect(ui.titles).toHaveText(['Call dentist', 'Pick up parcel', 'Water plants']);
  68  |   await expect(ui.rows.nth(0).getByRole('checkbox')).toBeChecked();
  69  |   await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  70  |   await expect(ui.rows.nth(2).getByRole('checkbox')).not.toBeChecked();
  71  | });
  72  | 
  73  | // Scenario: SC-004; Requirements: REQ-3, REQ-4.
  74  | test('bulk toggle affects hidden records and works from an empty filtered view', async ({ page, todo }) => {
  75  |   await page.goto(todo.baseURL);
  76  |   const ui = todoUI(page);
  77  |   await ui.add('Plan meals', 'Buy groceries', 'Cook dinner');
  78  |   await ui.rows.nth(0).getByRole('checkbox').check();
  79  |   await ui.filter('Active').click();
  80  |   await expect(ui.titles).toHaveText(['Buy groceries', 'Cook dinner']);
  81  |   await ui.allLabel.click();
  82  |   await expect(ui.rows).toHaveCount(0);
  83  |   await expect(ui.count).toHaveText('0 items left');
  84  |   await expect(ui.allCheckbox).toBeChecked();
  85  |   await ui.filter('Completed').click();
  86  |   await expect(ui.titles).toHaveText(['Plan meals', 'Buy groceries', 'Cook dinner']);
  87  |   await ui.allLabel.click();
  88  |   await expect(ui.rows).toHaveCount(0);
  89  |   await expect(ui.count).toHaveText('3 items left');
  90  |   await expect(ui.allCheckbox).not.toBeChecked();
  91  |   // No rows are currently displayed; all three must still be completed.
  92  |   await ui.allLabel.click();
  93  |   await expect(ui.titles).toHaveText(['Plan meals', 'Buy groceries', 'Cook dinner']);
  94  |   for (let i = 0; i < 3; i++) await expect(ui.rows.nth(i).getByRole('checkbox')).toBeChecked();
  95  |   await ui.allLabel.click();
  96  |   await ui.filter('All').click();
  97  |   await expect(ui.titles).toHaveText(['Plan meals', 'Buy groceries', 'Cook dinner']);
  98  |   for (let i = 0; i < 3; i++) await expect(ui.rows.nth(i).getByRole('checkbox')).not.toBeChecked();
  99  |   await expect(ui.count).toHaveText('3 items left');
  100 | });
  101 | 
  102 | // Scenario: SC-005; Requirement: REQ-4.
  103 | test('filters visibly select the correct subset without losing or duplicating records', async ({ page, todo }) => {
  104 |   await page.goto(todo.baseURL);
  105 |   const ui = todoUI(page);
  106 |   await ui.add('Read chapter', 'Return book', 'Reserve sequel');
  107 |   await ui.rows.nth(1).getByRole('checkbox').check();
  108 |   for (const [name, titles] of [
  109 |     ['Active', ['Read chapter', 'Reserve sequel']],
  110 |     ['Completed', ['Return book']],
  111 |     ['All', ['Read chapter', 'Return book', 'Reserve sequel']],
  112 |   ]) {
  113 |     await ui.filter(name).click();
  114 |     await expect(ui.titles).toHaveText(titles);
  115 |     // Observed legacy UI uses selected class, not aria-current, for its visible border.
  116 |     await expect(ui.filter(name)).toHaveClass(/selected/);
  117 |     for (const other of ['All', 'Active', 'Completed'].filter(x => x !== name))
  118 |       await expect(ui.filter(other)).not.toHaveClass(/selected/);
  119 |     await expect(ui.count).toHaveText('2 items left');
  120 |   }
  121 |   await ui.rows.nth(1).getByRole('checkbox').uncheck();
  122 |   await ui.filter('Completed').click();
  123 |   await expect(ui.rows).toHaveCount(0);
  124 |   await expect(ui.footer).toBeVisible();
  125 |   await ui.filter('All').click();
  126 |   await expect(ui.titles).toHaveText(['Read chapter', 'Return book', 'Reserve sequel']);
  127 | });
  128 | 
  129 | // Scenario: SC-006; Requirements: REQ-5, REQ-7, REQ-8.
  130 | test('Enter and blur save edits while Escape preserves the saved title on reload', async ({ page, todo }) => {
  131 |   await page.goto(todo.baseURL);
  132 |   const ui = todoUI(page);
  133 |   await ui.add('Book train', 'Pack bag');
  134 |   await ui.rows.nth(0).getByRole('checkbox').check();
  135 |   await ui.edit(0, '  Book evening train  ');
  136 |   await expect(ui.titles).toHaveText(['Book evening train', 'Pack bag']);
  137 |   await ui.edit(1, 'Pack overnight bag', 'blur');
  138 |   await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  139 |   await ui.edit(1, 'Discard this draft', 'Escape');
  140 |   await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  141 |   await ui.edit(0, '', 'Escape');
  142 |   await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  143 |   await page.reload();
  144 |   await expect(ui.titles).toHaveText(['Book evening train', 'Pack overnight bag']);
  145 |   await expect(ui.rows.nth(0).getByRole('checkbox')).toBeChecked();
  146 |   await expect(ui.rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  147 |   await expect(ui.count).toHaveText('1 item left');
  148 | });
  149 | 
  150 | // Scenario: SC-007; Requirements: REQ-2, REQ-5, REQ-6.
  151 | test('whitespace Enter and empty blur edits remove only their targeted records', async ({ page, todo }) => {
  152 |   await page.goto(todo.baseURL);
  153 |   const ui = todoUI(page);
  154 |   await ui.add('Check mailbox', 'Check mailbox', 'Keep stamped letter');
  155 |   await ui.rows.nth(2).getByRole('checkbox').check();
  156 |   await ui.edit(1, '   ');
  157 |   await expect(ui.titles).toHaveText(['Check mailbox', 'Keep stamped letter']);
```