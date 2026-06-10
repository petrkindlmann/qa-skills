---
name: compliance-testing
description: >-
  Test for regulatory compliance: GDPR/CMP consent verification, Google Consent
  Mode v2, Global Privacy Control (GPC), CCPA/US state opt-out, EU AI Act Article 50
  transparency, Better Ads Standards, and cookie-inventory auditing. Covers automated
  consent-flow testing, third-party script blocking before consent, and cookie drift
  detection.
  Use when: "GDPR test," "compliance," "CMP test," "cookie consent," "consent mode,"
  "CCPA," "GPC," "AI Act," "Better Ads," "privacy banner."
  Not for: WCAG/axe-core test authoring — use accessibility-testing. Not for: OWASP/vuln
  scanning — use security-testing. Not for: evaluating your LLM feature's quality or
  safety — use ai-system-testing.
  Related: accessibility-testing, security-testing, ai-system-testing, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: process
---

<objective>
Compliance is binary: a single analytics cookie that fires before consent, or a "Reject all" rendered as a tiny grey link, is a violation no matter how polished the rest of the flow looks. Manual quarterly audits miss the regression a developer shipped on a Tuesday. This skill automates the technical checks — consent state, script blocking, cookie attributes, GPC, Consent Mode v2, AI Act disclosure — so configuration drift fails CI instead of a regulator's inbox.
</objective>

## Discovery Questions

First, check for `.agents/qa-project-context.md` in the project root — it carries applicable regulations, CMP details, ad networks, and geographic scope. Skip any question already answered there. If it is missing, suggest creating one with the `qa-project-context` skill.

### Applicable regulations
- **Which privacy and platform regulations apply?** This sets the entire test matrix.
  - **EU:** GDPR, ePrivacy Directive (cookies), Digital Services Act (DSA, applied 17 Feb 2024), EU AI Act (prohibitions + AI literacy live since 2 Feb 2025; GPAI obligations + penalties since 2 Aug 2025; Article 50 transparency from 2 Aug 2026 — high-risk obligations postponed, see below).
  - **US:** CCPA/CPRA plus comprehensive state laws now active in ~20 states (Texas TDPSA, Indiana CDPA eff. 1 Jan 2026, Delaware DPDPA, Nebraska NDPA, Minnesota CDPA, Rhode Island DTPPA, …). Most require honoring Global Privacy Control (`Sec-GPC: 1`).
  - **UK:** UK GDPR/DPA, PECR (cookies), Online Safety Act 2023, Data Use and Access Act (DUAA).
  - **Other:** LGPD (Brazil), PIPEDA (Canada), POPIA (South Africa).
- **What is the legal basis for processing?** Consent (opt-in), legitimate interest, or contractual necessity — this decides whether explicit consent must precede processing.
- **Is there a DPO or legal team?** They define the legal requirements; this skill only validates the technical implementation against them.

### Consent management
- **What CMP is in use?** OneTrust, Cookiebot, Didomi, Usercentrics, Iubenda, Sourcepoint, or Axeptio — or custom? The CMP sets the consent storage format, API, and integration. **If you serve ads in the EEA or UK, you must use a Google-certified CMP and Consent Mode v2** — uncertified CMPs block Google ad serving. **As of 28 Feb 2026, new TC strings must be TCF v2.3** or Google demand treats traffic as unconsented and drops to Limited Ads.
- **What consent categories exist?** Typically Strictly Necessary (always on), Analytics/Performance, Functional/Preferences, Marketing/Targeting.
- **How is consent signaled to third-party scripts?** IAB TCF v2 (`__tcfapi`), a custom data layer, or direct CMP API?

### Advertising and accessibility
- **What ad networks and formats?** Google Ads, Meta, programmatic; display, video, interstitial. The Coalition for Better Ads defines which formats trigger Chrome ad-filtering.
- **Are there accessibility obligations (ADA, EAA, Section 508)?** Those are real compliance, but author them in `accessibility-testing` — this skill only maps the legal landscape, see below.

## Core Principles

### 1. Compliance is binary
There is no "mostly compliant." A cookie that fires before consent is a violation. A banner you cannot dismiss without accepting is a violation. Test for exact compliance, not "good enough."

### 2. Automate the technical checks, schedule the legal audits
Automate: cookies before consent, scripts loading without consent, banner functionality, cookie attributes, consent persistence, GPC, Consent Mode signals. A human still audits privacy-policy *language* and cross-border transfer documentation. Don't pretend a test settles a legal-language question.

### 3. Test the unhappy consent states
The compliance boundary lives in the "no interaction," "rejected," and "withdrawn" states — that is where violations hide. The "all accepted" state is the least interesting one to test.

### 4. Verify behavior, not the CMP
CMPs have bugs. Don't trust the CMP UI as proof. Assert the actual outcome: were cookies set, did scripts load, was the GPC opt-out registered. The CMP is an implementation detail; compliance is measured by behavior.

### 5. Defense in depth, config-driven
Verify at multiple layers — CMP config, network requests, cookie state, client signals. Drive tests from a typed inventory and a tracking-domain list so adding a category or threshold is a data edit, not a suite rewrite. Regulations change; the suite must be cheap to update.

## GDPR / CMP Testing with Playwright

Consent-flow compliance breaks into distinct, independently failing checks. Full runnable code for each is in `references/gdpr-cmp-tests.md`.

- **Consent banner and dark patterns** — banner appears on first visit; accept and reject have equal prominence (reject is not a tiny link); a privacy-policy link is present.
- **Cookie state before/after consent** — the critical test: no non-essential cookies before consent; analytics cookies only after accepting; nothing non-essential after rejecting. Maintain `isStrictlyNecessary` / `isAnalyticsCookie` classifiers against your inventory.
- **Consent persistence and withdrawal** — consent survives navigation; the user can withdraw via privacy settings, which must then clear the relevant cookies.
- **Third-party script blocking** — tracking scripts (`google-analytics.com`, `googletagmanager.com`, `facebook.net`, `analytics.tiktok.com`, `bat.bing.com`, …) must not load before consent and should load after acceptance. This is the most critical check — monitor with `page.on('request')`.
- **Global Privacy Control (`Sec-GPC: 1`)** — a required honored signal under CCPA/CPRA and most active US state laws. With the header set, assert `navigator.globalPrivacyControl === true` (the real browser signal) and that marketing cookies are absent. **Do not** assert an invented `window.__cmp.gpcStatus` global — it does not exist; TCF v1's `__cmp` is legacy and TCF v2 uses `__tcfapi`.
- **TCF v2 consent state** — every TCF-certified CMP exposes `window.__tcfapi('getTCData', 2, cb)`. Read purpose/vendor consent through it directly instead of guessing at CMP-private globals; the same call exposes `tcfPolicyVersion`, which doubles as a TCF-v2.3 freshness guard.
- **Google Consent Mode v2** — required since March 2024 for Google ads in the EEA/UK. Default state must be `denied` for `ad_storage` / `analytics_storage` / `ad_user_data` / `ad_personalization`; an `update` signal must fire `granted` after acceptance. The interception assumes the gtag `arguments`-array shape — note the object-form fallback in the reference.

## EU AI Act Compliance

The Act applies in phases, and the timeline shifted in 2026. **Note: the Digital Omnibus (Nov 2025 proposal; 7 May 2026 provisional agreement) postponed the high-risk obligations** — do not test against the old 2 Aug 2026 high-risk date.

| Obligation | Applies | What to test |
|------------|---------|--------------|
| Prohibitions + AI literacy | 2 Feb 2025 (live) | No Article 5 prohibited practices (social scoring, real-time public biometric ID, manipulative AI). Document AI features in scope; gate prohibited libraries. |
| GPAI obligations + penalties | 2 Aug 2025 (live) | Model cards, training-data summaries, copyright-policy and disclosure pages exist. |
| **Article 50 transparency** | **2 Aug 2026** | AI-generated content marked; deepfake disclosure; user told they are interacting with AI. Test the disclosure label/watermark. **Still live on this date.** |
| Machine-readable marking grace | 2 Dec 2026 | Systems already on the market before 2 Aug 2026 get until here to add the watermark/marking (Omnibus compressed six months to three). |
| High-risk (Annex III, use-case) | **2 Dec 2027** | Risk management, data governance, human oversight, transparency UI. **Postponed from 2 Aug 2026** by the Omnibus. |
| High-risk (Annex I, product-regulated) | **2 Aug 2028** | As above, embedded in regulated products. Postponed from 2 Aug 2027. |

Write the Article 50 disclosure test now; defer the high-risk UI tests until the Annex III obligations land. See `references/eu-ai-act-tests.md` for the Article 50 transparency-disclosure test and the Article 5 prohibited-practice (biometric library) gate. For LLM-specific evaluation (hallucination, jailbreak resistance, prompt-injection), use the `ai-system-testing` skill.

## Better Ads Standards

The Coalition for Better Ads defines ad formats that trigger browser-level ad filtering (Chrome filters ads on non-compliant sites).

| Format | Desktop | Mobile | Test approach |
|--------|---------|--------|---------------|
| Pop-up ads | Yes | Yes | Check for modal/overlay within 5s of load without user action |
| Auto-playing video with sound | Yes | Yes | Read the live `video.autoplay` / `video.muted` properties (not the HTML attributes) |
| Prestitial countdown ads | Yes | Yes | Check for a countdown timer blocking content |
| Large sticky ads (>30% viewport) | Yes | Yes | Measure sticky element dimensions vs viewport |
| Ad density >30% | No | Yes | Calculate total ad area vs content area |
| Flashing animated ads | No | Yes | Monitor animation frame rate (>3 flashes/second) |

The muted-video check must read the **live DOM property** (`el.muted`), not `getAttribute('muted')` — player scripts set `video.muted = true` in JS without ever adding the content attribute, so an attribute-only check reports muted ads as having sound and misses muted-then-unmuted ads.

**Note: the CBA added two desktop and two mobile ad experiences on 14 Jan 2025; Chrome assessment of those begins no earlier than 14 May 2026.** Re-check newer combined formats against the current Better Ads Standards page before that date. See `references/better-ads-tests.md` for the auto-playing-video and mobile ad-density checks.

## Cookie Compliance

Maintain a typed cookie inventory as the source of truth, then assert that actual cookies match it on three axes:

- **Inventory** — a `CookieDefinition[]` capturing name, category, purpose, max expiry, and the `Secure` / `HttpOnly` / `SameSite` attributes each cookie must carry.
- **Attribute validation** — every observed cookie must match its definition's flags and not exceed its declared max expiry. Normalize an unset `SameSite` to `None` before comparing — Playwright omits or varies it when the server doesn't set it, so an un-normalized check fails spuriously or passes silently.
- **Drift detection** — fail the suite (`throw`, don't warn) when a cookie appears that is not in the inventory, forcing the inventory to stay current as scripts are added.

See `references/cookie-compliance.md` for the typed inventory and both implementations.

## Accessibility Compliance — legal map only

Accessibility is a legal requirement in many jurisdictions, but author the actual tests in `accessibility-testing` (axe-core, keyboard, screen reader). This table is only the legal landscape so you know what the obligation is.

| Region | Law | Standard | Enforcement |
|--------|-----|----------|-------------|
| EU | European Accessibility Act (EAA) | EN 301 549 / WCAG 2.1 AA | Applied 28 June 2025; member-state penalties active. WCAG 2.2 alignment expected in the next EN 301 549 revision. |
| USA | ADA | WCAG 2.1 AA (court precedent) | Private lawsuits |
| USA (federal) | Section 508 | WCAG 2.0 AA | Federal procurement requirement |
| Canada (Ontario) | AODA | WCAG 2.0 AA | Fines up to $100K/day |
| UK | Equality Act 2010 | WCAG 2.1 AA (guidance) | Lawsuits |

## Scheduled Compliance Audits

Run compliance tests weekly (not just on PR) to catch configuration drift, and retain results as long-lived CI artifacts for the audit trail. See `references/ci-automation.md` for the scheduled GitHub Actions workflow with 90-day artifact retention.

## Anti-Patterns

### Testing only with consent accepted
Running compliance tests only in the "all accepted" state. The compliance boundary is the "no interaction" and "rejected" states — that is where violations hide. Test every state: no interaction, accepted, rejected, partially accepted, withdrawn.

### Asserting an invented CMP global
Checking `window.__cmp.gpcStatus` or similar fabricated globals to "prove" a GPC opt-out. That global does not exist. Assert `navigator.globalPrivacyControl === true` and verify marketing cookies are absent; read real consent state via `__tcfapi`.

### Attribute-only video checks
Treating `getAttribute('muted') === null` as "has sound." The content attribute is frequently absent on programmatically-muted videos. Read `el.muted` / `el.autoplay` live properties instead.

### Hardcoded cookie lists that drift
A cookie inventory nobody updates. Use the drift-detection test that `throw`s on any unknown cookie — reality and inventory stay in sync automatically.

### CMP-only testing
Trusting the CMP and only exercising its UI. CMPs have bugs. Test the outcome: cookies set, scripts loaded, data transmitted.

### Manual-only quarterly audits
Auditing by hand once a quarter. Between audits a developer adds an analytics script that fires before consent and nobody notices for three months. Automated tests catch it on the next CI run.

### Ignoring regional differences
One global consent model. GDPR requires opt-in; CCPA allows opt-out via GPC. Serving both regions means testing both experiences.

### Treating compliance as one-time
Building the suite once and freezing it. Regulations evolve (ePrivacy Regulation, TCF version bumps, AI Act phases, updated CBA standards). Review quarterly.

## Verification

Smallest check first — confirm the compliance suite runs and gates before trusting it:

```bash
npx playwright test --project=chromium --grep @compliance
```

A correct run shows the unhappy-path tests as the gate: "no non-essential cookies before consent" and "no tracking scripts load before consent" must **pass on a fresh context** (`storageState: undefined`). To prove the suite actually catches violations, temporarily point it at a page that loads GA before consent — the script-blocking test must go red. A suite that stays green against a known-bad page is asserting nothing. Then confirm the GPC test sees `navigator.globalPrivacyControl === true` with the `Sec-GPC: 1` header set, and that the Consent Mode default-state test reports `denied` for all four signals.

## Done When

- Applicable regulations identified for the product and geographic audience (GDPR, ePrivacy, DSA, EU AI Act, the relevant US state-law subset, UK OSA/DUAA) and documented in `.agents/qa-project-context.md`.
- Consent flow tested for every entry point: first visit, accept, reject, withdrawal, and cross-navigation persistence — each as a distinct passing test.
- Global Privacy Control honored: with `Sec-GPC: 1`, `navigator.globalPrivacyControl === true` and marketing cookies absent.
- Google Consent Mode v2 verified: default `denied` for `ad_storage` / `analytics_storage` / `ad_user_data` / `ad_personalization`; `update` fires `granted` after accept (only required for sites serving Google ads in EEA/UK).
- EU AI Act applicability assessed: prohibited-practice gate, GPAI documentation review (if applicable), and Article 50 transparency disclosure tested for any AI-generated content.
- Cookie audit complete: all cookies categorized in the typed inventory; drift-detection test passes with zero unknown cookies.
- No undeclared tracking domains or cookies fire that the privacy policy does not disclose (the automatable half — legal-language review is a separate manual/legal sign-off, not a test).
- Compliance suite runs green in the weekly CI job with results stored as artifacts at 90-day retention.

## Related Skills

- **accessibility-testing** — Author the actual WCAG/axe-core/keyboard/screen-reader tests there. This skill only maps the accessibility legal landscape; it does not write a11y assertions.
- **security-testing** — Security compliance (OWASP Top 10:2025, dependency and supply-chain scanning) complements privacy compliance; different threat model, different tools.
- **ai-system-testing** — Defines the eval layer (hallucination, jailbreak, prompt-injection) for AI features. This skill only tests the Article 50 *disclosure*; that skill tests whether the AI itself behaves.
- **ci-cd-integration** — Pipeline configuration for the scheduled weekly audit and compliance quality gates.
- **release-readiness** — A failing compliance gate (consent firing before opt-in, missing AI Act disclosure) is a release blocker; wire this suite into the go/no-go checklist there.

## Reference Files (in `references/`)

- **gdpr-cmp-tests.md** — Playwright code for banners/dark patterns, cookie state before/after consent, persistence and withdrawal, third-party script blocking, Global Privacy Control (`navigator.globalPrivacyControl`), TCF v2 `__tcfapi` consent read + v2.3 version guard, and Google Consent Mode v2.
- **eu-ai-act-tests.md** — Article 50 transparency-disclosure test and the Article 5 prohibited-practice (biometric library) gate, with the Omnibus timeline note.
- **better-ads-tests.md** — Coalition for Better Ads checks: live-property auto-playing-unmuted-video detection and mobile ad-density measurement.
- **cookie-compliance.md** — Typed cookie inventory, attribute validation (with SameSite normalization), and inventory drift detection.
- **ci-automation.md** — Scheduled weekly compliance-audit GitHub Actions workflow with 90-day artifact retention.
