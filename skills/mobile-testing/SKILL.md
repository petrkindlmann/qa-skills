---
name: mobile-testing
description: >-
  Test mobile applications with Appium 2.0 and Detox for React Native. Covers device
  farm setup (BrowserStack, Sauce Labs), gesture simulation, deep link testing, push
  notification testing, offline/poor network simulation, and permission dialog handling.
  Use when: "mobile test," "Appium," "Detox," "iOS test," "Android test," "device farm,"
  "React Native test."
  Related: ci-cd-integration, cross-browser-testing, performance-testing.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: automation
---

# Mobile Testing

Test native, React Native, and hybrid mobile applications with production-grade tooling and real device strategies.

**Before starting:** Check for `.agents/qa-project-context.md` in the project root. It contains tech stack details, target platforms, and device coverage requirements that shape every decision below.

---

## Discovery Questions

1. **App type:** Native iOS/Android, React Native, Flutter, or hybrid (Cordova/Capacitor)? This determines the framework choice -- Appium for native/hybrid, Detox for React Native, Patrol for Flutter.
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

## Appium 2.0

### Architecture

Appium 2.0 uses a driver-based plugin architecture. The server is a thin shell; drivers provide platform-specific automation.

```bash
# Install Appium 2.0 and drivers
npm install -g appium
appium driver install uiautomator2   # Android
appium driver install xcuitest       # iOS

# Verify installation
appium driver list --installed
```

### Capabilities (W3C Format)

```typescript
// Android capabilities
const androidCaps: Record<string, unknown> = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Pixel 7',
  'appium:platformVersion': '14',
  'appium:app': '/path/to/app.apk',
  'appium:autoGrantPermissions': true,
  'appium:newCommandTimeout': 300,
  'appium:noReset': false,
};

// iOS capabilities
const iosCaps: Record<string, unknown> = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:deviceName': 'iPhone 15 Pro',
  'appium:platformVersion': '17.4',
  'appium:app': '/path/to/app.ipa',
  'appium:autoAcceptAlerts': false,  // Handle alerts explicitly
  'appium:newCommandTimeout': 300,
};
```

### Element Location Strategies

```typescript
// Accessibility ID (preferred -- cross-platform, stable)
const loginButton = await driver.$('~login-button');

// iOS class chain (iOS-specific, fast)
const cell = await driver.$('-ios class chain:**/XCUIElementTypeCell[`name == "Settings"`]');

// Android UIAutomator (Android-specific, powerful)
const scrollTarget = await driver.$(
  'android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().text("Terms"))'
);

// XPath (last resort -- slow, brittle)
// Avoid unless no other strategy works
```

**Priority:** Accessibility ID > platform-specific selector > XPath.

### Gesture Simulation

```typescript
// Scroll down
await driver.execute('mobile: scroll', { direction: 'down' });

// Swipe from point A to point B
await driver.execute('mobile: swipeGesture', {
  left: 100, top: 500, width: 200, height: 400,
  direction: 'up', percent: 0.75,
});

// Pinch to zoom (iOS)
await driver.execute('mobile: pinch', {
  elementId: mapElement.elementId,
  scale: 2.0,
  velocity: 1.5,
});

// Long press
await driver.execute('mobile: longClickGesture', {
  elementId: menuItem.elementId,
  duration: 1500,
});

// Double tap
await driver.execute('mobile: doubleClickGesture', {
  elementId: imageElement.elementId,
});
```

---

## Detox for React Native

### Architecture

Detox is a gray-box testing framework. It synchronizes with the React Native bridge, waiting for animations, network requests, and timers to settle before acting. This eliminates most flakiness caused by timing.

### Setup

```javascript
// .detoxrc.js
module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/jest.config.js' },
    jest: { setupTimeout: 120000 },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/MyApp.app',
      build: 'xcodebuild -workspace ios/MyApp.xcworkspace -scheme MyApp -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build: 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
      reversePorts: [8081],
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { type: 'iPhone 15 Pro' } },
    emulator: { type: 'android.emulator', device: { avdName: 'Pixel_7_API_34' } },
  },
  configurations: {
    'ios.sim.debug': { device: 'simulator', app: 'ios.debug' },
    'android.emu.debug': { device: 'emulator', app: 'android.debug' },
  },
};
```

### Test Patterns

```javascript
describe('Login Flow', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should login with valid credentials', async () => {
    await element(by.id('email-input')).typeText('user@example.com');
    await element(by.id('password-input')).typeText('securePass123');
    await element(by.id('login-button')).tap();

    // Detox auto-waits for navigation and animations
    await expect(element(by.id('dashboard-screen'))).toBeVisible();
    await expect(element(by.text('Welcome back'))).toBeVisible();
  });

  it('should show error for invalid credentials', async () => {
    await element(by.id('email-input')).typeText('wrong@example.com');
    await element(by.id('password-input')).typeText('wrongpass');
    await element(by.id('login-button')).tap();

    await expect(element(by.id('error-message'))).toHaveText('Invalid email or password');
    await expect(element(by.id('dashboard-screen'))).not.toBeVisible();
  });
});
```

### Device APIs

```javascript
// Biometric authentication
await device.setBiometricEnrollment(true);
await device.matchBiometric();  // Simulate successful Face ID / fingerprint
await device.unmatchBiometric(); // Simulate failed biometric

// Shake gesture (e.g., to trigger feedback dialog)
await device.shake();

// Change device orientation
await device.setOrientation('landscape');
await device.setOrientation('portrait');

// Set location
await device.setLocation(37.7749, -122.4194); // San Francisco

// Open URL (deep link)
await device.openURL({ url: 'myapp://profile/settings' });

// Send user notification (iOS)
await device.sendUserNotification({
  trigger: { type: 'push' },
  title: 'New message',
  body: 'You have a new message from Alice',
  payload: { screen: 'chat', chatId: '123' },
});
```

### CI Integration

```bash
# Build and test on CI (iOS)
detox build --configuration ios.sim.debug
detox test --configuration ios.sim.debug --cleanup --headless --record-logs all

# Parallel test execution
detox test --configuration ios.sim.debug --workers 3
```

---

## Device Farm Integration

### BrowserStack App Automate

```typescript
// browserstack.config.ts
export const bsCapabilities = {
  'bstack:options': {
    userName: process.env.BROWSERSTACK_USERNAME,
    accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
    projectName: 'MyApp Mobile Tests',
    buildName: `build-${process.env.CI_BUILD_NUMBER}`,
    sessionName: 'Login Flow',
    debug: true,
    networkLogs: true,
    appiumVersion: '2.0.0',
  },
  platformName: 'Android',
  'appium:deviceName': 'Samsung Galaxy S24',
  'appium:platformVersion': '14.0',
  'appium:app': process.env.BROWSERSTACK_APP_URL, // Upload via API first
};

// Upload app before test run
// curl -u "USER:KEY" -X POST "https://api-cloud.browserstack.com/app-automate/upload"
//   -F "file=@/path/to/app.apk" -F "custom_id=MyApp"
```

### Sauce Labs

```typescript
export const sauceCapabilities = {
  platformName: 'iOS',
  'appium:deviceName': 'iPhone 15 Pro',
  'appium:platformVersion': '17',
  'appium:app': 'storage:filename=MyApp.ipa',
  'sauce:options': {
    name: 'Login Flow',
    build: `build-${process.env.CI_BUILD_NUMBER}`,
    appiumVersion: '2.0',
  },
};
```

### Device Matrix Strategy

```yaml
# GitHub Actions matrix for device farm
strategy:
  fail-fast: false
  matrix:
    include:
      # P0: Top devices from analytics
      - platform: android
        device: Samsung Galaxy S24
        os_version: "14"
      - platform: ios
        device: iPhone 15 Pro
        os_version: "17"
      # P1: Previous generation
      - platform: android
        device: Google Pixel 8
        os_version: "14"
      - platform: ios
        device: iPhone 14
        os_version: "16"
      # P2: Oldest supported
      - platform: android
        device: Samsung Galaxy A54
        os_version: "13"
      - platform: ios
        device: iPhone SE 3rd Gen
        os_version: "16"
```

Build the matrix from analytics data. Typical split: 60% of tests on P0 devices, 30% on P1, 10% on P2.

---

## Mobile-Specific Testing Patterns

### Deep Link Testing

```typescript
// Appium: launch app via deep link
await driver.execute('mobile: deepLink', {
  url: 'myapp://products/widget-123',
  package: 'com.mycompany.myapp', // Android only
});
// Verify correct screen loaded
const productTitle = await driver.$('~product-title');
await expect(productTitle).toHaveText('Widget');

// Test deep link when app is not running (cold start)
await driver.terminateApp('com.mycompany.myapp');
await driver.execute('mobile: deepLink', {
  url: 'myapp://products/widget-123',
  package: 'com.mycompany.myapp',
});
await expect(driver.$('~product-title')).toBeDisplayed();

// Test deep link with authentication required
// App should redirect to login, then forward to deep link target after auth
await driver.execute('mobile: deepLink', {
  url: 'myapp://settings/billing',
  package: 'com.mycompany.myapp',
});
await expect(driver.$('~login-screen')).toBeDisplayed();
```

### Push Notification Testing

```javascript
// Detox: send push notification and verify handling
await device.sendUserNotification({
  trigger: { type: 'push' },
  title: 'Order shipped',
  body: 'Your order #1234 has been shipped',
  payload: { screen: 'order-detail', orderId: '1234' },
});
await expect(element(by.id('order-detail-screen'))).toBeVisible();
await expect(element(by.id('order-id'))).toHaveText('#1234');

// Appium: use Firebase Cloud Messaging test API for real push
// Send via backend test endpoint, then verify notification appears
await fetch(`${API_BASE}/test/send-push`, {
  method: 'POST',
  body: JSON.stringify({ userId: testUser.id, title: 'Order shipped' }),
});
// Wait for notification in notification shade (Android)
await driver.openNotifications();
const notification = await driver.$('android=new UiSelector().text("Order shipped")');
await notification.click();
```

### Offline and Poor Network Simulation

```typescript
// Appium: toggle airplane mode (Android)
await driver.execute('mobile: shell', {
  command: 'cmd connectivity airplane-mode enable',
});
// Verify offline UI
await expect(driver.$('~offline-banner')).toBeDisplayed();
// Perform action while offline
await driver.$('~save-draft-button').click();
// Re-enable network
await driver.execute('mobile: shell', {
  command: 'cmd connectivity airplane-mode disable',
});
// Verify queued action syncs
await expect(driver.$('~sync-complete-indicator')).toBeDisplayed();

// BrowserStack: throttle network
// Set in capabilities:
// 'browserstack.networkProfile': '3g-lossy'
// Options: 'no-network', '2g-gprs', '3g-lossy', '4g-lte', 'reset'
```

```javascript
// Detox: WiFi toggle (iOS simulator)
await device.setStatusBar({ dataNetwork: 'wifi' });
// Note: Detox does not directly simulate offline. Use a proxy or
// mock the network layer in the app with a test-only flag.
```

### Permission Dialog Handling

```typescript
// Appium: auto-grant all permissions (Android)
// Set capability: 'appium:autoGrantPermissions': true

// Appium: handle iOS permission dialogs explicitly
const allowButton = await driver.$('-ios predicate string:label == "Allow"');
if (await allowButton.isDisplayed()) {
  await allowButton.click();
}

// Better: use Appium's mobile: alert command (iOS)
await driver.execute('mobile: alert', { action: 'accept' });

// Detox: handle system dialogs
await systemDialog.accept(); // Tap "Allow"
await systemDialog.deny();   // Tap "Don't Allow"
```

### App Lifecycle Testing

```typescript
// Background and foreground
await driver.execute('mobile: backgroundApp', { seconds: 5 });
// App returns to foreground after 5 seconds
await expect(driver.$('~dashboard-screen')).toBeDisplayed();

// Terminate and relaunch (cold start)
await driver.terminateApp('com.mycompany.myapp');
await driver.activateApp('com.mycompany.myapp');
// Verify state restoration
await expect(driver.$('~last-viewed-screen')).toBeDisplayed();
```

```javascript
// Detox lifecycle
await device.sendToHome();
await device.launchApp({ newInstance: false }); // Resume from background
await expect(element(by.id('dashboard'))).toBeVisible();

await device.launchApp({ newInstance: true, delete: true }); // Fresh install
await expect(element(by.id('onboarding-screen'))).toBeVisible();
```

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

## Related Skills

- **ci-cd-integration** -- Pipeline configuration for mobile test execution, artifact management, device farm CI connectors.
- **cross-browser-testing** -- Browser matrix design methodology applies to device matrix design.
- **performance-testing** -- Mobile-specific performance: app startup time, memory usage, battery drain.
- **test-data-management** -- Seed data strategies for mobile apps, backend state setup via API.
- **test-reliability** -- Flaky test patterns specific to mobile: timing, device state, network conditions.
