---
name: compliance-testing
description: >-
  Test for regulatory compliance including GDPR/CMP consent verification, Better Ads
  Standards, cookie compliance auditing, and privacy policy validation. Covers
  automated consent flow testing, third-party script blocking before consent,
  and cookie inventory validation. Use when: "GDPR test," "compliance," "CMP test,"
  "cookie consent," "Better Ads," "privacy," "consent banner."
  Related: accessibility-testing, security-testing, ci-cd-integration.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: process
---

<objective>
Test applications for regulatory compliance, focusing on privacy regulations (GDPR, CCPA, ePrivacy), consent management, cookie governance, and advertising standards. Compliance is binary -- you either comply or you do not -- and the penalties for non-compliance are significant. Automated testing catches configuration drift and regressions that manual audits miss between review cycles.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains applicable regulations, CMP details, ad networks, and geographic requirements that determine which compliance tests to implement.
</objective>

---

## Discovery Questions

### Applicable Regulations

1. **Which privacy and platform regulations apply?**
   - **EU:** GDPR, ePrivacy Directive (cookies), Digital Services Act (DSA — applied 17 Feb 2024), EU AI Act (prohibitions + literacy from 2 Feb 2025; GPAI obligations + penalties from 2 Aug 2025; full applicability 2 Aug 2026).
   - **US:** CCPA/CPRA (California) plus comprehensive state laws now active in ~20 states — including Texas TDPSA, Indiana CDPA (eff. 1 Jan 2026), Delaware DPDPA (eff. 1 Jan 2025), Nebraska NDPA, Minnesota CDPA, Rhode Island DTPPA. Most require honoring the Global Privacy Control (`Sec-GPC: 1`) signal.
   - **UK:** UK GDPR/DPA, ePrivacy via PECR, Online Safety Act 2023, Data Use and Access Act (DUAA) replacing parts of UK GDPR/DPA.
   - **Other:** LGPD (Brazil), PIPEDA (Canada), POPIA (South Africa).

   Multiple regulations apply simultaneously when you serve users in multiple regions. AI features layer EU AI Act obligations on top of existing privacy law.

2. **What is the legal basis for data processing?** Consent (opt-in), legitimate interest, contractual necessity? This determines whether explicit consent is required before processing.

3. **Is there a DPO or legal team to consult?** Compliance testing validates technical implementation against legal requirements. The legal team defines those requirements.

### Consent Management

4. **What CMP is in use?** OneTrust, Cookiebot (now a Usercentrics product), Didomi, Usercentrics, Iubenda, Sourcepoint, Axeptio, or custom? The CMP determines consent storage format, API, and integration patterns. **If you serve ads in the EEA or UK, you must use a Google-certified CMP and implement Google Consent Mode v2** — uncertified CMPs block Google ad serving.

5. **What consent categories exist?** Typically: Strictly Necessary (always allowed), Analytics/Performance, Functional/Preferences, Marketing/Targeting.

6. **How is consent communicated to third-party scripts?** TCF (Transparency and Consent Framework)? Custom data layer? Direct CMP API?

### Advertising and Accessibility

7. **What ad networks and formats are used?** Google Ads, Meta, programmatic? Display, video, interstitial? The Coalition for Better Ads defines acceptable formats.

8. **Are there accessibility compliance requirements?** ADA, EAA, Section 508? See the `accessibility-testing` skill for detailed WCAG testing.

---

## Core Principles

### 1. Compliance Is Binary
There is no "mostly compliant." A cookie that fires before consent is a violation. A consent banner that cannot be dismissed without accepting is a violation. Test for exact compliance.

### 2. Automate What You Can, Audit What You Cannot
Automated tests catch: cookies set before consent, scripts loading without consent, consent banner functionality, cookie attributes, consent persistence. Manual audits catch: privacy policy accuracy, legal language correctness, cross-border data transfer documentation. Automate the technical checks; schedule the legal audits.

### 3. Test From the User Perspective
Compliance regulations are written from the user's perspective. Tests should simulate real user interactions with the consent flow, not just check backend state.

### 4. Regulations Change, Tests Must Be Updatable
New regulations emerge regularly. Structure compliance tests with configuration-driven test data so that changing a threshold or adding a cookie category does not require rewriting the suite.

### 5. Defense in Depth
Do not rely solely on the CMP. Verify at multiple layers: CMP configuration, CSP headers, script loading behavior, cookie state, and network requests.

---

## GDPR/CMP Testing with Playwright

Consent-flow compliance is tested across five distinct areas. Full runnable code for each is in `references/gdpr-cmp-tests.md`.

- **Consent banner and dark patterns** — banner appears on first visit, accept/reject have equal prominence (reject is not a tiny link), and a privacy-policy link is present.
- **Cookie state before/after consent** — the critical test: no non-essential cookies before consent; analytics cookies appear only after accepting; nothing non-essential after rejecting. Maintain `isStrictlyNecessary` / `isAnalyticsCookie` classifiers against your cookie inventory.
- **Consent persistence and withdrawal** — consent persists across navigations, and the user can withdraw it via privacy settings (which must then clear the relevant cookies).
- **Third-party script blocking** — tracking scripts (`google-analytics.com`, `googletagmanager.com`, `facebook.net`, etc.) must not load before consent and should load after acceptance. This is the most critical check.
- **Global Privacy Control (`Sec-GPC: 1`)** — a required honored signal under CCPA/CPRA and most active US state laws. With the header set, marketing cookies must be absent and the CMP must register the opt-out.
- **Google Consent Mode v2** — required since March 2024 for Google ads in the EEA/UK. Default state must be `denied` for `ad_storage`/`analytics_storage`/`ad_user_data`/`ad_personalization`; an `update` signal must fire `granted` after acceptance.

See `references/gdpr-cmp-tests.md` for all of the above.

---

## EU AI Act Compliance

The AI Act applies in phases. Test patterns differ by AI system role and risk class.

| Phase | Date | Obligation | Test approach |
|-------|------|------------|---------------|
| Prohibitions + AI literacy | 2 Feb 2025 (active) | No prohibited practices (social scoring, real-time biometric ID in public spaces, manipulative AI) | Document the AI features in scope; verify none fall under Article 5 |
| GPAI obligations + governance + penalties | 2 Aug 2025 (active) | GPAI documentation, copyright policy, summary of training data | Verify model cards, data summaries, and disclosure pages exist |
| Full applicability | 2 Aug 2026 | High-risk system requirements (risk management, data governance, transparency, human oversight) | High-risk classification check; transparency UI tests |
| Article 50 transparency | Phased into 2026 | AI-generated content marked; deepfake disclosure; user awareness of AI interaction | Test that AI-generated text/images carry the required label or watermark |

See `references/eu-ai-act-tests.md` for the Article 50 transparency-disclosure test and the Article 5 prohibited-practice (biometric library) gate.

For LLM-specific evaluation (hallucination, jailbreak resistance, prompt-injection), see the `ai-system-testing` skill.

---

## Better Ads Standards

The Coalition for Better Ads defines ad formats that trigger browser-level ad blocking (Chrome filters ads on non-compliant sites).

### Unacceptable Ad Formats

| Format | Desktop | Mobile | Test Approach |
|--------|---------|--------|---------------|
| Pop-up ads | Yes | Yes | Check for modal/overlay within 5s of load without user action |
| Auto-playing video with sound | Yes | Yes | Monitor `<video>` elements for autoplay without muted attribute |
| Prestitial countdown ads | Yes | Yes | Check for countdown timer blocking content |
| Large sticky ads (>30% viewport) | Yes | Yes | Measure sticky element dimensions vs viewport |
| Ad density >30% | No | Yes | Calculate total ad area vs content area |
| Flashing animated ads | No | Yes | Monitor animation frame rate (>3 flashes/second) |

See `references/better-ads-tests.md` for automated checks covering auto-playing unmuted video and mobile ad-density measurement.

---

## Cookie Compliance

Maintain a typed cookie inventory as the source of truth, then assert that actual cookies match it on three axes:

- **Inventory** — a `CookieDefinition[]` capturing name, category, purpose, max expiry, and the `Secure`/`HttpOnly`/`SameSite` attributes each cookie must carry.
- **Attribute validation** — every observed cookie must match its inventory definition's flags and must not exceed its declared max expiry.
- **Drift detection** — fail the suite when a cookie appears that is not in the inventory, forcing the inventory to stay current as new scripts are added.

See `references/cookie-compliance.md` for the typed inventory and both test implementations.

---

## Accessibility Compliance

Accessibility is a legal requirement in many jurisdictions. See the `accessibility-testing` skill for detailed WCAG patterns.

| Region | Law | Standard | Enforcement |
|--------|-----|----------|-------------|
| EU | European Accessibility Act (EAA) | EN 301 549 / WCAG 2.1 AA | Applied 28 June 2025; member-state penalties active. WCAG 2.2 alignment expected in next EN 301 549 revision (ISO/IEC 40500:2025 = WCAG 2.2). |
| USA | ADA | WCAG 2.1 AA (court precedent) | Private lawsuits |
| USA (federal) | Section 508 | WCAG 2.0 AA | Federal procurement requirement |
| Canada (Ontario) | AODA | WCAG 2.0 AA | Fines up to $100K/day |
| UK | Equality Act 2010 | WCAG 2.1 AA (guidance) | Lawsuits |

**Key actions:** Run automated axe-core scans on all pages, conduct keyboard navigation audits, test with at least one screen reader, document VPAT for enterprise sales, schedule quarterly manual audits, maintain an accessibility statement.

---

## Automation Patterns

### Scheduled Compliance Audits

Run compliance tests weekly (not just on PR) to catch configuration drift, and retain the results as long-lived CI artifacts for the audit trail. See `references/ci-automation.md` for the scheduled GitHub Actions workflow with 90-day artifact retention.

---

## Anti-Patterns

### Testing Only With Consent Accepted
Running compliance tests only in the "all accepted" state. The critical compliance boundary is the "no consent" and "rejected" states -- those are where violations hide. Test all consent states: no interaction, accepted, rejected, partially accepted, and withdrawn.

### Hardcoded Cookie Lists That Drift
Maintaining a cookie inventory that nobody updates when new scripts are added. Use the inventory drift detection test to catch this automatically -- the test fails when reality diverges from the inventory.

### CMP-Only Testing
Trusting the CMP to handle everything and only testing the CMP UI. CMPs have bugs. Test the actual outcome: are cookies set? Are scripts loaded? Is data transmitted? The CMP is an implementation detail -- compliance is measured by behavior.

### Manual-Only Compliance Audits
Performing compliance audits manually once a quarter. Between audits, a developer adds a new analytics script that fires before consent, and nobody notices for three months. Automated tests catch regressions immediately.

### Ignoring Regional Differences
Applying one consent model globally. GDPR requires opt-in; CCPA allows opt-out. If you serve users in both regions, test the consent experience for each region's requirements.

### Treating Compliance as a One-Time Project
Building compliance tests once and never updating them. Regulations evolve (ePrivacy Regulation, new browser privacy features, updated CBA standards). Review compliance tests quarterly.

---

## Done When

- Applicable regulations identified for the product and geographic audience (GDPR, ePrivacy, DSA, EU AI Act, US state laws including the relevant subset of ~20, UK OSA/DUAA, etc.) and documented in `.agents/qa-project-context.md`
- Consent management flow tested for all user entry points: first visit, banner accept, banner reject, consent withdrawal, and cross-navigation persistence
- Global Privacy Control (`Sec-GPC: 1`) honored: marketing cookies blocked and opt-out registered when the signal is present
- Google Consent Mode v2 verified: default state denied for `ad_storage`/`analytics_storage`/`ad_user_data`/`ad_personalization`; update signals fire correctly after consent choices (only required for sites serving Google ads in EEA/UK)
- EU AI Act applicability assessed: prohibited-practice check, GPAI documentation review (if applicable), and Article 50 transparency disclosures tested for any AI-generated content
- Cookie audit completed with all cookies categorized in the typed inventory and no unknown cookies detected by the drift test
- Privacy policy accuracy verified against actual data collection behavior (no cookies or tracking scripts present that the policy doesn't disclose)
- Compliance test results stored as CI artifacts with 90-day retention to support audit trail requirements

## Reference Files (in `references/`)

- **gdpr-cmp-tests.md** — Playwright code for consent banners/dark patterns, cookie state before/after consent, persistence and withdrawal, third-party script blocking, Global Privacy Control, and Google Consent Mode v2.
- **eu-ai-act-tests.md** — Article 50 transparency-disclosure test and the Article 5 prohibited-practice (biometric library) gate.
- **better-ads-tests.md** — Coalition for Better Ads checks: auto-playing unmuted video and mobile ad-density measurement.
- **cookie-compliance.md** — Typed cookie inventory, attribute validation, and inventory drift detection.
- **ci-automation.md** — Scheduled weekly compliance-audit GitHub Actions workflow with 90-day artifact retention.

## Related Skills

- **accessibility-testing** -- Detailed WCAG testing patterns with axe-core and Playwright for the accessibility subset of compliance.
- **security-testing** -- Security compliance (OWASP Top 10:2025, dependency scanning, supply-chain attestations) complements privacy compliance.
- **ai-system-testing** -- EU AI Act Article 50 transparency tests need AI-feature eval suites; that skill defines the eval layer.
- **ci-cd-integration** -- Pipeline configuration for scheduled compliance audits and quality gates.
- **test-strategy** -- Compliance testing should be a defined test type in the overall strategy.
- **release-readiness** -- Compliance gates often block release; cross-link AI Configs / kill switches for AI-feature releases.
- **quality-postmortem** -- When a compliance violation reaches production, the postmortem identifies root cause and prevention.
