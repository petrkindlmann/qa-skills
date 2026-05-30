# Appium 3.x Patterns

Setup, capabilities, element location, and gesture code for Appium 3.x native/hybrid testing. The decision prose and selector priority live in `SKILL.md`.

## Install and Verify

```bash
# Install Appium 3.x and drivers
npm install -g appium
appium driver install uiautomator2   # Android
appium driver install xcuitest       # iOS

# Verify installation
appium --version       # >= 3.4.x
appium driver list --installed
```

## Capabilities (W3C Format)

```typescript
// Android capabilities — bump to current device + OS for new matrices
const androidCaps: Record<string, unknown> = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Pixel 9', // iPhone 17 / Pixel 9 / Galaxy S25 are current 2026 baselines
  'appium:platformVersion': '15',
  'appium:app': '/path/to/app.apk',
  'appium:autoGrantPermissions': true,
  'appium:newCommandTimeout': 300,
  'appium:noReset': false,
};

// iOS capabilities — bump to current device + OS for new matrices
const iosCaps: Record<string, unknown> = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:deviceName': 'iPhone 17 Pro',
  'appium:platformVersion': '19',
  'appium:app': '/path/to/app.ipa',
  'appium:autoAcceptAlerts': false,  // Handle alerts explicitly
  'appium:newCommandTimeout': 300,
};

// Older devices still belong in the matrix when analytics show the long tail —
// e.g. iPhone 15 Pro / iOS 17, Pixel 7 / Android 14. Tier them P1/P2.
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
