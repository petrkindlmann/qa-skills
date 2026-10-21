import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { expect as playwrightExpect } from 'playwright/test';
import { loadFunctions } from '../examples/snippets.mjs';

// Every helper and recipe under test is loaded from the actual fenced documentation.
const expect = playwrightExpect.configure({ timeout: 700 });
const consentReference = 'skills/analytics-tracking-testing/references/consent-mode.md';
const cmpReference = 'skills/compliance-testing/references/gdpr-cmp-tests.md';
const consent = loadFunctions(consentReference, 'function installConsentObserver', [
  'installConsentObserver', 'readConsentTrace', 'assertDefaultConsent',
  'assertConsentUpdate', 'assertBasicConsentAcceptance', 'waitForConsentUpdate', 'deniedConsent', 'grantedConsent',
], { expect });
const readiness = loadFunctions(consentReference, 'function waitForPrivacyPhase', ['waitForPrivacyPhase'], { expect });
const cookies = loadFunctions(cmpReference, 'function isStrictlyNecessary', [
  'isStrictlyNecessary', 'isAnalyticsCookie', 'isMarketingCookie',
]);
const tracking = loadFunctions(cmpReference, 'function attachTrackingRequests', [
  'attachTrackingRequests', 'assertNoTracking',
], { expect });
const gpc = loadFunctions(cmpReference, 'function emulateGPCDOM', ['emulateGPCDOM', 'assertGPCOptOut'], { expect, ...cookies });
const tcf = loadFunctions(cmpReference, 'function readTCFData', ['readTCFData', 'assertTCFConsent'], { expect });
const ga4 = loadFunctions('skills/analytics-tracking-testing/references/ga4-interception.md',
  'function parseGA4', ['parseGA4', 'attachGA4Collector']);
const dependencies = { expect, ...consent, ...readiness, ...cookies, ...tracking, ...gpc, ...tcf, ...ga4 };

function recipes(path, identifier) {
  const cases = [];
  const scopes = [{ hooks: [], options: {} }];
  const register = (name, run) => {
    const scope = scopes.at(-1);
    cases.push({ name, run, hooks: [...scope.hooks], options: { ...scope.options } });
  };
  register.describe = (_name, body) => {
    const parent = scopes.at(-1);
    scopes.push({ hooks: [...parent.hooks], options: { ...parent.options } });
    try { body(); } finally { scopes.pop(); }
  };
  register.use = options => Object.assign(scopes.at(-1).options, options);
  register.beforeEach = hook => scopes.at(-1).hooks.push(hook);
  loadFunctions(path, identifier, [], { ...dependencies, test: register });
  return Object.fromEntries(cases.map(example => [example.name, example]));
}

const transitions = recipes(cmpReference, "test.describe('Advanced gtag consent transitions'");
const basic = recipes(cmpReference, "test.describe('Basic consent policy'");
const gpcRecipes = recipes(cmpReference, "test.describe('HTTP GPC path'");
const advanced = recipes(consentReference, "test.describe('Advanced consent mode:");
const basicConsent = recipes(consentReference, "test.describe('Basic consent mode:");
const cookieRecipes = recipes(cmpReference, "test.describe('Cookie consent lifecycle'");
const bannerRecipes = recipes(cmpReference, "test.describe('Consent banner'");

let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.QA_BROWSER_EXECUTABLE ? { executablePath: process.env.QA_BROWSER_EXECUTABLE } : {}),
  });
});
after(async () => { await browser?.close(); });

function fixtureHTML(options, headerGPC) {
  return `<!doctype html><html><body>
    <div role="dialog" aria-label="Cookie consent">
      <button id="accept" style="width:100px;height:40px">Accept all</button>
      <button id="reject" style="width:100px;height:${options.tinyReject ? 2 : 40}px">Reject all</button>
      <button id="partial">Accept analytics only</button>
      <a href="/privacy">Privacy policy</a>
    </div>
    <label><input id="analytics" type="checkbox">Analytics</label>
    <label><input id="marketing" type="checkbox">Marketing</label>
    <label><input id="optout" type="checkbox">Do not sell or share my personal information</label>
    <button id="save">Save</button>
    <output data-testid="privacy-state" data-phase="booting"></output>
    <script>
    const options = ${JSON.stringify(options)};
    const headerGPC = ${JSON.stringify(headerGPC)};
    const denied = {ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'};
    const granted = Object.fromEntries(Object.keys(denied).map(key => [key,'granted']));
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const status = document.querySelector('[data-testid="privacy-state"]');
    const button = id => document.getElementById(id);
    let choice = options.losePersistence ? null : localStorage.getItem('consent-choice');
    window.__beforeLayer = typeof window.dataLayer;
    window.__beforeGtag = typeof window.gtag;
    window.__pushCalls = 0;
    const originalLayer = [];
    if (options.customPush) originalLayer.push = function(...entries) {
      if (this !== originalLayer) throw new Error('Observer changed push receiver');
      window.__pushCalls++;
      return Array.prototype.push.apply(this, entries);
    };
    window.dataLayer = originalLayer;
    window.__initialLayer = originalLayer;
    window.gtag = function() { return window.dataLayer.push(arguments); };
    if (options.rewrapPush) {
      const previous = window.dataLayer.push;
      window.dataLayer.push = function(...entries) {
        window.__pushCalls++;
        return previous.apply(this, entries);
      };
    }
    const state = () => {
      const result = {};
      for (const command of window.dataLayer) if (command[0] === 'consent') Object.assign(result, command[2]);
      return result;
    };
    async function emit(phase) {
      if ((phase === 'ready' && options.missingInitialBeacon) || (phase === 'accepted' && options.missingAcceptedBeacon)) return;
      const effective = state();
      const gcs = (phase === 'ready' && options.badDefaultTransport) ? 'G111' :
        'G1' + (effective.ad_storage === 'denied' ? '0' : '1') + (effective.analytics_storage === 'denied' ? '0' : '1');
      const params = new URLSearchParams({en:'page_view',gcs});
      if (!options.missingGCD) params.set('gcd','fixture-encoded-state');
      const url = 'http://www.google-analytics.com/g/collect?v=2&tid=G-TEST';
      if (options.postBeacons) {
        await fetch(url, {method:'POST',body:params.toString()+'\\nen=consent_sync&gcs='+gcs+'&gcd=fixture-encoded-state'});
      } else await fetch(url+'&'+params);
    }
    let tcfStatus = 'cmpuishown';
    let listenerSequence = 0;
    const listeners = window.__tcfListeners = new Map();
    window.__tcfCalls = [];
    const currentTCF = id => ({
      listenerId:id, gdprApplies:true, cmpStatus:'loaded', eventStatus:tcfStatus,
      tcString:options.tcf === 'missing-string' ? undefined : 'SYNTHETIC_TC_STRING',
      isServiceSpecific:true, tcfPolicyVersion:4,
      purpose:{consents:{'1':choice === 'accepted'}}, vendor:{consents:{'42':choice === 'accepted' && !options.denyVendor}},
    });
    if (options.tcf !== 'absent') window.__tcfapi = (command, version, callback, id) => {
      window.__tcfCalls.push(command);
      if (version !== 2) throw new Error('Wrong TCF API version');
      if (command === 'addEventListener') {
        const next = ++listenerSequence;
        listeners.set(next,callback);
        if (options.tcf === 'failure') callback({listenerId:next},false);
        else if (options.tcf === 'never') callback({listenerId:next,cmpStatus:'stub'},true);
        else callback(currentTCF(next),true);
      } else if (command === 'removeEventListener') callback(listeners.delete(id));
      else throw new Error('Deprecated or unsupported TCF command: '+command);
    };
    async function commit(next) {
      status.dataset.phase = 'changing';
      await delay(options.updateDelay ?? 40);
      choice = next;
      const selected = next === 'accepted' ? granted : next === 'partial' ? {...denied,analytics_storage:'granted'} : denied;
      if (options.replaceOnUpdate) window.dataLayer = [];
      if (options.deferDefaultUntilAccept && next === 'accepted' && options.defaultMode !== 'missing') {
        gtag('consent','default',denied);
      }
      if (options.skipUpdate !== next) {
        const update = options.twoSignalUpdate ? {ad_storage:selected.ad_storage,analytics_storage:selected.analytics_storage} : selected;
        window.__pushReturn = gtag('consent','update',update);
      }
      if (options.deferDefaultUntilAccept && next === 'accepted') gtag('config','G-TEST');
      localStorage.setItem('consent-choice', next);
      button('analytics').checked = selected.analytics_storage === 'granted';
      button('marketing').checked = selected.ad_storage === 'granted';
      if (next === 'accepted' || next === 'partial') document.cookie = '_ga=fixture; Path=/';
      else document.cookie = '_ga=; Max-Age=0; Path=/';
      if (options.leakAfterReject && next === 'rejected') document.cookie = 'consent_status_marketing=leak; Path=/';
      if (next === 'accepted') await emit(next);
      if (options.transientAccepted && next === 'accepted') gtag('consent','update',denied);
      tcfStatus = 'useractioncomplete';
      if (options.tcf !== 'never') for (const [id, callback] of listeners) callback(currentTCF(id),true);
      document.querySelector('[role="dialog"]').hidden = true;
      status.dataset.phase = next;
    }
    button('accept').onclick = () => commit('accepted');
    button('reject').onclick = () => commit('rejected');
    button('partial').onclick = () => commit('partial');
    button('save').onclick = () => commit('withdrawn');
    (async () => {
      await delay(options.initialDelay ?? 25);
      if (options.measurementFirst) gtag('config','G-TEST');
      if (!options.deferDefaultUntilAccept && options.defaultMode === 'object') window.dataLayer.push({event:'consent_default',...denied});
      else if (!options.deferDefaultUntilAccept && options.defaultMode !== 'missing') {
        const defaults = options.defaultMode === 'granted' ? granted : options.defaultMode === 'two' ?
          {ad_storage:'denied',analytics_storage:'denied'} : denied;
        window.__pushReturn = gtag('consent','default',defaults);
      }
      if (options.transientDefault) { gtag('consent','update',granted); gtag('consent','update',denied); }
      if (choice === 'accepted') { gtag('consent','update',granted); tcfStatus = 'tcloaded'; }
      if (options.overwritePush) Object.defineProperty(window.dataLayer,'push',{configurable:true,writable:true,value:Array.prototype.push});
      if (options.overwriteLayer) Object.defineProperty(window,'dataLayer',{configurable:true,writable:true,value:window.dataLayer});
      if (!options.deferDefaultUntilAccept) gtag('config','G-TEST');
      if (options.advanced) await emit('ready');
      if (options.decoyRequests) {
        await fetch('/asset?ref=google-analytics.com/g/collect');
        await fetch('http://google-analytics.com.attacker.test/g/collect?en=page_view');
      }
      if (options.lateTracker) {
        await delay(options.lateTracker);
        await fetch('http://google-analytics.com/g/collect?en=page_view');
      }
      if (options.initialCookieLeak) document.cookie = 'consent_status_marketing=leak; Path=/';
      const optedOut = (headerGPC && options.honorHeader !== false) ||
        (navigator.globalPrivacyControl === true && options.honorDOM !== false);
      button('optout').checked = optedOut;
      if (options.gpcLeak || (options.marketingBaseline && !optedOut)) {
        document.cookie = '_fbp=fixture; Path=/';
        await fetch('http://connect.facebook.net/pixel');
      }
      button('analytics').checked = choice === 'accepted';
      button('marketing').checked = choice === 'accepted';
      document.querySelector('[role="dialog"]').hidden = choice === 'accepted';
      status.dataset.phase = choice === 'accepted' ? 'accepted' : 'ready';
    })().catch(error => { window.__fixtureError = error.message; });
    </script></body></html>`;
}

async function withFixture(options, callback, contextOptions = {}) {
  const context = await browser.newContext({
    baseURL: 'http://consent.test', serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] }, ...contextOptions,
  });
  // No request reaches the public network. Even collector/decoy hosts are local fixtures.
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHTML(options, request.headers()['sec-gpc'] === '1') });
    } else {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
  });
  const page = await context.newPage();
  try {
    const result = await callback({ page, context });
    assert.equal(await page.evaluate(() => window.__fixtureError), undefined, 'Controlled fixture must complete without script errors');
    return result;
  } finally { await context.close(); }
}

async function runRecipe(recipe, options = {}) {
  assert.ok(recipe, 'Documented test exists');
  return withFixture(options, async context => {
    for (const hook of recipe.hooks) await hook(context);
    await recipe.run(context);
  }, recipe.options);
}

test('consent observer stays passive and preserves a custom push chain', async () => {
  await withFixture({ customPush: true, rewrapPush: true }, async ({ page }) => {
    await consent.installConsentObserver(page);
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    consent.assertDefaultConsent(await consent.readConsentTrace(page));
    const actual = await page.evaluate(() => ({
      beforeLayer: window.__beforeLayer, beforeGtag: window.__beforeGtag,
      sameArray: window.dataLayer === window.__initialLayer,
      returnValue: window.__pushReturn, pushCalls: window.__pushCalls,
      commands: window.__qaConsentTrace.commands.map(command => command[0]),
    }));
    assert.deepEqual(actual, {
      beforeLayer: 'undefined', beforeGtag: 'undefined', sameArray: true,
      returnValue: 1, pushCalls: 4, commands: ['consent', 'config'],
    });
  });
});

for (const [name, options, message] of [
  ['missing default', { defaultMode: 'missing' }, /No application consent default/],
  ['granted default', { defaultMode: 'granted' }, /Unexpected consent state/],
  ['two-signal default', { defaultMode: 'two' }, /Unexpected consent state/],
  ['object event masquerading as consent', { defaultMode: 'object' }, /No application consent default/],
  ['measurement before default', { measurementFirst: true }, /Measurement command ran before/],
  ['temporary grant before interaction', { transientDefault: true }, /Unexpected consent state/],
  ['overwritten layer descriptor', { overwriteLayer: true }, /Consent observation failed/],
  ['overwritten push descriptor', { overwritePush: true }, /Consent observation failed/],
]) {
  test(`application default gate rejects ${name}`, async () => {
    await assert.rejects(() => runRecipe(transitions['default state comes from the application'], options), message);
  });
}

test('late acceptance works as an independent documented test with its own observer', async () => {
  await runRecipe(transitions['accepted: a new update reflects the choice'], { updateDelay: 1150 });
});
test('a fresh rejection produces a new denied update', async () => {
  await runRecipe(transitions['rejected: a new update reflects the choice']);
});
test('partial consent is observed from the actual button interaction', async () => {
  await withFixture({}, async ({ page }) => {
    await consent.installConsentObserver(page);
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    const checkpoint = (await consent.readConsentTrace(page)).commands.length;
    await page.getByRole('button', { name: 'Accept analytics only' }).click();
    const expected = { ...consent.deniedConsent, analytics_storage: 'granted' };
    await consent.waitForConsentUpdate(page, checkpoint, expected);
    await readiness.waitForPrivacyPhase(page, 'partial');
    consent.assertConsentUpdate(await consent.readConsentTrace(page), checkpoint, expected);
  });
});
test('a layer replacement is observed but never repaired or silently approved', async () => {
  await withFixture({ replaceOnUpdate: true }, async ({ page }) => {
    await consent.installConsentObserver(page);
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    const checkpoint = (await consent.readConsentTrace(page)).commands.length;
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    await readiness.waitForPrivacyPhase(page, 'accepted');
    const trace = await consent.readConsentTrace(page);
    assert.equal(trace.replacements, 1);
    assert.equal(trace.commands.at(-1)[1], 'update');
    assert.equal(await page.evaluate(() => window.dataLayer.length), 1, 'Observer did not restore discarded defaults');
    assert.throws(() => consent.assertConsentUpdate(trace, checkpoint, consent.grantedConsent), /replaced its initialized dataLayer/);
  });
});
test('an earlier update cannot satisfy a new action with no update', async () => {
  await withFixture({ skipUpdate: 'withdrawn' }, async ({ page }) => {
    await consent.installConsentObserver(page);
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    await readiness.waitForPrivacyPhase(page, 'accepted');
    const checkpoint = (await consent.readConsentTrace(page)).commands.length;
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await readiness.waitForPrivacyPhase(page, 'withdrawn');
    await assert.rejects(() => consent.waitForConsentUpdate(page, checkpoint, consent.deniedConsent, 250), /No new application consent update/);
  });
});
test('documented withdrawal survives navigation and verifies storage and update', async () => {
  await runRecipe(transitions['withdrawal removes optional storage and sends a new denied update']);
});
test('latest denied state after an apparent acceptance is rejected', async () => {
  await withFixture({ transientAccepted: true }, async ({ page }) => {
    await consent.installConsentObserver(page);
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    const checkpoint = (await consent.readConsentTrace(page)).commands.length;
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    await readiness.waitForPrivacyPhase(page, 'accepted');
    const trace = await consent.readConsentTrace(page);
    assert.throws(() => consent.assertConsentUpdate(trace, checkpoint, consent.grantedConsent), /Latest consent state/);
  });
});

test('basic mode accepts clean and substring-decoy traffic but catches deferred tracking', async () => {
  await runRecipe(basic['no configured tracking requests before consent']);
  await runRecipe(basic['no configured tracking requests before consent'], { decoyRequests: true });
  await assert.rejects(() => runRecipe(basic['no configured tracking requests before consent'], { lateTracker: 750 }), /Prohibited tracking request/);
});
test('basic acceptance requires newly emitted configured traffic', async () => {
  await runRecipe(basic['acceptance triggers configured tracking']);
  await assert.rejects(() => runRecipe(basic['acceptance triggers configured tracking'], { missingAcceptedBeacon: true }), /No tracking request after acceptance/);
});
test('basic-mode defaults initialized only on acceptance are valid and remain required', async () => {
  const recipe = basicConsent['acceptance initializes defaults before the update and planned beacon'];
  await runRecipe(recipe, { deferDefaultUntilAccept: true });
  await assert.rejects(() => runRecipe(recipe, { deferDefaultUntilAccept: true, defaultMode: 'missing' }), /No application consent default/);
  await assert.rejects(() => runRecipe(recipe, { deferDefaultUntilAccept: true, skipUpdate: 'accepted' }), /No new basic-mode consent update/);
});

for (const postBeacons of [false, true]) {
  test(`advanced-mode recipes parse real ${postBeacons ? 'POST batch' : 'GET'} requests before and after acceptance`, async () => {
    await runRecipe(advanced['before consent: application defaults and planned denied ping'], { advanced: true, postBeacons });
    await runRecipe(advanced['acceptance: new update and new planned granted beacon'], { advanced: true, postBeacons });
  });
}
for (const [name, options, message] of [
  ['missing app default', { defaultMode: 'missing' }, /No application consent default/],
  ['empty collector', { missingInitialBeacon: true }, /Expected initial ping is missing/],
  ['incorrect storage transport', { badDefaultTransport: true }, /G100/],
  ['missing encoded diagnostic', { missingGCD: true }, /Missing encoded consent diagnostic/],
]) {
  test(`advanced pre-consent gate rejects ${name}`, async () => {
    await assert.rejects(() => runRecipe(advanced['before consent: application defaults and planned denied ping'], { advanced: true, ...options }), message);
  });
}
test('a pre-consent ping cannot satisfy the post-acceptance beacon expectation', async () => {
  await assert.rejects(() => runRecipe(advanced['acceptance: new update and new planned granted beacon'],
    { advanced: true, missingAcceptedBeacon: true }), /No new accepted page_view/);
});

test('HTTP GPC recipe validates transport and opt-out without assuming a DOM property', async () => {
  await runRecipe(gpcRecipes['server honors the request header'], { marketingBaseline: true });
  await withFixture({}, async ({ page }) => {
    const response = await page.goto('/');
    assert.equal(await response.request().headerValue('sec-gpc'), '1');
    assert.notEqual(await page.evaluate(() => navigator.globalPrivacyControl), true);
  }, { extraHTTPHeaders: { 'Sec-GPC': '1' } });
});
test('explicit DOM GPC simulation exercises the client opt-out path', async () => {
  await runRecipe(gpcRecipes['client honors the explicitly simulated DOM preference'], { marketingBaseline: true });
});
test('GPC gate rejects an ignored header even when no marketing cookie happens to exist', async () => {
  await assert.rejects(() => runRecipe(gpcRecipes['server honors the request header'], { honorHeader: false }), /toBeChecked/);
});
test('GPC gate rejects storage leakage despite a checked opt-out indicator', async () => {
  await assert.rejects(() => runRecipe(gpcRecipes['client honors the explicitly simulated DOM preference'], { gpcLeak: true }), /Policy-prohibited cookies/);
});

test('TCF reader waits through incomplete data, observes the real action, and unregisters', async () => {
  await withFixture({ updateDelay: 100 }, async ({ page }) => {
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    const dataPromise = tcf.readTCFData(page, 'useractioncomplete', 2000);
    await page.waitForFunction(() => window.__tcfListeners.size === 1);
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    const data = await dataPromise;
    tcf.assertTCFConsent(data, { purposeIds: ['1'], vendorIds: ['42'], policyVersion: 4 });
    assert.equal(await page.evaluate(() => window.__tcfListeners.size), 0);
    assert.deepEqual(await page.evaluate(() => window.__tcfCalls), ['addEventListener', 'removeEventListener']);
  });
});
for (const [mode, message] of [['never', /callback timed out/], ['failure', /registration\/callback failed/], ['absent', /Timeout/]]) {
  test(`TCF ${mode} response is bounded and does not leave a registered listener`, async () => {
    await withFixture({ tcf: mode }, async ({ page }) => {
      await page.goto('/');
      await readiness.waitForPrivacyPhase(page, 'ready');
      await assert.rejects(() => tcf.readTCFData(page, 'useractioncomplete', 180), message);
      assert.equal(await page.evaluate(() => window.__tcfListeners.size), 0);
    });
  });
}
test('TCF policy number cannot substitute for TC string and actual purpose/vendor consent', async () => {
  await withFixture({ tcf: 'missing-string' }, async ({ page }) => {
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    const data = await tcf.readTCFData(page);
    assert.equal(data.tcfPolicyVersion, 4);
    assert.throws(() => tcf.assertTCFConsent(data, { purposeIds: ['1'], vendorIds: ['42'], policyVersion: 4 }), /Missing TC string/);
  });
  await withFixture({ denyVendor: true }, async ({ page }) => {
    await page.goto('/');
    await readiness.waitForPrivacyPhase(page, 'ready');
    await page.getByRole('button', { name: 'Accept all', exact: true }).click();
    const data = await tcf.readTCFData(page);
    assert.throws(() => tcf.assertTCFConsent(data, { purposeIds: ['1'], vendorIds: ['42'], policyVersion: 4 }), /Vendor 42 not consented/);
    assert.throws(() => tcf.assertTCFConsent(data, { purposeIds: ['1'], vendorIds: [], policyVersion: 5 }), /toBe/);
  });
});

test('cookie recipe sees deferred inventory leaks and does not exempt similar names', async () => {
  await runRecipe(cookieRecipes['no optional cookies before consent']);
  await assert.rejects(() => runRecipe(cookieRecipes['no optional cookies before consent'], { initialDelay: 100, initialCookieLeak: true }), /Optional cookies before consent/);
  await runRecipe(cookieRecipes['no optional cookies after rejection']);
  await assert.rejects(() => runRecipe(cookieRecipes['no optional cookies after rejection'], { leakAfterReject: true }), /Optional cookies after rejection/);
});
test('cookie acceptance and persisted navigation run against real storage and DOM', async () => {
  await runRecipe(cookieRecipes['configured analytics storage appears after acceptance']);
  await runRecipe(cookieRecipes['accepted state persists across navigation']);
});
test('banner threshold accepts usable controls and rejects a two-pixel reject button', async () => {
  const recipe = bannerRecipes['first visit exposes the required controls and policy link'];
  await runRecipe(recipe);
  await assert.rejects(() => runRecipe(recipe, { tinyReject: true }), /toBeGreaterThanOrEqual/);
});
