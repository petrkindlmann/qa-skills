---
name: accessibility-testing
description: >-
  Test for WCAG 2.2 compliance using axe-core with Playwright, keyboard navigation
  audits, screen reader testing, ARIA pattern validation, and legal compliance mapping
  (ADA, EAA, Section 508). Automated tools catch 30-40% of issues -- this skill covers
  both automated and manual testing strategies. Use when: "accessibility," "a11y,"
  "WCAG," "screen reader," "axe," "keyboard navigation," "ARIA," "ADA compliance."
  Related: playwright-automation, compliance-testing, cross-browser-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Test applications for accessibility to ensure they are usable by everyone, including people who use assistive technologies. Automated tools catch 30-40% of accessibility issues -- the rest requires manual testing with keyboard navigation, screen readers, and human judgment. This skill covers both approaches.
</objective>

---

## Discovery Questions

Before designing an accessibility testing strategy, understand the requirements and current state. Check `.agents/qa-project-context.md` first -- if it exists, use it as the foundation and skip questions already answered there.

### Requirements and Compliance
- What WCAG conformance level is required? (A, AA, or AAA)
- What legal requirements apply? (ADA, EAA/EN 301 549, Section 508, AODA)
- Are there contractual accessibility requirements from customers? (common in enterprise/government)
- Is there a Voluntary Product Accessibility Template (VPAT) to maintain?

### Current State
- Has an accessibility audit been performed before? What were the findings?
- Are there known accessibility issues in the backlog?
- Does the design system include accessibility guidelines?

### Testing Infrastructure
- Is automated accessibility testing integrated into CI?
- Which screen readers does the team test with? (VoiceOver, NVDA, JAWS, TalkBack)
- What browsers and devices must be accessible?

---

## Core Principles

### 1. Automated Testing Catches 30-40% of Issues
Tools like axe-core can detect missing alt text, insufficient color contrast, missing form labels, and invalid ARIA attributes. They cannot detect whether alt text is meaningful, whether the tab order is logical, whether a custom widget is operable by keyboard, or whether the reading order makes sense. Both automated and manual testing are essential.

### 2. Semantic HTML First, ARIA as Last Resort
Native HTML elements (`<button>`, `<nav>`, `<input>`, `<table>`, `<dialog>`) carry built-in accessibility semantics, keyboard behavior, and screen reader support. Adding `role="button"` to a `<div>` requires also adding `tabindex`, `keydown` handlers for Enter and Space, focus styles, and ARIA states. Use the native element. Reach for ARIA only when no native element exists for the pattern.

### 3. Test in Order: Keyboard, Screen Reader, Automated
Keyboard testing catches the most impactful issues (users physically blocked from features). Screen reader testing catches semantics issues (users confused by incorrect announcements). Automated testing catches the remaining mechanical issues (missing attributes, contrast ratios). Start with the highest-impact method.

### 4. Accessibility Is Not a Feature -- It Is a Quality Attribute
Accessibility is tested continuously, like performance or security. Every new component, every new page, every PR gets accessibility review. Retrofitting accessibility onto a finished product costs 10-100x more than building it in from the start.

### 5. Test With Real Assistive Technology
Browser DevTools and axe-core extensions are useful for development, but they are not substitutes for testing with actual screen readers. VoiceOver on macOS, NVDA on Windows, and TalkBack on Android each have different behaviors and quirks.

---

## Automated Testing with axe-core and Playwright

### Setup

```bash
# axe-core 4.11.x or later — current is 4.11.4 (Apr 2026)
npm install --save-dev @axe-core/playwright
```

> **axe-core 4.11+ caveat:** Several best-practice rules (`focus-order-semantics`, `region`, `skip-link`, `table-duplicate-name`) are now also tagged `RGAAv4` (the French national standard). If you filter by tag and don't intend to test against RGAA, exclude it explicitly: `withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).disableRules([])` is fine, but `.withTags(['best-practice'])` will pull in RGAA-specific rules.

### Reusable Helper

```typescript
// e2e/helpers/a11y.ts
import { type Page, type TestInfo, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

interface A11yOptions {
  tags?: string[];
  exclude?: string[];
  disableRules?: string[];
}

export async function checkAccessibility(
  page: Page, testInfo: TestInfo, options: A11yOptions = {}
): Promise<void> {
  let builder = new AxeBuilder({ page })
    .withTags(options.tags ?? ['wcag2a', 'wcag2aa', 'wcag22aa']);

  for (const sel of options.exclude ?? []) builder = builder.exclude(sel);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);

  const results = await builder.analyze();

  await testInfo.attach('a11y-results', {
    body: JSON.stringify(results, null, 2), contentType: 'application/json',
  });

  const violations = results.violations.map((v) => ({
    rule: v.id, impact: v.impact, description: v.description,
    helpUrl: v.helpUrl, elements: v.nodes.map((n) => n.html).slice(0, 5),
  }));

  expect(violations, `${violations.length} a11y violations:\n${JSON.stringify(violations, null, 2)}`)
    .toHaveLength(0);
}
```

### Using in Tests

```typescript
// e2e/tests/a11y/pages.spec.ts
import { test, expect } from '@playwright/test';
import { checkAccessibility } from '../../helpers/a11y';

test.describe('Accessibility - public pages', () => {
  for (const { name, path } of [
    { name: 'Home', path: '/' }, { name: 'Login', path: '/login' },
    { name: 'Pricing', path: '/pricing' }, { name: 'Sign Up', path: '/signup' },
  ]) {
    test(`${name} page has no a11y violations`, async ({ page }, testInfo) => {
      await page.goto(path);
      await checkAccessibility(page, testInfo);
    });
  }
});

test.describe('Accessibility - interactive states', () => {
  test('modal dialog is accessible when open', async ({ page }, testInfo) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await checkAccessibility(page, testInfo);
  });
});
```

### Rule Suppression

Suppress rules only with documented justification:

```typescript
await checkAccessibility(page, testInfo, {
  disableRules: ['frame-title'], // Third-party chat widget; tracked in PROJ-4521
  exclude: ['#third-party-analytics-widget'],
});
```

### CI Integration

```yaml
# .github/workflows/a11y.yml
name: Accessibility Tests
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  a11y:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build && npm start &
      - run: npx wait-on http://localhost:3000 --timeout 60000
      - run: npx playwright test e2e/tests/a11y/
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with: { name: a11y-report, path: 'test-results/\nplaywright-report/', retention-days: 14 }
```

---

## Manual Testing Checklist

### Keyboard Navigation Audit

- [ ] **Tab order is logical:** Left-to-right, top-to-bottom for LTR languages. No unexpected focus jumps.
- [ ] **All interactive elements are reachable** via Tab/Shift+Tab.
- [ ] **Focus indicator is visible** on every focused element. No `outline: none` without a replacement.
- [ ] **Skip link works:** First Tab reveals "Skip to main content" link.
- [ ] **Enter activates** buttons and links. **Space activates** buttons and toggles checkboxes.
- [ ] **Escape closes** modals, dropdowns, tooltips. Focus returns to trigger element.
- [ ] **Arrow keys** navigate within tab panels, menus, radio groups, and tree views.
- [ ] **No keyboard traps** (exception: modal dialogs intentionally trap focus until dismissed).
- [ ] **Custom widgets are operable** without a mouse (sliders, date pickers, drag-and-drop).

```typescript
// e2e/tests/a11y/keyboard.spec.ts
import { test, expect } from '@playwright/test';

test('skip link moves focus to main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: /skip to (main )?content/i });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('modal traps focus and returns it on close', async ({ page }) => {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Create project' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Escape closes and returns focus to trigger
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('form can be completed entirely by keyboard', async ({ page }) => {
  await page.goto('/signup');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Jane Doe');
  await page.keyboard.press('Tab');
  await page.keyboard.type('jane@example.com');
  await page.keyboard.press('Tab');
  await page.keyboard.type('SecureP@ss123');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space'); // Toggle checkbox
  await expect(page.getByRole('checkbox', { name: /terms/i })).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter'); // Submit
  await expect(page).toHaveURL(/\/welcome/);
});
```

### Screen Reader Testing

| Screen Reader | OS | Browser | Free? |
|--------------|-----|---------|-------|
| VoiceOver | macOS/iOS | Safari | Yes (Cmd+F5) |
| NVDA | Windows | Firefox/Chrome | Yes |
| JAWS | Windows | Chrome/Edge | No |
| TalkBack | Android | Chrome | Yes |

**Checklist:**
- [ ] Page title announced on navigation
- [ ] Headings create a navigable outline (h1 -> h2 -> h3, no skipped levels)
- [ ] Images have descriptive alt text (or `alt=""` for decorative images)
- [ ] Form inputs announce their labels when focused
- [ ] Required fields announced as required; errors associated with inputs
- [ ] Live regions announce dynamic content (toasts, loading states)
- [ ] Buttons and links announce their purpose (no "click here")

### Color Contrast and Visual
- [ ] Normal text: 4.5:1 contrast ratio minimum (WCAG AA)
- [ ] Large text (18pt+ or 14pt+ bold): 3:1 minimum
- [ ] UI components: 3:1 against adjacent colors
- [ ] Information not conveyed by color alone (add icons, patterns, or text)

### Form and Error Accessibility
- [ ] Every input has a visible `<label>` associated via `for`/`id`
- [ ] Required fields indicated visually and programmatically (`required` or `aria-required`)
- [ ] Errors use `aria-describedby` to associate with inputs and `role="alert"` for announcement
- [ ] Focus moves to first error on form submission failure
- [ ] Form groups use `<fieldset>` and `<legend>`

---

## WCAG 2.2 Quick Reference

### Level A (Must Fix)

| Criterion | What It Means | Common Failure |
|-----------|--------------|---------------|
| 1.1.1 Non-text Content | Images have alt text | `<img>` without `alt` attribute |
| 1.3.1 Info and Relationships | Structure via HTML semantics | `<div>` styled as heading instead of `<h2>` |
| 2.1.1 Keyboard | All functionality via keyboard | Custom widget only responds to mouse |
| 2.4.1 Bypass Blocks | Skip navigation link | No skip link |
| 3.1.1 Language of Page | `<html lang="en">` set | Missing `lang` attribute |
| 3.3.1 Error Identification | Errors described in text | Error indicated only by red border |
| 4.1.2 Name, Role, Value | Custom controls expose name/role | `<div onclick>` with no role |

### Level AA (Most Common Legal Requirement)

| Criterion | What It Means | Common Failure |
|-----------|--------------|---------------|
| 1.4.3 Contrast (Minimum) | 4.5:1 normal text, 3:1 large | Light gray on white |
| 1.4.4 Resize Text | Scales to 200% without loss | Fixed-height containers clip text |
| 1.4.11 Non-text Contrast | UI components 3:1 ratio | Low-contrast input borders |
| 2.4.7 Focus Visible | Keyboard focus visible | `outline: none` without replacement |
| 2.5.8 Target Size | Touch targets 24x24px minimum | Tiny icon buttons |
| 3.3.2 Labels or Instructions | Inputs have labels | Placeholder as only label |
| 3.3.8 Accessible Auth | No cognitive function test | CAPTCHA with no alternative |

### Level AAA (Nice to Have)

| Criterion | What It Means |
|-----------|--------------|
| 1.4.6 Contrast (Enhanced) | 7:1 normal text, 4.5:1 large |
| 2.4.9 Link Purpose (Link Only) | Link text alone describes destination |
| 3.1.5 Reading Level | Lower secondary education level |

---

## Accessible Patterns with Code

### Accessible Forms

```typescript
test('form displays accessible error messages', async ({ page }) => {
  await page.goto('/contact');
  await page.getByRole('button', { name: 'Send message' }).click();

  const emailInput = page.getByLabel('Email address');
  const emailError = page.getByText('Email is required');
  await expect(emailError).toBeVisible();

  // Verify aria-describedby links input to error
  const errorId = await emailError.getAttribute('id');
  expect(await emailInput.getAttribute('aria-describedby')).toContain(errorId);
  await expect(emailInput).toHaveAttribute('aria-invalid', 'true');
  await expect(emailInput).toBeFocused();
});
```

Expected HTML: `<label for="email">Email</label>` + `<input id="email" aria-required="true" aria-invalid="true" aria-describedby="email-error">` + `<p id="email-error" role="alert">Email is required</p>`

### Modal/Dialog Accessibility

```typescript
test('dialog follows ARIA dialog pattern', async ({ page }) => {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', { name: 'Delete project' });
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-labelledby');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.locator(':focus')).toBeVisible(); // Focus inside dialog

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused(); // Focus returns to trigger
});
```

### Dynamic Content -- Live Regions

```typescript
test('toast notifications are announced', async ({ page }) => {
  await page.goto('/settings');
  const toastRegion = page.locator('[aria-live="polite"]');
  await expect(toastRegion).toBeAttached();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(toastRegion.getByText('Settings saved')).toBeVisible();
});
```

### Data Tables

```typescript
test('table has proper headers and sort state', async ({ page }) => {
  await page.goto('/users');
  const table = page.getByRole('table', { name: 'User accounts' });
  await expect(table.getByRole('columnheader')).toHaveCount(5);

  const nameHeader = page.getByRole('columnheader', { name: 'Name' });
  await nameHeader.click();
  await expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
});
```

### Navigation Landmarks

```typescript
test('page has required landmarks', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('banner')).toBeVisible();      // <header>
  await expect(page.getByRole('navigation')).toBeVisible();   // <nav>
  await expect(page.getByRole('main')).toBeVisible();         // <main>
  await expect(page.getByRole('main')).toHaveCount(1);        // Exactly one <main>
  await expect(page.getByRole('contentinfo')).toBeVisible();  // <footer>
});
```

---

## ARIA Snapshots (Playwright)

Playwright's `toMatchAriaSnapshot()` captures the accessible tree structure and asserts against it. Useful for catching regressions where visual changes break semantics.

```typescript
test('navigation has correct accessible structure', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: 'Main' })).toMatchAriaSnapshot(`
    - navigation "Main":
      - link "Dashboard"
      - link "Projects"
      - link "Settings"
      - link "Help"
  `);
});

test('form has correct accessible structure', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('form', { name: 'Profile settings' })).toMatchAriaSnapshot(`
    - form "Profile settings":
      - textbox "Display name"
      - textbox "Email address"
      - combobox "Time zone"
      - checkbox "Email notifications"
      - button "Save changes"
  `);
});
```

---

## Legal Compliance Mapping

| Law / Standard | Region | WCAG Level Required | Enforcement |
|---------------|--------|-------------------|------------|
| **ADA** | USA | AA (court precedent) | Lawsuits (private right of action) |
| **Section 508** | USA (federal) | WCAG 2.0 AA | Federal procurement requirement |
| **EAA** | EU | EN 301 549 (WCAG 2.1 AA) | **In force since 28 June 2025.** Member states actively enforcing; private cause of action varies by country (DE, FR, IE among the most active). EN 301 549 is expected to align with WCAG 2.2 in its next revision. |
| **AODA** | Ontario, Canada | WCAG 2.0 AA | Fines up to $100K/day |
| **EN 301 549** | EU | WCAG 2.1 AA | Public procurement requirement |
| **Equality Act 2010** | UK | WCAG 2.1 AA (guidance) | Lawsuits |
| **ISO/IEC 40500:2025** | International | Equivalent to WCAG 2.2 (Oct 2023) | Useful for procurement/RFP language; freely available from ISO |

**Key takeaway:** If your product serves users in the US or EU, **WCAG 2.2 AA is the practical target for new development** — the EAA is in force, EN 301 549 is expected to update to 2.2, and ISO/IEC 40500:2025 codifies WCAG 2.2 as an international standard. WCAG 2.1 AA is the legacy minimum where 2.2 cannot be reached immediately.

**WCAG 3 status:** W3C published updated WCAG 3 drafts in March 2026 (renamed "Foundational Requirements" → "Core Requirements," "Outcomes" → "Requirements," added a Best Practices section). Still a working draft; a final standard is years away. Plan for WCAG 2.2 today; track WCAG 3 but do not test against it yet.

**Evidence to collect for audits:** Automated scan results per page, manual testing checklists with tester/date, screen reader test results with AT versions, accessibility statement, VPAT for enterprise sales, remediation plan for known issues.

---

## Anti-Patterns

### Only Automated Testing
Running axe-core and declaring the product accessible because it found zero violations. Automated tools miss 60-70% of real accessibility issues. Keyboard testing, screen reader testing, and cognitive review are essential complements.

### ARIA Overuse
Adding `role`, `aria-label`, and `aria-describedby` to elements that already have native semantics. A `<button>` does not need `role="button"`. Extra ARIA can create confusing double announcements in screen readers.

### Ignoring Keyboard Users
Building features that work with mouse and touch but not keyboard. Custom dropdowns that only open on click, drag-and-drop with no keyboard alternative, and hover-only tooltips all block keyboard users. Every mouse interaction needs a keyboard equivalent.

### Retrofitting Accessibility
Waiting until the product is "finished" to add accessibility. By then, inaccessible patterns are baked into the component library and the cost to fix is 10-100x higher. Test accessibility from the first component.

### Treating Accessibility as Optional
Deprioritizing accessibility tickets because "nobody has complained." Users with disabilities often cannot complain through the product if it is inaccessible. They leave silently. Accessibility lawsuits in the US have increased year over year since 2018.

### Testing Only the Happy Path
Running accessibility checks only on the default page state. Interactive states (modals open, dropdowns expanded, error messages displayed, loading skeletons, empty states) all need accessibility testing. Components often have different ARIA attributes in different states.

---

## Done When

- axe-core integrated into the E2E test suite and runs automatically on all key pages (home, login, checkout, dashboard, settings).
- CI pipeline reports zero critical or serious axe violations and blocks merge when any are introduced.
- Keyboard navigation tested end-to-end for all interactive flows (forms, modals, dropdowns, navigation menus).
- Color contrast validated for the full brand palette against WCAG AA thresholds (4.5:1 for normal text, 3:1 for large text and UI components).
- Screen reader testing notes documented for complex custom widgets (date pickers, data tables, drag-and-drop), including which screen reader and version was used.

## Related Skills

- **playwright-automation** -- Playwright is the test runner for both automated axe-core scans and keyboard/ARIA snapshot tests; this skill provides the accessibility-specific patterns.
- **ci-cd-integration** -- Accessibility tests should run in CI and block merges when violations are found.
- **risk-based-testing** -- Accessibility risk assessment helps prioritize which pages and components to audit first.
- **test-strategy** -- The test strategy should include accessibility as a test type with defined coverage targets and ownership.
