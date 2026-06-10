# GDPR / CMP Testing with Playwright — Test Code

Runnable Playwright patterns for consent-flow compliance. The decision prose and "what to test" guidance live in `SKILL.md`; this file holds the implementations.

## Consent Banner and Dark Pattern Checks

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

## Cookie State Before and After Consent

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

## Consent Persistence and Withdrawal

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

## Third-Party Script Blocking Before Consent

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

## Global Privacy Control (Sec-GPC)

GPC is a browser/extension signal that communicates a universal opt-out. It is a required honored signal under CCPA/CPRA and most active US state laws. Sites that ignore it are non-compliant in those jurisdictions.

Assert two things: the browser exposes `navigator.globalPrivacyControl === true` (the standard client-side signal — this is the real global, not an invented one), and no marketing cookies are present. There is **no** standard `window.__cmp.gpcStatus` global — TCF v1's `__cmp` is legacy and TCF v2 uses `__tcfapi` (see below). The CMP-specific opt-out flag, if you read one, is a placeholder you must replace with your CMP's actual API.

```typescript
test.describe('Global Privacy Control', () => {
  test.use({
    storageState: undefined,
    extraHTTPHeaders: { 'Sec-GPC': '1' },
  });

  test('site honors Sec-GPC: signal exposed, no marketing cookies', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The standard, browser-exposed GPC signal — closes the loop on the Sec-GPC header.
    const gpc = await page.evaluate(() => (navigator as any).globalPrivacyControl);
    expect(gpc, 'navigator.globalPrivacyControl not set despite Sec-GPC: 1').toBe(true);

    const cookies = await context.cookies();
    const marketing = cookies.filter((c) =>
      ['_fbp', '_fbc', '_gcl', '_ttp', 'IDE', 'NID'].some((n) => c.name.startsWith(n))
    );
    expect(marketing.map((c) => c.name), 'Marketing cookies present despite Sec-GPC: 1').toHaveLength(0);

    // Optional: your CMP's recorded opt-out. This flag name is a PLACEHOLDER —
    // replace `window.__myCmp.optedOut` with your CMP's documented API. Do NOT
    // assume a `__cmp.gpcStatus` global exists; it does not.
    // const optedOut = await page.evaluate(() => (window as any).__myCmp?.optedOut === true);
    // expect(optedOut, 'CMP did not register the opt-out').toBe(true);
  });
});
```

## TCF v2 Consent State (vendor/purpose)

Every IAB TCF-certified CMP (the kind you must use to serve EU/UK ads) exposes `window.__tcfapi`. Read consent state directly through it instead of guessing at CMP-private globals. This is the certified-CMP-agnostic way to assert that a given purpose or vendor is consented.

```typescript
test('TCF: analytics purpose consented only after accept', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('dialog', { name: /consent/i }).getByRole('button', { name: /accept/i }).click();
  await page.waitForTimeout(1000);

  const tcData = await page.evaluate(() => new Promise<any>((resolve) => {
    (window as any).__tcfapi('getTCData', 2, (data: any, success: boolean) =>
      resolve(success ? data : null));
  }));
  expect(tcData, '__tcfapi getTCData failed — CMP not TCF v2 certified?').not.toBeNull();
  // Purpose 1 = "Store and/or access information on a device" in the TCF purpose list.
  expect(tcData.purpose.consents['1'], 'Purpose 1 consent not granted after accept').toBe(true);

  // TCF v2.3 string-version guard: as of 28 Feb 2026 a v2.2-format TC string is
  // treated as unconsented by Google demand. tcfPolicyVersion >= 4 == TCF v2.2+/2.3.
  expect(tcData.tcfPolicyVersion, 'Stale TCF policy version — TC string may be pre-v2.3').toBeGreaterThanOrEqual(4);
});
```

## Google Consent Mode v2

Required since March 2024 for sites serving Google ads in the EEA/UK. Verify default state is "denied" and that update signals fire correctly after consent choices.

> **Note:** the interception below assumes the site calls `gtag('consent', 'default', {...})`, whose pushes arrive as a gtag `arguments` array (`args[0]` is `['consent','default',{...}]`). If the site instead does `dataLayer.push({ event: 'consent_default', ... })` in object form, read `args[0].event` / `args[0]` properties instead — the array-index access (`e[1]`, `e[2]`) will not match.

```typescript
test.describe('Google Consent Mode v2', () => {
  test.use({ storageState: undefined });

  test('default consent is denied for ad/analytics signals', async ({ page }) => {
    const consentEvents: any[] = [];
    await page.addInitScript(() => {
      (window as any).dataLayer = (window as any).dataLayer || [];
      const originalPush = (window as any).dataLayer.push.bind((window as any).dataLayer);
      (window as any).dataLayer.push = (...args: any[]) => {
        if (args[0]?.[0] === 'consent') (window as any).__consentEvents = [...((window as any).__consentEvents ?? []), args[0]];
        return originalPush(...args);
      };
    });

    await page.goto('/');
    const events = await page.evaluate(() => (window as any).__consentEvents ?? []);
    const defaultEvent = events.find((e: any[]) => e[1] === 'default');
    expect(defaultEvent, 'No gtag consent default fired').toBeDefined();
    expect(defaultEvent[2].ad_storage).toBe('denied');
    expect(defaultEvent[2].analytics_storage).toBe('denied');
    expect(defaultEvent[2].ad_user_data).toBe('denied');
    expect(defaultEvent[2].ad_personalization).toBe('denied');
  });

  test('update signal fires "granted" after accepting consent', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('dialog', { name: /consent/i }).getByRole('button', { name: /accept/i }).click();
    await page.waitForTimeout(1000);

    const events = await page.evaluate(() => (window as any).__consentEvents ?? []);
    const updateEvent = events.find((e: any[]) => e[1] === 'update');
    expect(updateEvent, 'No gtag consent update fired after accept').toBeDefined();
    expect(updateEvent[2].ad_storage).toBe('granted');
    expect(updateEvent[2].analytics_storage).toBe('granted');
  });
});
```
