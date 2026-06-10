---
name: cross-browser-testing
description: >-
  Design analytics-driven browser test matrices and execute cross-browser tests.
  Covers BrowserStack/Sauce Labs configuration, Playwright browser channels, common
  cross-browser CSS/JS divergences, a known-issues documentation log, and progressive
  enhancement validation.
  Use when: "cross-browser," "browser matrix," "BrowserStack," "Safari issues,"
  "browser compatibility," "Edge," "works in Chrome but not Safari."
  Not for: pixel-level baseline strategy and threshold tuning — use visual-testing;
  device-farm testing of native/hybrid apps — use mobile-testing.
  Related: visual-testing, playwright-automation, ci-cd-integration, mobile-testing.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
Chrome-only testing gives false confidence: a layout that works in Chromium can break in WebKit, a clipboard call that succeeds in Chrome silently no-ops in Firefox, and a partitioned-cookie flow can pass everywhere except the one engine your users are on. This skill produces an analytics-driven browser matrix, a Playwright (or cloud-platform) config that runs it, and a committed log of known browser divergences — each verified by a test that asserts the user outcome, not the CSS.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Need to decide *which* browsers to test | Browser Matrix Design |
| Already on Playwright, just add browsers | Playwright Browser Configuration → `references/playwright-and-cloud-config.md` |
| Need real Safari/Windows/older OS, not engines | Cloud Platform Setup |
| One browser misbehaves; want a test for it | Common Cross-Browser Issues + `browserName` branch in `references/testing-patterns.md` |
| Need to record a divergence so it is not re-debugged | Known-Issues Log |
| Pixel diffs / baseline thresholds | use `visual-testing` |

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything already answered there. Then:

1. **Target browsers from analytics:** What do actual users use? Pull browser/OS data from your analytics tool. Testing browsers nobody uses is waste; missing a browser 15% of users rely on is a bug.
2. **Desktop and mobile?** Mobile Safari on iOS and Chrome on Android render differently than their desktop counterparts. Treat them as separate matrix entries.
3. **Cloud platform:** BrowserStack, Sauce Labs, LambdaTest, or local engines only? Cloud platforms provide real branded browsers and OSes; Playwright's bundled engines cover Chromium, Firefox, and WebKit (not Chrome/Safari themselves).
4. **Progressive enhancement or pixel-perfect?** Progressive enhancement accepts graceful degradation. Pixel-perfect demands identical rendering. The answer determines pass/fail criteria.
5. **Existing Playwright config?** If the project already uses Playwright, cross-browser testing is a configuration change, not a new tool.

---

## Core Principles

1. **Analytics-driven matrix.** Test what your users actually use. A browser at 0.3% traffic does not need the same investment as one at 40%. Check analytics quarterly — browser share shifts.

2. **Progressive enhancement over pixel-perfect.** Identical rendering across all browsers is neither achievable nor necessary. Define what "works" means: core functionality operates, content is accessible, layout is usable. Visual differences in shadows, gradients, or animation timing are acceptable.

3. **Safari and Firefox surface the most cross-browser bugs.** Chrome-only testing catches Chrome bugs. Safari's WebKit engine and Firefox's Gecko engine have the most behavioral differences from Chromium. Prioritize them.

4. **Test functionality, not rendering-engine internals.** A cross-browser test should verify that the user can complete a task, not that a CSS property renders identically. Visual comparison tools handle pixel-level differences.

5. **Engines are not brands.** Playwright's WebKit is *not* Safari and its Chromium is *not* Chrome — they share an engine, not the shipped product (codecs, fonts, enterprise policy, update cadence all differ). Report "WebKit coverage," not "Safari coverage," unless you ran real Safari on a cloud grid.

6. **One test, multiple browsers.** Write tests once. Run them across browser configurations. Never duplicate test logic for different browsers.

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
## Browser Matrix — Q1 2026 (next-review: 2026-04-01)

| Browser | Version | Platform | Traffic % | Tier | Notes |
|---------|---------|----------|-----------|------|-------|
| Chrome | Latest | Windows | 34% | P0 | |
| Chrome | Latest | macOS | 12% | P0 | |
| Safari | Latest | macOS | 11% | P0 | WebKit-specific issues |
| Chrome | Latest | Android | 15% | P0 | Mobile viewport |
| Safari | Latest | iOS | 14% | P0 | Mobile Safari quirks |
| Firefox | Latest | Windows | 5% | P1 | Gecko rendering |
| Edge | Latest | Windows | 4% | P1 | Chromium-based but different UA/policy |
| Samsung Internet | Latest | Android | 3% | P1 | Chromium fork, lagging engine |
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

Playwright ships three browser *engines* — Chromium, Firefox, WebKit — so no cloud platform is needed for basic engine-level coverage. This is engine coverage, not brand coverage: bundled WebKit ≠ Safari and bundled Chromium ≠ Chrome (see Core Principle 5). Define one project per matrix entry, map mobile devices via `devices[...]`, and drive locally installed branded browsers with the `channel` option.

See `references/playwright-and-cloud-config.md` for the full `playwright.config.ts` project list, branded-channel snippets, and `--project` run commands.

**When to use channels:** When you need real branded behavior that differs from the bundled engine — installed Chrome (`channel: 'chrome'`) or Edge (`channel: 'msedge'`) for extension support, enterprise policy, or codecs. WebKit and Firefox have no channel option; they are always Playwright's bundled engines. Note the `edge` project in the config and the `msedge` channel snippet are illustrative alternatives, not two projects to merge — a config needs one `edge` project, not both.

**`page.screencast()` (Playwright 1.59+, current in 1.60)** captures annotated video of a cross-browser run — useful when a matrix failure needs human review across engines. For agent-driven re-runs and stepping through a failure, use `--ui` (UI mode) or `--debug` (Inspector); `PWDEBUG=1` and `--headed` are the other real entry points. There is no `--debug=cli` flag.

---

## Cloud Platform Setup

Cloud platforms (BrowserStack, Sauce Labs) provide real branded-browser/OS instances Playwright connects to over a CDP/Playwright WebSocket endpoint. Pass credentials and capabilities via environment variables, and keep the platform's `playwrightVersion` aligned with the Playwright version in `package.json` (currently 1.60.x — a client/server mismatch causes socket errors).

**BrowserStack now recommends** the `npx browserstack-node-sdk` runner plus a `client.playwrightVersion` capability (in addition to `browserstack.playwrightVersion`) to keep the client and grid sockets in lock-step. The raw `wsEndpoint`/CDP config below still works for direct connections; use the SDK path for new setups.

See `references/playwright-and-cloud-config.md` for the BrowserStack config (with the `client.playwrightVersion` cap), the Sauce Labs config, and the GitHub Actions parallel matrix that fans out across cloud browsers.

---

## Common Cross-Browser Issues

Real divergences that surface in cross-browser testing, with detection patterns and fixes. The CSS workarounds and Playwright tests for each are in `references/common-browser-issues.md`, covering: partitioned cookies / CHIPS in iframes, `<input type="date">`, the Clipboard API, `scroll-behavior`, `backdrop-filter`, the `<dialog>` element, View Transitions, and Web Animations timing.

### Modern Cross-Browser Gotchas (2026)

The classic Safari-laggard list is mostly resolved (flexbox `gap`, `:has()` shipping, same-document View Transitions are all Baseline). Today's real divergences:

- **Partitioned cookies / partitioned storage:** Chrome's CHIPS (`Partitioned` attribute), Safari's ITP, and Firefox's State Partitioning each behave differently for embedded third-party contexts. Test third-party cookies *in an iframe per engine*, not just "the browser supports cookies." See the runnable per-engine iframe test in `references/common-browser-issues.md`.
- **`:has()` selector performance:** Universally supported since 2023, but a `:has()`-heavy page can have very different style-recalc cost across engines. Watch list — profile if a page feels janky in one engine; visual-regression it in `visual-testing`.
- **View Transitions API:** Same-document transitions are Baseline (Chrome 111, Safari 18, Firefox 144 — Oct 2025), so they are no longer a divergence. **Cross-document** transitions are still the gap: Chrome 126+, Safari 18.2+, Firefox behind a flag. Treat cross-document as progressive enhancement and verify the no-transition fallback.
- **WebDriver BiDi:** Production-ready in Selenium 4, partially supported in Playwright. For new cross-runner projects, BiDi is the convergence point. Watch list.

---

## Known-Issues Log

When a divergence is real and you cannot fix the app immediately, record it in a committed file (`docs/browser-issues.md`) so it is not re-debugged from scratch. The table is the artifact `Done When` checks for, and every row's test must assert the **user outcome, not the CSS property**:

```markdown
| Affected browser | Repro | Workaround / fallback / ticket | Test asserts (user outcome, not CSS) |
|------------------|-------|--------------------------------|--------------------------------------|
| Safari (WebKit) ≤17 | scroll-behavior: smooth is partial | rely on anchor nav; no JS scroll dependency | anchor link puts heading in viewport (`toBeInViewport`) |
| Firefox ≤102 | backdrop-filter unsupported | -webkit- prefix + rgba background fallback | overlay readable; modal content visible |
| Firefox (current) | cross-document View Transitions flagged off | progressive enhancement; instant nav fallback | navigation completes; target page heading visible |
```

Keep one row per divergence. A row with no ticket and no fallback is an open bug, not a documented issue.

---

## Testing Patterns

The core patterns and the rules that govern them:

- **Same test, multiple browsers** — the default. Write the test once; configure projects to run it everywhere. Never duplicate test logic per browser.
- **Browser-specific test logic** — branch on `browserName` only when behavior *genuinely* differs (the WebKit date-input fallback and Chromium-only clipboard permission are real cases). **Rule:** keep this rare. Many browser branches signal application compatibility bugs to fix, not work around.
- **Visual cross-browser comparison** — `toHaveScreenshot` with a `maxDiffPixelRatio` tolerance; each browser project generates its own baseline (`homepage-chromium.png`, `homepage-webkit.png`, …). For threshold strategy and baseline management, use `visual-testing`.
- **Progressive enhancement validation** — abort script requests (Chromium only) and verify core functionality still works via native HTML.

See `references/testing-patterns.md` for the runnable code for all four patterns.

---

## Anti-Patterns

**Testing only on Chrome.** Chrome is the largest desktop share but uses the same engine as Edge, Opera, and Brave. Safari (WebKit) and Firefox (Gecko) surface the real cross-browser issues. Chrome-only testing gives false confidence.

**Reporting WebKit/Chromium as Safari/Chrome.** Bundled engines share rendering, not the shipped browser. Claiming "Safari coverage" off a WebKit project hides codec, font, and policy bugs that only real Safari shows.

**Testing every browser equally.** A browser at 1% traffic share does not need the same investment as one at 30%. Use the tier system to allocate effort proportionally.

**Duplicating tests per browser.** Write tests once, run them across browser projects via configuration. A `checkout.chrome.spec.ts` and `checkout.safari.spec.ts` with identical logic is the wrong shape.

**`browserName` checks everywhere.** Excessive browser branching in tests signals application compatibility issues. Fix the app, do not work around it in tests.

**Pixel-perfect assertions without tolerance.** Font rendering, anti-aliasing, and sub-pixel rounding differ between browsers and platforms. Use `maxDiffPixelRatio` or `maxDiffPixels` in visual comparisons.

**Ignoring mobile browsers.** Mobile Chrome and mobile Safari are not their desktop counterparts — different viewport behavior, touch handling, and CSS support. Test them as separate matrix entries.

**Static browser matrix.** Browser usage changes. A matrix based on data from two years ago is wrong. Review analytics quarterly and update the `next-review` date.

**Documenting a divergence with no fallback or ticket.** A known-issues row that lists no workaround and no open ticket is an undocumented bug pretending to be documented.

---

## Failure Modes

| Symptom | Likely cause | Fix or check |
|---------|--------------|--------------|
| Cloud tests fail with a socket/handshake error | Grid Playwright version ≠ local | Set `playwrightVersion`/`client.playwrightVersion` to match `npx playwright --version`; use the `browserstack-node-sdk` runner |
| Clipboard test passes in Chromium, fails in Firefox/WebKit | `grantPermissions` only works in Chromium | Assert UI feedback (`Copied!`), not the clipboard API; gate `grantPermissions` on `browserName === 'chromium'` |
| Progressive-enhancement test errors in Firefox/WebKit | Script-abort route interception is Chromium-only | Gate the route on `browserName === 'chromium'`; skip the JS-disabled assertion elsewhere |
| WebKit project "passes" but real users on Safari report breakage | WebKit engine ≠ shipped Safari | Add a real-Safari row on a cloud grid for the affected flow |
| Visual baseline diff explodes for one browser only | Single baseline shared across browsers | Generate per-project baselines; each browser keeps its own `*-<project>.png` |
| `:has()`-heavy page janky in one engine only | Style-recalc cost differs by engine | Profile in that engine; reduce `:has()` scope; visual-regress in `visual-testing` |

---

## Done When

- Browser matrix defined using real analytics data (last 90 days), with tier assignments (P0/P1/P2) documented and justified by traffic share, committed to a file carrying a dated `next-review` field.
- Playwright project config (or BrowserStack/Sauce Labs config) reflects the matrix and runs P0 browsers on every PR; cloud configs pin `playwrightVersion` to match `package.json`.
- `docs/browser-issues.md` exists with one row per known divergence: affected browser, repro, workaround/fallback or linked ticket, and the test that asserts the user outcome (not the CSS).
- Common-divergence checklist (partitioned cookies, date inputs, clipboard, scroll behavior, backdrop-filter, `<dialog>`, View Transitions) has a test or a known-issues row for each item relevant to P0/P1 browsers.
- A tracked issue exists for the next quarterly matrix review (or the matrix file's `next-review` date is in the future), so the refresh is not lost.

## Related Skills

- **visual-testing** — Owns pixel-level baseline strategy, threshold tables, and `toHaveScreenshot` config. Go there for *how tolerant* a screenshot diff should be; this skill only decides *which browsers* get a baseline.
- **playwright-automation** — Core Playwright patterns, fixtures, and CI configuration that cross-browser testing builds on.
- **ci-cd-integration** — Pipeline configuration for parallel browser-matrix execution and artifact collection.
- **mobile-testing** — Device-farm and native/hybrid app testing (Appium/Detox); go there when the target is an app, not a browser viewport.
- **accessibility-testing** — Cross-browser accessibility differences (screen-reader behavior, ARIA support) that overlap with this matrix.

## Reference Files (in `references/`)

- **playwright-and-cloud-config.md** — `playwright.config.ts` project list, branded channels, `--project` run commands, and BrowserStack (SDK + `client.playwrightVersion`)/Sauce Labs/CI matrix configs.
- **common-browser-issues.md** — Per-engine partitioned-cookie iframe test, date-input WebKit fallback, clipboard, scroll behavior, backdrop-filter, `<dialog>`, View Transitions, and Web Animations.
- **testing-patterns.md** — Same-test-multiple-browsers, `browserName` branching, visual comparison, and progressive-enhancement code.
