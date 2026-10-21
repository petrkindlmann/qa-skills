# GDPR / CMP Testing with Playwright — Test Code

These recipes test an approved technical consent policy. Configure the region, CMP
selectors, cookie inventory, prohibited destinations, and **basic versus advanced**
Consent Mode before using them. A request's hostname alone does not determine its
legal basis. Google documents [both implementations](https://developers.google.com/tag-platform/security/concepts/consent-mode);
advanced mode can send measurements without cookies while storage is denied.

Set Playwright `baseURL` to the isolated test site. Use explicit empty storage below
even when the project has a saved authenticated `storageState`. Copy the observation
and `waitForPrivacyPhase` helpers from
`../../analytics-tracking-testing/references/consent-mode.md` into `helpers/consent.ts`.
The example `privacy-state` DOM marker is an **application-owned adapter contract**:
it changes only after the named consent transition and its scheduled tag work finish.
Replace it with the real CMP/application completion signal; never set it from the test.
If only a bounded observation interval is available, record that interval and the
interactions covered. `networkidle` and a visible banner are not completion signals
for delayed consent work.

## Cookie classification helpers

Copy these into `helpers/cookies.ts` and replace the sample names with the reviewed
inventory. Necessary names are exact matches: `consent_status_marketing` must not
inherit the exception for `consent_status`. Use the full name/domain/path inventory
and attribute checks from `cookie-compliance.md` for the production suite. Classification
is a policy input; a vendor prefix cannot establish that a cookie is necessary.

```typescript
export function isStrictlyNecessary(name: string): boolean {
  return ['__Host-session', 'csrf_token', 'consent_status'].includes(name);
}

export function isAnalyticsCookie(name: string): boolean {
  return /^_ga(?:_|$)|^_gid$|^_gat(?:_|$)|^analytics_/.test(name);
}

export function isMarketingCookie(name: string): boolean {
  return /^_(fbp|fbc|ttp)$|^_gcl_|^(IDE|NID)$/.test(name);
}
```

## Consent banner and controls

Minimum button dimensions are a mechanical UX threshold, **not proof of equal
prominence or absence of dark patterns**. Compare visual hierarchy, contrast,
wording, keyboard behavior, and effort with the approved design and a human review.

```typescript
import { test, expect } from '@playwright/test';
import { waitForPrivacyPhase } from './helpers/consent';

test.describe('Consent banner', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('first visit exposes the required controls and policy link', async ({ page }) => {
    await page.goto('/');
    await waitForPrivacyPhase(page, 'ready');
    const banner = page.getByRole('dialog', { name: /cookie|consent|privacy/i });
    await expect(banner).toBeVisible();
    for (const name of ['Accept all', 'Reject all']) {
      const button = banner.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeEnabled();
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(60);
      expect(box!.height).toBeGreaterThanOrEqual(30);
    }
    const policy = banner.getByRole('link', { name: 'Privacy policy', exact: true });
    await expect(policy).toBeVisible();
    expect(new URL(await policy.getAttribute('href'), page.url()).pathname).toBe('/privacy');
  });
});
```

## Cookie state, persistence, and withdrawal

These examples assume the approved policy prohibits the listed optional storage
before consent and after rejection. Their snapshots cover the completed lifecycle
milestone, not cookies that were set and deleted between snapshots. Retain request,
response, and storage evidence when auditing transient disclosures.

```typescript
import { test, expect } from '@playwright/test';
import { waitForPrivacyPhase } from './helpers/consent';
import { isStrictlyNecessary, isAnalyticsCookie } from './helpers/cookies';

test.describe('Cookie consent lifecycle', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('no optional cookies before consent', async ({ page, context }) => {
    await page.goto('/');
    await waitForPrivacyPhase(page, 'ready');
    const violations = (await context.cookies()).filter(c => !isStrictlyNecessary(c.name));
    expect(violations.map(c => c.name), 'Optional cookies before consent').toEqual([]);
  });

  test('configured analytics storage appears after acceptance', async ({ page, context }) => {
    await page.goto('/');
    await waitForPrivacyPhase(page, 'ready');
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    await waitForPrivacyPhase(page, 'accepted');
    const analytics = (await context.cookies()).filter(c => isAnalyticsCookie(c.name));
    expect(analytics.length, 'Expected analytics storage after acceptance').toBeGreaterThan(0);
  });

  test('no optional cookies after rejection', async ({ page, context }) => {
    await page.goto('/');
    await waitForPrivacyPhase(page, 'ready');
    await page.getByRole('button', { name: 'Reject all', exact: true }).click();
    await waitForPrivacyPhase(page, 'rejected');
    const violations = (await context.cookies()).filter(c => !isStrictlyNecessary(c.name));
    expect(violations.map(c => c.name), 'Optional cookies after rejection').toEqual([]);
  });

  test('accepted state persists across navigation', async ({ page }) => {
    await page.goto('/');
    await waitForPrivacyPhase(page, 'ready');
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    await waitForPrivacyPhase(page, 'accepted');
    await page.goto('/about');
    await waitForPrivacyPhase(page, 'accepted');
    await expect(page.getByRole('dialog', { name: /consent/i })).toBeHidden();
  });
});
```

## Basic policy: tracking requests blocked until consent

Use this zero-request gate only where the approved policy blocks these destinations.
Maintain the full destination inventory, including first-party proxies. Parse hostnames
instead of searching URL substrings, and attach the observer **before** navigation.
For advanced mode, validate permitted denied-state traffic and storage with the
Consent Mode reference; loading `googletagmanager.com` alone is not a universal violation.

```typescript
import { expect } from '@playwright/test';

export function attachTrackingRequests(page, domains: string[]) {
  const requests = [];
  const listener = request => {
    const host = new URL(request.url()).hostname;
    if (domains.some(domain => host === domain || host.endsWith(`.${domain}`))) requests.push(request);
  };
  page.on('request', listener);
  return { requests, stop: () => page.off('request', listener) };
}

export function assertNoTracking(traffic) {
  expect(traffic.requests.map(request => request.url()), 'Prohibited tracking request').toEqual([]);
}
```

```typescript
import { test, expect } from '@playwright/test';
import { waitForPrivacyPhase } from './helpers/consent';
import { attachTrackingRequests, assertNoTracking } from './helpers/tracking';

test.describe('Basic consent policy', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const blockedHosts = ['google-analytics.com', 'googletagmanager.com', 'connect.facebook.net'];

  test('no configured tracking requests before consent', async ({ page }) => {
    const traffic = attachTrackingRequests(page, blockedHosts);
    try {
      await page.goto('/');
      await waitForPrivacyPhase(page, 'ready');
      assertNoTracking(traffic);
    } finally { traffic.stop(); }
  });

  test('acceptance triggers configured tracking', async ({ page }) => {
    const traffic = attachTrackingRequests(page, blockedHosts);
    try {
      await page.goto('/');
      await waitForPrivacyPhase(page, 'ready');
      assertNoTracking(traffic);
      await page.getByRole('button', { name: 'Accept all', exact: true }).click();
      await waitForPrivacyPhase(page, 'accepted');
      expect(traffic.requests.length, 'No tracking request after acceptance').toBeGreaterThan(0);
    } finally { traffic.stop(); }
  });
});
```

## Global Privacy Control: HTTP and DOM are separate inputs

The [GPC specification](https://w3c.github.io/gpc/) defines both `Sec-GPC: 1` and
`navigator.globalPrivacyControl`. Setting `extraHTTPHeaders` sends an HTTP header;
it **does not enable a browser privacy preference or create the DOM property**.
Test the server's header path and the application's DOM path separately, then test
both in a genuinely GPC-enabled browser where supported. The explicit DOM shim
below is an application test, not evidence of native browser GPC support.

Map opt-out to the product's approved jurisdictional policy. GPC does not universally
mean "disable every analytics operation." Verify the recorded opt-out plus the
specific prohibited storage and destinations. This example exposes the recorded
choice in a real settings checkbox; replace that locator with the CMP's documented
UI/API. There is no standard `window.__cmp.gpcStatus` or TCF GPC-status field.

```typescript
import { expect } from '@playwright/test';
import { isMarketingCookie } from './helpers/cookies';

export async function emulateGPCDOM(context, enabled = true) {
  await context.addInitScript(value => {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
      configurable: true, get: () => value,
    });
  }, enabled);
}

export async function assertGPCOptOut(page, context) {
  await expect(page.getByRole('checkbox', { name: 'Do not sell or share my personal information', exact: true }))
    .toBeChecked();
  const marketing = (await context.cookies()).filter(c => isMarketingCookie(c.name));
  expect(marketing.map(c => c.name), 'Policy-prohibited cookies despite GPC').toEqual([]);
}
```

```typescript
import { test, expect } from '@playwright/test';
import { waitForPrivacyPhase } from './helpers/consent';
import { attachTrackingRequests, assertNoTracking } from './helpers/tracking';
import { emulateGPCDOM, assertGPCOptOut } from './helpers/gpc';

test.describe('HTTP GPC path', () => {
  test.use({ storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { 'Sec-GPC': '1' } });
  test('server honors the request header', async ({ page, context }) => {
    const traffic = attachTrackingRequests(page, ['connect.facebook.net']); // approved blocked inventory
    try {
      const response = await page.goto('/');
      expect(await response.request().headerValue('sec-gpc')).toBe('1');
      await waitForPrivacyPhase(page, 'ready');
      await assertGPCOptOut(page, context);
      assertNoTracking(traffic);
    } finally { traffic.stop(); }
  });
});

test.describe('DOM GPC application simulation', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ context }) => { await emulateGPCDOM(context); });
  test('client honors the explicitly simulated DOM preference', async ({ page, context }) => {
    const traffic = attachTrackingRequests(page, ['connect.facebook.net']);
    try {
      await page.goto('/');
      expect(await page.evaluate(() => (navigator as any).globalPrivacyControl)).toBe(true);
      await waitForPrivacyPhase(page, 'ready');
      await assertGPCOptOut(page, context);
      assertNoTracking(traffic);
    } finally { traffic.stop(); }
  });
});
```

## TCF v2 consent state: wait for the relevant event and remove the listener

For a TCF-integrated CMP, use `__tcfapi('addEventListener', 2, callback)`.
`getTCData` was deprecated in TCF v2.2. The initial callback may contain incomplete
data; after an acceptance action, wait for `useractioncomplete`, not just the first
callback. Bound missing/failed callbacks and unregister using the supplied listener
ID. Source: [IAB CMP API v2](https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md).

```typescript
import { expect } from '@playwright/test';

export async function readTCFData(page, eventStatus = 'useractioncomplete', timeoutMs = 5000) {
  await page.waitForFunction(() => typeof (window as any).__tcfapi === 'function', undefined, { timeout: timeoutMs });
  return page.evaluate(({ eventStatus, timeoutMs }) => new Promise<any>((resolve, reject) => {
    const api = (window as any).__tcfapi;
    let listenerId;
    let settled = false;
    const remove = () => {
      if (Number.isInteger(listenerId)) api('removeEventListener', 2, () => {}, listenerId);
    };
    const finish = (error, data?) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { remove(); } catch (cleanupError) { reject(error ?? cleanupError); return; }
      if (error) reject(error); else resolve(data);
    };
    const timer = setTimeout(() => finish(new Error(`TCF ${eventStatus} callback timed out`)), timeoutMs);
    try {
      api('addEventListener', 2, (data, success) => {
        if (Number.isInteger(data?.listenerId)) listenerId = data.listenerId;
        if (settled) { remove(); return; }
        if (!success) { finish(new Error('TCF listener registration/callback failed')); return; }
        if (data?.cmpStatus === 'error') { finish(new Error('CMP reported an error')); return; }
        if (data?.gdprApplies === false || data?.eventStatus === eventStatus) finish(null, data);
      });
    } catch (error) { finish(error); }
  }), { eventStatus, timeoutMs });
}

export function assertTCFConsent(data, { purposeIds, vendorIds, policyVersion }) {
  expect(data?.gdprApplies, 'Unexpected TCF jurisdiction').toBe(true);
  expect(data.cmpStatus).toBe('loaded');
  expect(data.eventStatus).toBe('useractioncomplete');
  expect(data.tcString, 'Missing TC string').toEqual(expect.any(String));
  expect(data.tcString.trim(), 'Empty TC string').not.toBe('');
  expect(data.isServiceSpecific).toBe(true);
  expect(Number.isInteger(policyVersion), 'Configure the approved TCF policy version').toBe(true);
  expect(data.tcfPolicyVersion).toBe(policyVersion);
  for (const id of purposeIds) expect(data.purpose?.consents?.[id], `Purpose ${id} not consented`).toBe(true);
  for (const id of vendorIds) expect(data.vendor?.consents?.[id], `Vendor ${id} not consented`).toBe(true);
}
```

```typescript
import { test } from '@playwright/test';
import { waitForPrivacyPhase } from './helpers/consent';
import { readTCFData, assertTCFConsent } from './helpers/tcf';

test.use({ storageState: { cookies: [], origins: [] } });
test('TCF: configured purposes and vendors are consented after acceptance', async ({ page }) => {
  await page.goto('/');
  await waitForPrivacyPhase(page, 'ready');
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  const data = await readTCFData(page);
  assertTCFConsent(data, {
    purposeIds: ['1'], vendorIds: ['42'], // example IDs: replace from the approved vendor/purpose matrix
    policyVersion: Number(process.env.TCF_POLICY_VERSION),
  });
});
```

Purpose 1 concerns device storage/access; it is not a general "analytics allowed"
flag. Assert the actual purpose, vendor, and legal-basis matrix. A numeric
`tcfPolicyVersion` comparison is a compatibility check, **not a TCF v2.3 freshness or
certification test**. Validate the decoded TC string and required segments with the
approved CMP/TCF decoder and current vendor/policy requirements. The API-state check
above neither decodes the string nor establishes CMP certification.

## Google Consent Mode: independent tests and action checkpoints

This suite targets the **advanced** gtag integration and the approved all-denied
default policy. Its `beforeEach` installs observation for every isolated page.
The observer must not push a denied default itself: doing that can repair the app
under test and hide the missing-default defect. In basic mode, use
`assertBasicConsentAcceptance` from the shared reference to check the default prefix
and new acceptance update separately; keep the zero-request gate above.

```typescript
import { test, expect } from '@playwright/test';
import { isStrictlyNecessary } from './helpers/cookies';
import { installConsentObserver, readConsentTrace, assertDefaultConsent, assertConsentUpdate } from './helpers/consent';
import { waitForConsentUpdate, waitForPrivacyPhase, deniedConsent, grantedConsent } from './helpers/consent';
// deniedConsent and grantedConsent carry the four Consent Mode v2 signals:
// ad_storage, analytics_storage, ad_user_data, ad_personalization.

test.describe('Advanced gtag consent transitions', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => { await installConsentObserver(page); });

  test('default state comes from the application', async ({ page }) => {
    await page.goto('/');
    await waitForPrivacyPhase(page, 'ready');
    assertDefaultConsent(await readConsentTrace(page), deniedConsent);
  });

  for (const [button, phase, expected] of [
    ['Accept all', 'accepted', grantedConsent], ['Reject all', 'rejected', deniedConsent],
  ] as const) {
    test(`${phase}: a new update reflects the choice`, async ({ page }) => {
      await page.goto('/');
      await waitForPrivacyPhase(page, 'ready');
      assertDefaultConsent(await readConsentTrace(page), deniedConsent);
      const checkpoint = (await readConsentTrace(page)).commands.length;
      await page.getByRole('button', { name: button, exact: true }).click();
      await waitForConsentUpdate(page, checkpoint, expected);
      await waitForPrivacyPhase(page, phase);
      assertConsentUpdate(await readConsentTrace(page), checkpoint, expected);
    });
  }

  test('withdrawal removes optional storage and sends a new denied update', async ({ page, context }) => {
    await page.goto('/');
    await waitForPrivacyPhase(page, 'ready');
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    await waitForPrivacyPhase(page, 'accepted');
    await page.goto('/privacy-settings');
    await waitForPrivacyPhase(page, 'accepted');
    const checkpoint = (await readConsentTrace(page)).commands.length;
    for (const name of ['Analytics', 'Marketing']) {
      await page.getByRole('checkbox', { name, exact: true }).setChecked(false);
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await waitForConsentUpdate(page, checkpoint, deniedConsent);
    await waitForPrivacyPhase(page, 'withdrawn');
    assertConsentUpdate(await readConsentTrace(page), checkpoint, deniedConsent);
    const optional = (await context.cookies()).filter(c => !isStrictlyNecessary(c.name));
    expect(optional.map(c => c.name), 'Optional cookies after withdrawal').toEqual([]);
  });
});
```

Add independent partial-consent and region cases from the same policy matrix; verify network outcomes
as well as the emitted consent updates in each lifecycle.
