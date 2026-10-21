import { test } from '../../../../../support/fixtures.mjs';
import { startProbe } from './probe-support.mjs';
import { passwordResetEmailProbe } from './probes.mjs';

// Schedule: every 10 min. Wall clock 20 s. Route: notify monitoring channel
// (email is a third-party integration; two consecutive failures page).
// Synthetic account: alice. The token is requested, never confirmed.
test.describe('synthetic: password-reset email', () => {
  test.describe.configure({ retries: 0 });

  test('reset request delivers one correctly addressed email with a reset link within 10 s', async ({ request, app, mailpit }, testInfo) => {
    const probe = startProbe(testInfo, { name: 'password-reset-email', route: 'notify-monitoring', wallClockMs: 20_000 });
    try { await passwordResetEmailProbe({ request, baseURL: app.baseURL, mailpitURL: mailpit.baseURL, user: app.users.alice, probe }); }
    finally { await probe.finish(); }
  });
});
