# Mailpit + Playwright recipes

Mailpit is the default local/self-host capture inbox: a single Go binary (or
`axllent/mailpit` Docker image), SMTP on `:1025`, web UI and REST API on `:8025`.
It is the maintained drop-in replacement for MailHog (MailHog is archived — see the
Avoid note in `SKILL.md`). The API your tests use:

- `GET /api/v1/messages` — list messages, newest first, with `?query=` full-text search.
- `GET /api/v1/message/{ID}` — full parsed message: `.Text`, `.HTML`, `.Subject`,
  `.From`, `.To`, headers.
- `DELETE /api/v1/messages` — purge (use in global setup, never as your only isolation).

Point your app's SMTP at `localhost:1025` in the test environment. Docker:

```yaml
# docker-compose.test.yml
services:
  mailpit:
    image: axllent/mailpit:latest
    ports: ["1025:1025", "8025:8025"]
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: "true"
      MP_SMTP_AUTH_ALLOW_INSECURE: "true"
```

## Polling helper — no fixed sleep

Email arrival is asynchronous. NEVER `page.waitForTimeout(5000)` and hope it landed —
that is the #1 cause of flaky email tests. Poll the list endpoint with `expect.poll`
(or `.toPass`) until a message addressed to *this test's* recipient appears, then fetch
its full body by ID. `expect.poll` retries on an interval until the timeout, so a fast
inbox resolves immediately and a slow one still passes.

```ts
// helpers/mailpit.ts
import { APIRequestContext, expect, request } from '@playwright/test';

const BASE = process.env.MAILPIT_URL ?? 'http://localhost:8025';

type Summary = { ID: string; To: { Address: string }[]; Subject: string };
type Message = {
  ID: string; Subject: string; Text: string; HTML: string;
  From: { Address: string; Name: string };
  To: { Address: string }[];
};

/** Wait for the latest message sent to `recipient`, then return the parsed body. */
export async function waitForEmail(
  api: APIRequestContext,
  recipient: string,
  opts: { timeout?: number; intervals?: number[] } = {},
): Promise<Message> {
  let summary: Summary | undefined;

  await expect
    .poll(
      async () => {
        // Search by recipient so parallel tests never read each other's mail.
        const res = await api.get(
          `${BASE}/api/v1/messages?query=to:${encodeURIComponent(recipient)}`,
        );
        const { messages } = (await res.json()) as { messages: Summary[] };
        summary = messages.find((m) =>
          m.To.some((t) => t.Address.toLowerCase() === recipient.toLowerCase()),
        );
        return summary?.ID ?? null;
      },
      {
        message: `No email for ${recipient}`,
        timeout: opts.timeout ?? 30_000,
        intervals: opts.intervals ?? [500, 1_000, 2_000],
      },
    )
    .not.toBeNull();

  const res = await api.get(`${BASE}/api/v1/message/${summary!.ID}`);
  return (await res.json()) as Message;
}

/** Standalone request context if you are not inside a test with the `request` fixture. */
export async function mailpitContext(): Promise<APIRequestContext> {
  return request.newContext();
}
```

Note: the `query=to:` filter plus the in-code `.find` on `To[].Address` is what makes
each test deterministic. We filter by recipient — we never blindly take `messages[0]`.

## Extracting an OTP and a magic link from the body

Extract with an anchored regex against the email **body** (`message.Text` /
`message.HTML`), not the live page's `innerText`. Guard the match: a `null` result must
throw or fail an assertion, otherwise a missing code silently becomes `undefined` and
the failure surfaces three steps later with a useless message.

```ts
export function extractOtp(body: string): string {
  // Anchored 6-digit code. Prefer a label if your template has one.
  const m = body.match(/\b(\d{6})\b/);
  expect(m, 'No 6-digit OTP found in email body').not.toBeNull();
  return m![1];
}

export function extractLink(body: string, pattern = /https?:\/\/\S*(?:verify|confirm|reset|token=)\S*/i): string {
  const m = body.match(pattern);
  if (!m) throw new Error('No verification link found in email body');
  return m[0].replace(/[)>"'.]+$/, ''); // trim trailing punctuation/quotes
}
```

If your OTP could collide with other 6-digit numbers (order IDs, years), anchor on the
label instead: `body.match(/code[:\s]+(\d{6})/i)`.

## Password-reset E2E (full flow)

Request the reset on the UI, capture the real email, extract the link, `goto` it, set a
new password, and confirm login. Do NOT call the reset endpoint directly or hardcode a
token — that skips the exact integration (templating, link generation, token signing)
the test exists to cover.

```ts
import { test, expect } from '@playwright/test';
import { waitForEmail, extractLink } from '../helpers/mailpit';

test('password reset end-to-end', async ({ page, request }) => {
  const email = `reset+${Date.now()}@example.test`; // unique per run

  // 1. Request reset on the UI.
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();

  // 2. Capture the email and pull the reset link out of the body.
  const message = await waitForEmail(request, email);
  expect(message.Subject).toContain('Reset your password');
  const resetUrl = extractLink(message.HTML || message.Text, /https?:\/\/\S*reset\S*token=\S*/i);

  // 3. Visit the link, set a new password.
  await page.goto(resetUrl);
  await page.getByLabel('New password').fill('Sup3r-secret!');
  await page.getByLabel('Confirm password').fill('Sup3r-secret!');
  await page.getByRole('button', { name: 'Save' }).click();

  // 4. Confirm login works with the new password.
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Sup3r-secret!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
```

## Signup / OTP / magic-link variations

- **Signup confirmation:** identical shape — submit signup form, `waitForEmail`, assert
  `Subject`/`From`, `extractLink(body, /confirm/)`, `page.goto(confirmUrl)`, assert the
  account is now active.
- **OTP / MFA:** submit credentials, `waitForEmail`, `extractOtp(body)`, type the code
  into the page, assert you land authenticated.
- **Magic-link login:** request the link, `waitForEmail`, `extractLink`,
  `page.goto(magicUrl)`, assert session established.

All four reuse `waitForEmail` + `extractOtp` / `extractLink`. The recipient address must
be unique per test (see "Deterministic addresses" in `SKILL.md`).
