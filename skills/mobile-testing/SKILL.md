---
name: mobile-testing
description: >-
  Test native, React Native, hybrid, and Flutter mobile apps with Appium 3.x, Detox,
  Maestro, and Patrol. Covers device farm setup (BrowserStack, Sauce Labs), gesture
  simulation, deep link and cold-start testing, push notifications, biometric (Face ID)
  auth, offline/poor-network simulation, and iOS/Android permission dialog handling.
  Use when: "mobile test," "Appium," "Detox," "Maestro," "Patrol," "Flutter test,"
  "iOS test," "Android test," "device farm," "deep link," "biometric," "Face ID,"
  "permission dialog," "React Native test."
  Not for: device/browser matrix strategy in the abstract — use cross-browser-testing;
  app startup/memory/battery profiling depth — use performance-testing; mobile screenshot
  diffing — use visual-testing.
  Related: ci-cd-integration, cross-browser-testing, performance-testing, test-data-management, test-reliability.
license: MIT
metadata:
  author: kindlmann
  version: "2.0"
  category: automation
---

<objective>
A login test that passes on the iOS simulator but hangs forever on a real device because a location-permission dialog it never accounted for is sitting on top of the screen — that is the mobile failure mode this skill prevents. It delivers a runnable suite across native, React Native, hybrid, and Flutter apps with the right framework per app type, real-device-vs-emulator tiers, and first-class handling for the scenarios web frameworks cannot reach: deep links, push, biometrics, offline, and permission dialogs.
</objective>

---

## Quick Route

| Situation | Go to |
| --- | --- |
| Picking a framework for an app type | [Framework Decision](#framework-decision) |
| Native/hybrid Appium setup + selectors + gestures | [Appium 3.x](#appium-3x) → `references/appium-patterns.md` |
| React Native suite | [Detox](#detox-for-react-native) → `references/detox-and-maestro.md` |
| Low-friction cross-platform YAML | [Maestro](#maestro-cross-platform-yaml) → `references/detox-and-maestro.md` |
| Cloud device matrix (P0/P1/P2) | [Device Farm](#device-farm-integration) → `references/device-farm.md` |
| Deep links, push, biometrics, offline, permissions | [Mobile-Specific Patterns](#mobile-specific-testing-patterns) → `references/mobile-patterns.md` |

---

## Discovery Questions

Check `.agents/qa-project-context.md` in the project root first — if it exists, use it and skip any question it already answers.

1. **App type:** Native iOS/Android, React Native, Flutter, or hybrid (Cordova/Capacitor)? This picks the framework (see [Framework Decision](#framework-decision)).
2. **Real devices or emulators?** Real devices for release validation and performance; emulators/simulators for development speed. Most teams need both.
3. **Device farm:** BrowserStack App Automate, Sauce Labs, AWS Device Farm, or self-hosted? Budget and CI integration decide.
4. **OS coverage:** Minimum iOS and Android versions? Read analytics for actual user distribution before building the matrix — do not target the newest hardware by default.
5. **Existing CI pipeline:** Where do mobile tests run — local machines, CI runners with emulators, or cloud device farms?
6. **App distribution:** How are test builds distributed — TestFlight, Firebase App Distribution, direct APK/IPA? This determines how the farm gets the binary.

---

## Core Principles

1. **Real devices for release, emulators for speed.** Emulators miss touch latency, GPS drift, camera quirks, push notification timing, and battery behavior. Use emulators in development and PR checks; reserve real device farms for nightly and release pipelines.

2. **Gesture simulation is framework-specific.** Appium W3C Actions, Detox device APIs, and platform-native gesture recognizers each handle swipes, pinches, and long-presses differently. Do not assume cross-framework portability.

3. **Deep links and push notifications are unique to mobile.** Web testing frameworks cannot reach them. Dedicated patterns exist for each — treat them as first-class scenarios, not afterthoughts.

4. **Permission dialogs break assumptions.** iOS and Android handle runtime permissions differently. Camera, location, contacts, and notification permissions need explicit handling in setup or the test hangs waiting for a dialog it cannot dismiss.

5. **Network conditions matter more on mobile.** Users switch between WiFi, LTE, 3G, and offline. Test degraded and absent connectivity — not just happy-path WiFi.

6. **Anything platform-specific needs a platform guard.** A shell command, selector, or device API that works on Android may not exist on iOS (and vice versa). Branch on `platformName` before issuing platform-specific commands, or the test fails silently on the other platform.

---

## Framework Decision

| App type | Primary choice | Why |
| --- | --- | --- |
| Native iOS/Android, hybrid | **Appium 3.x** | Driver-based, mature ecosystem, deepest native + gesture coverage |
| React Native | **Detox** | Gray-box, synchronizes with the RN bridge, fastest feedback, least flake |
| Cross-platform, mixed-skill team | **Maestro** | Declarative YAML, native AI commands, lowest authoring friction |
| Flutter | **Patrol 4.x** | Flutter-native integration testing; 4.0 added web support (via Playwright) and richer native interaction APIs |

---

## Appium 3.x

Appium 3.x (current stable line, 2026) keeps the driver-based plugin architecture introduced in 2.0 — the server is a thin shell; drivers provide platform-specific automation. Upgrade from 2.x is mostly a Node-version bump and dependency cleanup; most capabilities carry over, but Appium 3 dropped several long-deprecated commands and changed plugin/driver handling, so check the 3.x migration notes for removed legacy commands.

**Selector priority:** Accessibility ID > platform-specific selector (iOS class chain / Android UIAutomator) > XPath (last resort — slow, brittle).

**Guard platform-specific commands.** Branch on `platformName` before any platform-only shell command, selector strategy, or device API:

```typescript
if (driver.capabilities.platformName === 'Android') {
  // UIAutomator selectors, `mobile: shell` network toggles
} else {
  // iOS class chain / predicate selectors, `mobile: alert`, device-farm network profiles
}
```

See `references/appium-patterns.md` for install/driver commands, W3C Android/iOS capabilities, the four element-location strategies, and the full gesture set (scroll, swipe, pinch, long-press, double-tap).

---

## Detox for React Native

Detox is a gray-box framework. It synchronizes with the React Native bridge, waiting for animations, network requests, and timers to settle before acting — this eliminates most timing flakiness.

> Detox supports React Native 0.77–0.84, including the New Architecture. Use `by.id`/`by.text` matchers as the default; reach for `by.type()` only to relax a brittle exact-class assertion.

**Biometric ordering rule:** enroll the biometric with `device.setBiometricEnrollment(true)` *before* calling `device.matchBiometric()`. Matching without prior enrollment is a no-op and the auth flow never advances.

**Push notifications are iOS-only via `sendUserNotification`.** On Android, Detox push handling is limited and `sendUserNotification` behavior differs — drive Android push through FCM/the notification shade (Appium pattern) instead of assuming parity.

See `references/detox-and-maestro.md` for the `.detoxrc.js` config, login-flow test patterns, device APIs (biometric, shake, orientation, location, deep link, notifications), and CI build/test commands.

---

## Maestro (Cross-Platform YAML)

Maestro CLI 2.5.x (Apr 2026) is the lowest-friction option for cross-platform mobile e2e — declarative YAML flows, native AI-assisted commands (`assertVisible: 'login button'` works without selectors), running against simulators, real devices, and Maestro Cloud. Best for teams that don't want Appium's Java/JS stack or RN-only Detox tooling.

```bash
# macOS (preferred — lower friction, brew-managed):
brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro
# Or the cross-platform curl one-liner:
curl -Ls "https://get.maestro.mobile.dev" | bash
```

When to choose Maestro: cross-platform suite, mixed-skill team, fast iteration. When not: deep native gesture or biometric coverage (Appium/Detox win), or when you need fine-grained programmatic control.

See `references/detox-and-maestro.md` for an annotated login flow YAML (with `${MAESTRO_TEST_PASSWORD}` env-var injection).

---

## Device Farm Integration

Provision a tiered device matrix from analytics, not from the newest hardware. Typical split: 60% of tests on P0 devices, 30% on P1, 10% on P2. Test apps are uploaded to the farm and referenced by capability (`app` URL / `storage:filename`).

See `references/device-farm.md` for BrowserStack and Sauce Labs capability objects, the authenticated app-upload `curl`, and the GitHub Actions device-matrix strategy (P0/P1/P2 across iOS and Android).

---

## Mobile-Specific Testing Patterns

These scenarios cannot be tested by web frameworks. Treat each as a first-class flow.

- **Deep links** — cold start (terminate then deep-link), authenticated redirect, and running-app navigation.
- **Push notifications** — Detox `sendUserNotification` (iOS) and Appium + FCM test-endpoint / notification-shade patterns (Android).
- **Offline / poor network** — platform-guarded: Android `mobile: shell` airplane-mode, device-farm network profiles, iOS conditioner / Detox proxy notes.
- **Permission dialogs** — `autoGrantPermissions` (Android), explicit `mobile: alert` (`action: accept`/`dismiss`) and `-ios predicate string` handling (iOS).
- **Biometrics** — Detox `setBiometricEnrollment(true)` then `matchBiometric()` (enroll before match).
- **App lifecycle** — background/foreground, cold start, fresh install vs. resume.

See `references/mobile-patterns.md` for the runnable code, including the platform-guarded airplane-mode snippet and the iOS-vs-Android permission split.

---

## Anti-Patterns

**Running all tests on emulators only.** Emulators do not reproduce touch latency, camera behavior, GPS drift, or push timing. Use emulators for development velocity; run release suites on real devices via a device farm.

**Hardcoded device names in tests.** `await driver.$('Samsung Galaxy S24 - Home')` breaks when the device changes. Use accessibility IDs and platform-agnostic selectors.

**Platform-specific commands with no platform check.** `cmd connectivity airplane-mode` only exists on newer Android and not at all on iOS; firing it unguarded fails silently on the other platform. Branch on `platformName` first (see [Appium 3.x](#appium-3x)).

**Ignoring app permissions.** Tests that assume permissions are pre-granted fail on first install or when testing denial flows. Handle permissions explicitly per platform.

**Matching a biometric without enrolling it.** `matchBiometric()` with no prior `setBiometricEnrollment(true)` is a no-op; the auth never completes and the test times out on the login screen.

**Testing only portrait orientation.** Many apps break in landscape. Test critical flows in both orientations, especially on tablets.

**Skipping offline scenarios.** Mobile users lose connectivity constantly. If the app does not handle offline gracefully, prove it; if it does, verify the behavior.

**Using `sleep()` instead of framework synchronization.** Detox auto-waits; Appium has implicit and explicit waits. Sleep-based synchronization is slow and flaky on both.

**Ignoring app size and startup time.** A 200MB app with a 6-second cold start is a real UX issue. Include non-functional checks for binary size and launch time. (For deep startup/memory/battery profiling, use `performance-testing`.)

---

## Verification

Run the smallest check for whichever framework you set up; each should exit 0 and print the expected output before you call the suite done.

```bash
# Appium: drivers installed and server reachable
appium driver list --installed        # lists uiautomator2 and/or xcuitest
appium --version                       # prints the 3.x version

# Detox: one config builds and a smoke spec passes
detox test --configuration ios.sim.debug --headless   # green run on the iOS simulator

# Maestro: a single flow runs end-to-end
maestro test flows/login.yaml          # prints "Flow Passed"
```

---

## Done When

- Device matrix defined and committed (e.g. `device-matrix.md` or a CI matrix block): real devices + emulators per platform, tiered P0/P1/P2 from analytics.
- Test suite runs against both iOS and Android from a single CI configuration (matrix strategy or paired jobs).
- A gesture test (swipe/scroll/long-press) and a deep-link cold-start test (terminate → deep-link → assert target screen) exist as committed test files — list their paths.
- Push notification coverage is either a committed test file path OR a tracked deferral ticket ID (e.g. "JIRA-1234: deferred until FCM test endpoint available") — not a bare code comment.
- `appium driver list --installed` / `detox test --configuration ios.sim.debug` / `maestro test flows/login.yaml` (whichever applies) exits 0 locally.
- CI runs tests on at least one emulator per platform (iOS simulator + Android emulator) on every PR, with real-device-farm runs gated to nightly or release branches.

## Reference Files (in `references/`)

- **appium-patterns.md** — Appium 3.x install, W3C capabilities, element-location strategies, gesture simulation, and the platform-guard pattern.
- **detox-and-maestro.md** — Detox `.detoxrc.js` config, test patterns, device APIs (biometric ordering, push iOS-only note), CI commands; plus Maestro install (brew + curl) and YAML flow.
- **device-farm.md** — BrowserStack and Sauce Labs capabilities, authenticated app-upload curl, and the GitHub Actions P0/P1/P2 device matrix.
- **mobile-patterns.md** — Runnable code for deep links, push, platform-guarded network simulation, iOS/Android permission dialogs, and app lifecycle.

## Related Skills

- **ci-cd-integration** — Pipeline configuration for mobile test execution, artifact management, device-farm CI connectors.
- **cross-browser-testing** — Device-matrix design borrows the browser-matrix methodology; go there for matrix strategy in the abstract, here for the mobile execution.
- **performance-testing** — Mobile non-functional depth: app startup time, memory usage, battery drain.
- **visual-testing** — Screenshot/pixel-diff regression, including mobile viewport captures.
- **test-data-management** — Seed data strategies for mobile apps; backend state setup via API.
- **test-reliability** — Runtime flaky-test healing for mobile timing, device state, and network conditions.
