# Consent Mode v2 Gating

Consent Mode v2 is the mandatory four-signal standard. As of the **June 15 2026** change, Google acts only on the CMP-sent consent signal; any two-signal (`ad_storage` + `analytics_storage` only) implementation is outdated.

## The four signals — default `denied`

| Signal | Governs |
|--------|---------|
| `ad_storage` | Advertising cookies |
| `analytics_storage` | Analytics cookies |
| `ad_user_data` | Sending user data to Google for ads |
| `ad_personalization` | Personalized ads / remarketing |

A `granted` default is a bug. Omitting `ad_user_data` and `ad_personalization` is the pre-2026 two-signal model and is wrong.

## Consent state on the beacon

- `gcs=` — encodes `ad_storage` + `analytics_storage` only. Format `G1XY`: `G100` = both denied, `G111` = both granted, `G110`/`G101` = partial. Before consent you expect `gcs=G100`.
- `gcd=` — encodes all four signals (string beginning `11...`); present on every hit to Google services.

## Seeding the denied default before page scripts run

```ts
import { test, expect } from '@playwright/test';

async function seedDeniedConsent(page) {
  await page.addInitScript(() => {
    window.dataLayer = window.dataLayer || [];
    function gtag(){ window.dataLayer.push(arguments); }
    gtag('consent', 'default', {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',          // v2 signal
      ad_personalization: 'denied',    // v2 signal
    });
  });
}
```

## Before consent: no full beacon (or cookieless ping only)

```ts
test('no full beacon before consent', async ({ page }) => {
  await seedDeniedConsent(page);

  const beacons: string[] = [];
  page.on('request', r => { if (r.url().includes('/g/collect')) beacons.push(r.url()); });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Either nothing fired, or only a cookieless consent ping carrying gcs=G100.
  for (const url of beacons) {
    const gcs = new URL(url).searchParams.get('gcs');
    expect(gcs, 'pre-consent beacon must carry a denied consent state').toBe('G100');
  }
});
```

## After accept: full beacon fires

```ts
test('full beacon fires after consent accept', async ({ page }) => {
  await seedDeniedConsent(page);
  await page.goto('/');

  const [request] = await Promise.all([
    page.waitForRequest(r => r.url().includes('/g/collect') && r.url().includes('en=page_view')),
    page.getByRole('button', { name: /accept all/i }).click(), // CMP accept selector
  ]);

  const params = new URL(request.url()).searchParams;
  expect(params.get('gcs')).toBe('G111');        // both consents now granted
  expect(params.get('gcd')).toBeTruthy();         // all-four-signal string present
});
```

## Boundary with compliance-testing

Whether the law *permits* a beacon under a given consent state, the CMP banner UX, and data-subject rights belong to `compliance-testing`. This file asserts that *when* a beacon fires, its consent params (`gcs`/`gcd`) and the default-denied state are correct.
