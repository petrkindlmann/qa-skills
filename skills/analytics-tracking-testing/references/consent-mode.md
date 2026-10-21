# Consent Mode v2 Observation

Test the application's consent configuration against the approved regional policy.
Choose **basic** or **advanced** Consent Mode before writing the network assertion:
basic blocks Google tags until consent; advanced can load consent-aware tags and send
measurements without cookies while storage consent is denied. The implementation
choice and permitted data belong to `compliance-testing`, not to a URL heuristic.
Sources: [Google's overview](https://developers.google.com/tag-platform/security/concepts/consent-mode)
and [implementation guide](https://developers.google.com/tag-platform/security/guides/consent).

## The four signals

| Signal | Governs |
|--------|---------|
| `ad_storage` | Advertising storage |
| `analytics_storage` | Analytics storage |
| `ad_user_data` | Sending user data to Google for advertising |
| `ad_personalization` | Personalized advertising |

The examples below assume a fresh visitor in a region whose approved defaults are
all `denied`. Other regional defaults require their own expected-state matrix.
In basic mode, defaults can be sent when tags load after acceptance; do not require
a pre-interaction command that the chosen basic integration intentionally omits.
Google specifies that gtag defaults precede measurement-producing `config`/`event`
commands, and updates reflect the user's choices before navigation.

## Observe the app; do not supply its defaults

Copy this block into `helpers/consent.ts`. Install it before navigation in **every**
test. It leaves an absent `dataLayer` undefined and never creates `gtag`, sends a
consent command, or restores an overwritten queue. It taps pushes while preserving
the array, arguments, receiver, return value, and any existing push implementation.
A later layer replacement is recorded and fails the assertions: replacing a live
layer can detach tag state, even when the replacement contains plausible commands.

This adapter observes gtag argument arrays on the selected data layer. Object events
such as `{ event: 'consent_default' }` are not proof of a Google consent command.
GTM consent templates use `setDefaultConsentState`/`updateConsentState`; use the
template's documented diagnostics or Tag Assistant for those integrations. Regional
default resolution, custom property descriptors, and iframe-owned layers need an
explicit adapter. Keep the independent network and storage checks in either case.

```ts
import { expect } from '@playwright/test';

export const deniedConsent = {
  ad_storage: 'denied', analytics_storage: 'denied',
  ad_user_data: 'denied', ad_personalization: 'denied',
};
export const grantedConsent = Object.fromEntries(
  Object.keys(deniedConsent).map(signal => [signal, 'granted']),
);

export async function installConsentObserver(page, layerName = 'dataLayer') {
  await page.addInitScript(({ layerName }) => {
    const w = window as any;
    const trace = w.__qaConsentTrace = { commands: [], errors: [], replacements: 0 };
    const seen = new WeakSet();
    const pushDescriptors = new WeakMap();
    function record(item) {
      if (!Array.isArray(item) && Object.prototype.toString.call(item) !== '[object Arguments]') return;
      if (!['consent', 'config', 'event', 'js'].includes(item[0])) return;
      try { trace.commands.push(JSON.parse(JSON.stringify(Array.from(item)))); }
      catch { trace.errors.push('Could not snapshot a dataLayer command'); }
    }
    function tap(layer) {
      if (layer === undefined) return;
      if (!Array.isArray(layer)) { trace.errors.push('dataLayer is not an array'); return; }
      if (seen.has(layer)) return;
      seen.add(layer);
      layer.forEach(record);
      const activeItems = new WeakSet();
      function wrap(delegate) {
        if (typeof delegate !== 'function') {
          trace.errors.push('dataLayer.push is not a function');
          return delegate;
        }
        return function (...items) {
          const owned = [];
          for (const item of items) {
            if (item === null || typeof item !== 'object' || activeItems.has(item)) continue;
            activeItems.add(item); owned.push(item); record(item);
          }
          try { return Reflect.apply(delegate, this, items); }
          finally { owned.forEach(item => activeItems.delete(item)); }
        };
      }
      let push = wrap(layer.push);
      const descriptor = Object.getOwnPropertyDescriptor(layer, 'push');
      const observed = { get: () => push, set: next => { push = wrap(next); } };
      try {
        Object.defineProperty(layer, 'push', {
          configurable: true, enumerable: descriptor?.enumerable ?? false,
          ...observed,
        });
        pushDescriptors.set(layer, observed);
      } catch { trace.errors.push('Cannot observe dataLayer.push'); }
    }
    let layer = w[layerName];
    tap(layer);
    const observedLayer = {
      get: () => layer,
      set: next => {
        if (layer !== undefined && next !== layer) trace.replacements++;
        layer = next; tap(next);
      },
    };
    try {
      Object.defineProperty(w, layerName, {
        configurable: true, enumerable: true, ...observedLayer,
      });
    } catch { trace.errors.push('Cannot observe dataLayer assignments'); }
    w.__qaConsentAudit = () => {
      const intact = (actual, observed) => actual?.get === observed?.get && actual?.set === observed?.set;
      if (!intact(Object.getOwnPropertyDescriptor(w, layerName), observedLayer)) {
        trace.errors.push('Application removed the dataLayer observer');
      }
      if (Array.isArray(layer) && !intact(Object.getOwnPropertyDescriptor(layer, 'push'), pushDescriptors.get(layer))) {
        trace.errors.push('Application removed the dataLayer.push observer');
      }
    };
  }, { layerName });
}

export async function readConsentTrace(page) {
  return page.evaluate(() => {
    const trace = (window as any).__qaConsentTrace;
    if (!trace) throw new Error('Install the consent observer before navigation in this test');
    (window as any).__qaConsentAudit();
    return trace;
  });
}

function assertObservationIntact(trace) {
  expect(trace.errors, 'Consent observation failed').toEqual([]);
  expect(trace.replacements, 'Application replaced its initialized dataLayer').toBe(0);
}

function consentState(commands) {
  const state = {};
  for (const command of commands) {
    if (command[0] === 'consent' && ['default', 'update'].includes(command[1])) {
      expect(command[2]?.region, 'Use a regional-consent adapter for region-scoped commands').toBeUndefined();
      Object.assign(state, command[2]);
    }
  }
  return Object.fromEntries(Object.keys(deniedConsent).map(signal => [signal, state[signal]]));
}

export function assertDefaultConsent(trace, expected = deniedConsent) {
  assertObservationIntact(trace);
  const first = trace.commands.findIndex(c => c[0] === 'consent' && c[1] === 'default');
  expect(first, 'No application consent default was observed').toBeGreaterThanOrEqual(0);
  expect(trace.commands.slice(0, first).filter(c => ['config', 'event'].includes(c[0])),
    'Measurement command ran before the consent default').toHaveLength(0);
  // Check every intermediate state; granted-then-denied must not pass as denied.
  for (let index = first; index < trace.commands.length; index++) {
    expect(consentState(trace.commands.slice(0, index + 1)),
      'Unexpected consent state before interaction').toEqual(expected);
  }
}

export function assertConsentUpdate(trace, after, expected) {
  assertObservationIntact(trace);
  const updates = trace.commands.slice(after).filter(c => c[0] === 'consent' && c[1] === 'update');
  expect(updates.length, 'No new application consent update after the action').toBeGreaterThan(0);
  expect(consentState(trace.commands), 'Latest consent state does not match the choice').toEqual(expected);
}

export function assertBasicConsentAcceptance(trace, after, defaults = deniedConsent, accepted = grantedConsent) {
  const firstUpdate = trace.commands.findIndex((command, index) =>
    index >= after && command[0] === 'consent' && command[1] === 'update');
  expect(firstUpdate, 'No new basic-mode consent update').toBeGreaterThanOrEqual(0);
  const prefix = { ...trace, commands: trace.commands.slice(0, firstUpdate) };
  assertDefaultConsent(prefix, defaults);
  expect(prefix.commands.filter(command => ['config', 'event'].includes(command[0])),
    'Basic-mode measurement command preceded the acceptance update').toHaveLength(0);
  assertConsentUpdate(trace, after, accepted);
}

export async function waitForConsentUpdate(page, after, expected, timeout = 5000) {
  await expect(async () => {
    assertConsentUpdate(await readConsentTrace(page), after, expected);
  }).toPass({ timeout });
}
```

## Bound the observation to a real application milestone

Replace the example `privacy-state` test ID with the application's documented CMP
completion signal. Here `ready` means consent initialization and initial tag work
have finished; `accepted`, `rejected`, and `withdrawn` mean that transition and its
scheduled tag work have finished. The app must expose that milestone; the test must
not manufacture it. If no such signal exists, define a measured observation budget,
exercise the relevant interactions, and report the interval covered. A banner
becoming visible, `networkidle`, or an arbitrary sleep cannot prove tracking will
never occur. Cookie snapshots also miss cookies set and deleted between snapshots;
retain network/storage evidence for the lifecycle being audited.

Append this helper to the same `helpers/consent.ts`; it uses the `expect` import above.

```ts
export async function waitForPrivacyPhase(page, phase, timeout = 5000) {
  await expect(page.getByTestId('privacy-state'))
    .toHaveAttribute('data-phase', phase, { timeout });
}
```

## Advanced mode: default, emitted requests, and acceptance

Copy `parseGA4`/`attachGA4Collector` from `ga4-interception.md`; they match approved
hosts and `/g/collect` exactly and parse URL plus POST/batch records. This example
tracking plan expects a `page_view` ping at initialization and a new `page_view`
after acceptance. Replace those expectations with the actual event plan. Requiring
the planned event prevents an empty collector from passing a broken integration.

`gcs=G100` and `gcs=G111` check the two storage signals in the captured web-tag
format. `gcd` presence is only a transport diagnostic: it does not decode or prove
all four states, nor prove that a request contains no identifiers. Verify all four
through the observed consent calls, inspect payloads against the approved inventory,
and retain tag-version captures/Tag Assistant evidence when validating encoded
transport. Do not hardcode an undocumented `gcd` prefix as a universal contract.

```ts
import { test, expect } from '@playwright/test';
import { attachGA4Collector } from './helpers/ga4';
import { installConsentObserver, readConsentTrace, assertDefaultConsent, assertConsentUpdate } from './helpers/consent';
import { waitForConsentUpdate, waitForPrivacyPhase, deniedConsent, grantedConsent } from './helpers/consent';

test.describe('Advanced consent mode: approved denied-default policy', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => { await installConsentObserver(page); });

  test('before consent: application defaults and planned denied ping', async ({ page, context }) => {
    const traffic = attachGA4Collector(page);
    try {
      await page.goto('/');
      await waitForPrivacyPhase(page, 'ready');
      assertDefaultConsent(await readConsentTrace(page), deniedConsent);
      expect(traffic.events.some(event => event.name === 'page_view'), 'Expected initial ping is missing').toBe(true);
      for (const event of traffic.events) {
        expect(event.params.gcs).toBe('G100');
        expect(event.params.gcd, 'Missing encoded consent diagnostic').toBeTruthy();
      }
      // Replace this sample inventory with the product's approved storage inventory.
      const analytics = (await context.cookies()).filter(c => /^_ga(?:_|$)|^_gid$/.test(c.name));
      expect(analytics, 'Analytics storage while denied').toHaveLength(0);
    } finally { traffic.stop(); }
  });

  test('acceptance: new update and new planned granted beacon', async ({ page }) => {
    const traffic = attachGA4Collector(page);
    try {
      await page.goto('/');
      await waitForPrivacyPhase(page, 'ready');
      assertDefaultConsent(await readConsentTrace(page), deniedConsent);
      const commandCheckpoint = (await readConsentTrace(page)).commands.length;
      const requestCheckpoint = traffic.events.length;
      await page.getByRole('button', { name: 'Accept all', exact: true }).click();
      await waitForConsentUpdate(page, commandCheckpoint, grantedConsent);
      await waitForPrivacyPhase(page, 'accepted');
      assertConsentUpdate(await readConsentTrace(page), commandCheckpoint, grantedConsent);
      const acceptedEvents = traffic.events.slice(requestCheckpoint);
      expect(acceptedEvents.some(event => event.name === 'page_view'), 'No new accepted page_view').toBe(true);
      for (const event of acceptedEvents) {
        expect(event.params.gcs).toBe('G111');
        expect(event.params.gcd, 'Missing encoded consent diagnostic').toBeTruthy();
      }
    } finally { traffic.stop(); }
  });
});
```

## Basic mode: defaults may be initialized only on acceptance

Use the basic zero-request gate in the compliance reference alongside this test.
The default-state helper above is for the pre-interaction advanced-mode trace;
do not run it over the whole accepted trace and expect the final state to be denied.
The basic helper checks the default prefix and then the new acceptance update.
This example again assumes the event plan emits a `page_view` after acceptance.

```ts
import { test, expect } from '@playwright/test';
import { attachGA4Collector } from './helpers/ga4';
import { installConsentObserver, readConsentTrace, assertBasicConsentAcceptance, waitForPrivacyPhase } from './helpers/consent';

test.describe('Basic consent mode: initialize on acceptance', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ page }) => { await installConsentObserver(page); });
  test('acceptance initializes defaults before the update and planned beacon', async ({ page }) => {
    const traffic = attachGA4Collector(page);
    try {
      await page.goto('/');
      await waitForPrivacyPhase(page, 'ready');
      expect(traffic.events).toHaveLength(0);
      const checkpoint = (await readConsentTrace(page)).commands.length;
      await page.getByRole('button', { name: 'Accept all', exact: true }).click();
      await waitForPrivacyPhase(page, 'accepted');
      assertBasicConsentAcceptance(await readConsentTrace(page), checkpoint);
      expect(traffic.events.some(event => event.name === 'page_view'), 'No accepted page_view').toBe(true);
      for (const event of traffic.events) expect(event.params.gcs).toBe('G111');
    } finally { traffic.stop(); }
  });
});
```

## Boundary with compliance-testing

Run separate fresh-context cases for rejection, partial consent, withdrawal,
persistence, and each approved region. Use the same observer in each case and
checkpoint before the action so an old update cannot satisfy a new transition.
Whether storage or a beacon is permitted, CMP banner UX, GPC, and data-subject rights
belong to `compliance-testing`; correct signals alone do not certify compliance.
