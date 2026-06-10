# Hosted inboxes: Mailosaur, MailSlurp, Ethereal

Use these when local Mailpit isn't enough: you need a **real, externally-deliverable
address** (staging, third-party ESP, real DNS), per-test isolation that survives high
parallelism, or true SPF/DKIM/DMARC alignment results. Store every API key in a secret /
env var (`MAILOSAUR_API_KEY`, `MAILSLURP_API_KEY`) — never inline it.

## Mailosaur — real addresses, auto-waiting `messages.get`

Each Mailosaur server has a domain like `<serverId>.mailosaur.net`; any address at that
domain is captured. `messages.get(serverId, { sentTo })` **auto-waits** (~10s default,
raise with `timeout`) for a matching message — so you do NOT add your own sleep, and you
do NOT use `messages.list(` + a poll loop. Filter by `sentTo` for parallel determinism.

```ts
// helpers/mailosaur.ts
import MailosaurClient from 'mailosaur';

const mailosaur = new MailosaurClient(process.env.MAILOSAUR_API_KEY!);
const serverId = process.env.MAILOSAUR_SERVER_ID!;
const serverDomain = `${serverId}.mailosaur.net`;

/** A unique, real, deliverable address for this test. */
export function testAddress(tag = ''): string {
  return `${tag || 'user'}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@${serverDomain}`;
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
  expect(links.every((l) => new URL(l.href!).hostname.endsWith('staging.example.com'))).toBe(true);

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

test('login OTP via per-test inbox', async ({ page }) => {
  const inbox = await mailslurp.createInbox(); // unique throwaway inbox

  await page.goto('/login');
  await page.getByLabel('Email').fill(inbox.emailAddress);
  await page.getByRole('button', { name: 'Send code' }).click();

  // Blocks until an email lands in THIS inbox; 60s timeout, no sleep.
  const email = await mailslurp.waitForLatestEmail(inbox.id, 60_000);

  const otp = email.body?.match(/\b(\d{6})\b/)?.[1];
  expect(otp, 'no OTP in email').toBeTruthy();

  await page.getByLabel('Verification code').fill(otp!);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/app/);
});
```

Avoid `imap-simple` / `node-imap` / `imapflow` against a real mailbox for this — MailSlurp's
`waitForLatestEmail` already does the polling for you and gives parallel isolation.

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

For CI assertions, use Mailpit (local) or Mailosaur/MailSlurp (real addresses) — never
Ethereal.
