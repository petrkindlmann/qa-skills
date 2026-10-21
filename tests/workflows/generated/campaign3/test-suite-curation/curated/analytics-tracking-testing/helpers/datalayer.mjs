// Port of references/datalayer-capture.md "Install and read the observer" to plain ESM.
// Changes from the recipe, all recorded in final-response.md:
//   1. TypeScript annotations removed (the suite runs as .mjs).
//   2. Each recorded push also stores a UI probe in trace.context[i] (same index as
//      trace.entries[i]): a monotonic timestamp plus the state of a few page elements at
//      the instant of the push. The recipe records the object only, which cannot answer
//      the contract's ordering clause ("after the order response arrives and before the
//      orders list refreshes"). trace.entries keeps the recipe's shape so the recipe's
//      filter(entry => entry.event === ...) still applies.
// The observer never seeds the layer, never creates gtag and never repairs a replaced queue.

export async function installDataLayerObserver(page, { layerName = 'dataLayer', uiProbes = [] } = {}) {
  await page.addInitScript(({ layerName, uiProbes }) => {
    const w = window;
    const trace = w.__qaDataLayerTrace = { entries: [], context: [], errors: [], replacements: 0 };
    const seen = new WeakSet();
    const pushDescriptors = new WeakMap();
    function probeUi() {
      const ui = { at: Math.round(performance.now() * 1000) / 1000 };
      for (const [name, selector, kind] of uiProbes) {
        try {
          const element = document.querySelector(selector);
          if (kind === 'text') ui[name] = element ? element.textContent : null;
          else if (kind === 'visible') ui[name] = Boolean(element) && !element.hidden;
          else if (kind === 'disabled') ui[name] = element ? element.disabled : null;
          else if (kind === 'count') ui[name] = document.querySelectorAll(selector).length;
          else if (kind.startsWith('attr:')) ui[name] = [...document.querySelectorAll(selector)].map(el => el.getAttribute(kind.slice(5)));
          else ui[name] = 'unknown-probe-kind';
        } catch { ui[name] = 'probe-error'; }
      }
      return ui;
    }
    function record(item) {
      if (Object.prototype.toString.call(item) !== '[object Object]') return;
      try { trace.entries.push(structuredClone(item)); trace.context.push(probeUi()); }
      catch { trace.errors.push('Could not snapshot a dataLayer object'); }
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
  }, { layerName, uiProbes });
}

export async function readDataLayerTrace(page) {
  return page.evaluate(() => {
    const w = window;
    if (!w.__qaDataLayerTrace) throw new Error('Install the dataLayer observer before navigation');
    w.__qaDataLayerAudit?.();
    return w.__qaDataLayerTrace;
  });
}
