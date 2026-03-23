# Anti-Patterns: BAD vs GOOD Playwright Code

Every pattern below shows code that AI agents commonly generate, why it is wrong, and the correct alternative. This is the highest-value reference in the skill -- read it before generating any Playwright code.

---

## 1. waitForTimeout vs Proper Waiting

### BAD

```typescript
await page.goto('/dashboard');
await page.waitForTimeout(3000); // "wait for data to load"
await expect(page.getByText('Revenue')).toBeVisible();
```

**Why it is wrong:** 3 seconds is too long on fast machines (wastes CI time) and too short on slow ones (still flaky). The test does not express what it is actually waiting for.

### GOOD

```typescript
await page.goto('/dashboard');
await expect(page.getByText('Revenue')).toBeVisible(); // auto-retries until visible or timeout
```

### GOOD (waiting for network)

```typescript
await page.goto('/dashboard');
const responsePromise = page.waitForResponse('**/api/dashboard/stats');
await page.getByRole('button', { name: 'Refresh' }).click();
await responsePromise;
await expect(page.getByText('Revenue')).toBeVisible();
```

---

## 2. CSS Selectors vs getByRole

### BAD

```typescript
await page.locator('#login-btn').click();
await page.locator('.submit-button').click();
await page.locator('div.modal-overlay > div.modal-content button.primary').click();
```

**Why it is wrong:** CSS selectors encode DOM structure and styling concerns. They break when class names change, when components are refactored, when CSS modules add hashes, or when a component library updates.

### GOOD

```typescript
await page.getByRole('button', { name: 'Log in' }).click();
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByRole('dialog', { name: 'Confirm' }).getByRole('button', { name: 'OK' }).click();
```

---

## 3. page.click() vs locator.click()

### BAD

```typescript
await page.click('#email');
await page.fill('#email', 'user@example.com');
await page.type('#search', 'query', { delay: 100 });
await page.check('#agree-terms');
```

**Why it is wrong:** `page.click()`, `page.fill()`, `page.type()`, `page.check()` are legacy convenience methods. They accept only string selectors (not locators), cannot be chained, and do not benefit from the locator auto-waiting pipeline. Playwright's documentation marks them as discouraged.

### GOOD

```typescript
await page.getByLabel('Email').fill('user@example.com');
await page.getByPlaceholder('Search...').fill('query');
await page.getByRole('checkbox', { name: 'I agree to the terms' }).check();
```

---

## 4. force:true Abuse

### BAD

```typescript
// "The button was covered by a cookie banner, so I added force:true"
await page.getByRole('button', { name: 'Submit' }).click({ force: true });
```

**Why it is wrong:** `force: true` skips all actionability checks -- visibility, enabled state, stable position, receiving events. If the element is obscured, the test is hiding a real bug or testing the wrong state.

### GOOD

```typescript
// Dismiss the overlay first
await page.getByRole('button', { name: 'Accept cookies' }).click();
await page.getByRole('button', { name: 'Submit' }).click();
```

### GOOD (if the overlay is not always present)

```typescript
const cookieBanner = page.getByRole('dialog', { name: 'Cookie consent' });
if (await cookieBanner.isVisible()) {
  await cookieBanner.getByRole('button', { name: 'Accept' }).click();
}
await page.getByRole('button', { name: 'Submit' }).click();
```

**Only acceptable use of force:true:** Testing that a visually hidden element exists in the DOM (e.g., screen-reader-only content). Document the reason in a comment.

---

## 5. Shared Mutable State Between Tests

### BAD

```typescript
let projectId: string;

test('create project', async ({ request }) => {
  const resp = await request.post('/api/projects', {
    data: { name: 'Test Project' },
  });
  projectId = (await resp.json()).id; // module-level variable
});

test('rename project', async ({ request }) => {
  // Depends on the previous test having run AND succeeded
  await request.patch(`/api/projects/${projectId}`, {
    data: { name: 'Renamed' },
  });
});

test('delete project', async ({ request }) => {
  await request.delete(`/api/projects/${projectId}`);
});
```

**Why it is wrong:** Tests run in parallel across workers. Even within a single file, `fullyParallel: true` means order is not guaranteed. If "create project" fails, both subsequent tests fail with a confusing error about `undefined`.

### GOOD

```typescript
// Use a fixture that creates and tears down per-test
const test = base.extend<{ project: { id: string; name: string } }>({
  project: async ({ request }, use) => {
    const resp = await request.post('/api/projects', {
      data: { name: `test-${Date.now()}` },
    });
    const project = await resp.json();
    await use(project);
    await request.delete(`/api/projects/${project.id}`);
  },
});

test('rename project', async ({ request, project }) => {
  const resp = await request.patch(`/api/projects/${project.id}`, {
    data: { name: 'Renamed' },
  });
  expect(resp.status()).toBe(200);
});
```

### GOOD (if tests genuinely depend on each other)

```typescript
// Use test.describe.serial and keep state scoped to the describe block
test.describe.serial('project lifecycle', () => {
  let projectId: string;

  test('create project', async ({ request }) => {
    const resp = await request.post('/api/projects', {
      data: { name: 'Lifecycle Test' },
    });
    projectId = (await resp.json()).id;
  });

  test('rename project', async ({ request }) => {
    await request.patch(`/api/projects/${projectId}`, {
      data: { name: 'Renamed' },
    });
  });

  test.afterAll(async ({ request }) => {
    if (projectId) await request.delete(`/api/projects/${projectId}`);
  });
});
```

---

## 6. Login in Every Test vs storageState

### BAD

```typescript
test('view dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@test.com');
  await page.getByLabel('Password').fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  // Actual test starts here -- 4 lines of boilerplate above
  await expect(page.getByRole('heading')).toHaveText('Dashboard');
});

test('view settings', async ({ page }) => {
  // Same login boilerplate repeated
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@test.com');
  await page.getByLabel('Password').fill('secret');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto('/settings');
  // ...
});
```

**Why it is wrong:** Each UI login takes 2-5 seconds of real network time. Multiply by 100 tests = 200-500 seconds of pure login overhead. If the login page changes, every test breaks.

### GOOD

```typescript
// e2e/global-setup.ts -- runs once, saves session
import { test as setup, expect } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.TEST_USER_EMAIL!);
  await page.getByLabel('Password').fill(process.env.TEST_USER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
  await page.context().storageState({ path: '.auth/user.json' });
});
```

```typescript
// playwright.config.ts -- all test projects reuse the session
projects: [
  { name: 'setup', testMatch: /global-setup\.ts/ },
  {
    name: 'chromium',
    use: { storageState: '.auth/user.json' },
    dependencies: ['setup'],
  },
],
```

```typescript
// Tests start already authenticated -- zero login overhead
test('view dashboard', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading')).toHaveText('Dashboard');
});
```

---

## 7. allTextContents() vs toHaveText()

### BAD

```typescript
const texts = await page.getByRole('listitem').allTextContents();
expect(texts).toEqual(['Home', 'Products', 'About']);
```

**Why it is wrong:** `allTextContents()` takes a DOM snapshot at one instant. If the list is still rendering, you get `[]` or a partial result, and the test fails intermittently.

### GOOD

```typescript
await expect(page.getByRole('listitem')).toHaveText(['Home', 'Products', 'About']);
```

`toHaveText()` is a web-first assertion. It retries until the locator matches the expected array of strings or the timeout expires.

---

## 8. isVisible() Checks Instead of expect().toBeVisible()

### BAD

```typescript
const visible = await page.getByRole('alert').isVisible();
expect(visible).toBe(true);
```

**Why it is wrong:** `isVisible()` returns the visibility at one instant, with no retry. If the alert has not appeared yet, you get `false` and the test fails.

### GOOD

```typescript
await expect(page.getByRole('alert')).toBeVisible();
```

The web-first assertion retries until the element is visible or the timeout expires.

---

## 9. Testing Implementation Details

### BAD

```typescript
// Checking CSS classes for state
await expect(page.locator('.btn-primary')).toHaveClass(/active/);
await expect(page.locator('.nav-item')).toHaveClass(/selected/);

// Checking internal data attributes for state
const state = await page.locator('[data-state]').getAttribute('data-state');
expect(state).toBe('open');
```

**Why it is wrong:** CSS classes and internal data attributes are implementation details. They can change without any user-visible difference. Tests should assert what the user sees.

### GOOD

```typescript
// Check the user-visible state
await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
await expect(page.getByRole('dialog', { name: 'Confirm' })).toBeVisible();
```

---

## 10. Hardcoded Waits for Animations

### BAD

```typescript
await page.getByRole('button', { name: 'Open menu' }).click();
await page.waitForTimeout(500); // "wait for slide-in animation"
await page.getByRole('menuitem', { name: 'Settings' }).click();
```

**Why it is wrong:** Animation duration varies by browser, device, and whether `prefers-reduced-motion` is set. Playwright already waits for elements to be stable before acting.

### GOOD

```typescript
await page.getByRole('button', { name: 'Open menu' }).click();
await page.getByRole('menuitem', { name: 'Settings' }).click(); // auto-waits for actionability
```

### GOOD (if CSS animations genuinely interfere)

```typescript
// Disable animations globally in playwright.config.ts
export default defineConfig({
  use: {
    // Playwright injects a stylesheet that sets animation-duration: 0s
    // for all elements
    launchOptions: {
      args: ['--force-prefers-reduced-motion'],
    },
  },
});
```

---

## 11. Nested Locator Chains That Mirror DOM Structure

### BAD

```typescript
await page.locator('div.page-wrapper > main > section.content > div.card-grid > div.card:first-child > div.card-footer > button').click();
```

**Why it is wrong:** This locator encodes 7 levels of DOM nesting. Any wrapper div added, removed, or renamed breaks it.

### GOOD

```typescript
await page
  .getByTestId('card-grid')
  .getByTestId('project-card')
  .first()
  .getByRole('button', { name: 'View details' })
  .click();
```

### BETTER (if the card has unique text)

```typescript
await page
  .getByTestId('project-card')
  .filter({ hasText: 'Acme Project' })
  .getByRole('button', { name: 'View details' })
  .click();
```

---

## 12. Using evaluate() for Assertions

### BAD

```typescript
const text = await page.evaluate(() => document.querySelector('h1')?.textContent);
expect(text).toBe('Dashboard');
```

**Why it is wrong:** `page.evaluate()` runs raw JavaScript in the browser context. It bypasses Playwright's auto-waiting, auto-retry, and locator pipeline. If the `h1` has not rendered yet, you get `null`.

### GOOD

```typescript
await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
```

---

## 13. Catching Errors Instead of Asserting Absence

### BAD

```typescript
try {
  await page.getByRole('alert').click({ timeout: 1000 });
  // Alert existed, handle it
} catch {
  // Alert did not exist, continue
}
```

**Why it is wrong:** Using try/catch for flow control is slow (waits the full timeout), fragile, and hides real errors.

### GOOD

```typescript
// Assert absence
await expect(page.getByRole('alert')).toBeHidden();

// Or conditionally handle
const alert = page.getByRole('alert');
if (await alert.isVisible()) {
  await alert.getByRole('button', { name: 'Dismiss' }).click();
}
```

---

## 14. Using page.waitForSelector Instead of Locator Assertions

### BAD

```typescript
await page.waitForSelector('.loading-spinner', { state: 'hidden' });
await page.waitForSelector('.data-table', { state: 'visible' });
```

**Why it is wrong:** `waitForSelector` uses CSS selectors and returns an `ElementHandle` (a DOM reference that can become stale). Locator-based assertions are more readable and more robust.

### GOOD

```typescript
await expect(page.getByTestId('loading-spinner')).toBeHidden();
await expect(page.getByRole('table', { name: 'Data' })).toBeVisible();
```

---

## 15. Incorrect Use of locator.all() for Iteration

### BAD

```typescript
// Iterating immediately without waiting for the list to stabilize
const items = await page.getByRole('listitem').all();
for (const item of items) {
  await expect(item).toBeVisible(); // items.length might be 0
}
```

**Why it is wrong:** `locator.all()` returns a point-in-time snapshot. If the DOM is updating, you may get an empty array or a partial list.

### GOOD

```typescript
// First, assert the expected count (this auto-retries)
await expect(page.getByRole('listitem')).toHaveCount(5);

// Then iterate safely
const items = await page.getByRole('listitem').all();
for (const item of items) {
  await expect(item).toContainText(/\w+/);
}
```

### GOOD (when the exact count is unknown)

```typescript
// Wait for at least one item to appear
await expect(page.getByRole('listitem').first()).toBeVisible();
// Then snapshot
const items = await page.getByRole('listitem').all();
```
