---
name: compliance-testing
description: >-
  Test for regulatory compliance: GDPR/CMP consent verification, Google Consent
  Mode v2, Global Privacy Control (GPC), CCPA/US state opt-out, EU AI Act Article 50
  transparency, Better Ads Standards, and cookie-inventory auditing. Covers automated
  consent-flow testing, policy-based script blocking before consent, and cookie drift
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
  version: "2.1"
  category: process
---

<objective>
A banner can display a rejected state while tracking continues underneath it. This skill tests consent state, policy-based request blocking, storage, GPC, Consent Mode signals, and disclosure behavior against the product's approved requirements. It delivers reproducible technical evidence; passing those checks does not establish legal compliance or CMP certification.
</objective>

## Discovery Questions

First, check for `.agents/qa-project-context.md` in the project root — it carries applicable regulations, CMP details, ad networks, and geographic scope. Skip any question already answered there. If it is missing, suggest creating one with the `qa-project-context` skill.

### Applicable regulations
- **Which privacy and platform regulations apply?** This sets the entire test matrix.
  - **EU:** GDPR, ePrivacy Directive (cookies), Digital Services Act (DSA, applied 17 Feb 2024), EU AI Act (prohibitions + AI literacy live since 2 Feb 2025; GPAI obligations + penalties since 2 Aug 2025; Article 50 transparency from 2 Aug 2026 — high-risk obligations postponed, see below).
  - **US:** CCPA/CPRA and the state laws applicable to the audience. Record the specific opt-out and universal-signal requirements in the regional policy matrix.
  - **UK:** UK GDPR/DPA, PECR (cookies), Online Safety Act 2023, Data Use and Access Act (DUAA).
  - **Other:** LGPD (Brazil), PIPEDA (Canada), POPIA (South Africa).
- **What is the legal basis for processing?** Consent (opt-in), legitimate interest, or contractual necessity — this decides whether explicit consent must precede processing.
- **Is there a DPO or legal team?** They define the legal requirements; this skill only validates the technical implementation against them.

### Consent management
- **What CMP and advertising products are in use?** The CMP sets the storage format, API, and integration. Record the current certification and TCF requirements for the specific products and regions; do not infer them from a CMP API response or a numeric policy-version comparison.
- **What consent categories exist?** Typically Strictly Necessary (always on), Analytics/Performance, Functional/Preferences, Marketing/Targeting.
- **How is consent signaled to third-party scripts?** IAB TCF v2 (`__tcfapi`), a custom data layer, or direct CMP API?
- **Is Google Consent Mode basic or advanced, and what defaults does the regional policy require?** Basic blocks tags until consent; advanced can send permitted measurements without cookies while storage consent is denied. This changes the pre-consent network assertion. See [Google's implementation guide](https://developers.google.com/tag-platform/security/guides/consent).
- **What proves each consent transition has completed?** Identify an application/CMP completion signal that includes scheduled tag work. A visible banner or `networkidle` cannot establish that no delayed tracking will occur.

### Advertising and accessibility
- **What ad networks and formats?** Google Ads, Meta, programmatic; display, video, interstitial. The Coalition for Better Ads defines which formats trigger Chrome ad-filtering.
- **Are there accessibility obligations (ADA, EAA, Section 508)?** Those are real compliance, but author them in `accessibility-testing` — this skill only maps the legal landscape, see below.

## Core Principles

### 1. Make the approved policy the test oracle
Record the expected storage, requests, signals, and UI behavior for each region and consent state. Fail deviations from that matrix. A test proves an observed technical result; legal applicability, permitted processing, and visual dark-pattern judgments require their own review.

### 2. Automate the technical checks, schedule the legal audits
Automate: policy-prohibited cookies and requests, banner functionality, cookie attributes, consent persistence, GPC, and Consent Mode signals. A human still audits privacy-policy language, banner prominence, and cross-border transfer documentation. Don't pretend a minimum button-size assertion settles those questions.

### 3. Test the unhappy consent states
The compliance boundary lives in the "no interaction," "rejected," and "withdrawn" states — that is where violations hide. The "all accepted" state is the least interesting one to test.

### 4. Verify behavior, not the CMP
CMPs have bugs. Don't trust the CMP UI as proof. Assert the actual outcome: were cookies set, did scripts load, was the GPC opt-out registered. The CMP is an implementation detail; compliance is measured by behavior.

### 5. Defense in depth, config-driven
Verify at multiple layers — CMP config, network requests, cookie state, client signals. Drive tests from a typed inventory and a tracking-domain list so adding a category or threshold is a data edit, not a suite rewrite. Regulations change; the suite must be cheap to update.

## GDPR / CMP Testing with Playwright

Consent-flow compliance breaks into distinct, independently failing checks. Full runnable code for each is in `references/gdpr-cmp-tests.md`.

- **Consent banner and controls** — verify first-visit visibility, usable accept/reject controls, and the policy link. Minimum dimensions are a mechanical threshold; assess equal prominence and dark patterns separately.
- **Cookie state before/after consent** — enforce the approved optional-storage policy at completed initialization, acceptance, and rejection. Maintain exact necessary-cookie names and the full inventory; a prefix must not exempt similarly named tracking cookies.
- **Consent persistence and withdrawal** — verify the actual persisted state after navigation and the new update after withdrawal, then check storage and network effects. Use fresh contexts with `storageState: { cookies: [], origins: [] }` for first visits.
- **Third-party request blocking** — attach `page.on('request')` before navigation; match configured hostnames and endpoints rather than URL substrings. Basic mode can require zero tracking requests; advanced mode needs assertions for the permitted denied-state traffic. Include first-party proxies and a real completion milestone.
- **Global Privacy Control** — verify the HTTP header path and the DOM preference path separately. `extraHTTPHeaders: { 'Sec-GPC': '1' }` does not create `navigator.globalPrivacyControl`. Explicitly label DOM emulation, check the recorded opt-out and policy-prohibited behavior, and use a native GPC-enabled browser for browser-support verification. See the [GPC specification](https://w3c.github.io/gpc/).
- **TCF v2 consent state** — use `__tcfapi('addEventListener', 2, callback)`, wait for the relevant completed event, bound failures, and remove the listener. `getTCData` is deprecated. Assert configured purpose/vendor consents; a policy number does not prove TC-string validity, TCF v2.3 freshness, or certification. See the [IAB CMP API](https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md).
- **Google Consent Mode v2** — validate all four signals (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`) against the regional policy and preserve command ordering. Install the observer in every test and checkpoint before each action. Never seed denied defaults in a test of the app's own defaults. The shared adapter observes gtag argument arrays; object events and GTM consent-template APIs need their documented adapters. See `../analytics-tracking-testing/references/consent-mode.md` for the shared helper and basic/advanced distinction.

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
Checking `window.__cmp.gpcStatus` or similar fabricated globals to "prove" a GPC opt-out. Use the CMP's documented state or settings UI and verify the required network/storage outcome. The GPC HTTP header and DOM property are separate inputs; TCF does not define a GPC-status field.

### Tests that supply the missing consent configuration
Pushing a denied default from `addInitScript` while testing application defaults can hide the defect. Observe the app's own commands in every test, retain late updates, and fail observation gaps or replaced data layers instead of repairing them. Pair each gate with a known-good fixture and a targeted broken variant.

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
npx playwright test tests/compliance --project=chromium
```

Place the adapted recipes under `tests/compliance` and configure their real readiness signal and policy inventory. First prove they pass on a known-good fixture in an explicitly empty context. Then point them at controlled broken variants: a delayed prohibited request, a missing default, an incorrect or absent post-action update, ignored GPC, and a CMP callback that never completes. Each corresponding test must fail. Verify the HTTP GPC header independently of an explicitly emulated or natively enabled DOM preference. For advanced mode in the all-denied policy, check all four defaults before measurement; for basic mode, validate defaults and updates when tags initialize after acceptance. Retain the scenarios and observation interval with the result.

## Done When

- Applicable regulations identified for the product and geographic audience (GDPR, ePrivacy, DSA, EU AI Act, the relevant US state-law subset, UK OSA/DUAA) and documented in `.agents/qa-project-context.md`.
- Consent flow tested for every entry point: first visit, accept, reject, withdrawal, and cross-navigation persistence — each as a distinct passing test.
- Global Privacy Control cases pass for the required HTTP and DOM inputs; recorded opt-out and policy-prohibited storage/requests are verified. DOM emulation is identified as emulation.
- Google Consent Mode's four signals and command ordering match the approved region/mode matrix; fresh action checkpoints prove accept, reject, partial consent, and withdrawal updates. The observer supplies no application consent defaults.
- Controlled good and broken fixtures prove each technical gate distinguishes the intended behavior; bounded timeouts and completion markers prevent silent empty observations.
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

- **gdpr-cmp-tests.md** — Playwright code for banner controls, cookie state, persistence/withdrawal, policy-based request blocking, independent GPC inputs, bounded TCF event reads, and Google Consent Mode transitions.
- **eu-ai-act-tests.md** — Article 50 transparency-disclosure test and the Article 5 prohibited-practice (biometric library) gate, with the Omnibus timeline note.
- **better-ads-tests.md** — Coalition for Better Ads checks: live-property auto-playing-unmuted-video detection and mobile ad-density measurement.
- **cookie-compliance.md** — Typed cookie inventory, attribute validation (with SameSite normalization), and inventory drift detection.
- **ci-automation.md** — Scheduled weekly compliance-audit GitHub Actions workflow with 90-day artifact retention.
