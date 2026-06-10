# Deliverability: SPF / DKIM / DMARC — a separate, non-blocking suite

Deliverability is "will this land in the inbox," not "does the flow work." Keep it in its
**own suite** that does NOT block the functional OTP / reset / signup tests. A functional
test should pass even if your DMARC alignment is misconfigured, because the user-facing
flow still works against your capture inbox; conflating the two makes every flow test fail
on a DNS problem and hides the real signal.

## The conceptual trap to avoid

SPF, DKIM, and DMARC results come from the **receiving mail server's authentication of
the sending domain** — they are not strings in the email body. Do NOT
`body.includes('spf')` or `body.match(/dkim/)`. And do NOT assume Mailpit validates them:
Mailpit only does basic SpamAssassin-style spam scoring on the captured message; it does
**not** perform real SPF/DKIM/DMARC alignment, because nothing was sent over real DNS.

Real alignment checks require a **send-and-receive over real DNS**, i.e. a hosted service
that actually receives your mail:

| Need | Tool |
|------|------|
| Real SPF/DKIM/DMARC `pass`/`fail` + alignment per message | **Mailosaur** — `message.metadata` / deliverability report exposes auth results |
| One-off score with raw SPF/DKIM/DMARC breakdown | **mail-tester.com** (send to its address, fetch the report) |
| Spam-content score only (no auth) | Mailpit's built-in SpamAssassin score — content heuristics, NOT auth |

## Mailosaur deliverability assertion (separate spec)

```ts
// tests/deliverability/auth.spec.ts  — runs in its own non-blocking job
import { test, expect } from '@playwright/test';
import MailosaurClient from 'mailosaur';

const mailosaur = new MailosaurClient(process.env.MAILOSAUR_API_KEY!);
const serverId = process.env.MAILOSAUR_SERVER_ID!;

test('notification email passes SPF, DKIM, DMARC @deliverability', async () => {
  const sentTo = `deliverability.${Date.now()}@${serverId}.mailosaur.net`;
  await triggerNotificationEmail(sentTo); // your app's send path, over real SMTP

  const message = await mailosaur.messages.get(serverId, { sentTo }, { timeout: 60_000 });

  // Mailosaur returns structured authentication / deliverability results.
  const auth = message.metadata?.ehlo; // plus spam/deliverability report fields
  const report = await mailosaur.analysis?.deliverability?.(message.id!);

  expect(report?.spf?.result, 'SPF').toBe('pass');
  expect(report?.dkim?.[0]?.result, 'DKIM').toBe('pass');
  expect(report?.dmarc?.result, 'DMARC alignment').toBe('pass');
});
```

Field names vary by Mailosaur SDK version — consult the current deliverability-report
docs; the point is you read structured **SPF / DKIM / DMARC** `pass`/`fail` + alignment
results from the service, never from the body text.

## Wiring it as non-blocking

- Tag these tests `@deliverability` and run them in a separate Playwright project or CI
  job (`--grep @deliverability`).
- Mark the job `continue-on-error: true` (GitHub Actions) or a non-required check, so a
  deliverability regression files a warning/alert but does not red the release gate.
- Run on a schedule (nightly) as well as on send-path changes — deliverability drifts when
  DNS / ESP config changes outside your repo.

Email **HTML rendering across clients** (Outlook, Gmail, Apple Mail dark mode) is a
different concern again and is out of scope for this skill — use Litmus / Email on Acid or
the `visual-testing` skill for that.
