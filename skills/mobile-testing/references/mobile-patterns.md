# Mobile-Specific Testing Patterns

Code for the scenarios unique to mobile: deep links, push notifications, network simulation, permission dialogs, and app lifecycle. The "treat these as first-class scenarios" rationale lives in `SKILL.md`.

## Deep Link Testing

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

## Push Notification Testing

```javascript
// Detox: send push notification and verify handling — iOS only.
// On Android, sendUserNotification behavior differs; use the Appium + FCM
// notification-shade flow below instead of assuming parity.
await device.sendUserNotification({
  trigger: { type: 'push' },
  title: 'Order shipped',
  body: 'Your order #1234 has been shipped',
  payload: { screen: 'order-detail', orderId: '1234' },
});
await expect(element(by.id('order-detail-screen'))).toBeVisible();
await expect(element(by.id('order-id'))).toHaveText('#1234');

// Appium (Android real push): use Firebase Cloud Messaging test API
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

## Offline and Poor Network Simulation

```typescript
// Appium: toggle airplane mode — GUARD on platform first.
// `cmd connectivity airplane-mode` exists only on newer Android and not on iOS.
const platform = driver.capabilities.platformName; // 'Android' | 'iOS'

async function setAirplaneMode(on: boolean) {
  if (platform === 'Android') {
    // Newer Android:
    await driver.execute('mobile: shell', {
      command: `cmd connectivity airplane-mode ${on ? 'enable' : 'disable'}`,
    });
    // Older Android fallback (cmd connectivity unavailable):
    //   settings put global airplane_mode_on <0|1>
    //   am broadcast -a android.intent.action.AIRPLANE_MODE --ez state <true|false>
  } else {
    // iOS: no airplane-mode shell. Use the device-farm network profile
    // (e.g. BrowserStack 'no-network') or the iOS Network Link Conditioner.
    throw new Error('Use a device-farm network profile to go offline on iOS');
  }
}

await setAirplaneMode(true);
// Verify offline UI
await expect(driver.$('~offline-banner')).toBeDisplayed();
// Perform action while offline
await driver.$('~save-draft-button').click();
// Re-enable network
await setAirplaneMode(false);
// Verify queued action syncs
await expect(driver.$('~sync-complete-indicator')).toBeDisplayed();

// BrowserStack: throttle network (works for iOS and Android)
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

## Permission Dialog Handling

```typescript
// Android: set 'appium:autoGrantPermissions': true in capabilities

// iOS: handle permission dialogs explicitly
const allowButton = await driver.$('-ios predicate string:label == "Allow"');
if (await allowButton.isDisplayed()) {
  await allowButton.click();
}
// Or use the mobile: alert command (action: 'accept' grants, 'dismiss' denies)
await driver.execute('mobile: alert', { action: 'accept' });
await driver.execute('mobile: alert', { action: 'dismiss' });

// Detox: there is no `systemDialog` global. Grant permissions deterministically
// at launch instead of tapping the dialog (avoids the iOS system-alert race):
await device.launchApp({
  newInstance: true,
  permissions: { location: 'always', camera: 'YES', notifications: 'YES' },
});
// To exercise the DENIAL flow, pass the negative value:
//   permissions: { location: 'never' }
```

## App Lifecycle Testing

```typescript
// Background and foreground
await driver.execute('mobile: backgroundApp', { seconds: 5 });
await expect(driver.$('~dashboard-screen')).toBeDisplayed();

// Terminate and relaunch (cold start)
await driver.terminateApp('com.mycompany.myapp');
await driver.activateApp('com.mycompany.myapp');
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
