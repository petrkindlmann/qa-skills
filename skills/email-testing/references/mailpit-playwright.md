# Mailpit + Playwright recipes

Mailpit is the default local/self-host capture inbox: a single Go binary (or
`axllent/mailpit` Docker image), SMTP on `:1025`, web UI and REST API on `:8025`.
It is the maintained drop-in replacement for MailHog (MailHog is archived — see the
Avoid note in `SKILL.md`). The API your tests use:

- `GET /api/v1/messages` — list messages, newest first, with pagination.
- `GET /api/v1/search?query=to:...` — search messages by recipient and other filters.
- `GET /api/v1/message/{ID}` — full parsed message: `.Text`, `.HTML`, `.Subject`,
  `.From`, `.To`, headers.
- `DELETE /api/v1/messages` with a JSON body `{ "IDs": [...] }` — deletes those messages.
  With no body or an **empty** `IDs` list it deletes **every** message in the inbox
  (observed on Mailpit 1.31.6). Per-test cleanup must send only that test's own IDs and
  must skip the call when it collected none; a whole-inbox purge belongs only in a global
  setup that owns the inbox, never in a shared or worker-scoped one.

Use the [Mailpit API specification](https://mailpit.axllent.org/docs/api-v1/view.html)
for the installed version. Adding `query` to the list endpoint does not select the
search endpoint; under a busy inbox this can leave the target outside the first page.

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
import { APIRequestContext, Page, expect, request } from '@playwright/test';

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
  opts: { timeout?: number; intervals?: number[]; excludeIds?: string[] } = {},
): Promise<Message> {
  let summary: Summary | undefined;

  await expect
    .poll(
      async () => {
        // Search by recipient so parallel tests never read each other's mail.
        const res = await api.get(
          `${BASE}/api/v1/search?${new URLSearchParams({ query: `to:${recipient}` })}`,
        );
        if (!res.ok()) throw new Error(`Mailpit search returned HTTP ${res.status()}`);
        const { messages } = (await res.json()) as { messages: Summary[] };
        if (!Array.isArray(messages)) throw new Error('Mailpit search has no messages array');
        summary = messages.find((m) =>
          !opts.excludeIds?.includes(m.ID)
          && m.To.some((t) => t.Address.toLowerCase() === recipient.toLowerCase()),
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

  const res = await api.get(`${BASE}/api/v1/message/${encodeURIComponent(summary!.ID)}`);
  if (!res.ok()) throw new Error(`Mailpit message returned HTTP ${res.status()}`);
  const message = (await res.json()) as Message;
  if (message.ID !== summary!.ID || !message.To?.some(t => t.Address.toLowerCase() === recipient.toLowerCase())) {
    throw new Error('Mailpit returned a different message or recipient');
  }
  return message;
}

/** Standalone request context if you are not inside a test with the `request` fixture. */
export async function mailpitContext(): Promise<APIRequestContext> {
  return request.newContext();
}
```

Use a fresh UUID recipient for every test attempt, including retries. When one scenario
requests a second email for the same account, pass the previously seen IDs in
`excludeIds`; otherwise the first message can satisfy the second wait. Do not purge an
inbox used by concurrent workers. The search result still gets an exact recipient check.

```ts
// Clean up only what this test received. An empty IDs list would empty the shared inbox.
export async function deleteOwnMessages(api: APIRequestContext, ids: string[]) {
  if (ids.length === 0) return;
  const res = await api.delete('/api/v1/messages', { data: { IDs: ids } });
  expect(res.ok(), `Mailpit delete returned ${res.status()}`).toBe(true);
}
```

## Extracting an OTP and a magic link from the body

Anchor the OTP on the real template's label, then require one distinct code. An order
number is not an OTP. The default below covers English `Code: 123456` / `code is 123456`;
pass a template-specific expression with one capture group for localized templates.
For links, parse HTML attributes with a DOM parser and require an exact origin plus
the flow's path/token predicate before navigation. Do not trim characters off a token
or treat a suffix such as `evil-staging.example.com` as the trusted origin.

```ts
export function extractOtp(body: string, pattern = /\bcode\s*(?:is|:)?\s*(\d{6})\b/gi): string {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const codes = [...body.matchAll(new RegExp(pattern.source, flags))].map(match => match[1]);
  const unique = [...new Set(codes)];
  if (unique.length !== 1 || !/^\d{6}$/.test(unique[0] ?? '')) {
    throw new Error('Expected one distinct 6-digit OTP under the template label');
  }
  return unique[0];
}

export async function extractLink(
  page: Page, message: { Text: string; HTML: string }, expectedOrigin: string,
  accepts: (url: URL) => boolean,
): Promise<string> {
  const htmlLinks = message.HTML ? await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return [...document.querySelectorAll('a[href]')].map(anchor => anchor.getAttribute('href')!);
  }, message.HTML) : [];
  const candidates = htmlLinks.length ? htmlLinks : (message.Text ?? '').match(/https?:\/\/[^\s<>"']+/g) ?? [];
  const origin = new URL(expectedOrigin).origin;
  const links = new Set<string>();
  for (const candidate of candidates) {
    let url: URL;
    try { url = new URL(candidate); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) continue;
    if (accepts(url)) links.add(url.href);
  }
  if (links.size !== 1) throw new Error('Expected exactly one matching email link at the approved origin');
  return [...links][0];
}
```

Import the `Page` type from `@playwright/test` when copying the helper. HTML entity
decoding comes from the parser; `&amp;token=` must become `&token=`. Plain-text URLs need
a known template delimiter if punctuation touches the token. For hosted inboxes,
prefer their structured links and codes, applying the same origin and ambiguity checks.

## Password-reset E2E (full flow)

Request the reset on the UI, capture the real email, extract the link, `goto` it, set a
new password, and confirm login. Do NOT call the reset endpoint directly or hardcode a
token — that skips the exact integration (templating, link generation, token signing)
the test exists to cover.

```ts
import { test, expect } from '../fixtures/users';
import { waitForEmail, extractLink } from '../helpers/mailpit';

test('password reset end-to-end', async ({ page, request, testUser, baseURL }) => {
  const email = testUser.email;

  // 1. Request reset on the UI.
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();

  // 2. Capture the email and pull the reset link out of the body.
  const message = await waitForEmail(request, email);
  expect(message.Subject).toContain('Reset your password');
  const resetUrl = await extractLink(page, message, new URL(baseURL!).origin,
    url => url.pathname === '/reset' && Boolean(url.searchParams.get('token')));

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

The project adapter `../fixtures/users` must extend Playwright with a `testUser`
fixture that creates a real sandbox account, assigns a UUID recipient for each test
attempt, and cleans it up. A randomly generated address without an existing account
will correctly receive no reset email in an app that prevents account enumeration.

## Signup / OTP / magic-link variations

- **Signup confirmation:** identical shape — submit signup form, `waitForEmail`, assert
  `Subject`/`From`, `extractLink(page, message, origin, confirmPredicate)`, `page.goto(confirmUrl)`, assert the
  account is now active.
- **OTP / MFA:** submit credentials, `waitForEmail`, `extractOtp(body)`, type the code
  into the page, assert you land authenticated.
- **Magic-link login:** request the link, `waitForEmail`, `extractLink`,
  `page.goto(magicUrl)`, assert session established.

All four reuse `waitForEmail` + `extractOtp` / `extractLink`. The recipient address must
be unique per test (see "Deterministic addresses" in `SKILL.md`).
