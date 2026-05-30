---
name: mobile-testing
description: >-
  Test mobile applications with Appium 3.x, Maestro, and Detox for React Native. Covers
  device farm setup (BrowserStack, Sauce Labs), gesture simulation, deep link testing,
  push notification testing, offline/poor network simulation, and permission dialog handling.
  Use when: "mobile test," "Appium," "Detox," "Maestro," "iOS test," "Android test,"
  "device farm," "React Native test."
  Related: ci-cd-integration, cross-browser-testing, performance-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

<objective>
Test native, React Native, and hybrid mobile applications with production-grade tooling and real device strategies.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains tech stack details, target platforms, and device coverage requirements that shape every decision below.
</objective>

---

## Discovery Questions

1. **App type:** Native iOS/Android, React Native, Flutter, or hybrid (Cordova/Capacitor)? This determines the framework choice — **Appium 3.x** for native/hybrid (driver-based, mature ecosystem), **Detox** for React Native (white-box, fastest feedback), **Maestro** for cross-platform YAML-based suites (lowest authoring friction, native AI commands), **Patrol** for Flutter.
2. **Real devices or emulators?** Real devices for release validation and performance, emulators/simulators for development speed. Most teams need both.
3. **Device farm:** BrowserStack App Automate, Sauce Labs, AWS Device Farm, or self-hosted? Check budget and CI integration requirements.
4. **OS coverage:** Minimum iOS and Android versions? Check analytics for actual user distribution before building the device matrix.
5. **Existing CI pipeline:** Where do mobile tests run? Local machines, CI runners with emulators, or cloud device farms?
6. **App distribution:** How are test builds distributed? TestFlight, Firebase App Distribution, direct APK/IPA?

---

## Core Principles

1. **Real devices for release, emulators for speed.** Emulators miss touch latency, GPS drift, camera quirks, push notification timing, and battery behavior. Use emulators in development and PR checks; reserve real device farms for nightly and release pipelines.

2. **Gesture simulation is framework-specific.** Appium W3C Actions, Detox device APIs, and platform-native gesture recognizers each handle swipes, pinches, and long-presses differently. Do not assume cross-framework portability.

3. **Deep links and push notifications are unique to mobile.** Web testing frameworks cannot test these. Dedicated patterns exist for each -- treat them as first-class test scenarios, not afterthoughts.

4. **Permission dialogs break assumptions.** iOS and Android handle runtime permissions differently. Camera, location, contacts, and notification permissions require explicit handling in test setup or the test will hang waiting for a dialog it cannot dismiss.

5. **Network conditions matter more on mobile.** Users switch between WiFi, LTE, 3G, and offline. Test behavior under degraded and absent connectivity -- not just happy-path WiFi.

---

## Framework Decision

| App type | Primary choice | Why |
| --- | --- | --- |
| Native iOS/Android, hybrid | **Appium 3.x** | Driver-based, mature ecosystem, deepest native + gesture coverage |
| React Native | **Detox** | Gray-box, synchronizes with the RN bridge, fastest feedback, least flake |
| Cross-platform, mixed-skill team | **Maestro** | Declarative YAML, native AI commands, lowest authoring friction |
| Flutter | **Patrol** | Flutter-native integration testing |

---

## Appium 3.x

Appium 3.x (current stable: 3.4.2, May 2026) keeps the driver-based plugin architecture introduced in 2.0 — the server is a thin shell; drivers provide platform-specific automation. Upgrade from 2.x is mostly a Node-version bump and dependency cleanup; capabilities and APIs are unchanged.

**Selector priority:** Accessibility ID > platform-specific selector (iOS class chain / Android UIAutomator) > XPath (last resort — slow, brittle).

See `references/appium-patterns.md` for install/driver commands, W3C Android/iOS capabilities, the four element-location strategies, and the full gesture set (scroll, swipe, pinch, long-press, double-tap).

---

## Detox for React Native

Detox is a gray-box testing framework. It synchronizes with the React Native bridge, waiting for animations, network requests, and timers to settle before acting. This eliminates most flakiness caused by timing.

> Detox 20.51+ added `by.type()` semantic matching — use it to relax brittle exact-class assertions. Detox 20.51 also confirms support for React Native 0.83 + iOS 26.

See `references/detox-and-maestro.md` for the `.detoxrc.js` config, login-flow test patterns, device APIs (biometric, shake, orientation, location, deep link, notifications), and CI build/test commands.

---

## Maestro (Cross-Platform YAML)

Maestro CLI 2.5.x (Apr 2026) is the lowest-friction option for cross-platform mobile e2e — declarative YAML flows, native AI commands (e.g. `assertVisible: 'login button'` works without selectors), works against simulators, real devices, and Maestro Cloud. Best for teams that don't want to maintain Appium's Java/JS stack or RN-only Detox tooling.

When to choose Maestro: cross-platform suite, mixed-skill team, fast iteration. When not: deep native gesture or biometric coverage (Appium/Detox win), or when you need fine-grained programmatic control.

See `references/detox-and-maestro.md` for the install command and an annotated login flow YAML.

---

## Device Farm Integration

Provision a tiered device matrix from analytics, not from the newest hardware. Typical split: 60% of tests on P0 devices, 30% on P1, 10% on P2. Build test apps are uploaded to the farm and referenced by capability (`app` URL / `storage:filename`).

See `references/device-farm.md` for BrowserStack and Sauce Labs capability objects and the GitHub Actions device-matrix strategy (P0/P1/P2 across iOS and Android).

---

## Mobile-Specific Testing Patterns

These scenarios cannot be tested by web frameworks. Treat each as a first-class flow.

- **Deep links** — cold start, authenticated redirect, and running-app navigation.
- **Push notifications** — Detox `sendUserNotification` and Appium + FCM test-endpoint patterns.
- **Offline / poor network** — Appium airplane-mode shell, BrowserStack network profiles, Detox status-bar/proxy notes.
- **Permission dialogs** — `autoGrantPermissions` (Android), explicit `mobile: alert` / predicate handling (iOS), Detox `systemDialog`.
- **App lifecycle** — background/foreground, cold start, fresh install vs. resume.

See `references/mobile-patterns.md` for the runnable code for all five.

---

## Anti-Patterns

**Running all tests on emulators only.** Emulators do not reproduce touch latency, camera behavior, GPS drift, or push notification timing. Use emulators for development velocity; run release suites on real devices via a device farm.

**Hardcoded device names in tests.** `await driver.$('Samsung Galaxy S24 - Home')` breaks when the device changes. Use accessibility IDs and platform-agnostic selectors.

**Ignoring app permissions.** Tests that assume permissions are pre-granted will fail on first install or when testing permission denial flows. Handle permissions explicitly.

**Testing only portrait orientation.** Many apps break in landscape. Test critical flows in both orientations, especially on tablets.

**Skipping offline scenarios.** Mobile users lose connectivity constantly. If the app does not handle offline gracefully, test it. If it does, verify the behavior works.

**Using `sleep()` instead of framework synchronization.** Detox auto-waits. Appium has implicit and explicit waits. Sleep-based synchronization is slow and flaky on both.

**Ignoring app size and startup time.** A 200MB app with a 6-second cold start is a real user experience issue. Include non-functional checks for app binary size and launch time in the test suite.

---

## Done When

- Device matrix defined and documented: real devices + emulators per platform, prioritized by analytics (P0/P1/P2 tiers)
- Test suite runnable against both iOS and Android with a single CI configuration (matrix strategy or separate jobs)
- Gesture tests (swipe, scroll, long-press) and deep link tests (cold start + authenticated redirect) cover the app's primary flows
- Push notification tests exist or are explicitly deferred with a documented rationale (e.g. "deferred until FCM test endpoint available")
- CI pipeline runs tests on at least one emulator per platform (iOS simulator + Android emulator) on every PR, with real device farm runs gated to nightly or release branches

## Reference Files (in `references/`)

- **appium-patterns.md** — Appium 3.x install, W3C capabilities, element-location strategies, and gesture simulation code.
- **detox-and-maestro.md** — Detox `.detoxrc.js` config, test patterns, device APIs, CI commands; plus Maestro install and YAML flow.
- **device-farm.md** — BrowserStack and Sauce Labs capabilities and the GitHub Actions P0/P1/P2 device matrix.
- **mobile-patterns.md** — Runnable code for deep links, push notifications, network simulation, permission dialogs, and app lifecycle.

## Related Skills

- **ci-cd-integration** -- Pipeline configuration for mobile test execution, artifact management, device farm CI connectors.
- **cross-browser-testing** -- Browser matrix design methodology applies to device matrix design.
- **performance-testing** -- Mobile-specific performance: app startup time, memory usage, battery drain.
- **test-data-management** -- Seed data strategies for mobile apps, backend state setup via API.
- **test-reliability** -- Flaky test patterns specific to mobile: timing, device state, network conditions.
