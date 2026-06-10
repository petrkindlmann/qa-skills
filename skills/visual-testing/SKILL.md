---
name: visual-testing
description: >-
  Implement visual regression testing with Playwright screenshots, Chromatic, Percy,
  and Argos CI. Covers baseline management, diff threshold tuning, dynamic content
  masking, responsive viewport testing, and review/approval workflows.
  Use when: "visual test," "screenshot," "visual regression," "pixel diff," "snapshot diff,"
  "update baselines," "Chromatic," "percy snapshot," "argos screenshot."
  Not for: bulk baseline regeneration after a redesign broke many tests — use
  selector-drift-recovery; cross-browser rendering matrices — use cross-browser-testing;
  general Playwright test structure — use playwright-automation.
  Related: playwright-automation, ci-cd-integration, cross-browser-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
Catch visual regressions that functional tests miss. A button that works perfectly but renders at 2px height passes `toBeVisible()` and `click()` — visual testing compares screenshots against approved baselines and flags pixel-level differences. This skill covers Playwright's built-in `toHaveScreenshot`, dedicated tools (Chromatic, Percy, Argos CI), and the baseline-management workflows around them.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Just need pixel diffs in CI, no review SaaS | Playwright Visual Comparisons (below) |
| Storybook in the repo | Dedicated Tools → Chromatic, or recipes.md "Storybook without Chromatic" |
| Need a hosted review/approval UI + AI diff triage | Dedicated Visual Testing Tools |
| Screenshots flake on timestamps/avatars/ads | Masking & Freezing Dynamic Content |
| Baselines bloating git history | Baseline Management → Git LFS |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything answered there.

### Tool selection
- **Playwright built-in or dedicated tool?** `toHaveScreenshot` is free, stores baselines in-repo (git/LFS cost is on you). Dedicated tools (Chromatic, Percy, Argos) store artifacts off-repo, add review workflows, browser farms, historical tracking, and — since late 2025 — AI diff triage. Choose on team size, review needs, and whether you want artifacts in your repo or theirs.
- **Storybook in the project?** If yes, Chromatic is the natural fit (every story becomes a visual test) — but you can also drive stories with Playwright without paying (see recipes.md). If no Storybook, Playwright built-in or Percy.
- **CI platform and artifact budget?** Visual tests generate large screenshot/diff artifacts. Built-in baselines live in git (repo bloat, LFS); hosted tools keep retention off-repo at a subscription cost. Confirm CI has the storage and time before scaling up.

### Scope
- **Full-page or component screenshots?** Full-page catches layout issues but is sensitive to unrelated changes. Component-level screenshots are more stable and focused.
- **Which pages/components are visually critical?** Not everything needs it. Focus on user-facing pages, marketing pages, design-system components, and complex layouts.
- **Which viewports?** Desktop, tablet, mobile — define the viewport matrix upfront from analytics, not every possible width.

### Dynamic content
- **What changes between runs?** Dates, timestamps, user-generated content, analytics IDs, randomized content, ads, avatars — all must be masked or frozen.
- **Animations or transitions?** They cause false positives if not disabled or finished before capture.
- **External resources?** Fonts, CDN images, third-party widgets can vary between runs.

---

## Core Principles

### 1. Visual tests catch what functional tests miss
Functional tests assert behavior ("clicking Submit shows a success message"). Visual tests assert appearance ("the success message is green, correctly positioned, and does not overlap the form"). Both are needed. Visual tests complement functional tests; they do not replace them.

### 2. Baseline management is the hard part
Taking screenshots is easy. Managing baselines — updating them when design changes intentionally, reviewing diffs, coordinating approvals across a team — is the real challenge. Invest in the review workflow early.

### 3. Dynamic content causes false positives
Any content that changes between runs (timestamps, avatars, ads, random IDs) produces pixel differences that are not real regressions. Aggressively mask or freeze it. A suite with a 10% false-positive rate gets ignored within a month. Hosted tools (Percy's Visual Review Agent, Chromatic AI triage) now auto-filter a large share of these — but masking and freezing remain your first line of defense regardless of tool.

### 4. Threshold tuning is iterative
The right diff threshold depends on the component, rendering engine, and what counts as "visually different." Start strict (zero tolerance), observe false positives, loosen per-component. Document why each threshold was chosen.

### 5. Screenshots are artifacts, not test results
The screenshot file is the evidence. Store it, version it, make it accessible for review. A test that says "visual diff detected" without showing the diff is useless — always upload expected/actual/diff images as CI artifacts.

---

## Playwright Visual Comparisons

Playwright's built-in `toHaveScreenshot` and `toMatchSnapshot` provide visual regression testing without an external service.

### Basic screenshot comparison

```typescript
import { test, expect } from '@playwright/test';

test('dashboard matches baseline', async ({ page }) => {
  await page.goto('/dashboard');
  // Wait for data to load before capturing — never waitForTimeout
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('chart-container')).toBeVisible();

  await expect(page).toHaveScreenshot('dashboard.png', { animations: 'disabled' });
});
```

First run creates the baseline. Subsequent runs compare and fail if pixels differ beyond the threshold.

### Configuration options

```typescript
await expect(page).toHaveScreenshot('dashboard.png', {
  maxDiffPixels: 100,          // Allow up to 100 pixels to differ
  // OR
  maxDiffPixelRatio: 0.01,     // Allow up to 1% of pixels to differ
  threshold: 0.2,              // Per-pixel color difference tolerance (0-1, YIQ space)
  animations: 'disabled',      // Freeze CSS animations and transitions
  caret: 'hide',               // Hide blinking cursor
  stylePath: './screenshot.css', // Inject a stylesheet at capture to hide dynamic chrome
  timeout: 15000,              // Wait up to 15s for a stable screenshot
});
```

The default comparator is `pixelmatch` (YIQ color space). The relevant knobs are `comparator: 'pixelmatch'` plus `threshold`/`maxDiffPixel*` — there is no stable perceptual-color mode key, so do not set `mode:` (perceptual SSIM is an internal/experimental underscore API, not stable config).

**When to use which threshold:**

| Option | Use when |
|--------|----------|
| `maxDiffPixels: 0` | Pixel-perfect components (icons, logos, design-system atoms) |
| `maxDiffPixels: 50-100` | Full-page layouts where antialiasing varies slightly |
| `maxDiffPixelRatio: 0.01` | Full-page screenshots where absolute pixel count varies with viewport |
| `threshold: 0.2` | Cross-browser testing where color rendering differs slightly |

### playwright.config.ts visual settings

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    toHaveScreenshot: {
      comparator: 'pixelmatch',    // Default comparator (YIQ color space)
      maxDiffPixelRatio: 0.005,    // Global default: 0.5% tolerance
      animations: 'disabled',
      caret: 'hide',
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.005,
    },
  },
  projects: [
    {
      name: 'visual-desktop',
      use: { viewport: { width: 1280, height: 720 }, colorScheme: 'light' },
      testMatch: /.*visual.*\.spec\.ts/,
    },
    {
      name: 'visual-mobile',
      use: { viewport: { width: 375, height: 667 }, colorScheme: 'light', isMobile: true },
      testMatch: /.*visual.*\.spec\.ts/,
    },
  ],
});
```

### Masking & freezing dynamic content

Two complementary tactics. Mask blanks specific elements; `stylePath` / freezing kills time- and animation-driven noise.

```typescript
test('profile page visual test', async ({ page }) => {
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();

  await expect(page).toHaveScreenshot('profile.png', {
    mask: [
      page.getByTestId('user-avatar'),       // User-specific image
      page.getByTestId('last-login-time'),    // Timestamp
      page.getByTestId('activity-feed'),      // Dynamic content
    ],
    maskColor: '#FF00FF',                      // Visible mask color for debugging
  });
});
```

For cursors, animations, and dynamic chrome, prefer `stylePath` (a stylesheet injected at capture time) over per-element masks — it is declarative and survives DOM changes. To eliminate timestamps and live data, pin the clock with **`page.clock.setFixedTime`** (holds the clock dead-still — best for screenshot determinism; `page.clock.install` lets it tick from a seed) and stub the API with `page.route` + `route.fulfill`.

See `references/recipes.md` for the full frozen-data recipe (clock + route + font-abort + `getAnimations().finish()`), the `stylePath` example, and component-state screenshots.

### Updating baselines

```bash
# Update all baselines (when design intentionally changes)
npx playwright test --update-snapshots

# Update baselines for specific tests only
npx playwright test visual-dashboard --update-snapshots

# Review what changed before committing
git diff --stat                 # See which baseline files changed
npx playwright show-report      # Visually review expected/actual/diff for each
```

**Baseline update workflow:**

1. Design change is implemented.
2. Run visual tests — they fail with expected diffs.
3. Review each diff in `show-report`: is the change intentional?
4. Update baselines: `npx playwright test --update-snapshots`.
5. Commit updated baselines with a message referencing the design change.
6. PR reviewers verify the baseline images look correct — not just the file diff.

### Component-level & responsive testing

Screenshot the component (e.g. `getByRole('table')`), not the full page — more stable, more focused. Drive empty/error/normal states by stubbing the API per test. For responsive coverage, loop a `VISUAL_VIEWPORTS` array (mobile/tablet/desktop with `isMobile` flags) or define one Playwright project per viewport. See `references/recipes.md` for the component-state and responsive-loop recipes.

---

## Dedicated Visual Testing Tools

Reach for these when you want a hosted review/approval UI, a cross-browser rendering farm, historical tracking, or AI-assisted diff triage — and you are fine with artifacts living off-repo on a subscription.

| Tool | Best when | Integration | Key feature |
|------|-----------|-------------|-------------|
| **Chromatic** | Project uses Storybook | Every story = a visual test | Review/approval UI, cross-browser, TurboSnap + AI triage |
| **Percy** | No Storybook, need multi-browser | Any framework via SDK | Multi-width captures, CSS overrides, AI Visual Review Agent (auto-filters ~40% of false positives), BrowserStack Test Observability |
| **Argos CI** | Open-source preference, budget-conscious | Playwright reporter | Self-hosted tier; generous cloud free tier |

**AI diff triage (the material 2026 shift):** Percy's Visual Review Agent and Chromatic's AI triage auto-classify a large share of diffs as noise vs. real change, cutting review fatigue. This is the strongest reason to pay for a hosted tool over built-in baselines — but it reduces, not removes, the need to mask/freeze dynamic content.

> **Avoid:** Lost Pixel — repo archived 22 April 2026 (read-only). Use Argos, Chromatic, or Playwright's built-in `toHaveScreenshot` instead.

See `references/recipes.md` for the Chromatic GitHub Action, Percy `percySnapshot`, Argos `argosScreenshot`, and the Storybook-without-Chromatic snippets.

---

## Baseline Management

### Git-stored baselines, LFS, and platform tags

Playwright stores baselines alongside test files, tagged per platform because rendering differs across operating systems:

```
e2e/tests/visual/
  dashboard.visual.spec.ts
  dashboard.visual.spec.ts-snapshots/
    dashboard-chromium-linux.png     # Platform-specific baselines
    dashboard-chromium-darwin.png
    dashboard-firefox-linux.png
```

**Pros:** versioned with the code, reviewed in PRs, available offline. **Cons:** repo size grows; large PNGs bloat git history.

Use **Git LFS** to prevent bloat, and customize layout with `snapshotPathTemplate`:

```
# .gitattributes
*.png filter=lfs diff=lfs merge=lfs -text
```

```typescript
// playwright.config.ts
export default defineConfig({
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}-{projectName}{ext}',
});
```

Because baselines are platform-tagged, generate them in the **same Docker image CI uses** so they always match the CI rendering environment — never commit baselines captured on a developer laptop. See `references/recipes.md` for the Docker CI job (`mcr.microsoft.com/playwright:v1.60.0-noble`, matched to your `@playwright/test` version).

### Review and approval workflow

1. CI detects a visual diff, uploads expected/actual/diff images as artifacts.
2. PR reviewer examines the diffs in `show-report` (or the hosted tool's UI).
3. Intentional change: update baselines (`--update-snapshots`), re-commit.
4. Unintentional regression: fix the code, re-run tests.

---

## Anti-Patterns

### 1. Full-page screenshots without masking
Capturing entire pages without masking dynamic content (timestamps, avatars, live data) produces diffs every run. The team stops trusting visual tests. Always mask dynamic regions and freeze time-dependent content.

### 2. No artifact storage in CI
Running visual tests without uploading screenshot artifacts means a failure has no expected/actual/diff to inspect, forcing local repro that may render differently. Always upload screenshots, diffs, and the report as CI artifacts.

### 3. No review process for baseline updates
Running `--update-snapshots` and committing without reviewing the change bakes regressions into baselines, making them invisible. Every update goes through review of the before/after images, not just the file diff.

### 4. Visual-testing unstable components
Visual tests for components that change by design (A/B tests, personalized content, frequently rotated banners) fail constantly with intentional changes. Exclude them or stub their content.

### 5. Pixel-perfect thresholds on full pages
`maxDiffPixels: 0` on full-page screenshots flags sub-pixel rendering differences from browser/OS/font updates as failures. Use `maxDiffPixelRatio: 0.005` for full pages; reserve zero tolerance for small critical components (logos, icons).

### 6. No consistent rendering environment
Running visual tests on assorted developer machines and expecting baselines to match — font rendering, antialiasing, and scaling differ across platforms. Run in a consistent CI Docker environment and generate baselines there.

### 7. Skipping animation handling
Not disabling animations captures transitions mid-frame, producing random diffs. Use `animations: 'disabled'`, `stylePath` to zero out durations, or `getAnimations().finish()` before capture.

---

## Verification

Prove baselines generate and the comparator runs before calling it done, smallest first:

```bash
npx playwright test --grep @visual          # baselines generate (first run) / compare (later)
npx playwright test --grep @visual --update-snapshots  # regenerate intentionally
npx playwright show-report                  # diff artifacts (expected/actual/diff) render
git check-attr filter -- "e2e/**/*.png"     # prints "filter: lfs" if LFS is wired
```

A clean first run that writes `*-snapshots/*.png` files, plus a second run that passes against them, confirms the pipeline works end to end.

---

## Done When

- Baseline screenshots captured in a consistent CI Docker environment (not locally) and committed.
- `playwright.config.ts` sets a global `maxDiffPixelRatio` AND at least one icon/logo test overrides to `maxDiffPixels: 0`.
- Dynamic content masked or frozen before capture (timestamps, avatars, live API data) via `mask`, `stylePath`, or clock/route stubbing.
- CI pipeline blocks merge when a visual diff exceeds the configured threshold.
- Baselines tracked via Git LFS (`.gitattributes` has `*.png filter=lfs`) OR an off-repo hosted tool, so the repo does not bloat.
- Review workflow defined: who reviews diffs, how intentional changes get baseline updates, and PR reviewers sign off on the baseline images.

## Reference Files (in `references/`)

- **recipes.md** — frozen-data capture (clock + route + font-abort), `stylePath` masking, component-state screenshots, the responsive-viewport loop, Chromatic/Percy/Argos snippets, Storybook-without-Chromatic, and the Docker CI job.

## Related Skills

- **playwright-automation** — foundation for Playwright-based visual tests; Page Object Model, fixtures, and test structure apply here too.
- **ci-cd-integration** — pipeline config for running visual tests, uploading artifacts, and wiring review workflows.
- **cross-browser-testing** — when the goal is a rendering matrix across browsers rather than baseline diffs of one render; viewport/project config overlaps.
- **selector-drift-recovery** — when a redesign broke many baselines at once and you need bulk regeneration, not per-test visual diffs.
- **qa-project-context** — captures which pages are visually critical and what dynamic content exists.
