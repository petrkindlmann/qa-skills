// Experiment 1: the SMTP dependency is down (closed port). Dependency failure,
// SKILL.md "Dependency failures" / Starter Experiment 2 shape, injected by
// starting a second Shop whose --smtp-port nothing listens on.
import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from '../../../support/fixtures.mjs';
import { oracle } from '../../../support/oracle.mjs';
import { startShop } from '../../../support/runtime.mjs';
import {
  closedPort, expectHealthy, experiment, login, mailpitMessages, readState,
  RESET_MESSAGE, RESET_SUBJECT,
} from './helpers.mjs';

test.describe('Experiment 1: SMTP outage', () => {
  test('reset requests answer 202 during an SMTP outage, the outage is counted in smtp_errors, nothing is 5xx', async ({ app, mailpit, request, page }, testInfo) => {
    const exp = experiment(testInfo, {
      name: 'smtp-outage',
      hypothesis: 'We believe that if the SMTP service is unreachable, POST /api/password-reset/request still answers 202 with the contract message, '
        + 'each failed delivery increments smtp_errors by exactly one, no response (API or browser) is 5xx, and /health stays 200 within 500 ms.',
      blastRadius: 'One extra Shop process started by this test with its SMTP port set to a closed loopback port; the worker Mailpit and the per-test healthy Shop are untouched. '
        + 'Duration: the length of this test (a few seconds).',
      abortCondition: 'Any response >= 500 from the faulted Shop, a health probe outside its 500 ms budget, or a browser page response >= 500: the assertion throws, no further requests are sent, rollback runs in finally.',
      rollback: 'Dispose the faulted request context and stop the faulted Shop (finally block, timed, must be < 30 s); then prove the healthy Shop still delivers mail and has smtp_errors 0.',
    });

    // Step 1: steady state on the healthy Shop with real Mailpit.
    const baseline = await expectHealthy(request, app.baseURL, 'baseline health');
    const healthyReset = await request.post(app.baseURL + '/api/password-reset/request', { data: { email: app.users.alice.email } });
    expect(healthyReset.status()).toBe(202);
    await expect.poll(async () => (await mailpitMessages(request, mailpit, app.users.alice.email)).length, { timeout: 8000, message: 'healthy Shop delivers the reset mail' }).toBe(1);
    const [delivered] = await mailpitMessages(request, mailpit, app.users.alice.email);
    expect(delivered.Subject).toBe(RESET_SUBJECT);
    expect((await readState(request, app)).smtp_errors).toBe(0);
    exp.record.baseline = { healthMs: baseline.ms, smtpErrors: 0, mailDelivered: 1 };

    // Step 2: introduce the variable. The port is proven closed before use.
    const smtpPort = await closedPort();
    const faulted = await startShop({ directory: testInfo.outputPath('shop-smtp-outage'), smtpPort });
    const outage = await playwrightRequest.newContext({ baseURL: faulted.baseURL });
    const statuses = [];
    const pageErrors = [];
    page.on('response', response => { if (response.status() >= 500) pageErrors.push(`${response.status()} ${response.url()}`); });
    const post = async (path, data) => {
      const response = await outage.post(path, { data });
      statuses.push(response.status());
      await oracle('c3-chaos-smtp-503', 'toBeLessThan', () =>
        expect(response.status(), `abort: ${path} returned ${response.status()}`).toBeLessThan(500));
      return response;
    };
    const smtpErrors = async () => (await readState(outage, faulted)).smtp_errors;
    try {
      // The fault must only touch mail: health and sign-in are unaffected.
      const faultedHealth = await expectHealthy(outage, faulted.baseURL, 'faulted Shop health during outage');
      await login(outage, faulted.baseURL, faulted.users.alice);
      expect(await smtpErrors()).toBe(0);

      // Step 3: observe. API reset request for a known account.
      const started = performance.now();
      const first = await post('/api/password-reset/request', { email: faulted.users.alice.email });
      const firstMs = Math.round(performance.now() - started);
      expect(first.status()).toBe(202);
      expect(await first.json()).toEqual({ message: RESET_MESSAGE });
      await expect.poll(smtpErrors, { timeout: 4000, message: 'first failed delivery is counted' }).toBe(1);

      const second = await post('/api/password-reset/request', { email: faulted.users.alice.email });
      expect(second.status()).toBe(202);
      await expect.poll(smtpErrors, { timeout: 4000, message: 'second failed delivery is counted' }).toBe(2);

      // Unknown account: 202, no delivery attempted, so the counter must not move.
      const unknown = await post('/api/password-reset/request', { email: `nobody+${faulted.namespace}@example.test` });
      expect(unknown.status()).toBe(202);
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(await smtpErrors(), 'unknown account sends no mail and counts no error').toBe(2);

      // User-visible path: the browser form on the faulted Shop.
      await page.goto(faulted.baseURL + '/');
      await page.waitForSelector('html[data-ready="true"]');
      await page.getByLabel('Account email').fill(faulted.users.alice.email);
      await page.getByRole('button', { name: 'Send reset link' }).click();
      await expect(page.getByRole('status')).toHaveText(RESET_MESSAGE);
      await expect.poll(smtpErrors, { timeout: 4000, message: 'browser-initiated delivery failure is counted' }).toBe(3);
      expect(pageErrors, 'no 5xx reached the browser').toEqual([]);

      // Nothing from the faulted Shop reached Mailpit; the faulted Shop is still healthy.
      expect(await mailpitMessages(request, mailpit, faulted.users.alice.email)).toEqual([]);
      const duringHealth = await expectHealthy(outage, faulted.baseURL, 'faulted Shop health after three failed deliveries');
      expect(statuses.filter(s => s >= 500)).toEqual([]);

      exp.record.observed = { resetStatuses: statuses, firstResetMs: firstMs, smtpErrors: 3, mailpitMessagesForFaultedAccount: 0,
        faultedHealthMs: [faultedHealth.ms, duringHealth.ms], browserNotice: RESET_MESSAGE, pageErrors };
    } finally {
      // Step 4: rollback. Remove the fault (stop the faulted instance) and time it.
      const started = performance.now();
      await outage.dispose();
      await faulted.stop();
      exp.record.rollbackMs = Math.round(performance.now() - started);
    }
    expect(exp.record.rollbackMs, 'rollback inside its 30 s window').toBeLessThan(30000);

    // Steady state restored: the healthy Shop still delivers mail and counted no errors.
    const afterReset = await request.post(app.baseURL + '/api/password-reset/request', { data: { email: app.users.alice.email } });
    expect(afterReset.status()).toBe(202);
    await expect.poll(async () => (await mailpitMessages(request, mailpit, app.users.alice.email)).length, { timeout: 8000, message: 'mail still delivered after rollback' }).toBe(2);
    expect((await readState(request, app)).smtp_errors).toBe(0);
    exp.record.dataIntegrity = 'no data at stake beyond the reset_tokens rows; the healthy Shop lost nothing: lost no, corrupted no';
    const final = await expectHealthy(request, app.baseURL, 'Shop healthy again at the end of the experiment');
    exp.record.recoveryMs = final.ms;
    await exp.finish('confirmed');
  });
});
