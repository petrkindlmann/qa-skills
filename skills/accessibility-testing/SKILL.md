---
name: accessibility-testing
description: >-
  Test for WCAG 2.2 AA compliance with axe-core + Playwright, keyboard navigation audits,
  screen reader testing, ARIA pattern validation, and legal compliance mapping (ADA, EAA,
  Section 508). Automated tools catch 30-40% of issues — this skill covers automated and
  manual testing together. Use when: "accessibility," "a11y," "WCAG," "screen reader," "axe,"
  "keyboard navigation," "ARIA," "ADA compliance."
  Not for: cookie-consent/GDPR compliance — use compliance-testing; pixel-diff visual
  regression — use visual-testing.
  Related: playwright-automation, compliance-testing, visual-testing, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: specialized
---

<objective>
Make an application usable by people who rely on keyboards and assistive technology, and prove
it with tests that run in CI. A button that passes `toBeVisible()` can still be unreachable by
keyboard; a page with zero axe violations can still be impossible to operate with a screen
reader. Automated tools catch 30-40% of accessibility issues — this skill covers the automated
scan plus the keyboard, screen reader, and ARIA-state testing that catch the other 60-70%.
</objective>

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it as the foundation and skip
anything already answered.

**Requirements and compliance** (sets the target level and audit obligations)
- What WCAG conformance level is required — A, AA, or AAA? AA is the practical legal default.
- What laws apply — ADA, EAA/EN 301 549, Section 508, AODA? Each maps to a WCAG level.
- Is there a VPAT or accessibility statement to maintain, or contractual a11y clauses from enterprise/government customers?

**Current state** (tells you whether you're auditing or preventing regressions)
- Has an audit run before? What were the findings, and what's already in the backlog?
- Does the design system carry accessibility guidance and accessible components?

**Testing infrastructure** (determines what you can automate vs. must do by hand)
- Is automated a11y testing already in CI?
- Which screen readers does the team test with — VoiceOver, NVDA, JAWS, TalkBack?

## Core Principles

1. **Automated testing catches 30-40% of issues — no more.** axe-core finds missing alt text,
   low contrast, missing labels, and invalid ARIA. It cannot tell you whether alt text is
   meaningful, whether tab order is logical, or whether a custom widget is operable. Passing
   axe is necessary, not sufficient. Crucially, axe ships **no automated rule** for several
   WCAG 2.2 success criteria (2.4.11 focus-not-obscured, 2.5.7 dragging movements, and 2.5.8
   target-size only partially) — a green axe run does not equal 2.2 AA conformance.

2. **Semantic HTML first, ARIA as last resort.** Native elements (`<button>`, `<nav>`,
   `<input>`, `<dialog>`) carry built-in semantics, keyboard behavior, and screen reader
   support. A `<div role="button">` also needs `tabindex`, Enter/Space handlers, focus styles,
   and ARIA state — all of which a `<button>` gives you free. Reach for ARIA only when no
   native element fits.

3. **Test in impact order: keyboard, screen reader, automated.** Keyboard issues physically
   block users from features (highest impact). Screen reader issues confuse with wrong
   announcements. Automated checks catch the mechanical remainder. Start where the damage is
   worst, not where the tooling is easiest.

4. **Accessibility is a quality attribute, not a feature.** Test it continuously like
   performance or security — every new component, every PR. Retrofitting accessibility onto a
   finished product costs 10-100x more because inaccessible patterns get baked into the
   component library.

5. **Test with real assistive technology.** Browser DevTools and axe extensions are dev aids,
   not substitutes for VoiceOver (macOS/iOS), NVDA (Windows), and TalkBack (Android), which
   each behave differently. Reserve manual AT passes for complex custom widgets.

## Automated Scanning with axe-core + Playwright

Install `@axe-core/playwright` (the 4.11.x line; it tracks axe-core's major.minor). Wrap it in
a reusable `checkAccessibility(page, testInfo, options)` helper that filters to the WCAG tags
`['wcag2a', 'wcag2aa', 'wcag22aa']`, attaches the full results JSON to the test for the audit
trail, and asserts `violations.toHaveLength(0)`. Loop it over every key page and over
interactive states (modal open, menu expanded), not just the default load.

Suppress a rule only with a documented justification (a tracking issue or inline comment) and
`exclude` third-party widgets you don't own rather than disabling the rule globally.

See `references/recipes.md` for the install command, RGAA tag caveat, the full helper, the
page-loop and interactive-state specs, rule suppression, and CI integration.

## Manual Testing Checklist

Automated scanning is the floor. These checks need a human (or a keyboard-driven Playwright
spec — see `references/recipes.md` for the keyboard specs).

### Keyboard navigation audit

- [ ] **Tab order is logical** — left-to-right, top-to-bottom for LTR. No surprise focus jumps.
- [ ] **All interactive elements reachable** via Tab / Shift+Tab.
- [ ] **Focus indicator visible** on every focused element. No `outline: none` without a replacement.
- [ ] **Skip link works** — first Tab reveals "Skip to main content"; Enter moves focus to `<main>`.
- [ ] **Enter activates** buttons/links; **Space activates** buttons and toggles checkboxes.
- [ ] **Escape closes** modals, dropdowns, tooltips; focus returns to the trigger.
- [ ] **Arrow keys** navigate within tabs, menus, radio groups, tree views.
- [ ] **No keyboard traps** (modal dialogs intentionally trap until dismissed — that's allowed).
- [ ] **Custom widgets operable** without a mouse (sliders, date pickers, drag-and-drop).

### Screen reader testing

| Screen Reader | OS | Browser | Free? |
|--------------|-----|---------|-------|
| VoiceOver | macOS/iOS | Safari | Yes (Cmd+F5) |
| NVDA | Windows | Firefox/Chrome | Yes |
| JAWS | Windows | Chrome/Edge | No |
| TalkBack | Android | Chrome | Yes |

- [ ] Page title announced on navigation.
- [ ] Headings form a navigable outline (h1 → h2 → h3, no skipped levels).
- [ ] Images have descriptive alt text (or `alt=""` for decorative).
- [ ] Form inputs announce their labels when focused.
- [ ] Required fields announced as required; errors associated with their input.
- [ ] Live regions announce dynamic content (toasts, loading states).
- [ ] Buttons/links announce their purpose (no "click here").

### Color contrast and visual

- [ ] Normal text: **4.5:1** minimum (WCAG AA). Large text (18pt+ / 14pt+ bold): **3:1**.
- [ ] UI components and graphical objects: **3:1** against adjacent colors.
- [ ] Information never conveyed by color alone — add icons, patterns, or text.

### Form and error accessibility

- [ ] Every input has a visible `<label>` tied via `for`/`id` (placeholder is not a label).
- [ ] Required fields indicated visually **and** programmatically (`required` / `aria-required`).
- [ ] Errors use `aria-describedby` to link to the input and `role="alert"` to announce.
- [ ] Focus moves to the first error on submission failure.
- [ ] Related fields grouped with `<fieldset>` and `<legend>`.

## WCAG 2.2 Quick Reference

### Level A (must fix)

| Criterion | What it means | Common failure |
|-----------|--------------|---------------|
| 1.1.1 Non-text Content | Images have alt text | `<img>` without `alt` |
| 1.3.1 Info and Relationships | Structure via HTML semantics | `<div>` styled as a heading |
| 2.1.1 Keyboard | All functionality via keyboard | Custom widget responds only to mouse |
| 2.4.1 Bypass Blocks | Skip navigation link | No skip link |
| 3.1.1 Language of Page | `<html lang="en">` set | Missing `lang` |
| 3.3.1 Error Identification | Errors described in text | Error shown only by red border |
| 4.1.2 Name, Role, Value | Custom controls expose name/role | `<div onclick>` with no role |

### Level AA (most common legal requirement)

| Criterion | What it means | Common failure |
|-----------|--------------|---------------|
| 1.4.3 Contrast (Minimum) | 4.5:1 normal, 3:1 large | Light gray on white |
| 1.4.4 Resize Text | Scales to 200% without loss | Fixed-height containers clip text |
| 1.4.11 Non-text Contrast | UI components 3:1 | Low-contrast input borders |
| 2.4.7 Focus Visible | Keyboard focus visible | `outline: none` with no replacement |
| 2.5.8 Target Size | Touch targets 24×24px min | Tiny icon buttons |
| 3.3.2 Labels or Instructions | Inputs have labels | Placeholder as the only label |
| 3.3.8 Accessible Auth | No cognitive function test | CAPTCHA with no alternative |

### Level AAA (nice to have)

| Criterion | What it means |
|-----------|--------------|
| 1.4.6 Contrast (Enhanced) | 7:1 normal text, 4.5:1 large |
| 2.4.9 Link Purpose (Link Only) | Link text alone describes destination |
| 3.1.5 Reading Level | Lower-secondary education level |

## Accessible Patterns

Test on the accessible tree (roles, names, ARIA state), not on CSS. The patterns you need
runnable tests for:

- **Forms** — error linked via `aria-describedby`, `aria-invalid='true'`, focus on first error.
- **Modal/dialog** — `aria-modal='true'`, `aria-labelledby`, focus trapped, Escape returns focus.
- **Interactive states** — opened dropdown (`role="menu"` or `role="listbox"`, `aria-expanded`),
  loading skeleton (`aria-busy='true'` during fetch), toast (`aria-live='polite'`). These carry
  different ARIA per state, so click to trigger the state change and assert the open-state ARIA —
  the default page snapshot never exercises them.
- **Data tables** — `columnheader` roles, `aria-sort` reflects the active sort.
- **Landmarks** — exactly one `main`; `banner`, `navigation`, `contentinfo` present.

See `references/patterns.md` for the full runnable tests for every pattern above.

## ARIA Snapshots

Playwright's `toMatchAriaSnapshot()` captures the accessible tree as YAML and asserts against
it — the fastest way to catch a regression where a visual change silently breaks semantics (a
`<div>` restyled to look like a button, a heading demoted to plain text). It checks structure
and accessible names, not pixels, so it's complementary to `visual-testing`, not a replacement.
Scope snapshots to a stable container; whole-page snapshots over async content go flaky. See
`references/patterns.md` for navigation and form snapshot examples.

## Legal Compliance Mapping

| Law / Standard | Region | WCAG level required | Enforcement |
|---------------|--------|-------------------|------------|
| **ADA** | USA | AA (court precedent) | Lawsuits (private right of action) |
| **Section 508** | USA (federal) | WCAG 2.0 AA | Federal procurement requirement |
| **EAA** | EU | EN 301 549 (WCAG 2.1 AA) | **In force since 28 June 2025.** Member states actively enforcing; private cause of action varies (DE, FR, IE most active). EN 301 549 expected to align with WCAG 2.2 next revision. |
| **AODA** | Ontario, Canada | WCAG 2.0 AA | Fines up to $100K/day |
| **EN 301 549** | EU | WCAG 2.1 AA | Public procurement requirement |
| **Equality Act 2010** | UK | WCAG 2.1 AA (guidance) | Lawsuits |
| **ISO/IEC 40500:2025** | International | Equivalent to WCAG 2.2 (Oct 2023) | Useful for procurement/RFP language; freely available from ISO |

**Practical target:** if you serve US or EU users, **WCAG 2.2 AA is the target for new
development** — the EAA is in force, EN 301 549 is expected to update to 2.2, and ISO/IEC
40500:2025 (published Sept 2025) codifies WCAG 2.2 internationally. WCAG 2.1 AA is the legacy
minimum where 2.2 can't be reached immediately.

**WCAG 3 status:** W3C published an updated WCAG 3 working draft in March 2026 that renamed
"Outcomes" to "Requirements" and moved away from binary pass/fail grading; it lists ~174
requirements. It remains a working draft — Candidate Recommendation is targeted for Q4 2027 and
a Recommendation not before 2028. Plan for WCAG 2.2 today; track WCAG 3 but do not test against
it yet.

**Audit evidence to collect:** automated scan results per page, manual checklists with
tester/date, screen reader results with AT versions, accessibility statement, VPAT for
enterprise sales, and a remediation plan for known issues. For the full legal/VPAT/consent
mapping, see `compliance-testing`.

## Anti-Patterns

### Only automated testing
Running axe, finding zero violations, and declaring the product accessible. Automated tools
miss 60-70% of real issues and skip several WCAG 2.2 criteria entirely. **Fix:** pair every axe
run with the keyboard and screen reader checklist; gate releases on both, not just the scan.

### ARIA overuse
Adding `role`, `aria-label`, and `aria-describedby` to elements that already have native
semantics, creating double announcements. **Fix:** delete the redundant ARIA and use the native
element — a `<button>` never needs `role="button"`.

### Ignoring keyboard users
Features that work by mouse and touch but not keyboard — click-only dropdowns, drag-and-drop
with no keyboard path, hover-only tooltips. **Fix:** give every mouse interaction a keyboard
equivalent and cover it with a `keyboard.spec.ts` test (see `references/recipes.md`).

### Retrofitting accessibility
Waiting until the product is "finished," by which point inaccessible patterns are baked into the
component library at 10-100x the fix cost. **Fix:** add an axe check to the Definition of Done
so every new component is gated on accessibility before merge.

### Treating accessibility as optional
Deprioritizing a11y tickets because "nobody complained" — users with disabilities can't complain
through a product they can't use, so they leave silently, and US web-accessibility lawsuits have
climbed year over year since 2018. **Fix:** track a11y as a release blocker with the same
severity rules as functional bugs, and report open a11y issues in the release readiness check.

### Testing only the happy path
Scanning only the default page state, missing the modals, expanded dropdowns, error messages,
and loading skeletons that carry different ARIA. **Fix:** drive each interactive state in the
test (click to open the menu, trigger the fetch) and re-run the scan against the changed DOM.

## Failure Modes

| Symptom | Likely cause | Fix or check |
|---------|-------------|-------------|
| axe finds 0 violations but the page is unusable by keyboard | Automated scans don't test operability or focus order | Run the keyboard audit; add a `keyboard.spec.ts` |
| `toMatchAriaSnapshot` is flaky | Dynamic content or list reordering inside the snapshot scope | Scope to a stable container; use a partial snapshot |
| Contrast rule passes but text over a gradient/overlay/image is unreadable | axe can't compute contrast against non-solid backgrounds | Check those cases manually or with a contrast picker |
| Passing axe but failing a WCAG 2.2 AA audit | axe ships no rule for 2.4.11 / 2.5.7 and only partial 2.5.8 | Manually verify focus-not-obscured, dragging alternatives, and target size |

## Verification

Prove the suite actually exercises the page — an a11y test that passes vacuously (wrong URL, axe scanning an error page, snapshot never reached) is worse than none.

1. **Confirm axe is scanning real content.** Point the helper at a page you know has a violation (e.g. temporarily remove a `<label>`) and run it — the test must FAIL and name the rule:
   ```bash
   npx playwright test e2e/tests/a11y/pages.spec.ts
   ```
   If a page with a planted defect still passes, AxeBuilder is scanning the wrong DOM (redirect, blank page, or wrong selector) — fix that before trusting any green run.
2. **Confirm the keyboard specs reach the app, not a 404.** Run `npx playwright test e2e/tests/a11y/keyboard.spec.ts` and open the trace for the skip-link test — the first Tab should land on the skip link, not nowhere. A test that "passes" because the page never loaded is a false green.
3. **Confirm the CI gate blocks.** Introduce one serious violation on a branch and push — the `a11y` job must exit non-zero and fail the PR check. Revert after.
4. **Spot-check an ARIA snapshot.** Run `toMatchAriaSnapshot` once with `--update-snapshots`, then again without — the second run must pass. If it flakes, the snapshot scope includes async/reordering content; narrow it to a stable container.

## Done When

- axe-core integrated into the E2E suite and run automatically on all key user-facing pages identified in the test strategy.
- CI reports zero critical or serious axe violations and blocks merge when any are introduced (see `references/recipes.md` for the workflow).
- Keyboard navigation tested end-to-end for all interactive flows (forms, modals, dropdowns, navigation menus).
- Interactive-state ARIA verified for at least one dropdown/menu (`aria-expanded` + `role`), one loading region (`aria-busy`), and one live region (`aria-live`).
- Color contrast validated for the full brand palette against WCAG AA thresholds (4.5:1 normal text, 3:1 large text and UI components).
- Screen reader test notes documented for complex custom widgets (date pickers, data tables, drag-and-drop), including which screen reader and version was used.

## Related Skills

- **playwright-automation** — the test runner for both axe scans and keyboard/ARIA snapshot tests; this skill adds the accessibility-specific patterns on top.
- **compliance-testing** — legal/regulatory testing including cookie consent (GDPR/CMP), VPAT generation, and EAA/Section 508 reporting. Go there for consent banners and formal compliance documentation; stay here for WCAG conformance testing.
- **visual-testing** — pixel-diff screenshot regression. Use it for visual rendering changes; use this skill's ARIA snapshots for semantic-tree regressions and contrast for the a11y-specific color thresholds.
- **ci-cd-integration** — running a11y tests in CI and blocking merges on violations.
- **risk-based-testing** — prioritizes which pages and components to audit first.
