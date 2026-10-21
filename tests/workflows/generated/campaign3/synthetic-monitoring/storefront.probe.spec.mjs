import { test } from '../../../support/fixtures.mjs';
import { startProbe } from './probe-support.mjs';
import { storefrontProbe } from './probes.mjs';

// Schedule: every 1 min. Wall clock 10 s. Route: page on-call.
test.describe('synthetic: storefront', () => {
  test.describe.configure({ retries: 0 });

  test('GET / renders the catalogue at contract prices with sign-in and reset controls', async ({ page, app }, testInfo) => {
    const probe = startProbe(testInfo, { name: 'storefront', route: 'page-oncall', wallClockMs: 10_000 });
    try { await storefrontProbe({ page, baseURL: app.baseURL, probe }); }
    finally { await probe.finish(); }
  });
});
