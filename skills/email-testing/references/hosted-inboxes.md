# Hosted inboxes: Mailosaur, MailSlurp, ShazaMail, Ethereal

Use these when local Mailpit isn't enough: you need a **real, externally-deliverable
address** (staging, third-party ESP, real DNS), per-test isolation that survives high
parallelism, or true SPF/DKIM/DMARC alignment results. Store every API key in a secret /
env var (`MAILOSAUR_API_KEY`, `MAILSLURP_API_KEY`, `SHAZAMAIL_API_KEY`) — never inline it.

## Mailosaur — real addresses, auto-waiting `messages.get`

Each Mailosaur server has a domain like `<serverId>.mailosaur.net`; any address at that
domain is captured. `messages.get(serverId, { sentTo })` **auto-waits** (~10s default,
raise with `timeout`) for a matching message — so you do NOT add your own sleep, and you
do NOT use `messages.list(` + a poll loop. Filter by `sentTo` for parallel determinism.

```ts
// helpers/mailosaur.ts
import MailosaurClient from 'mailosaur';
import { randomUUID } from 'node:crypto';

const mailosaur = new MailosaurClient(process.env.MAILOSAUR_API_KEY!);
const serverId = process.env.MAILOSAUR_SERVER_ID!;
const serverDomain = `${serverId}.mailosaur.net`;

/** A unique, real, deliverable address for this test. */
export function testAddress(tag = ''): string {
  return `${tag || 'user'}.${randomUUID()}@${serverDomain}`;
}

export async function getEmail(sentTo: string, timeout = 30_000) {
  // Auto-waits for a matching message; throws on timeout.
  return mailosaur.messages.get(serverId, { sentTo }, { timeout });
}
```

```ts
// tests/welcome.mailosaur.spec.ts
import { test, expect } from '@playwright/test';
import { getEmail, testAddress } from '../helpers/mailosaur';

test('staging welcome email — subject, from, link domain', async ({ page }) => {
  const email = testAddress('signup');
  await page.goto('https://staging.example.com/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Create account' }).click();

  const message = await getEmail(email);

  // Assert content, not just existence.
  expect(message.subject).toBe('Welcome to Example');
  expect(message.from?.[0].email).toBe('hello@example.com');

  const links = message.html?.links ?? [];
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const url = new URL(link.href!);
    expect(url.origin).toBe('https://staging.example.com');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
  }

  // OTP / codes are exposed in the structured `codes` array too:
  // const otp = message.html?.codes?.[0]?.value;
});
```

Mailosaur also surfaces structured `message.html.links`, `message.html.codes`, and
attachment metadata — prefer those over regex-scraping the raw body when available.

## MailSlurp — per-test throwaway inbox

API-first: create a fresh inbox per test, send/receive against it, then wait. `createInbox()`
gives a unique `emailAddress` + `id`; `waitForLatestEmail(inbox.id, timeoutMs)` blocks
until one email arrives — no fixed delay, no IMAP library. One inbox per test (not one
shared inbox) is what gives you parallel isolation.

```ts
// helpers/mailslurp.ts
import { MailSlurp } from 'mailslurp-client';

export const mailslurp = new MailSlurp({ apiKey: process.env.MAILSLURP_API_KEY! });

// In a test (Playwright fixture or beforeEach):
//   const inbox = await mailslurp.createInbox();
//   ... use inbox.emailAddress in the signup form ...
//   const email = await mailslurp.waitForLatestEmail(inbox.id, 60_000);
```

```ts
// tests/otp.mailslurp.spec.ts
import { test, expect } from '@playwright/test';
import { mailslurp } from '../helpers/mailslurp';
import { extractOtp } from '../helpers/mailpit'; // template-specific helper from mailpit-playwright.md

test('login OTP via per-test inbox', async ({ page }) => {
  const inbox = await mailslurp.createInbox(); // unique throwaway inbox

  await page.goto('/login');
  await page.getByLabel('Email').fill(inbox.emailAddress);
  await page.getByRole('button', { name: 'Send code' }).click();

  // Blocks until an email lands in THIS inbox; 60s timeout, no sleep.
  const email = await mailslurp.waitForLatestEmail(inbox.id, 60_000);

  const otp = extractOtp(email.body ?? ''); // rejects missing or distinct competing codes

  await page.getByLabel('Verification code').fill(otp);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/app/);
});
```

Avoid `imap-simple` / `node-imap` / `imapflow` against a real mailbox for this — MailSlurp's
`waitForLatestEmail` already does the polling for you and gives parallel isolation.

## ShazaMail — receive-only test inbox + bounded wait API

ShazaMail is a hosted, receive-only option for tests that need a real externally-deliverable
address but do not need outbound SMTP. Create one test inbox per scenario, use its returned
email address in the app under test, then wait for a matching message through the REST API.
API access uses a scoped Bearer key; keep `SHAZAMAIL_API_KEY` in the CI secret store.

```ts
// helpers/shazamail.ts — Node 20+; the deadline covers headers AND response body parsing.
export async function shazaMailPost(
  path: string, payload: object,
  { timeoutMs = 10_000, apiKey = process.env.SHAZAMAIL_API_KEY } = {}
) {
  if (!apiKey) throw new Error('SHAZAMAIL_API_KEY is required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('ShazaMail client deadline must be a positive integer in milliseconds');
  }
  if (!/^\/api\/v1\/test-inboxes(?:\/[^/?#]+\/wait)?$/.test(path)) {
    throw new Error('Unsupported ShazaMail inbox path');
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(new URL(path, 'https://shazamail.com'), {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`ShazaMail ${path} returned HTTP ${response.status}`);
    }
    // Do not return response.json() without awaiting it: the same deadline must cover the body.
    return await response.json();
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`ShazaMail ${path} client deadline exceeded (${timeoutMs} ms)`);
    }
    // Keep API keys, tokens, recipient addresses, and message bodies out of failure output.
    if (error instanceof Error && error.message.startsWith('ShazaMail ')) throw error;
    throw new Error(`ShazaMail ${path} transport or JSON response failure`);
  }
}
```

```ts
import { shazaMailPost } from '../helpers/shazamail';

const inbox = await shazaMailPost('/api/v1/test-inboxes', {
  ttl_seconds: 1800,
  run_id: process.env.CI_JOB_ID || 'local-e2e',
  purpose: 'signup-verification',
}, { timeoutMs: 10_000 });
if (typeof inbox?.id !== 'string' || !inbox.id || typeof inbox.email !== 'string' || !inbox.email) {
  throw new Error('ShazaMail create response omitted the inbox id or email');
}

const receivedAfter = new Date().toISOString();
// ...submit inbox.email through the real signup/reset flow AFTER recording receivedAfter...

const delivery = await shazaMailPost(
  `/api/v1/test-inboxes/${encodeURIComponent(inbox.id)}/wait`,
  {
    timeout_ms: 20_000, // the service's wait budget
    match: { received_after: receivedAfter, has_verification_code: true },
  },
  { timeoutMs: 25_000 }, // a separate transport deadline, allowing time for the service response
);
// Assert sender/subject and extract the expected token from the documented delivery schema.
// Complete the link/OTP in the application and assert the resulting account state.
```

The wait endpoint accepts a server wait budget (30s maximum); that does not bound a stalled
connection or response body. Use a separate client deadline for **both** inbox creation and
waiting, and leave the enclosing Playwright test enough time for creation, application actions,
wait, and final assertions. A client timeout, HTTP failure, or malformed JSON is a failed
acquisition, never evidence that no email was sent. Do not automatically retry inbox creation
without checking whether the first call created it.

The matcher can select sender, recipient, subject, verification-code presence, category,
`received_after`, or internet message ID. Use one inbox per test and capture `received_after`
just before the application action. The example covers inbox acquisition; it only becomes an
end-to-end test after content checks and the application completion assertion. Because the
service is receive-only, it does not replace a sandbox SMTP server when the test must send mail.

Reference guides:
- https://shazamail.com/guides/playwright-email-testing
- https://shazamail.com/guides/signup-email-verification-testing
- https://shazamail.com/guides/password-reset-email-testing

## Ethereal — throwaway local preview (NOT for CI assertions)

Ethereal is a fake SMTP service for **manually previewing** what an email looks like
during local dev, with zero service setup. It captures the message and gives you a preview
URL — it **delivers nothing**, so you cannot assert on a real inbox arrival in CI. Use it
only to eyeball a template.

```ts
// scripts/preview-welcome.ts  — run locally, opens a preview URL
import nodemailer from 'nodemailer';

const account = await nodemailer.createTestAccount(); // throwaway Ethereal account
const transporter = nodemailer.createTransport({
  host: account.smtp.host,
  port: account.smtp.port,
  secure: account.smtp.secure,
  auth: { user: account.user, pass: account.pass },
});

const info = await transporter.sendMail({
  from: '"Example" <hello@example.test>',
  to: 'preview@example.test',
  subject: 'Welcome to Example',
  html: '<h1>Welcome!</h1><p>Confirm your account.</p>',
});

// Open this in a browser to preview the rendered message:
console.log('Preview URL:', nodemailer.getTestMessageUrl(info));
```

For CI assertions, use Mailpit (local) or Mailosaur/MailSlurp/ShazaMail (real addresses) — never
Ethereal.
