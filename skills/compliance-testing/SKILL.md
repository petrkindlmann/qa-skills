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

# Compliance Testing

Test applications for regulatory compliance, focusing on privacy regulations (GDPR, CCPA, ePrivacy), consent management, cookie governance, and advertising standards. Compliance is binary -- you either comply or you do not -- and the penalties for non-compliance are significant. Automated testing catches configuration drift and regressions that manual audits miss between review cycles.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains applicable regulations, CMP details, ad networks, and geographic requirements that determine which compliance tests to implement.

---

## Discovery Questions

### Applicable Regulations

1. **Which privacy regulations apply?** GDPR (EU users), CCPA/CPRA (California), ePrivacy Directive (EU cookies), LGPD (Brazil), PIPEDA (Canada). Multiple regulations may apply simultaneously if you serve users in multiple regions.

2. **What is the legal basis for data processing?** Consent (opt-in), legitimate interest, contractual necessity? This determines whether explicit consent is required before processing.

3. **Is there a DPO or legal team to consult?** Compliance testing validates technical implementation against legal requirements. The legal team defines those requirements.

### Consent Management

4. **What CMP is in use?** OneTrust, Cookiebot, Didomi, Usercentrics, or custom? The CMP determines consent storage format, API, and integration patterns.

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

### Consent Banner and Dark Pattern Checks

```typescript
import { test, expect } from '@playwright/test';

test.describe('GDPR Consent Banner', () => {
  test.use({ storageState: undefined }); // Fresh context — first visit

  test('consent banner appears on first visit', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('dialog', { name: /cookie|consent|privacy/i });
    await expect(banner).toBeVisible({ timeout: 5000 });
  });

  test('banner provides accept and reject with equal prominence', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('dialog', { name: /cookie|consent|privacy/i });
    const acceptBtn = banner.getByRole('button', { name: /accept|agree|allow/i });
    const rejectBtn = banner.getByRole('button', { name: /reject|decline|deny/i });

    await expect(acceptBtn).toBeVisible();
    await expect(rejectBtn).toBeVisible();

    // Dark pattern check: reject button must be reasonably sized, not a tiny link
    const rejectBox = await rejectBtn.boundingBox();
    expect(rejectBox).not.toBeNull();
    expect(rejectBox!.width).toBeGreaterThan(60);
    expect(rejectBox!.height).toBeGreaterThan(30);
  });

  test('banner links to privacy policy', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByRole('dialog', { name: /cookie|consent|privacy/i });
    const policyLink = banner.getByRole('link', { name: /privacy policy|learn more/i });
    await expect(policyLink).toBeVisible();
    await expect(policyLink).toHaveAttribute('href', /privacy/);
  });
});
```

### Cookie State Before and After Consent

The critical test: no non-essential cookies may be set before the user gives consent.

```typescript
// Cookie classification helpers — maintain based on your cookie inventory
function isStrictlyNecessary(name: string): boolean {
  const necessary = ['__Host-session', 'csrf_token', '__cf_bm', 'consent_status'];
  return necessary.some((n) => name.startsWith(n));
}

function isAnalyticsCookie(name: string): boolean {
  return ['_ga', '_gid', '_gat', '_gtag', 'analytics_'].some((p) => name.startsWith(p));
}

test.describe('Cookie Consent Compliance', () => {
  test.use({ storageState: undefined });

  test('no non-essential cookies before consent', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: /cookie|consent/i })).toBeVisible();

    const cookies = await context.cookies();
    const violations = cookies.filter((c) => !isStrictlyNecessary(c.name));
    expect(violations.map((c) => c.name), 'Non-essential cookies set before consent').toHaveLength(0);
  });

  test('analytics cookies appear after accepting consent', async ({ page, context }) => {
    await page.goto('/');
    const banner = page.getByRole('dialog', { name: /cookie|consent/i });
    await banner.getByRole('button', { name: /accept|agree/i }).click();
    await page.waitForTimeout(1000); // Allow async cookie setting

    const cookies = await context.cookies();
    expect(cookies.filter((c) => isAnalyticsCookie(c.name)).length).toBeGreaterThan(0);
  });

  test('no non-essential cookies after rejecting consent', async ({ page, context }) => {
    await page.goto('/');
    const banner = page.getByRole('dialog', { name: /cookie|consent/i });
    await banner.getByRole('button', { name: /reject|decline|deny/i }).click();
    await page.waitForTimeout(1000);

    const cookies = await context.cookies();
    const violations = cookies.filter((c) => !isStrictlyNecessary(c.name));
    expect(violations.map((c) => c.name), 'Non-essential cookies after rejection').toHaveLength(0);
  });
});
```

### Consent Persistence and Withdrawal

```typescript
test.describe('Consent Persistence', () => {
  test.use({ storageState: undefined });

  test('consent persists across navigations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('dialog', { name: /consent/i }).getByRole('button', { name: /accept/i }).click();
    await page.goto('/about');
    await expect(page.getByRole('dialog', { name: /consent/i })).toBeHidden({ timeout: 3000 });
  });

  test('user can withdraw consent via privacy settings', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('dialog', { name: /consent/i }).getByRole('button', { name: /accept/i }).click();

    await page.goto('/privacy-settings');
    const analyticsToggle = page.getByRole('checkbox', { name: /analytics/i });
    if (await analyticsToggle.isChecked()) await analyticsToggle.uncheck();
    await page.getByRole('button', { name: /save/i }).click();

    await page.waitForTimeout(1000);
    const cookies = await context.cookies();
    expect(cookies.filter((c) => isAnalyticsCookie(c.name))).toHaveLength(0);
  });
});
```

### Third-Party Script Blocking Before Consent

The most critical compliance check: tracking scripts must not load before consent.

```typescript
test.describe('Script Blocking', () => {
  test.use({ storageState: undefined });

  test('no tracking scripts load before consent', async ({ page }) => {
    const trackingDomains = [
      'google-analytics.com', 'googletagmanager.com', 'facebook.net',
      'connect.facebook.net', 'analytics.tiktok.com', 'bat.bing.com',
    ];
    const violations: string[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (trackingDomains.some((d) => url.includes(d))) violations.push(url);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(violations, `Tracking scripts before consent:\n${violations.join('\n')}`).toHaveLength(0);
  });

  test('tracking scripts load after consent acceptance', async ({ page }) => {
    const trackerLoaded: string[] = [];
    page.on('request', (req) => {
      if (/google-analytics|googletagmanager/.test(req.url())) trackerLoaded.push(req.url());
    });

    await page.goto('/');
    await page.getByRole('dialog', { name: /consent/i }).getByRole('button', { name: /accept/i }).click();
    await page.waitForTimeout(3000);

    expect(trackerLoaded.length, 'Analytics should load after consent').toBeGreaterThan(0);
  });
});
```

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

### Automated Better Ads Checks

```typescript
test.describe('Better Ads Compliance', () => {
  test('no auto-playing video ads with sound', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const videos = page.locator('video');
    for (let i = 0; i < await videos.count(); i++) {
      const video = videos.nth(i);
      const autoplay = await video.getAttribute('autoplay');
      const muted = await video.getAttribute('muted');
      if (autoplay !== null && muted === null) {
        throw new Error(`Auto-playing unmuted video: ${await video.evaluate((el) => el.outerHTML.slice(0, 200))}`);
      }
    }
  });

  test('mobile: ad density below 30%', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/article/sample-article');
    await page.waitForLoadState('networkidle');

    const banner = page.getByRole('dialog', { name: /consent/i });
    if (await banner.isVisible()) await banner.getByRole('button', { name: /accept/i }).click();
    await page.waitForTimeout(3000);

    const adElements = page.locator('[class*="ad-"], [id*="ad-"], [data-ad], iframe[src*="doubleclick"]');
    let totalAdHeight = 0;
    for (let i = 0; i < await adElements.count(); i++) {
      const box = await adElements.nth(i).boundingBox();
      if (box) totalAdHeight += box.height;
    }

    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(totalAdHeight / pageHeight, `Ad density: ${Math.round(totalAdHeight / pageHeight * 100)}%`).toBeLessThan(0.30);
  });
});
```

---

## Cookie Compliance

### Cookie Inventory

Maintain a typed cookie inventory as the source of truth. Test that actual cookies match the inventory.

```typescript
// cookie-inventory.ts
interface CookieDefinition {
  name: string;
  category: 'necessary' | 'analytics' | 'functional' | 'marketing';
  purpose: string;
  maxExpiry: number;     // Maximum days
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export const COOKIE_INVENTORY: CookieDefinition[] = [
  { name: '__Host-session', category: 'necessary', purpose: 'Session ID',
    maxExpiry: 1, secure: true, httpOnly: true, sameSite: 'Lax' },
  { name: 'csrf_token', category: 'necessary', purpose: 'CSRF protection',
    maxExpiry: 1, secure: true, httpOnly: true, sameSite: 'Strict' },
  { name: 'consent_status', category: 'necessary', purpose: 'Consent choice',
    maxExpiry: 365, secure: true, httpOnly: false, sameSite: 'Lax' },
  { name: '_ga', category: 'analytics', purpose: 'GA client ID',
    maxExpiry: 730, secure: true, httpOnly: false, sameSite: 'Lax' },
  { name: '_fbp', category: 'marketing', purpose: 'Facebook Pixel',
    maxExpiry: 90, secure: true, httpOnly: false, sameSite: 'Lax' },
];
```

### Cookie Attribute Validation

```typescript
test('all cookies match inventory attributes', async ({ page, context }) => {
  await page.goto('/');
  const banner = page.getByRole('dialog', { name: /consent/i });
  if (await banner.isVisible()) await banner.getByRole('button', { name: /accept/i }).click();
  await page.goto('/dashboard');
  await page.waitForTimeout(2000);

  const cookies = await context.cookies();
  const violations: string[] = [];

  for (const cookie of cookies) {
    const def = COOKIE_INVENTORY.find((d) => cookie.name === d.name || cookie.name.startsWith(d.name));
    if (!def) { violations.push(`Unknown cookie: "${cookie.name}" (${cookie.domain})`); continue; }

    if (def.secure && !cookie.secure) violations.push(`${cookie.name}: missing Secure flag`);
    if (def.httpOnly && !cookie.httpOnly) violations.push(`${cookie.name}: missing HttpOnly flag`);
    if (cookie.sameSite !== def.sameSite) violations.push(`${cookie.name}: SameSite "${cookie.sameSite}" != "${def.sameSite}"`);

    if (cookie.expires > 0) {
      const days = (cookie.expires - Date.now() / 1000) / 86400;
      if (days > def.maxExpiry) violations.push(`${cookie.name}: expires in ${Math.round(days)}d, max ${def.maxExpiry}d`);
    }
  }

  expect(violations, violations.join('\n')).toHaveLength(0);
});
```

### Cookie Inventory Drift Detection

Detect when new cookies appear that are not in the inventory:

```typescript
test('no unknown cookies', { tag: ['@compliance'] }, async ({ page, context }) => {
  await page.goto('/');
  const banner = page.getByRole('dialog', { name: /consent/i });
  if (await banner.isVisible()) await banner.getByRole('button', { name: /accept/i }).click();

  for (const path of ['/', '/dashboard', '/settings', '/pricing']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }

  const cookies = await context.cookies();
  const known = COOKIE_INVENTORY.map((d) => d.name);
  const unknown = cookies.filter((c) => !known.some((n) => c.name === n || c.name.startsWith(n)));

  if (unknown.length > 0) {
    throw new Error(
      `${unknown.length} unknown cookie(s). Add to cookie-inventory.ts:\n` +
      unknown.map((c) => `  - ${c.name} (${c.domain})`).join('\n')
    );
  }
});
```

---

## Accessibility Compliance

Accessibility is a legal requirement in many jurisdictions. See the `accessibility-testing` skill for detailed WCAG patterns.

| Region | Law | Standard | Enforcement |
|--------|-----|----------|-------------|
| EU | European Accessibility Act (EAA) | EN 301 549 / WCAG 2.1 AA | Member state enforcement, fines (June 2025) |
| USA | ADA | WCAG 2.1 AA (court precedent) | Private lawsuits |
| USA (federal) | Section 508 | WCAG 2.0 AA | Federal procurement requirement |
| Canada (Ontario) | AODA | WCAG 2.0 AA | Fines up to $100K/day |
| UK | Equality Act 2010 | WCAG 2.1 AA (guidance) | Lawsuits |

**Key actions:** Run automated axe-core scans on all pages, conduct keyboard navigation audits, test with at least one screen reader, document VPAT for enterprise sales, schedule quarterly manual audits, maintain an accessibility statement.

---

## Automation Patterns

### Scheduled Compliance Audits

Run compliance tests weekly to catch configuration drift, not just on PR.

```yaml
# .github/workflows/compliance-audit.yml
name: Weekly Compliance Audit
on:
  schedule:
    - cron: '0 6 * * 1'  # Every Monday at 06:00 UTC
  workflow_dispatch: {}
jobs:
  compliance:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run build && npm start &
      - run: npx wait-on http://localhost:3000 --timeout 60000
      - run: npx playwright test --project=chromium --grep @compliance
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: compliance-report-${{ github.run_number }}
          path: test-results/
          retention-days: 90  # Keep compliance evidence longer
```

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

## Related Skills

- **accessibility-testing** -- Detailed WCAG testing patterns with axe-core and Playwright for the accessibility subset of compliance.
- **security-testing** -- Security compliance (OWASP, dependency scanning) complements privacy compliance.
- **ci-cd-integration** -- Pipeline configuration for scheduled compliance audits and quality gates.
- **test-strategy** -- Compliance testing should be a defined test type in the overall strategy.
- **quality-postmortem** -- When a compliance violation reaches production, the postmortem identifies root cause and prevention.
