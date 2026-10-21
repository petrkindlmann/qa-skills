import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { expect as playwrightExpect } from 'playwright/test';
import { loadFunctions } from '../examples/snippets.mjs';

// Execute the actual documented helpers, fixture lifecycle and example assertions.
const expect = playwrightExpect.configure({ timeout: 700 });
const captureSource = 'skills/analytics-tracking-testing/references/capture-fixture.md';
const layerSource = 'skills/analytics-tracking-testing/references/datalayer-capture.md';
const { parseGA4 } = loadFunctions('skills/analytics-tracking-testing/references/ga4-interception.md',
  'function parseGA4(', ['parseGA4']);
const { test: fixtures, attachAnalyticsCollector } = loadFunctions(captureSource, '// fixtures/analytics.ts',
  ['test', 'attachAnalyticsCollector'], { base: { extend: definitions => definitions }, expect, parseGA4 });
const { metaGETPixel } = loadFunctions(captureSource, 'function metaGETPixel(', ['metaGETPixel']);
const layer = loadFunctions(layerSource, 'function installDataLayerObserver(',
  ['installDataLayerObserver', 'readDataLayerTrace']);
let captureRecipe, captureOptions, layerRecipe;
const registerCapture = (_name, run) => { captureRecipe = run; };
registerCapture.use = options => { captureOptions = options.analyticsOptions; };
loadFunctions(captureSource, "test('add_to_cart hits", [], { test: registerCapture, expect, metaGETPixel });
loadFunctions(layerSource, "test('view_item supplies", [], {
  test: (_name, run) => { layerRecipe = run; }, expect, ...layer,
});

let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true, timeout: 10000,
    ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}),
  });
  console.log(`Analytics fixture browser: ${browser.version()}`);
});
after(async () => { await browser?.close(); });

function fixtureHTML(options) {
  return `<!doctype html><html><body>
    <button>Add to cart</button><output data-testid="analytics-state" data-phase="booting"></output>
    <script>
    const options = ${JSON.stringify(options)};
    const status = document.querySelector('output');
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const ga4 = name => fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-TEST&en='+name);
    (async () => {
      if (options.kind === 'capture') {
        document.querySelector('button').onclick = async () => {
          try {
            status.dataset.phase = 'changing';
            if (!options.missingGA4) {
              if (options.postGA4) await fetch('https://www.google-analytics.com/g/collect?v=2&tid=G-TEST', {
                method:'POST', body:'en=add_to_cart'+String.fromCharCode(10)+'en=cart_details',
              });
              else await ga4('add_to_cart');
              if (options.duplicateGA4) { await pause(40); await ga4('add_to_cart'); }
            }
            if (!options.missingMeta) await fetch('https://www.facebook.com/tr/?id=1234567890&ev=AddToCart');
            status.dataset.phase = 'cart-complete';
          } catch (error) { window.__fixtureError = error.message; }
        };
        await ga4('page_view');
        if (options.staleGA4) await ga4('add_to_cart');
        status.dataset.phase = 'ready';
      } else {
        window.__beforeLayer = typeof window.dataLayer;
        const item = {event:'view_item',ecommerce:{currency:'USD',value:49.99,
          items:[{item_id:'SKU-42',price:49.99,quantity:options.stringQuantity ? '1' : 1}]}};
        if (!options.absent) {
          if (options.defaultAssignment) window.dataLayer = window.dataLayer || [];
          else window.dataLayer = [];
          window.__assignedLayer = window.dataLayer;
          if (!options.missingEvent) {
            if (options.duplicate === 'same-call') window.dataLayer.push(item,item);
            else {
              window.dataLayer.push(item);
              if (options.duplicate === 'separate') { await pause(40); window.dataLayer.push(item); }
            }
          }
          if (options.replace) { window.dataLayer = []; window.dataLayer.push({event:'after_replacement'}); }
          if (options.removePushObserver) Object.defineProperty(window.dataLayer,'push',{
            configurable:true,writable:true,value:Array.prototype.push,
          });
          if (options.removeLayerObserver) Object.defineProperty(window,'dataLayer',{
            configurable:true,writable:true,value:window.dataLayer,
          });
        }
        status.dataset.phase = 'view-item-complete';
      }
    })().catch(error => { window.__fixtureError = error.message; });
    </script></body></html>`;
}

async function withFixture(options, run) {
  const context = await browser.newContext({ baseURL: 'https://shop.test', serviceWorkers: 'block' });
  let navigations = 0;
  // All fixture-page requests, including collector and decoy hosts, are fulfilled locally.
  await context.route('**/*', route => {
    if (route.request().isNavigationRequest()) {
      navigations++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHTML(options) });
    }
    return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(700);
  page.setDefaultNavigationTimeout(3000);
  const scriptErrors = [];
  page.on('pageerror', error => scriptErrors.push(error.message));
  try { return await run(page); }
  finally {
    const fixtureError = await page.evaluate(() => window.__fixtureError);
    await context.close();
    assert.ok(navigations > 0, 'The controlled application fixture was visited');
    assert.deepEqual(scriptErrors, [], 'Fixture scripts must execute successfully');
    assert.equal(fixtureError, undefined, 'Fixture work must complete without errors');
  }
}

async function runCapture(options = {}, inspect = () => {}) {
  return withFixture({ kind: 'capture', ...options }, async page => {
    const initial = page.listenerCount('request');
    try {
      await fixtures.beacons({ page, analyticsOptions: captureOptions }, async beacons => {
        await captureRecipe({ page, beacons });
        await inspect(beacons, page);
      });
    } finally { assert.equal(page.listenerCount('request'), initial, 'Fixture removes its listener'); }
  });
}
const runLayer = (options = {}) => withFixture(options, page => layerRecipe({ page }));
const finishLayer = page => expect(page.getByTestId('analytics-state'))
  .toHaveAttribute('data-phase', 'view-item-complete');

test('capture recipe observes a healthy GET and Meta action after initialization', async () => {
  await runCapture({}, beacons => assert.deepEqual(beacons.map(event => event.eventName),
    ['page_view', 'add_to_cart', 'AddToCart']));
});
test('capture recipe preserves each POST batch row and common measurement ID', async () => {
  await runCapture({ postGA4: true }, beacons => {
    assert.deepEqual(beacons.map(event => event.eventName), ['page_view', 'add_to_cart', 'cart_details', 'AddToCart']);
    assert.ok(beacons.filter(event => event.destination === 'ga4').every(event => event.params.tid === 'G-TEST'));
  });
});
for (const [name, options, error] of [
  ['missing GA4', { missingGA4: true }, /Expected exactly one new GA4/],
  ['stale GA4 without a new action event', { missingGA4: true, staleGA4: true }, /Expected exactly one new GA4/],
  ['delayed duplicate GA4', { duplicateGA4: true }, /Expected exactly one new GA4/],
  ['missing Meta', { missingMeta: true }, /Expected exactly one new Meta/],
]) test(`capture recipe rejects ${name}`, async () => { await assert.rejects(runCapture(options), error); });

test('collector applies exact pixel origin/path/method and approved GA4 hosts', async () => {
  await withFixture({ absent: true }, async page => {
    const collector = attachAnalyticsCollector(page, { extraGA4Hosts: ['metrics.shop.test'], pixels: [metaGETPixel('1234567890')] });
    try {
      await page.goto('/');
      await page.evaluate(async () => {
        for (const [url, init] of [
          ['https://metrics.shop.test/g/collect?tid=G-FIRST&en=approved'],
          ['https://www.facebook.com/tr/?id=1234567890&ev=Approved'],
          ['https://metrics.shop.test.attacker.test/g/collect?en=decoy'],
          ['https://google-analytics.com.attacker.test/g/collect?en=decoy'],
          ['https://www.google-analytics.com/proxy?next=/g/collect&en=decoy'],
          ['https://www.facebook.com.attacker.test/tr/?id=1234567890&ev=decoy'],
          ['https://www.facebook.com/tr/extra?id=1234567890&ev=decoy'],
          ['https://www.facebook.com:8443/tr/?id=1234567890&ev=decoy'],
          ['https://www.facebook.com/tr/?id=1234567890&ev=decoy', { method:'POST', body:'{"event":"invented-json"}' }],
        ]) await fetch(url, init);
      });
      assert.deepEqual(collector.events.map(event => event.eventName), ['approved', 'Approved']);
      assert.deepEqual(collector.errors, []);
    } finally { collector.stop(); }
  });
});
test('matched pixel decoder errors fail the actual fixture and still release its listener', async () => {
  await withFixture({ absent: true }, async page => {
    const initial = page.listenerCount('request');
    await assert.rejects(fixtures.beacons({ page, analyticsOptions: captureOptions }, async () => {
      await page.goto('/');
      await page.evaluate(() => fetch('https://www.facebook.com/tr/?id=wrong&ev=AddToCart'));
    }), /Analytics capture failed/);
    assert.equal(page.listenerCount('request'), initial);
  });
});
test('fixture teardown also runs when the consuming test throws and stops collection', async () => {
  await withFixture({ kind: 'capture' }, async page => {
    const initial = page.listenerCount('request');
    const failure = new Error('Consumer assertion failed');
    let observed;
    await assert.rejects(fixtures.beacons({ page, analyticsOptions: captureOptions }, async beacons => {
      observed = beacons;
      await page.goto('/');
      await expect(page.getByTestId('analytics-state')).toHaveAttribute('data-phase', 'ready');
      assert.equal(beacons[0].eventName, 'page_view');
      throw failure;
    }), error => error === failure);
    assert.equal(page.listenerCount('request'), initial);
    const length = observed.length;
    await page.evaluate(() => fetch('https://www.google-analytics.com/g/collect?en=after_stop'));
    assert.equal(observed.length, length);
  });
});

for (const defaultAssignment of [false, true]) {
  test(`dataLayer recipe observes healthy ${defaultAssignment ? 'default' : 'direct first'} assignment without seeding`, async () => {
    await withFixture({ defaultAssignment }, async page => {
      await layerRecipe({ page });
      assert.deepEqual(await page.evaluate(() => ({ before:window.__beforeLayer, same:window.dataLayer === window.__assignedLayer })),
        { before:'undefined', same:true });
    });
  });
}
test('missing application initialization remains absent and cannot pass the event gate', async () => {
  await withFixture({ absent: true }, async page => {
    await layer.installDataLayerObserver(page);
    await page.goto('/');
    await finishLayer(page);
    assert.equal(await page.evaluate(() => typeof window.dataLayer), 'undefined');
    assert.deepEqual(await layer.readDataLayerTrace(page), { entries:[], errors:[], replacements:0 });
  });
  await assert.rejects(runLayer({ absent: true }), /Expected exactly one view_item/);
});
for (const [name, options, error] of [
  ['initialized but empty queue', { missingEvent: true }, /Expected exactly one view_item/],
  ['same object in separate pushes', { duplicate: 'separate' }, /Expected exactly one view_item/],
  ['same object twice in one push', { duplicate: 'same-call' }, /Expected exactly one view_item/],
  ['wrong nested quantity type', { stringQuantity: true }, /toMatchObject/],
  ['removed layer descriptor', { removeLayerObserver: true }, /dataLayer observation failed/],
  ['removed push descriptor', { removePushObserver: true }, /dataLayer observation failed/],
]) test(`dataLayer recipe rejects ${name}`, async () => { await assert.rejects(runLayer(options), error); });

test('replacement events remain observable without restoring the discarded queue', async () => {
  await withFixture({ replace: true }, async page => {
    await layer.installDataLayerObserver(page);
    await page.goto('/');
    await finishLayer(page);
    const trace = await layer.readDataLayerTrace(page);
    assert.equal(trace.replacements, 1);
    assert.deepEqual(trace.entries.map(entry => entry.event), ['view_item', 'after_replacement']);
    assert.equal(await page.evaluate(() => window.dataLayer.length), 1);
  });
  await assert.rejects(runLayer({ replace: true }), /Application replaced its initialized dataLayer/);
});
test('custom push chain preserves receiver, arguments, return identity and one snapshot', async () => {
  await withFixture({ absent: true }, async page => {
    await layer.installDataLayerObserver(page);
    await page.goto('/');
    await finishLayer(page);
    const result = await page.evaluate(() => {
      const queue = [], entry = { event:'custom', nested:{ value:7 } }, token = { accepted:true };
      let customCalls = 0, wrapperCalls = 0, sameReceiver = false, sameArgument = false;
      queue.push = function (...items) {
        customCalls++; sameReceiver = this === queue; sameArgument = items[0] === entry;
        Array.prototype.push.apply(this, items); return token;
      };
      window.dataLayer = queue;
      const previous = queue.push;
      queue.push = function (...items) { wrapperCalls++; return Reflect.apply(previous, this, items); };
      const returned = queue.push(entry);
      entry.nested.value = 99;
      return { customCalls, wrapperCalls, sameReceiver, sameArgument, sameReturn:returned === token, sameQueue:window.dataLayer === queue };
    });
    assert.deepEqual(result, { customCalls:1, wrapperCalls:1, sameReceiver:true, sameArgument:true, sameReturn:true, sameQueue:true });
    const trace = await layer.readDataLayerTrace(page);
    assert.deepEqual(trace, { entries:[{ event:'custom',nested:{value:7} }], errors:[], replacements:0 });
  });
});
test('custom push exceptions propagate unchanged and snapshot failure does not alter the delegate', async () => {
  await withFixture({ absent: true }, async page => {
    await layer.installDataLayerObserver(page);
    await page.goto('/');
    await finishLayer(page);
    const result = await page.evaluate(() => {
      window.dataLayer = [];
      const failure = new Error('Application error');
      window.dataLayer.push = () => { throw failure; };
      let sameError = false;
      try { window.dataLayer.push({event:'attempted'}); } catch (error) { sameError = error === failure; }
      window.dataLayer.push = Array.prototype.push;
      const returned = window.dataLayer.push({event:'uncloneable',callback:()=>{}});
      return { sameError, returned, length:window.dataLayer.length };
    });
    assert.deepEqual(result, { sameError:true, returned:1, length:1 });
    const trace = await layer.readDataLayerTrace(page);
    assert.deepEqual(trace.entries.map(entry => entry.event), ['attempted']);
    assert.deepEqual(trace.errors, ['Could not snapshot a dataLayer object']);
  });
});
test('reading before observer installation fails explicitly', async () => {
  await withFixture({ absent: true }, async page => {
    await page.goto('/');
    await assert.rejects(layer.readDataLayerTrace(page), /Install the dataLayer observer before navigation/);
  });
});
