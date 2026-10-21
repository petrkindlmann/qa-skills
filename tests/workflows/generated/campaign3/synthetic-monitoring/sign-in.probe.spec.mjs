import { test } from '../../../support/fixtures.mjs';
import { startProbe } from './probe-support.mjs';
import { signInProbe } from './probes.mjs';

// Schedule: every 5 min. Wall clock 15 s. Route: page on-call.
// Synthetic account: alice (dedicated to this probe; the order probe uses bob).
test.describe('synthetic: sign-in', () => {
  test.describe.configure({ retries: 0 });

  test('synthetic account signs in through the page, sees its account view, signs out', async ({ page, app }, testInfo) => {
    const probe = startProbe(testInfo, { name: 'sign-in', route: 'page-oncall', wallClockMs: 15_000 });
    try { await signInProbe({ page, baseURL: app.baseURL, user: app.users.alice, probe }); }
    finally { await probe.finish(); }
  });
});
