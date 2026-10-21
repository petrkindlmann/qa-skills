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
  version: "1.1"
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

First: check `.agents/qa-project-context.md` in the project root and skip anything it already answers (stack, tag manager, consent platform, target environments). An unfilled template answers nothing; treat it as absent and take the answers from the application's contract or configuration.

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

4. **Consent state is an input dimension.** Test the approved regional policy in basic
   or advanced mode. Observe the application's actual four-signal default and updates;
   do not supply a default from the test. Basic mode blocks tags before consent, while
   advanced mode may emit permitted measurements without cookies. Assert the planned
   post-accept events and relevant storage independently.

5. **Drive real user actions and wait on requests, never the clock.** Scroll depth fires from actual scrolling (`mouse.wheel`, `scrollIntoView`, `evaluate(scrollTo)`), and you wait for the beacon with `waitForRequest`, not `waitForTimeout`. A fixed sleep is flaky and hides the very timing bug you should catch.

6. **A tracking test that can't fail the build is theater.** "Check it in GA4 DebugView" and "monitor production" never block a regression. The contract must run in CI and exit non-zero when an event drops or a required param goes missing.

---

## Intercepting GA4 Beacons

GA4 web tags use `/g/collect` requests, sometimes with several events in a POST body and common fields in the query. The following parser handles an observed web-tag format, not the public JSON Measurement Protocol. Retain captures from the deployed tag version; first-party proxy and server-side collection need explicit adapters. A request proves browser emission, not successful downstream ingestion.

GA4 `/g/collect` URL grammar you assert on:

| Param | Meaning | Example |
|-------|---------|---------|
| `v=2` | Version field in the observed web-tag transport | `v=2` |
| `tid=G-XXXXXXX` | Measurement ID | `tid=G-ABC123` |
| `en=` | **Event name** | `en=add_to_cart` |
| `ep.<name>=` | Custom event parameter, **string** type | `ep.campaign_label=spring` |
| `epn.<name>=` | Event parameter, **number** type | `epn.value=49.99` |
| `gcs=` / `gcd=` | Consent state (see Consent Mode v2 section) | `gcs=G111` |

Preserve wire type information. Custom parameters can use `ep.` or `epn.`, but reserved ecommerce fields and items have their own web-tag encodings. Do not assume standard currency is `ep.currency` or an item ID is a flat `ep.item_id`. Google's logical ecommerce contract uses event-level `currency` and nested `items[]`; decode the observed transport through a capture-tested adapter before checking that contract.

Intercept with `page.waitForRequest` (single expected event) or `page.on('request', ...)`
(collect many). Attach before the action. Match the exact `/g/collect` path and an
approved hostname. Merge each POST event's parameters over the URL query with
`parseGA4` from `references/ga4-interception.md`; URL-only matching misses batched events.
Use a test property or a local collector so tests do not pollute production analytics.

Pattern using the parser below plus your application's verified ecommerce decoder and logical tracking plan. `decodeEcommerceWebEvent` is a required project adapter, not a package supplied by this skill; unsupported or missing wire fields must fail. See `references/ga4-interception.md` and `references/tracking-plan.md`.

```ts
test('add_to_cart fires with correct params', async ({ page }) => {
  await page.goto('/product/42');
  const [request] = await Promise.all([
    page.waitForRequest(r => parseGA4(r).some(event => event.name === 'add_to_cart')),
    page.getByRole('button', { name: 'Add to cart' }).click(),
  ]);
  const events = parseGA4(request).filter(event => event.name === 'add_to_cart');
  expect(events).toHaveLength(1);
  const params = events[0].params;
  expect(params.tid).toBe('G-TEST'); // use the test property's exact measurement ID
  // Application adapter, checked against redacted captures from the deployed tag.
  const payload = decodeEcommerceWebEvent(params);
  expect(validateEvent(plan, 'add_to_cart', payload)).toEqual([]);
  expect(payload).toMatchObject({
    currency: 'USD', value: 49.99,
    items: [{ item_id: 'SKU-42', price: 49.99, quantity: 1 }],
  });
});
```

Never substitute `page.evaluate(() => window.dataLayer)` as the only assertion, `toBeVisible()` on the button, or `waitForTimeout()` to "let the beacon send." See `references/ga4-interception.md` for batched-event parsing (GA4 can pack multiple events into one POST body) and region-endpoint handling.

---

## The Tracking Plan Is the Contract

A tracking plan is the source of truth: for every event, its name, required params, and each param's type. Keep it as a versioned file (`tracking-plan.json` / `.yaml`, or a TS `interface`/`Zod` schema) that both the app team and the tests import. Tests read the captured event and validate it against the plan — they check the schema and the known scenario values.

Validate the normalized logical payload and return every missing field and type
violation. The helper in `references/tracking-plan.md` checks finite numbers, nonempty
strings and nested nonempty item arrays. It rejects unsupported or empty schemas.
Zero is a valid number; an absent field, empty string, `null`, `Infinity` or a numeric
string is not a typed zero. Add scenario-specific expected values after schema checks.

```ts
const payload = decodeEcommerceWebEvent(capturedGA4Event.params); // capture-tested project adapter
expect(validateEvent(plan, 'add_to_cart', payload)).toEqual([]);
expect(payload.currency).toBe('USD');
expect(payload.value).toBe(49.99);
expect(payload.items).toEqual([{ item_id: 'SKU-42', price: 49.99, quantity: 1 }]);
```

A matching schema cannot prove that a price is correct. Compare the payload with the
known test cart, then assert event counts at the application's tracking completion
boundary. Keep raw input events and raw emitted records so a decoder cannot hide a
missing field, a tag transformation or a duplicate purchase.

---

## Asserting dataLayer.push

When the question is specifically the GTM **input** — "is the right object pushed to `dataLayer` when the page loads?" — assert the push, not the GA4 beacon. This is the inverse of beacon interception: here the dataLayer push IS the target.

Install the passive observer from `references/datalayer-capture.md` before navigation.
Leave an absent data layer absent, observe the application's first assignment, preserve
push behavior and flag later replacement or lost observation. Do not initialize or
repair the application queue in a test intended to measure the application's setup.
Use a completion signal from the application before inspecting the captured objects.

For GTM ecommerce object events, assert `ecommerce.currency`, `ecommerce.value`, and
`ecommerce.items[]` with each item's expected ID, price and quantity. Currency is at
event level in Google's ecommerce contract. Check counts as well as shape; selecting
the first matching event conceals duplicates. Direct gtag command arrays need the
corresponding command adapter rather than an object-event parser.

The reference contains the observer and full example. Use both observed input and
network output when the question concerns the whole tracking path, while recording
what each observation establishes.

**When the push is the only observable.** Some applications push to `dataLayer` and
load no tag manager and no collect endpoint; the push is the whole tracking contract.
Then the push tests are the gate, not a stopgap: keep the versioned plan, the schema
validation, the count assertions and the scenario literals, and cross-check each
purchase against the order the public API reports. In the report mark the beacon,
deduplication, consent, pixel-fixture and news-media items of Done When as not
applicable with the reason, rather than leaving them unmet; a reviewer must see that
nothing left the browser because nothing was meant to.

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

Choose the approved regional defaults and basic or advanced implementation before
writing a gate. The examples in the reference use an all-denied default policy.
See [Google's consent-mode overview](https://developers.google.com/tag-platform/security/concepts/consent-mode).

Observe all four signals against that policy:

| Signal | Governs |
|--------|---------|
| `ad_storage` | Advertising cookies |
| `analytics_storage` | Analytics cookies |
| `ad_user_data` | Sending user data to Google for ads |
| `ad_personalization` | Personalized ads / remarketing |

Install the passive observer before navigation in every test. It must not create
`gtag`, send a consent command, or repair a replaced data layer. A missing default,
an early measurement command, or an incorrect intermediate state must fail.

**Before consent:** basic mode blocks the configured tag requests. Advanced mode can
send the event plan's denied-state pings. Observe a real application completion signal
and any declared observation interval; an empty collector or `networkidle` is not proof
that delayed tracking is correct. Basic defaults can be initialized after acceptance.

**After accept:** checkpoint existing commands and events, click the CMP button, and
require a new matching update plus the newly expected beacon. Repeat independently
for rejection, partial consent, withdrawal, and persistence.

In the captured web-tag transport, `gcs=G100` and `gcs=G111` distinguish the two storage
signals. `gcd` presence is a diagnostic, not proof that all four signals or payload
identifiers are correct. Keep versioned transport captures and use the four observed
states plus the approved payload/storage inventory. Do not rely on an undocumented
`gcd` prefix. See `references/consent-mode.md` for the executable helpers and recipes.

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

### 6. Testing a default supplied by the test
Seeding denied consent can hide an application that omits its own default. Observe
all four real signals against the selected policy, and distinguish basic from advanced.

### 7. `page.route(...).abort()` inside a capture helper
Aborting blocks the beacons you meant to observe. Use `page.on('request')` (or `route.continue()`).

### 8. A "gate" that can't fail the build
GA4 DebugView, production-only monitoring, or warn-but-pass do not stop a regression. Make CI exit non-zero on a dropped event or missing required param.

---

## Verification

Smallest check first — prove the suite actually catches a regression, don't just trust a green run:

- **One event, one beacon:** `npx playwright test -g add_to_cart` passes, and its trace (`--trace on`) shows the captured `/g/collect` request with `en=add_to_cart`. A green test with no matching request in the trace means you asserted on the wrong thing.
- **The gate can fail:** rename a required param in a branch (e.g. `value` → `amount` in the app) and re-run the CI project — the build must exit non-zero with a `missing`/violation message. If it still passes, the gate is theater. When the application cannot be edited (a black-box target, a frozen fixture), prove it from the test side instead: feed the validator one good payload and several broken ones (missing param, wrong type, minor units where major units are required) and drive a deliberately broken static page (a `data:` URL that pushes the wrong object) through the same observer and assertions. Both must fail, and the broken-page run belongs in the execution log.
- **Consent gate detects the wrong app state:** the real default matches the selected
  policy; missing or granted defaults fail an all-denied-policy fixture. A new action
  requires a new update and planned event. Both healthy and deliberately broken basic
  and advanced fixtures produce the expected result.
- **Dedup holds:** the client `eid` from `facebook.com/tr?ev=Purchase` equals the server CAPI `event_id` for the same order. Different values mean Meta will double-count.

## Done When

- Each tracked event has a test that intercepts the real collect-endpoint beacon (`/g/collect`, `facebook.com/tr`, etc.) and parses `en=`/`ev=` plus params from `searchParams`/`postData` — no DOM-only or dataLayer-only assertions. Exception: an application whose contract is the push itself, with no tag manager or collect endpoint, is done when every planned push is asserted against the plan and the backing record (see "When the push is the only observable"), and the beacon items below are recorded as not applicable.
- A versioned tracking plan file exists (JSON/YAML/TS) with required params and types; tests validate captured events against it and report `missing`/type violations, not just the event name.
- Purchase (or any client+server event) has a deduplication assertion: client beacon `event_id` equals the server CAPI `event_id`.
- Consent tests observe all four actual signals, require the configured events, and
  check storage against the approved regional/basic/advanced policy. They never seed
  the consent state they are meant to verify. Transport diagnostics have stated limits.
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
- **tracking-plan.md** — A JSON ecommerce contract, the reusable `validateEvent` helper, and separate assertions for schema and scenario values.
- **datalayer-capture.md** — `addInitScript` dataLayer.push wrapper and ecommerce `items[]` shape assertions.
- **pixels-and-dedup.md** — Meta/TikTok/LinkedIn payload parsing and client-vs-server CAPI `event_id` dedup capture.
- **consent-mode.md** — Passive four-signal observation, basic/advanced recipes, action
  checkpoints, completion signals, and bounded `gcs=`/`gcd=` diagnostics.
- **news-media.md** — article_view, de-duplicated 25/50/75/100 scroll buckets, and paywall-meter event tests.
- **capture-fixture.md** — The reusable multi-pixel `test.extend` capture fixture.
- **ci-gating.md** — GitHub Actions workflow, baseline-diff script, and surfacing missing-param failures.
