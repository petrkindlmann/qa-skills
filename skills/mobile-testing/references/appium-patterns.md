# Appium 3.x Patterns

Setup, capabilities, element location, and gesture code for Appium 3.x native/hybrid testing. The decision prose and selector priority live in `SKILL.md`.

## Install and Verify

```bash
# Install Appium 3.x and drivers
npm install -g appium
appium driver install uiautomator2   # Android
appium driver install xcuitest       # iOS

# Verify installation
appium --version       # 3.x current stable line
appium driver list --installed
```

## Capabilities (W3C Format)

```typescript
// Android capabilities — P0 baseline; bump to current device + OS for new matrices
const androidCaps: Record<string, unknown> = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Pixel 9', // Pixel 9 / Galaxy S24 are current P0 baselines
  'appium:platformVersion': '15',
  'appium:app': '/path/to/app.apk',
  'appium:autoGrantPermissions': true,
  'appium:newCommandTimeout': 300,
  'appium:noReset': false,
};

// iOS capabilities — P0 baseline; bump to current device + OS for new matrices
const iosCaps: Record<string, unknown> = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:deviceName': 'iPhone 15 Pro',
  'appium:platformVersion': '17',
  'appium:app': '/path/to/app.ipa',
  'appium:autoAcceptAlerts': false,  // Handle alerts explicitly
  'appium:newCommandTimeout': 300,
};

// Older devices still belong in the matrix when analytics show the long tail —
// e.g. iPhone 14 / iOS 16, Pixel 7 / Android 14. Tier them P1/P2.
```

## Element Location Strategies

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

## Gesture Simulation

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

## Platform Guard

Shell commands, selector strategies, and some device APIs exist on only one platform. Branch on `platformName` before issuing them, or the test fails silently on the other OS. The airplane-mode `cmd connectivity` subcommand, for example, exists only on newer Android and not on iOS at all.

```typescript
const platform = driver.capabilities.platformName; // 'Android' | 'iOS'

if (platform === 'Android') {
  // Newer Android: cmd connectivity subcommand.
  await driver.execute('mobile: shell', { command: 'cmd connectivity airplane-mode enable' });
  // Older Android fallback if cmd connectivity is unavailable:
  //   settings put global airplane_mode_on 1
  //   am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true
} else {
  // iOS has no airplane-mode shell. Drive offline via the device-farm network
  // profile (e.g. BrowserStack 'no-network') or the iOS Network Link Conditioner.
}
```

See `mobile-patterns.md` for the full offline test flow built on this guard.
