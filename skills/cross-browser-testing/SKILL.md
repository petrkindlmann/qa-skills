---
name: cross-browser-testing
description: >-
  Design analytics-driven browser test matrices and execute cross-browser tests.
  Covers BrowserStack/Sauce Labs configuration, Playwright browser channels, common
  cross-browser CSS/JS issues, and progressive enhancement validation.
  Use when: "cross-browser," "browser matrix," "BrowserStack," "Safari issues,"
  "browser compatibility," "IE/Edge."
  Related: visual-testing, playwright-automation, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Design analytics-driven browser test matrices and catch cross-browser issues before users do.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains target browsers, analytics data, and platform priorities that drive matrix design.
</objective>

---

## Discovery Questions

1. **Target browsers from analytics:** What do actual users use? Pull browser/OS data from your analytics tool. Testing browsers nobody uses is waste; missing a browser 15% of users rely on is a bug.
2. **Desktop and mobile?** Mobile Safari on iOS and Chrome on Android have different rendering behaviors than their desktop counterparts. Treat them as separate matrix entries.
3. **Cloud platform:** BrowserStack, Sauce Labs, LambdaTest, or local browsers only? Cloud platforms provide real browser instances; Playwright's built-in browsers cover Chromium, Firefox, and WebKit.
4. **Progressive enhancement or pixel-perfect?** Progressive enhancement accepts graceful degradation. Pixel-perfect demands identical rendering. The answer determines pass/fail criteria.
5. **Existing Playwright config?** If the project already uses Playwright, cross-browser testing is a configuration change, not a new tool.

---

## Core Principles

1. **Analytics-driven matrix.** Test what your users actually use. A browser at 0.3% traffic does not need the same investment as one at 40%. Check analytics quarterly -- browser share shifts.

2. **Progressive enhancement over pixel-perfect.** Identical rendering across all browsers is neither achievable nor necessary. Define what "works" means: core functionality operates, content is accessible, layout is usable. Visual differences in shadows, gradients, or animation timing are acceptable.

3. **Safari and Firefox surface the most cross-browser bugs.** Chrome-only testing catches Chrome bugs. Safari's WebKit engine and Firefox's Gecko engine have the most behavioral differences from Chromium. Prioritize them.

4. **Test functionality, not rendering engine internals.** A cross-browser test should verify that the user can complete a task, not that a CSS property renders identically. Visual comparison tools handle pixel-level differences.

5. **One test, multiple browsers.** Write tests once. Run them across browser configurations. Never duplicate test logic for different browsers.

---

## Browser Matrix Design

### Analytics-Based Methodology

```
Step 1: Export browser/OS data from analytics (last 90 days)
Step 2: Rank by session share
Step 3: Group into tiers
Step 4: Assign test coverage per tier
Step 5: Review quarterly
```

### Tier System

| Tier | Criteria | Coverage | When to run |
|------|----------|----------|-------------|
| **P0** | >10% traffic share | Full test suite | Every PR, every deploy |
| **P1** | 3-10% traffic share | Smoke + critical paths | Nightly, pre-release |
| **P2** | 1-3% traffic share | Smoke tests only | Weekly, pre-release |
| **Skip** | <1% traffic share | Not tested | Manual spot-check if reported |

### Example Matrix (derived from analytics)

```markdown
## Browser Matrix — Q1 2026

| Browser | Version | Platform | Traffic % | Tier | Notes |
|---------|---------|----------|-----------|------|-------|
| Chrome | Latest | Windows | 34% | P0 | |
| Chrome | Latest | macOS | 12% | P0 | |
| Safari | Latest | macOS | 11% | P0 | WebKit-specific issues |
| Chrome | Latest | Android | 15% | P0 | Mobile viewport |
| Safari | Latest | iOS | 14% | P0 | Mobile Safari quirks |
| Firefox | Latest | Windows | 5% | P1 | Gecko rendering |
| Edge | Latest | Windows | 4% | P1 | Chromium-based but different UA |
| Samsung Internet | Latest | Android | 3% | P1 | Chromium fork, older engine |
| Firefox | Latest | macOS | 1.5% | P2 | |
| Chrome | N-1 | Windows | 1.2% | P2 | Previous major version |
```

### Version Coverage Strategy

- **Latest:** Always test current stable release.
- **Latest - 1:** Test previous major version only for P0 browsers where analytics show >1% on older versions.
- **Extended Support Release (ESR):** Test Firefox ESR only if enterprise users are a significant segment.
- **Do not test:** Beta/Canary/Nightly releases unless you are a browser vendor or building browser-facing tools.

---

## Playwright Browser Configuration

Playwright ships three browser engines (Chromium, Firefox, WebKit) — no cloud platform needed for basic cross-browser coverage. Define one project per matrix entry, map mobile devices via `devices[...]`, and drive locally installed branded browsers with the `channel` option.

See `references/playwright-and-cloud-config.md` for the full `playwright.config.ts` project list, branded-channel snippets, and `--project` run commands.

**When to use channels:** When you need to test browser-specific behavior that differs between Chromium and Chrome (extensions support, enterprise policies, codec support). WebKit and Firefox are always Playwright's bundled versions (no channel option).

**Playwright 1.59+ adds `page.screencast()`** — capture annotated video of cross-browser test runs. Useful when a matrix failure needs human review across browsers; pair with `--debug=cli` for agent-driven re-runs.

---

## Cloud Platform Setup

Cloud platforms (BrowserStack, Sauce Labs) provide real browser/OS instances Playwright connects to over a CDP/Playwright WebSocket endpoint. Pass credentials and capabilities via environment variables, and keep the platform's `playwrightVersion` aligned with `package.json`.

See `references/playwright-and-cloud-config.md` for the BrowserStack config, Sauce Labs config, and the GitHub Actions parallel matrix that fans out across cloud browsers.

---

## Common Cross-Browser Issues

Real issues that surface in cross-browser testing, with detection patterns and fixes. The CSS workarounds and Playwright tests for each are in `references/common-browser-issues.md`, covering: CSS Grid/Flexbox `gap`, `scroll-behavior`, `<input type="date">`, the Clipboard API, `backdrop-filter`, the `<dialog>` element, and Web Animations timing.

### Modern Cross-Browser Gotchas (2026)

The classic Safari laggard list is mostly resolved. Today's real divergences:

- **Partitioned cookies / partitioned storage:** Chrome's CHIPS, Safari's ITP, and Firefox's State Partitioning each behave differently for embedded contexts. Test third-party cookies in iframes per browser, not just per "browser supports cookies."
- **`:has()` selector edge cases:** Universal support but performance and specificity edge cases differ. Visual-regression a `:has()`-heavy page across all three engines.
- **View Transitions API:** Chrome and Edge ship same-document and cross-document; Safari has partial support; Firefox is behind. Treat as progressive enhancement and verify the fallback path in Firefox/older Safari.
- **WebDriver BiDi:** Production-ready in Selenium 4, partially supported in Playwright. For new cross-runner projects, BiDi is the convergence point.

---

## Testing Patterns

The four core patterns and the rules that govern them:

- **Same test, multiple browsers** — the default. Write the test once; configure projects to run it everywhere. Never duplicate test logic per browser.
- **Browser-specific test logic** — branch on `browserName` only when behavior genuinely differs. **Rule:** this should be rare. Many browser branches signal application compatibility bugs to fix, not work around.
- **Visual cross-browser comparison** — use `toHaveScreenshot` with a `maxDiffPixelRatio` tolerance; each browser project generates its own baseline.
- **Progressive enhancement validation** — abort script requests (Chromium only) and verify core functionality still works via native HTML.

See `references/testing-patterns.md` for the runnable code for all four patterns.

---

## Anti-Patterns

**Testing only on Chrome.** Chrome is ~65% of desktop traffic but uses the same engine as Edge, Opera, and Brave. Safari (WebKit) and Firefox (Gecko) surface the real cross-browser issues. Chrome-only testing gives false confidence.

**Testing every browser equally.** A browser at 1% traffic share does not need the same test investment as one at 30%. Use the tier system to allocate effort proportionally.

**Duplicating tests per browser.** Write tests once, run them across browser projects via configuration. If you have a `checkout.chrome.spec.ts` and a `checkout.safari.spec.ts` with the same test logic, you are doing it wrong.

**Using `browserName` checks everywhere.** Excessive browser branching in tests signals application compatibility issues. Fix the app, do not work around it in tests.

**Pixel-perfect assertions without tolerance.** Font rendering, anti-aliasing, and sub-pixel rounding differ between browsers and platforms. Use `maxDiffPixelRatio` or `maxDiffPixels` in visual comparisons.

**Ignoring mobile browsers.** Mobile Chrome and mobile Safari are not the same as their desktop counterparts. They have different viewport behaviors, touch event handling, and CSS support. Test them as separate matrix entries.

**Static browser matrix.** Browser usage changes. If your matrix is based on data from 2 years ago, it is wrong. Review analytics data quarterly.

---

## Done When

- Browser matrix defined using real analytics data (last 90 days), with tier assignments (P0/P1/P2) documented and justified by traffic share.
- Playwright project config (or BrowserStack/Sauce Labs config) reflects the defined matrix and runs P0 browsers on every PR.
- Known browser-specific bugs documented with the affected browser, reproduction steps, and either a workaround or a linked open ticket.
- Rendering issues checklist (flexbox gaps, scroll behavior, date inputs, clipboard API, dialog element) run against all P0 and P1 target browsers.
- Browser matrix reviewed and signed off by the team, with a calendar reminder set for quarterly refresh against updated analytics data.

## Reference Files (in `references/`)

- **playwright-and-cloud-config.md** — `playwright.config.ts` project list, branded channels, `--project` run commands, and BrowserStack/Sauce Labs/CI matrix configs.
- **common-browser-issues.md** — CSS workarounds and Playwright tests for flexbox `gap`, scroll behavior, date inputs, clipboard, backdrop-filter, `<dialog>`, and Web Animations.
- **testing-patterns.md** — Same-test-multiple-browsers, `browserName` branching, visual comparison, and progressive-enhancement code.

## Related Skills

- **visual-testing** -- Screenshot comparison, baseline management, and threshold strategies for pixel-level cross-browser validation.
- **playwright-automation** -- Core Playwright patterns, fixtures, and CI configuration that cross-browser testing builds on.
- **ci-cd-integration** -- Pipeline configuration for parallel browser matrix execution, artifact collection.
- **accessibility-testing** -- Cross-browser accessibility differences (screen reader behavior, ARIA support) overlap with cross-browser testing.
- **mobile-testing** -- Device-specific testing for native/hybrid apps extends the browser matrix to app-level concerns.
