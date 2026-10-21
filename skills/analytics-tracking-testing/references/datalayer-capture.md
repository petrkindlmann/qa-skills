# Observing Application `dataLayer` Events

When the contract is the GTM input, observe the objects the application supplies to
its data layer. Install the observer before navigation. Never seed `dataLayer`,
create `gtag`, or restore a replaced queue: those changes can make missing application
initialization pass. GA4 request emission is a separate contract; use
[`ga4-interception.md`](ga4-interception.md) when that is the required evidence.

## Install and read the observer

Copy this block into `helpers/datalayer.ts`. It follows the assignment/push observer
pattern in [`consent-mode.md`](consent-mode.md), scoped to serializable object events.
For a plain-JavaScript suite (`.mjs`, `.js`) save it as `helpers/datalayer.mjs` and drop
the type annotations: the `Page` import, the `DataLayerTrace` type and the parameter and
return types. The body passed to `addInitScript` is serialized as source, so it must be
plain JavaScript in either case; keep `const trace = ...` there without an annotation.
It records initial queue entries and later push inputs, preserves array identity,
the push receiver and arguments, the delegated return value or exception, and
repeated inputs. Rewrapping `push` around its previous implementation does not count
one invocation twice. A replacement queue is observed and reported, never repaired.

This adapter supports ordinary assignments such as `window.dataLayer = []` and
`window.dataLayer = window.dataLayer || []`, plus writable `push` replacements. An
absent layer still reads as `undefined`, but intercepting assignment installs an
accessor property. Code depending on property absence/descriptors, custom accessors,
direct index writes, iframe-owned layers, or transforming push implementations needs
an integration-specific observer. Array/Arguments gtag commands are outside this
object-event contract; use the consent observer for those. Install one observer in
each fresh page, selecting the application's layer name; combine required records
in one adapter when observing both consent commands and ecommerce objects.

```ts
import { Page } from '@playwright/test';

export type DataLayerTrace = { entries: Record<string, any>[]; errors: string[]; replacements: number };

export async function installDataLayerObserver(page: Page, layerName = 'dataLayer') {
  await page.addInitScript(({ layerName }) => {
    const w = window as any;
    const trace: DataLayerTrace = w.__qaDataLayerTrace = { entries: [], errors: [], replacements: 0 };
    const seen = new WeakSet();
    const pushDescriptors = new WeakMap();
    function record(item) {
      if (Object.prototype.toString.call(item) !== '[object Object]') return;
      try { trace.entries.push(structuredClone(item)); }
      catch { trace.errors.push('Could not snapshot a dataLayer object'); }
      // An ordering clause ("after the order response, before the list refreshes") needs
      // the page state at the instant of the push, which the object alone does not carry.
      // Add a parallel trace.context[] here: a timestamp plus serializable probes of the
      // UI (text of a status element, a disabled flag, a row count) passed in through the
      // init script's argument. Keep trace.entries unchanged so the assertions below hold.
    }
    function tap(layer) {
      if (layer === undefined) return;
      if (!Array.isArray(layer)) { trace.errors.push('dataLayer is not an array'); return; }
      if (seen.has(layer)) return;
      seen.add(layer);
      layer.forEach(record);
      const descriptor = Object.getOwnPropertyDescriptor(layer, 'push');
      if (descriptor && (!('value' in descriptor) || !descriptor.configurable || !descriptor.writable)) {
        trace.errors.push('dataLayer.push needs a custom descriptor adapter'); return;
      }
      const activeItems = new WeakSet();
      function wrap(delegate) {
        if (typeof delegate !== 'function') {
          trace.errors.push('dataLayer.push is not a function'); return delegate;
        }
        return function (...items) {
          const owned = new Set();
          for (const item of items) {
            if (item === null || typeof item !== 'object' || activeItems.has(item)) continue;
            record(item); owned.add(item);
          }
          // Mark after recording: the same object twice in one call is two inputs.
          owned.forEach(item => activeItems.add(item));
          try { return Reflect.apply(delegate, this, items); }
          finally { owned.forEach(item => activeItems.delete(item)); }
        };
      }
      let push = wrap(layer.push);
      const observed = { get: () => push, set: next => { push = wrap(next); } };
      try {
        Object.defineProperty(layer, 'push', {
          configurable: true, enumerable: descriptor?.enumerable ?? false, ...observed,
        });
        pushDescriptors.set(layer, observed);
      } catch { trace.errors.push('Cannot observe dataLayer.push'); }
    }
    const descriptor = Object.getOwnPropertyDescriptor(w, layerName);
    if (descriptor && (!('value' in descriptor) || !descriptor.configurable || !descriptor.writable)) {
      trace.errors.push('dataLayer needs a custom descriptor adapter'); return;
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
        configurable: true, enumerable: descriptor?.enumerable ?? true, ...observedLayer,
      });
    } catch { trace.errors.push('Cannot observe dataLayer assignments'); }
    w.__qaDataLayerAudit = () => {
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

export async function readDataLayerTrace(page: Page): Promise<DataLayerTrace> {
  return page.evaluate(() => {
    const w = window as any;
    if (!w.__qaDataLayerTrace) throw new Error('Install the dataLayer observer before navigation');
    w.__qaDataLayerAudit?.();
    return w.__qaDataLayerTrace;
  });
}
```

## Assert one complete ecommerce input

`analytics-state` below is a documented application milestone meaning initial
product tracking work is complete. Replace that selector and phase with the real
signal; do not set it from the test. Many applications document no tracking milestone
at all; then use the last state the handler reaches that the contract does document
(a status message such as "Order created", a `data-ready` attribute after load, the
order row appearing) and say in the notes that it is a handler-end signal, not a
tracking milestone. With no such signal either, define a bounded observation window
and report its duration. A first-event wait alone cannot exclude
a later duplicate. After actions, checkpoint `trace.entries.length` and assert only
new entries, so a page-load event cannot satisfy a click that emits nothing.

```ts
import { test, expect } from '@playwright/test';
import { installDataLayerObserver, readDataLayerTrace } from './helpers/datalayer';

test('view_item supplies the ecommerce input', async ({ page }) => {
  await installDataLayerObserver(page);
  await page.goto('/product/42');
  await expect(page.getByTestId('analytics-state')).toHaveAttribute('data-phase', 'view-item-complete');
  const trace = await readDataLayerTrace(page);
  expect(trace.errors, 'dataLayer observation failed').toEqual([]);
  expect(trace.replacements, 'Application replaced its initialized dataLayer').toBe(0);
  const matches = trace.entries.filter(entry => entry.event === 'view_item');
  expect(matches, 'Expected exactly one view_item input').toHaveLength(1);
  const ecommerce = matches[0].ecommerce;
  expect(ecommerce.currency).toBe('USD');
  expect(ecommerce.value).toBe(49.99);
  expect(ecommerce.items).toHaveLength(1);
  expect(ecommerce.items[0]).toMatchObject({ item_id: 'SKU-42', price: 49.99, quantity: 1 });
});
```

Currency belongs at the ecommerce event level, and products are nested in `items`.
See [Google's ecommerce examples](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce?client_type=gtm)
and [GA4 view_item parameters](https://developers.google.com/analytics/devguides/collection/ga4/reference/events#view_item).
The particular SKU, price, and quantity are this example's tracking-plan expectations.
Validate the normalized payload with the tracking-plan helper for additional required
fields. The observer records input, not successful tag processing; pair it with
network capture and a reviewed transport decoder when both layers matter.
