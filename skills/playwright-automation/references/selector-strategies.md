# Selector Strategies

How to choose, write, and maintain locators that are stable, readable, and survive UI refactors.

---

## Decision Tree

```
Is the element interactive (button, link, input, checkbox, select)?
├── YES: Does it have visible text or an accessible name (aria-label)?
│   ├── YES → getByRole('role', { name: 'text' })
│   └── NO: Does it have a <label>?
│       ├── YES → getByLabel('label text')
│       └── NO: Does it have placeholder text?
│           ├── YES → getByPlaceholder('placeholder')
│           └── NO → Add data-testid, use getByTestId('id')
│
└── NO (non-interactive: heading, image, region, generic container):
    ├── Heading? → getByRole('heading', { name: 'text', level: n })
    ├── Image? → getByRole('img', { name: 'alt text' })
    ├── Navigation/region? → getByRole('navigation', { name: 'label' })
    ├── Has unique visible text? → getByText('text', { exact: true })
    └── None of the above → Add data-testid, use getByTestId('id')
```

**Priority order:**

1. `getByRole` -- Best. Queries the accessibility tree. Survives CSS refactors, component library swaps.
2. `getByLabel` -- For form inputs with `<label>` associations.
3. `getByPlaceholder` -- When labels are absent (common in search fields).
4. `getByText` -- For non-interactive elements with unique, stable text.
5. `getByAltText` -- For images.
6. `getByTitle` -- Rare. Title attributes are uncommon.
7. `getByTestId` -- Escape hatch. Stable but conveys no user-visible meaning.
8. CSS selector (`page.locator()`) -- Last resort. Only when nothing above works.

---

## getByRole Examples for Every Common Element

### Buttons

```typescript
// Button with visible text
await page.getByRole('button', { name: 'Submit' }).click();

// Icon-only button (uses aria-label)
// <button aria-label="Close"><svg>...</svg></button>
await page.getByRole('button', { name: 'Close' }).click();

// Disambiguate: exact match prevents "Delete all" from matching "Delete"
await page.getByRole('button', { name: 'Delete', exact: true }).click();

// Disabled state
await expect(page.getByRole('button', { name: 'Submit' })).toBeDisabled();
```

### Links

```typescript
await page.getByRole('link', { name: 'Documentation' }).click();

// Link within a specific navigation region
await page.getByRole('navigation', { name: 'Main' })
  .getByRole('link', { name: 'Settings' })
  .click();

// Verify href without clicking
await expect(page.getByRole('link', { name: 'GitHub' }))
  .toHaveAttribute('href', /github\.com/);
```

### Text Inputs

```typescript
// <label for="email">Email address</label><input id="email" type="email" />
await page.getByRole('textbox', { name: 'Email address' }).fill('user@example.com');

// Number input
await page.getByRole('spinbutton', { name: 'Quantity' }).fill('5');

// Search input (requires <input type="search"> or role="searchbox")
await page.getByRole('searchbox', { name: 'Search' }).fill('query');
```

### Checkboxes and Radio Buttons

```typescript
await page.getByRole('checkbox', { name: 'Remember me' }).check();
await expect(page.getByRole('checkbox', { name: 'Remember me' })).toBeChecked();

await page.getByRole('radio', { name: 'Express shipping' }).check();

// Radio group
const shippingOptions = page.getByRole('radiogroup', { name: 'Shipping method' });
await expect(shippingOptions.getByRole('radio')).toHaveCount(3);
```

### Select / Combobox

```typescript
// Native <select>
await page.getByRole('combobox', { name: 'Country' }).selectOption('United States');

// By value
await page.getByRole('combobox', { name: 'Country' }).selectOption({ value: 'US' });

// Custom combobox (Radix, Headless UI, etc.)
await page.getByRole('combobox', { name: 'Assignee' }).click();
await page.getByRole('option', { name: 'Jane Doe' }).click();
```

### Headings

```typescript
await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome');
await expect(page.getByRole('heading', { level: 2, name: 'Recent activity' })).toBeVisible();
```

### Dialogs

```typescript
const dialog = page.getByRole('dialog', { name: 'Confirm deletion' });
await expect(dialog).toBeVisible();
await dialog.getByRole('button', { name: 'Delete' }).click();
await expect(dialog).toBeHidden();

// Alert dialog (used for destructive confirmations)
const alertDialog = page.getByRole('alertdialog', { name: 'Unsaved changes' });
await alertDialog.getByRole('button', { name: 'Discard' }).click();
```

### Tables

```typescript
const table = page.getByRole('table', { name: 'User list' });
await expect(table.getByRole('columnheader')).toHaveCount(5);

// Find a row by content
const row = table.getByRole('row', { name: /jane@example\.com/ });
await row.getByRole('button', { name: 'Edit' }).click();
```

### Tabs

```typescript
const tabList = page.getByRole('tablist', { name: 'Account settings' });
await tabList.getByRole('tab', { name: 'Security' }).click();
await expect(tabList.getByRole('tab', { name: 'Security' }))
  .toHaveAttribute('aria-selected', 'true');
await expect(page.getByRole('tabpanel', { name: 'Security' })).toBeVisible();
```

### Navigation and Regions

```typescript
// <nav aria-label="Main navigation">
const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
await mainNav.getByRole('link', { name: 'Products' }).click();

// <section aria-label="User profile">
const profile = page.getByRole('region', { name: 'User profile' });
```

### Alerts and Status

```typescript
await expect(page.getByRole('alert')).toContainText('Saved successfully');
await expect(page.getByRole('status')).toHaveText('3 items selected');
```

---

## getByTestId Naming Conventions

Use `data-testid` when no user-facing attribute works. This typically means:

- Container/wrapper elements with no semantic role
- Canvas elements, charts, complex visualizations
- Third-party components you cannot modify

### Naming pattern: `{component}-{element}-{qualifier}`

```
data-testid="metric-card-revenue"
data-testid="sidebar-nav-link-settings"
data-testid="checkout-step-payment"
data-testid="user-table-row-123"
```

Avoid generic names like `data-testid="container"` or `data-testid="wrapper"` -- they will collide.

### Custom test ID attribute

If your app uses `data-cy` or `data-qa`, configure globally:

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    testIdAttribute: 'data-qa',
  },
});
```

---

## Chaining and Filtering

### filter() with hasText

```typescript
// Find a specific card among many
const card = page.getByTestId('project-card').filter({ hasText: 'Acme Corp' });
await expect(card).toBeVisible();
```

### filter() with has (nested locator)

```typescript
// Find the row containing a specific cell value
const row = page
  .getByRole('row')
  .filter({ has: page.getByRole('cell', { name: 'jane@example.com' }) });
await row.getByRole('button', { name: 'Edit' }).click();
```

### Combining has and hasText

```typescript
const urgentTask = page
  .getByTestId('task-card')
  .filter({ has: page.getByRole('heading', { name: 'Fix login bug' }) })
  .filter({ hasText: 'Urgent' });
await urgentTask.getByRole('button', { name: 'Assign to me' }).click();
```

### hasNot and hasNotText

```typescript
// Cards that are NOT archived
const activeCards = page
  .getByTestId('project-card')
  .filter({ hasNotText: 'Archived' });
await expect(activeCards).toHaveCount(3);
```

### Chaining locators (scoping)

```typescript
// Scope to a specific region
const sidebar = page.getByRole('complementary');
await expect(sidebar.getByRole('link')).toHaveCount(5);

// Click a link inside a specific list item
await page
  .getByRole('listitem')
  .filter({ hasText: 'Premium Plan' })
  .getByRole('link', { name: 'Details' })
  .click();
```

---

## Locator Stability Scoring

Rate locators 1-5. Aim for 4+ across your test suite.

### Score 5: Semantic role + accessible name

```typescript
page.getByRole('button', { name: 'Add to cart' })
page.getByRole('heading', { level: 1 })
page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Products' })
```

Survives: CSS refactors, component library swaps, layout changes. Breaks only when user-visible text or element semantics change -- which is a real product change you want to know about.

### Score 4: Label-based or test ID

```typescript
page.getByLabel('Email address')
page.getByPlaceholder('Search...')
page.getByTestId('checkout-summary')
```

Survives: most refactors. Test IDs change only intentionally.

### Score 3: Text content

```typescript
page.getByText('No results found')
page.getByText('Welcome back, Jane')
```

Risk: fragile if text is localized, A/B tested, or from a CMS.

### Score 2: CSS selectors on stable attributes

```typescript
page.locator('[data-state="open"]')
page.locator('input[type="file"]')
```

Functional but opaque. Does not communicate intent.

### Score 1: CSS class selectors, nth(), XPath

```typescript
page.locator('.MuiButton-containedPrimary')       // breaks on library upgrade
page.locator('div > div > span:nth-child(3)')     // breaks on any DOM change
page.locator('//div[@class="header"]/ul/li[2]/a') // unmaintainable
page.locator('.btn').nth(0)                        // which button? nobody knows
```

---

## Migration: CSS to User-Facing Locators

| Old (CSS) | New (User-facing) |
|---|---|
| `page.locator('#login-btn')` | `page.getByRole('button', { name: 'Log in' })` |
| `page.locator('.submit-button')` | `page.getByRole('button', { name: 'Submit' })` |
| `page.locator('input[name="email"]')` | `page.getByLabel('Email')` |
| `page.locator('input[placeholder="Search"]')` | `page.getByPlaceholder('Search')` |
| `page.locator('h1')` | `page.getByRole('heading', { level: 1 })` |
| `page.locator('a[href="/about"]')` | `page.getByRole('link', { name: 'About' })` |
| `page.locator('.nav-menu')` | `page.getByRole('navigation', { name: 'Main' })` |
| `page.locator('.modal')` | `page.getByRole('dialog', { name: 'title' })` |
| `page.locator('.error-message')` | `page.getByRole('alert')` |
| `page.locator('select[name="country"]')` | `page.getByRole('combobox', { name: 'Country' })` |

If `getByRole` does not work, the element probably has poor accessibility. Fix the source code, not the test:

```tsx
// Before: no accessible name
<button className="icon-btn"><TrashIcon /></button>

// After: accessible name via aria-label
<button className="icon-btn" aria-label="Delete item"><TrashIcon /></button>
```

---

## Anti-Patterns

### nth() without context

```typescript
// BAD
await page.getByRole('button').nth(2).click();

// GOOD
await page.getByRole('button', { name: 'Delete' }).click();

// ACCEPTABLE: nth() scoped to a small, stable container
await page.getByRole('listitem').nth(2).getByRole('link').click();
```

### Auto-generated IDs

```typescript
// BAD -- framework-generated IDs change between builds
await page.locator('#ember234').click();
await page.locator('#radix-\\:r1\\:').click();

// GOOD
await page.getByRole('button', { name: 'Toggle menu' }).click();
```

### Overly broad getByText

```typescript
// BAD -- matches "Delete", "Delete all", "Undelete"
await page.getByText('Delete').click();

// GOOD
await page.getByRole('button', { name: 'Delete', exact: true }).click();
```

---

## Quick Reference

| I want to find... | Use this |
|---|---|
| Button | `getByRole('button', { name: 'text' })` |
| Link | `getByRole('link', { name: 'text' })` |
| Text input | `getByLabel('label')` or `getByRole('textbox', { name: '' })` |
| Checkbox | `getByRole('checkbox', { name: 'label' })` |
| Radio | `getByRole('radio', { name: 'label' })` |
| Dropdown | `getByRole('combobox', { name: 'label' })` |
| Heading | `getByRole('heading', { name: 'text', level: n })` |
| Dialog | `getByRole('dialog', { name: 'title' })` |
| Table row | `getByRole('row').filter({ hasText: 'content' })` |
| Navigation | `getByRole('navigation', { name: 'label' })` |
| Alert/toast | `getByRole('alert')` |
| Tab | `getByRole('tab', { name: 'label' })` |
| Image | `getByRole('img', { name: 'alt text' })` |
| List item | `getByRole('listitem').filter({ hasText: 'text' })` |
| Static text | `getByText('text', { exact: true })` |
| No semantics | `getByTestId('test-id')` |
