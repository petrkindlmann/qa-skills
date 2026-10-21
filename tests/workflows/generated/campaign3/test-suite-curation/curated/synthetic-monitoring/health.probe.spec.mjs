import { test } from '../../../../../support/fixtures.mjs';
import { startProbe } from './probe-support.mjs';
import { healthProbe } from './probes.mjs';

// Schedule: every 1 min. Wall clock 5 s. Route: page on-call.
test.describe('synthetic: health', () => {
  test.describe.configure({ retries: 0 });

  test('GET /health answers ok for the released build within 500 ms', async ({ request, app }, testInfo) => {
    const probe = startProbe(testInfo, { name: 'health', route: 'page-oncall', wallClockMs: 5000 });
    try { await healthProbe({ request, baseURL: app.baseURL, probe }); }
    finally { await probe.finish(); }
  });
});
