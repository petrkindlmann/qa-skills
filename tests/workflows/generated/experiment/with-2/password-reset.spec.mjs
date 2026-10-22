import { test, expect } from '../../../support/fixtures.mjs';
import {
  advanceClock, apiClient, deleteMessages, extractResetLink, messageIdsFor, signIn, supportState, waitForEmail,
} from './helpers.mjs';

const ACCEPTED = { message: 'If this account exists, a reset email has been sent.' };
const SUBJECT = 'Reset your Shop password';

async function cleanupInbox(request, mailpit, recipients) {
  const ids = [];
  for (const recipient of recipients) ids.push(...await messageIdsFor(request, mailpit, recipient));
  await deleteMessages(request, mailpit, ids);
}

async function loginStatus(app, email, password) {
  const client = await apiClient(app);
  try {
    return (await client.post('/api/login', { data: { email, password } })).status();
  } finally {
    await client.dispose();
  }
}

test('password reset from the emailed link changes the password and revokes sessions', async ({ page, app, mailpit, request }) => {
  const { alice } = app.users;
  const ghost = `ghost+${app.namespace}@example.test`;
  const newPassword = 'Fresh-password-2026';
  const existing = await signIn(app, alice);
  try {
    await test.step('unknown and known addresses get the same 202 answer', async () => {
      const anon = await apiClient(app);
      try {
        const unknown = await anon.post('/api/password-reset/request', { data: { email: ghost } });
        expect(unknown.status()).toBe(202);
        expect(await unknown.json()).toEqual(ACCEPTED);
      } finally {
        await anon.dispose();
      }

      await page.goto(app.baseURL);
      await page.getByLabel('Account email').fill(alice.email);
      const requested = page.waitForResponse(r => r.url() === `${app.baseURL}/api/password-reset/request`);
      await page.getByRole('button', { name: 'Send reset link' }).click();
      const response = await requested;
      expect(response.status()).toBe(202);
      expect(await response.json()).toEqual(ACCEPTED);
    });

    let link;
    await test.step('the real email is addressed, templated and links back to this app', async () => {
      const message = await waitForEmail(request, mailpit, alice.email);
      expect(message.Subject).toBe(SUBJECT);
      expect(message.To.map(t => t.Address)).toEqual([alice.email]);
      expect(message.Text.trim().length).toBeGreaterThan(0);
      expect(message.HTML.trim().length).toBeGreaterThan(0);
      link = await extractResetLink(page, message, new URL(app.baseURL).origin);
      // Alice's message has arrived, so the earlier unknown-address request has been handled.
      expect(await messageIdsFor(request, mailpit, ghost)).toEqual([]);
    });

    await test.step('the link opens the new-password form and the reset succeeds', async () => {
      await page.goto(link);
      await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
      await page.getByLabel('New password').fill(newPassword);
      await page.getByRole('button', { name: 'Reset password' }).click();
      await expect(page.getByRole('status')).toHaveText(/password has been reset/i);
    });

    await test.step('the link is single use and the page reports the server error', async () => {
      await page.goto(link);
      await page.getByLabel('New password').fill('Second-attempt-2026');
      await page.getByRole('button', { name: 'Reset password' }).click();
      await expect(page.getByRole('status')).toHaveText('invalid_or_expired_token');
    });

    await test.step('old credentials and sessions are dead; the new password works', async () => {
      expect((await existing.get('/api/me')).status(), 'pre-reset session').toBe(401);
      expect(await loginStatus(app, alice.email, alice.password), 'old password').toBe(401);
      expect(await loginStatus(app, alice.email, 'Second-attempt-2026'), 'rejected second reset').toBe(401);
      const tokens = (await supportState(app)).reset_tokens.filter(t => t.user_id === 'alice');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].consumed).not.toBeNull();

      await page.getByRole('link', { name: 'Back to sign in' }).click();
      await page.getByLabel('Email', { exact: true }).fill(alice.email);
      await page.getByLabel('Password', { exact: true }).fill(newPassword);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText(`Signed in as ${alice.email}`)).toBeVisible();
    });
  } finally {
    await existing.dispose();
    await cleanupInbox(request, mailpit, [alice.email, ghost]);
  }
});

test('reset tokens expire after 300 seconds and enforce the password length', async ({ page, app, mailpit, request }) => {
  const { bob } = app.users;
  const origin = new URL(app.baseURL).origin;
  const client = await apiClient(app);
  const requestReset = async () => {
    const response = await client.post('/api/password-reset/request', { data: { email: bob.email } });
    expect(response.status()).toBe(202);
  };
  const confirm = (token, password) => client.post('/api/password-reset/confirm', { data: { token, password } });
  const tokenOf = link => new URL(link).searchParams.get('token');
  try {
    const twelve = 'Twelve-chr-1';
    expect(twelve).toHaveLength(12);

    await test.step('control: at 299 s the token still works, with a 12-character minimum', async () => {
      await requestReset();
      const first = await waitForEmail(request, mailpit, bob.email);
      expect(first.Subject).toBe(SUBJECT);
      const token = tokenOf(await extractResetLink(page, first, origin));
      await advanceClock(app, 299);
      const short = await confirm(token, 'Elevenchr-1');
      expect(short.status(), '11-character password').toBeGreaterThanOrEqual(400);
      expect(short.status(), '11-character password').toBeLessThan(500);
      expect(await loginStatus(app, bob.email, bob.password), 'password unchanged after rejection').toBe(200);
      const ok = await confirm(token, twelve);
      expect(ok.status()).toBe(200);
      expect(await ok.json()).toEqual({ reset: true });
      expect(await loginStatus(app, bob.email, twelve)).toBe(200);
    });

    await test.step('at 301 s a fresh token is expired and changes nothing', async () => {
      const seen = await messageIdsFor(request, mailpit, bob.email);
      expect(seen).toHaveLength(1);
      await requestReset();
      const second = await waitForEmail(request, mailpit, bob.email, { excludeIds: seen });
      const token = tokenOf(await extractResetLink(page, second, origin));
      await advanceClock(app, 301);
      const expired = await confirm(token, 'Too-late-password-1');
      expect(expired.status()).toBe(400);
      expect(await expired.json()).toEqual({ error: 'invalid_or_expired_token' });
      expect(await loginStatus(app, bob.email, 'Too-late-password-1')).toBe(401);
      expect(await loginStatus(app, bob.email, twelve)).toBe(200);
    });

    await test.step('a fabricated token is rejected the same way', async () => {
      const forged = await confirm('not-a-real-token', 'Whatever-password-1');
      expect(forged.status()).toBe(400);
      expect(await forged.json()).toEqual({ error: 'invalid_or_expired_token' });
    });
  } finally {
    await client.dispose();
    await cleanupInbox(request, mailpit, [bob.email]);
  }
});
