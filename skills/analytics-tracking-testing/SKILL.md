---
name: analytics-tracking-testing
description: >-
  Validate that analytics and marketing tracking fire CORRECTLY: GA4/GTM dataLayer events,
  Meta/TikTok/LinkedIn pixels, and ad-tech tags. Covers building a tracking plan as the
  contract, intercepting collect-endpoint beacons and dataLayer.push in Playwright, asserting
  event name + params + values + timing + de-duplication, Consent Mode v2 gating, CI regression
  gating, and news-media events (article-view, scroll-depth, paywall). Use when: "test analytics
  tracking," "GA4 event test," "verify the pixel fires," "dataLayer test," "tracking plan,"
  "Meta Pixel dedup," "scroll-depth tracking test," "gate tracking in CI."
  Not for: whether tracking is ALLOWED to fire under consent law (GDPR/CMP) — that is
  compliance-testing; this skill checks the data is CORRECT. SEO meta tags / structured data —
  out of scope.
  Related: compliance-testing, playwright-automation, api-testing, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: specialized
---

<objective>
Tracking that "looks fine" in GA4 DebugView still drops events silently after a refactor, sends the wrong currency, or double-counts a purchase. Reading `window.dataLayer` or asserting the button is `toBeVisible()` proves nothing — the beacon may never leave the browser. This skill makes you intercept the real network beacon (`google-analytics.com/g/collect`, `facebook.com/tr`, `analytics.tiktok.com`, `px.ads.linkedin.com`), parse the event name and parameters out of the request, and assert them against a tracking plan that is a typed contract — then gate that contract in CI so a dropped event fails the build.
</objective>

## Quick Route

| Situation | Go to |
|-----------|-------|
| Assert one GA4 event fired with correct params | [Intercepting GA4 beacons](#intercepting-ga4-beacons) |
| Treat the tracking plan as a validated contract | [The Tracking Plan Is the Contract](#the-tracking-plan-is-the-contract) |
| Verify dataLayer.push shape (not the beacon) | [Asserting dataLayer.push](#asserting-datalayerpush) |
| Pixel + server CAPI deduplication (event_id) | [Pixels and Server-Side Deduplication](#pixels-and-server-side-deduplication) |
| Events must/mustn't fire by consent state | [Consent Mode v2 Gating](#consent-mode-v2-gating) |
| Capture every pixel in one reusable fixture | `references/capture-fixture.md` |
| News-media: article-view, scroll-depth, paywall | [News-Media Events](#news-media-events) |
| Fail the build on a tracking regression | [Regression-Gating in CI](#regression-gating-in-ci) |
| Hundreds of events, many domains, small team | [Buy vs Build](#buy-vs-build) |

## Discovery Questions

First: check `.agents/qa-project-context.md` in the project root and skip anything it already answers (stack, tag manager, consent platform, target environments).

- **Which tracking destinations are live?** GA4 (`/g/collect`), Meta Pixel (`facebook.com/tr`), TikTok (`analytics.tiktok.com`), LinkedIn (`px.ads.linkedin.com`), ad-tech tags — each has a different endpoint grammar, so the capture helper must know them all.
- **GTM or hardcoded gtag?** GTM means the truth flows through `window.dataLayer.push` first, then GTM fires the beacon. You may assert at the push layer (input contract) AND the beacon (output contract); they are different tests.
- **Is there a tracking plan?** If not, build one first — it is the contract everything else validates against. No plan means no objective pass/fail.
- **Consent platform and default consent state?** Consent Mode v2 changes which beacons are even allowed to fire before consent. You need the CMP's accept/reject selectors to drive the test.
- **Client + server (CAPI) dedup in play?** If purchases fire both client Pixel and server Conversions API, the `event_id` must match or you double-count. This is the correctness property, not "did fbq run."
- **News-media surface?** Article pages add article-view, scroll-depth thresholds (25/50/75/100), and paywall-meter events that generic e-commerce plans miss.

---

## Core Principles

1. **Intercept the beacon, never trust the DOM or `dataLayer` alone.** A button click that updates the DOM, or a `dataLayer.push` that GTM silently drops, leaves no GA4 hit. The only proof an event was *sent* is the outbound request to the collect endpoint. Assert on the network beacon's URL params; reading `window.dataLayer` via `page.evaluate` only proves the push happened, not that anything left the browser.

2. **The tracking plan is a typed contract, not a comment.** Every expected event lives in an external schema (JSON/YAML/TS interface) with required params and their types. Tests validate captured events against it and report `missing` params and type `violations`. Hardcoding one expected value inline asserts nothing about the other twenty params and rots on the first plan change.

3. **De-duplication is the real correctness property for purchases.** Checking that `fbevents.js` loaded or counting that `fbq('track','Purchase')` ran misses double-counting entirely. The property that matters: the browser Pixel and the server CAPI send the *same* `event_id`/`eventID` so Meta collapses them into one conversion.

4. **Consent state is an input dimension, not a footnote.** The same page produces different beacons before vs after consent. Test both: before consent → no beacon (or only a cookieless consent ping); after accept → full beacon. And the default must be `denied` for all four Consent Mode v2 signals — a `granted` default is a compliance bug AND makes the gating test meaningless.

5. **Drive real user actions and wait on requests, never the clock.** Scroll depth fires from actual scrolling (`mouse.wheel`, `scrollIntoView`, `evaluate(scrollTo)`), and you wait for the beacon with `waitForRequest`, not `waitForTimeout`. A fixed sleep is flaky and hides the very timing bug you should catch.

6. **A tracking test that can't fail the build is theater.** "Check it in GA4 DebugView" and "monitor production" never block a regression. The contract must run in CI and exit non-zero when an event drops or a required param goes missing.

---

## Intercepting GA4 Beacons

GA4 (gtag.js / GTM) sends every event as an HTTP request to `https://www.google-analytics.com/g/collect` (region variants like `region1.google-analytics.com/g/collect` also occur). The event identity lives in the URL query string — you do not need the response.

GA4 `/g/collect` URL grammar you assert on:

| Param | Meaning | Example |
|-------|---------|---------|
| `v=2` | Measurement Protocol version (always 2 for GA4) | `v=2` |
| `tid=G-XXXXXXX` | Measurement ID | `tid=G-ABC123` |
| `en=` | **Event name** | `en=add_to_cart` |
| `ep.<name>=` | Event parameter, **string** type | `ep.currency=USD` |
| `epn.<name>=` | Event parameter, **number** type | `epn.value=49.99` |
| `gcs=` / `gcd=` | Consent state (see Consent Mode v2 section) | `gcs=G111` |

The string/number split is load-bearing: GA4 types params automatically, so `price` arrives as `epn.value` (number) and `currency` as `ep.currency` (string). Asserting `ep.value` when it is really `epn.value` silently fails.

Intercept with `page.waitForRequest` (single expected event), `page.on('request', ...)` (collect many), or `page.route` (inspect then continue — never `abort`). Parse params from `new URL(request.url()).searchParams`. Then `expect(...).toBe(...)` / `toEqual` / `toContain` on the parsed values.

Minimal pattern (full version with helper in `references/ga4-interception.md`):

```ts
test('add_to_cart fires with correct params', async ({ page }) => {
  await page.goto('/product/42');
  const [request] = await Promise.all([
    page.waitForRequest(r => r.url().includes('/g/collect') && r.url().includes('en=add_to_cart')),
    page.getByRole('button', { name: 'Add to cart' }).click(),
  ]);
  const params = new URL(request.url()).searchParams;
  expect(params.get('v')).toBe('2');
  expect(params.get('tid')).toContain('G-');
  expect(params.get('en')).toBe('add_to_cart');
  expect(params.get('ep.currency')).toBe('USD');
  expect(Number(params.get('epn.value'))).toBe(49.99);
});
```

Never substitute `page.evaluate(() => window.dataLayer)` as the only assertion, `toBeVisible()` on the button, or `waitForTimeout()` to "let the beacon send." See `references/ga4-interception.md` for batched-event parsing (GA4 can pack multiple events into one POST body) and region-endpoint handling.

---

## The Tracking Plan Is the Contract

A tracking plan is the source of truth: for every event, its name, required params, and each param's type. Keep it as a versioned file (`tracking-plan.json` / `.yaml`, or a TS `interface`/`Zod` schema) that both the app team and the tests import. Tests read the captured event and validate it against the plan — they do not hardcode expected values inline.

Validation produces a structured result, not a pass/fail boolean: list every `missing` required param and every type `mismatch`/`violation`. Example plan entry and validator:

```ts
// tracking-plan.json
{ "add_to_cart": { "required": { "currency": "string", "value": "number", "item_id": "string" } } }

function validateEvent(plan, eventName, params) {
  const spec = plan[eventName];
  const violations = [];
  for (const [name, type] of Object.entries(spec.required)) {
    const raw = params.get(`ep.${name}`) ?? params.get(`epn.${name}`);
    if (raw == null) { violations.push({ param: name, problem: 'missing' }); continue; }
    if (type === 'number' && Number.isNaN(Number(raw))) violations.push({ param: name, problem: 'type', expected: 'number' });
  }
  return violations; // empty array = event satisfies the contract
}
```

Then `expect(validateEvent(plan, 'add_to_cart', params)).toEqual([])`. Asserting only the event name and ignoring params, or hardcoding expected values with no plan file, is the bare-agent shortcut this skill exists to replace. See `references/tracking-plan.md` for the YAML form, a Zod-typed plan, and a reusable `assertAgainstPlan` matcher.

---

## Asserting dataLayer.push

When the question is specifically the GTM **input** — "is the right object pushed to `dataLayer` when the page loads?" — assert the push, not the GA4 beacon. This is the inverse of beacon interception: here the dataLayer push IS the target.

Capture pushes by wrapping `window.dataLayer.push` in `addInitScript` *before navigation* so you record every push from page load, then read the recorded array via `page.evaluate`. Do **not** `page.route` to mock the dataLayer (you would replace the thing under test), and do not read the GA4 network beacon instead (that is the output, a different contract).

For ecommerce, assert the nested shape, not just the event name — the `ecommerce.items` array and each item's `item_id`, `price`, `currency`:

```ts
await page.addInitScript(() => {
  window.dataLayer = window.dataLayer || [];
  const orig = window.dataLayer.push.bind(window.dataLayer);
  window.__pushes = [];
  window.dataLayer.push = (...args) => { window.__pushes.push(...args); return orig(...args); };
});
await page.goto('/product/42');
const pushes = await page.evaluate(() => window.__pushes);
const viewItem = pushes.find(p => p.event === 'view_item');
expect(viewItem.ecommerce.items[0]).toMatchObject({ item_id: 'SKU-42', price: 49.99, currency: 'USD' });
```

Use `find`/`filter`/`some` to locate the event in the recorded pushes. Full helper in `references/datalayer-capture.md`.

---

## Pixels and Server-Side Deduplication

Marketing pixels send their own beacons. Endpoints to intercept:

| Destination | Endpoint | Event param | Dedup key |
|-------------|----------|-------------|-----------|
| Meta Pixel | `facebook.com/tr` (also `/tr?`) | `ev=PageView`, `ev=Purchase` | `eid` / `event_id` |
| TikTok | `analytics.tiktok.com` | event in body/params | `event_id` |
| LinkedIn | `px.ads.linkedin.com` | conversion id | — |

For Meta, asserting that `connect.facebook.net/en_US/fbevents.js` loaded, or that `fbq('track','Purchase')` ran, is a load/count check — it does **not** prove correctness. The correctness property for a Purchase that fires both client-side (Pixel) and server-side (Conversions API / CAPI) is **deduplication**: both must carry the *same* `event_id` so Meta merges them into one conversion instead of double-counting.

Test it: capture the browser `facebook.com/tr` beacon for `ev=Purchase`, read its `event_id`, and assert it equals the `event_id` your server sent to CAPI (from a mocked/captured server call or a known fixture value). Skeleton:

```ts
const [pixel] = await Promise.all([
  page.waitForRequest(r => r.url().includes('facebook.com/tr') && r.url().includes('ev=Purchase')),
  completeCheckout(page),
]);
const clientEventId = new URL(pixel.url()).searchParams.get('eid'); // event_id on the wire
expect(clientEventId).toBe(serverCapiEventId); // deduplicates against the server CAPI event
```

See `references/pixels-and-dedup.md` for parsing TikTok/LinkedIn payloads and capturing the server CAPI call.

---

## Consent Mode v2 Gating

Consent Mode v2 is the standard (mandatory four-signal model). As of the **June 15 2026** change, Google acts only on the CMP-sent consent signal, so any two-signal answer is outdated. Test two states.

The four signals — all must default to `denied`:

| Signal | Governs |
|--------|---------|
| `ad_storage` | Advertising cookies |
| `analytics_storage` | Analytics cookies |
| `ad_user_data` | Sending user data to Google for ads |
| `ad_personalization` | Personalized ads / remarketing |

A `granted` default is a bug; omitting `ad_user_data` and `ad_personalization` (the v2 additions) is the outdated two-signal model and is wrong.

**Before consent:** no full beacon should fire — or only a *cookieless consent ping*. Use `addInitScript` to seed the `gtag('consent', 'default', {...})` denied state before page scripts run, and assert no `/g/collect` request fires (or that the one that does carries a denied consent state).

**After accept:** click the CMP accept button; the full beacon now fires.

The consent state rides on the beacon URL:

- `gcs=` — encodes `ad_storage` + `analytics_storage` only. `G100` = both denied, `G111` = both granted, `G110`/`G101` = partial. Before consent you expect `gcs=G100`.
- `gcd=` — encodes all four signals (string starting `11...`); present on every hit to Google services.

Assert the denied default and the `gcs=`/`gcd=` value on the pre-consent beacon, then the granted state post-accept. Full test with `addInitScript` consent seeding and CMP click in `references/consent-mode.md`.

> Whether the law *permits* a beacon under a given consent state is `compliance-testing`. This skill asserts that *when* a beacon fires, its data and consent params are correct.

---

## News-Media Events

News and publisher sites have a tracking surface generic e-commerce plans miss. Cover all three:

- **article_view** (or `article-view`) on article load — assert the beacon fires once with article metadata (id, section, author).
- **scroll-depth** at the 25 / 50 / 75 / 100 percent thresholds — one event per bucket, driven by *real scrolling*.
- **paywall / meter** — a `paywall_hit` (or meter) event when the free-article meter is exhausted.

Drive scroll with actual actions — `mouse.wheel`, `element.scrollIntoView`, or `page.evaluate(() => window.scrollTo(...))` / `scrollBy` — and wait on the beacon (`waitForRequest` or your captured-events list), never `waitForTimeout`. Scrolling in fixed sleeps both flakes and masks threshold-timing bugs.

```ts
const buckets = [25, 50, 75, 100];
for (const pct of buckets) {
  const [req] = await Promise.all([
    page.waitForRequest(r => r.url().includes('/g/collect') && r.url().includes('en=scroll')),
    page.evaluate(p => window.scrollTo(0, document.body.scrollHeight * (p / 100)), pct),
  ]);
  expect(new URL(req.url()).searchParams.get('epn.percent_scrolled')).toBe(String(pct));
}
```

Full suite (article_view metadata, the four scroll buckets de-duplicated, and the paywall-meter event) in `references/news-media.md`.

---

## Multi-Pixel Capture Fixture

Don't re-implement beacon capture in every test. Build one reusable Playwright fixture (`test.extend`) that listens with `page.on('request', ...)`, matches all destination endpoints (GA4 `/g/collect`, `facebook.com/tr`, `analytics.tiktok.com`, `px.ads.linkedin.com`), parses each request's `new URL(...).searchParams` and `postData()`, and pushes a normalized `{ destination, eventName, params }` onto a `collected` array tests assert against.

Critical trap: a capture helper must **observe**, so use `page.on('request')` (or `page.route` followed by `route.continue()`), **never** `page.route(...).abort()` — aborting blocks the very beacons you are trying to see. And it must capture pixels too, not GA4 only. Full fixture in `references/capture-fixture.md`.

---

## Regression-Gating in CI

The gate diffs captured events against the tracking-plan baseline and **fails the build** (non-zero exit) when a previously-firing event stops firing or a required param goes missing after a release. Structure it as a Playwright project that runs the journeys, captures every beacon via the fixture, and validates each against the plan; on any `missing`/dropped event the test `expect` fails, Playwright exits non-zero, and the GitHub Actions (or any CI) job goes red.

Do **not** make the gate "check GA4 DebugView manually," "only run against production traffic," or "warn but pass anyway" — none of those block a regression. The diff-against-baseline run belongs in PR CI, before merge. See `references/ci-gating.md` for the workflow YAML, the baseline-diff script, and how to surface missing-param failures in the job summary.

---

## Buy vs Build

DIY Playwright interception is the right call for a bounded set of events on a few critical journeys gated in CI. It stops paying off at scale: hundreds of events across many domains, with a small team, and a need for *continuous production / drift monitoring* (catching a tag a marketer breaks in GTM at 2am, which a pre-merge CI gate never sees).

| Dimension | Build (Playwright) | Buy |
|-----------|-------------------|-----|
| Few events, key journeys, pre-merge gate | Best fit | Overkill |
| Hundreds of events, many domains | Maintenance crushes you | Buy |
| Continuous 24/7 production drift monitoring | Out of scope for CI | Buy |
| Small team, high coverage demand | Build cost too high | Buy |

Current live paid options worth naming:

- **Trackingplan** — always-on/continuous monitoring of live traffic across web, mobile, and server-side; strongest when you need real-time drift detection rather than scheduled checks.
- **ObservePoint** — scheduled scans/audits of journeys against a tracking plan; mature for periodic governance.

Don't recommend Segment Protocols as the *only* validation (it governs data flowing through Segment, not arbitrary client beacons), and never call Google Tag Assistant a CI gate — it is an interactive debug tool, not an automated pass/fail. Tie the decision to scale, many domains, maintenance burden, and continuous monitoring — the axes where DIY stops paying off.

---

## Anti-Patterns

### 1. Asserting `window.dataLayer` (or the DOM) instead of the beacon
`page.evaluate(() => window.dataLayer)` proves a push happened, not that GA4 sent anything; `toBeVisible()` proves nothing about tracking. Intercept the `/g/collect` request and assert its `en=` and `ep.`/`epn.` params. (The one exception: when the *push itself* is the contract — see dataLayer.push — but then never reach for the GA4 beacon instead.)

### 2. `waitForTimeout` to "wait for the event to fire"
A fixed sleep flakes and hides timing bugs. Wait on the request: `page.waitForRequest(r => r.url().includes('/g/collect'))`.

### 3. Asserting only the event name
Name-only assertions pass while currency, value, and item_id are wrong. Validate every required param and its type against the tracking plan.

### 4. Hardcoding expected values inline with no plan file
There is no source of truth, so nothing catches a renamed param across the suite. Keep the plan external and validate against it.

### 5. Load/count checks for pixels (`fbevents.js` loaded, `fbq` ran)
Neither proves the conversion is correct or de-duplicated. For Purchase, assert the client and server `event_id` match.

### 6. Two-signal Consent Mode, or a `granted` default
Omitting `ad_user_data` and `ad_personalization` is the pre-2026 model. Default all four to `denied` and assert `gcs=`/`gcd=`.

### 7. `page.route(...).abort()` inside a capture helper
Aborting blocks the beacons you meant to observe. Use `page.on('request')` (or `route.continue()`).

### 8. A "gate" that can't fail the build
GA4 DebugView, production-only monitoring, or warn-but-pass do not stop a regression. Make CI exit non-zero on a dropped event or missing required param.

---

## Verification

Smallest check first — prove the suite actually catches a regression, don't just trust a green run:

- **One event, one beacon:** `npx playwright test -g add_to_cart` passes, and its trace (`--trace on`) shows the captured `/g/collect` request with `en=add_to_cart`. A green test with no matching request in the trace means you asserted on the wrong thing.
- **The gate can fail:** rename a required param in a branch (e.g. `value` → `amount` in the app) and re-run the CI project — the build must exit non-zero with a `missing`/violation message. If it still passes, the gate is theater.
- **Consent default is denied:** with the denied seed and no accept click, `gcs=G100` (or no full beacon) on every captured hit; after accept, `gcs=G111`. A pre-consent `G111` means the default is wrongly `granted`.
- **Dedup holds:** the client `eid` from `facebook.com/tr?ev=Purchase` equals the server CAPI `event_id` for the same order. Different values mean Meta will double-count.

## Done When

- Each tracked event has a test that intercepts the real collect-endpoint beacon (`/g/collect`, `facebook.com/tr`, etc.) and parses `en=`/`ev=` plus params from `searchParams`/`postData` — no DOM-only or dataLayer-only assertions.
- A versioned tracking plan file exists (JSON/YAML/TS) with required params and types; tests validate captured events against it and report `missing`/type violations, not just the event name.
- Purchase (or any client+server event) has a deduplication assertion: client beacon `event_id` equals the server CAPI `event_id`.
- A Consent Mode v2 test asserts all four signals default to `denied`, no full beacon fires before consent (or only a cookieless ping), the full beacon fires after accept, and `gcs=`/`gcd=` carry the expected consent state.
- A reusable capture fixture (`test.extend`) collects GA4 + Meta + TikTok + LinkedIn beacons; no test re-implements capture and no capture helper calls `route.abort()`.
- News-media surfaces (if present) cover article_view, scroll-depth at 25/50/75/100 driven by real scroll actions, and a paywall/meter event — all using `waitForRequest`, no `waitForTimeout`.
- A CI job runs the suite, diffs captured events against the tracking-plan baseline, and exits non-zero on a dropped event or missing required param — verified by a deliberately-broken tag turning the build red.

## Related Skills

- **compliance-testing** — Whether a beacon is *allowed* to fire under GDPR/CMP consent law, cookie-consent UI, and data-subject rights. This skill assumes the beacon is permitted and checks its data is correct; go there for the legality question.
- **playwright-automation** — Page Object Model, fixtures, config, and the general E2E patterns this skill builds its interception on.
- **api-testing** — Validating the server-side Conversions API / Measurement Protocol calls directly (request body, auth, response) when you need to assert the server half of deduplication.
- **qa-project-context** — Stack, tag manager, consent platform, and target environments that this skill's discovery questions read first.

## Reference Files (in `references/`)

- **ga4-interception.md** — Full GA4 `/g/collect` interception helper, batched-event POST-body parsing, region-endpoint handling.
- **tracking-plan.md** — JSON and YAML plan forms, a Zod-typed contract, and the reusable `assertAgainstPlan` matcher.
- **datalayer-capture.md** — `addInitScript` dataLayer.push wrapper and ecommerce `items[]` shape assertions.
- **pixels-and-dedup.md** — Meta/TikTok/LinkedIn payload parsing and client-vs-server CAPI `event_id` dedup capture.
- **consent-mode.md** — Consent Mode v2 default-denied seeding, CMP accept-click flow, and `gcs=`/`gcd=` assertions.
- **news-media.md** — article_view, de-duplicated 25/50/75/100 scroll buckets, and paywall-meter event tests.
- **capture-fixture.md** — The reusable multi-pixel `test.extend` capture fixture.
- **ci-gating.md** — GitHub Actions workflow, baseline-diff script, and surfacing missing-param failures.
