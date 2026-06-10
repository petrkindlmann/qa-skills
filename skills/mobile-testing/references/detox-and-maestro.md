# Detox and Maestro

Config and test code for Detox (React Native gray-box) and Maestro (cross-platform YAML). The framework-choice prose lives in `SKILL.md`.

## Detox Setup

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

## Detox Test Patterns

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

## Detox Device APIs

> Detox supports React Native 0.77–0.84, including the New Architecture. Prefer `by.id`/`by.text` matchers; use `by.type()` only to relax a brittle exact-class assertion.

```javascript
// Biometric authentication
// Enroll BEFORE matching — matchBiometric() with no prior enrollment is a no-op.
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

// Send user notification — iOS only. On Android, Detox push handling is limited
// and sendUserNotification behavior differs; drive Android push via FCM + the
// notification shade (see mobile-patterns.md, Push Notification Testing) instead.
await device.sendUserNotification({
  trigger: { type: 'push' },
  title: 'New message',
  body: 'You have a new message from Alice',
  payload: { screen: 'chat', chatId: '123' },
});
```

## Detox CI Integration

```bash
# Build and test on CI (iOS)
detox build --configuration ios.sim.debug
detox test --configuration ios.sim.debug --cleanup --headless --record-logs all

# Parallel test execution
detox test --configuration ios.sim.debug --workers 3
```

## Maestro (Cross-Platform YAML)

```bash
# Install — macOS preferred (brew-managed, lower friction):
brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro
# Cross-platform curl one-liner (still the official endpoint):
curl -Ls "https://get.maestro.mobile.dev" | bash

# Run a flow
maestro test flows/login.yaml
```

```yaml
# flows/login.yaml
appId: com.example.app
---
- launchApp
- tapOn: "Sign in"
- inputText: "user@example.com"
- tapOn: "Password"
- inputText: "${MAESTRO_TEST_PASSWORD}"
- tapOn: "Continue"
- assertVisible: "Welcome back"
```
