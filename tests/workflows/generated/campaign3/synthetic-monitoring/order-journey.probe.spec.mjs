import { test } from '../../../support/fixtures.mjs';
import { startProbe } from './probe-support.mjs';
import { orderJourneyProbe } from './probes.mjs';

// Schedule: every 10 min. Wall clock 20 s. Route: page on-call.
// Synthetic account: bob, which owns every order this probe leaves behind.
test.describe('synthetic: order journey', () => {
  test.describe.configure({ retries: 0 });

  test('synthetic account signs in, places a 1 x TEA-50 order and sees it listed as pending', async ({ page, app }, testInfo) => {
    const probe = startProbe(testInfo, { name: 'order-journey', route: 'page-oncall', wallClockMs: 20_000 });
    try { await orderJourneyProbe({ page, baseURL: app.baseURL, user: app.users.bob, probe, testInfo }); }
    finally { await probe.finish(); }
  });
});
