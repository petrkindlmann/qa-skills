---
name: email-testing
description: >-
  End-to-end testing of email-dependent flows — signup confirmation, password reset,
  magic-link login, OTP/MFA codes, and notification emails. Covers the capture-inbox
  decision tree (Mailpit, Mailosaur, MailSlurp, Ethereal), Playwright polling without
  fixed sleeps, regex extraction of links/OTPs from the email body, deterministic
  per-test addresses (plus-addressing, per-inbox), subject/from/header/link assertions,
  and SPF/DKIM/DMARC deliverability checks as a separate suite.
  Use when: "test the signup confirmation email," "password reset email test,"
  "magic-link login test," "capture OTP from email," "Mailpit," "Mailosaur," "MailSlurp,"
  "email arrives flaky in CI," "assert email subject/from/links."
  Not for: Sending transactional email from your app code, or API-only contract tests of
  an email provider — those are api-testing / app concerns. Email HTML rendering across
  clients (Outlook/Gmail dark mode) is out of scope (note it as a gap; use visual-testing
  or Litmus).
  Related: playwright-automation, api-testing, test-data-management, qa-project-context.
license: MIT
metadata:
  author: kindlmann
  version: "1.0"
  category: specialized
---

<objective>
Email-dependent flows fail silently: a test that "signs up and clicks confirm" by calling
the confirm endpoint directly never proves the email was generated, addressed, templated,
and linkable. This skill captures the real email, waits for it without a fixed sleep,
extracts the OTP or link from the body with an anchored regex, and completes the flow —
so a broken template, an unsigned token, or a wrong-recipient bug actually fails the test.
It also keeps deliverability (SPF/DKIM/DMARC) in a separate non-blocking suite so a DNS
problem never reds your functional gate.
</objective>

---

## Quick Route

| Situation | Go to |
|-----------|-------|
| Pick a capture tool | "Capture-inbox decision tree" below |
| Poll an inbox without a sleep | `references/mailpit-playwright.md` (polling helper) |
| Pull an OTP / link out of the body | `references/mailpit-playwright.md` (extraction) |
| Full password-reset / signup / magic-link E2E | `references/mailpit-playwright.md` |
| Real addresses on staging | `references/hosted-inboxes.md` (Mailosaur) |
| Per-test throwaway inbox | `references/hosted-inboxes.md` (MailSlurp) |
| Just preview a template locally | `references/hosted-inboxes.md` (Ethereal) |
| Flag SPF/DKIM/DMARC problems | `references/deliverability.md` |
| Tests pass locally, "no email yet" in CI | "Flaky email in CI" below |

---

## Discovery Questions

Check `.agents/qa-project-context.md` first — if it exists, use it and skip anything
answered there.

- **Where does the email need to be received?** Local capture (Mailpit) covers most
  functional flows for free. A *real, externally-deliverable* address (staging, a third-
  party ESP, real DNS) means a hosted inbox (Mailosaur / MailSlurp). This is the single
  biggest tool-selection driver.
- **How parallel is the suite?** High parallelism makes "the latest email" ambiguous —
  you need per-test unique addresses or per-test inboxes, not a shared mailbox.
- **Which flows?** Signup confirmation, password reset, magic-link login, OTP/MFA,
  notification emails — they share one shape (capture, extract, complete) but differ in
  what you extract (link vs 6-digit code).
- **Is deliverability in scope?** "Lands in inbox / passes SPF, DKIM, DMARC" is a separate
  non-blocking suite, not part of the functional OTP test. Decide upfront.
- **Local-only preview, or CI assertions?** Previewing a template during dev is Ethereal;
  asserting in CI is Mailpit/Mailosaur/MailSlurp. Don't confuse the two.

---

## Core Principles

1. **Capture the real email; never shortcut past it.** Calling the reset endpoint directly
   or hardcoding a token skips the exact integration the test exists to cover — templating,
   recipient resolution, link generation, token signing. Submit on the UI, read the inbox.

2. **Poll, never sleep.** Email arrival is asynchronous. A fixed `waitForTimeout` is either
   too short (flake) or too slow (wasted minutes) and is the #1 cause of flaky email tests.
   Use `expect.poll` / `.toPass` against `/api/v1/messages`, or a built-in waiter
   (`messages.get`, `waitForLatestEmail`) that already polls for you.

3. **One unique recipient per test.** Two parallel tests both reading "the latest signup
   email" grab each other's mail. Make every test's address unique (plus-addressing or a
   per-test inbox) and **filter by recipient** when reading. Clearing the inbox between
   tests does NOT survive parallelism.

4. **Extract from the body with an anchored regex, guarded.** Pull the OTP / link from the
   email body (`message.Text` / `message.HTML`), not the live page. Use `\d{6}` /
   `.match(` and assert the match is not null — a missing code must fail loudly, not become
   `undefined`.

5. **Assert content, not existence.** "An email arrived" is a weak assertion. Check the
   `subject`, the `from` address, and that links point to the right domain. Wrong-template
   and wrong-link bugs only surface if you assert on content.

6. **Deliverability is a separate, non-blocking suite.** SPF/DKIM/DMARC come from a real
   receiving server's authentication, never from the body text — and they must not block
   the functional flow tests.

---

## Capture-inbox decision tree

Pick the cheapest tool that can actually receive your mail. Default to **Mailpit** for
local + CI functional tests; reach for a hosted inbox only when you need real addresses or
high-parallelism isolation.

| Tool | Hosting / cost | Address type | Use when |
|------|----------------|--------------|----------|
| **Mailpit** | Self-host, single binary or docker, **free / open source** | Any local SMTP recipient | Default. Local + GitHub Actions functional tests, tight budget. REST API at `:8025` (`/api/v1/messages`). |
| **Mailosaur** | Hosted (API key), paid | **Real** `*.mailosaur.net` addresses | Staging/prod-like flows needing a real deliverable address; auto-waiting `messages.get(serverId, { sentTo })`; structured links/codes; real SPF/DKIM/DMARC. |
| **MailSlurp** | Hosted (API key), paid | Real, per-inbox | Per-test throwaway inboxes via `createInbox()` + `waitForLatestEmail`; strong parallel isolation. |
| **Ethereal** | Hosted throwaway, free | Captures, **delivers nothing** | Local-dev template **preview** only (`createTestAccount` + `getTestMessageUrl`). NOT for CI assertions. |

For the budget signup-flow case (local + GitHub Actions, self-host fine): use **Mailpit**
— a single binary / docker image with a free, open-source REST API at `:8025`. If you
later need a real deliverable address, graduate that suite to **Mailosaur** or
**MailSlurp** (hosted inboxes with real addresses). Do not "just check the database instead
of the email" — that proves the row was written, not that the email was sent, addressed,
and linkable.

**Avoid: MailHog** — archived/unmaintained since 2020; Mailpit is its drop-in replacement
(same ports, compatible API), verified mid-2026. Also skip smtp4dev / Papercut for new
suites — Mailpit's API and full-text search are better for automated assertions.

See `references/mailpit-playwright.md` for the docker-compose, the polling helper, and the
extraction utilities; `references/hosted-inboxes.md` for Mailosaur / MailSlurp / Ethereal.

---

## Polling an inbox (Mailpit)

Read the list endpoint with Playwright's `request` fixture, find the message addressed to
*this test's* recipient, then fetch the full body by ID. Use `expect.poll` with a `timeout`
and `intervals` — it retries until a match appears, so fast inboxes resolve instantly and
slow ones still pass.

```ts
// `request` is the Playwright APIRequestContext fixture; plain fetch() works too.
await expect.poll(async () => {
  const res = await request.get(`http://localhost:8025/api/v1/messages?query=to:${encodeURIComponent(to)}`);
  const { messages } = await res.json();
  return messages.find((m) => m.To.some((t) => t.Address === to))?.ID ?? null;
}, { timeout: 30_000, intervals: [500, 1_000, 2_000] }).not.toBeNull();
// then: request.get(`http://localhost:8025/api/v1/message/${id}`) → { Text, HTML, Subject, From, To }
```

The `query=to:` filter plus the `.find` on the recipient is what makes parallel tests
deterministic. Never take `messages[0]` / `messages.at(-1)` (newest overall) with no
recipient filter. Full helper in `references/mailpit-playwright.md`.

---

## Extracting OTPs and links

Match against the **email body**, anchored, with a null guard:

```ts
const otp = body.match(/\b(\d{6})\b/)?.[1];
expect(otp, 'no OTP in email body').toBeTruthy();   // throw / fail if null

const link = body.match(/https?:\/\/\S*(?:verify|confirm|reset|token=)\S*/i)?.[0];
if (!link) throw new Error('no verification link in email body');
```

Do NOT slice by index (`body.split(' ')[3]`, `substring(0, 6)`, `indexOf('code')`) — those
break the moment the template changes a word. Do NOT read `innerText` of the live page when
you mean the email body. If a 6-digit code could collide with other numbers, anchor on the
label: `body.match(/code[:\s]+(\d{6})/i)`. Hosted services expose structured
`message.html.links` / `message.html.codes` — prefer those when available. See
`references/mailpit-playwright.md`.

---

## Deterministic addresses (parallel isolation)

The parallel-flake bug: two tests sign up at once and both poll for "the latest signup
email," so they swap messages. Fixes, in order of preference:

- **Per-test unique address** — plus-addressing / sub-addressing:
  `user+${randomUUID()}@example.com`, or `signup.${Date.now()}@...`. Most providers route
  `user+anything@` to `user@`, so one real mailbox yields infinite unique recipients.
- **Filter every read by recipient** — `sentTo` (Mailosaur) or a `query=to:` + `.find`
  match (Mailpit). Never take the newest message overall.
- **Per-test dedicated inbox** — MailSlurp `createInbox()` gives each test its own inbox;
  Mailosaur gives each test a unique address on your server domain.

Clearing the inbox between tests is **not** sufficient under parallelism — two tests
running at the same instant still collide. Unique address + recipient filter is the real
fix. See `references/hosted-inboxes.md`.

---

## Asserting subject / from / headers / links

After capture, assert on content:

- `expect(message.subject).toBe('Welcome to Example')` — catches wrong-template bugs.
- `expect(message.from?.[0].email).toBe('hello@example.com')` — catches misconfigured
  sender / reply-to.
- Headers (`List-Unsubscribe`, custom `X-` headers) when your product sets them.
- Links point to the right domain:
  `expect(links.every((l) => new URL(l.href).hostname.endsWith('staging.example.com'))).toBe(true)`.

Mailosaur example asserting `subject`, `from`, and link domain is in
`references/hosted-inboxes.md`.

---

## Deliverability: SPF / DKIM / DMARC

Keep this in its **own non-blocking suite**, separate from functional flow tests. SPF,
DKIM, and DMARC `pass`/`fail` + alignment come from a real receiving server authenticating
your sending domain — they are **not** strings in the body, so never
`body.includes('spf')` or `body.match(/dkim/)`. And **Mailpit does not validate
SPF/DKIM/DMARC** alignment — it only does basic SpamAssassin content scoring, because
nothing was sent over real DNS. Real alignment needs a hosted send-and-receive
(**Mailosaur** deliverability report, or mail-tester.com for a one-off). Tag the suite
`@deliverability`, run it as a non-required CI job (`continue-on-error`), and never assert
deliverability inside the OTP / reset flow test. See `references/deliverability.md`.

---

## Flaky email in CI

Tests pass locally but the email "hasn't arrived yet" when CI asserts. The four root
causes — diagnose all of them, do not just bump the sleep:

1. **A fixed sleep instead of polling.** `waitForTimeout` / arbitrary delay races the
   email. Replace with `expect.poll` / `.toPass` / a built-in `waitFor`.
2. **Timeout too short.** CI mail delivery is slower than local. Once polling, increase the
   poll `timeout` (e.g. 30–60s) rather than adding a longer blind sleep.
3. **No recipient filter.** Reading the newest message overall picks up another test's mail
   under parallelism. Filter by `sentTo` / `to:` and use a unique address per test.
4. **Stale messages from a previous run.** An old matching email satisfies the assertion
   before the new one arrives. Clear the inbox in global setup and/or make the address
   unique per run so prior-run mail can't match.

Retrying the whole job, quarantining the test, or raising a global sleep to 30s treats the
symptom and leaves the race in place.

---

## Anti-Patterns

### 1. Fixed sleep before reading the inbox
`page.waitForTimeout(5000)` / `setTimeout` / `sleep()` then read. Too short flakes, too long
wastes minutes. Poll with `expect.poll` against `/api/v1/messages` (or a built-in waiter).

### 2. Recommending a dead capture tool
MailHog is archived (2020). Papercut / smtp4dev are weaker for automation. Use Mailpit.

### 3. Checking the database instead of the email
A DB row proves the write happened, not that the email was sent, addressed, and linkable.
Read the actual captured message.

### 4. Shortcutting past the email
Calling the reset endpoint directly or hardcoding a token skips templating, link
generation, and token signing. Capture the email, extract the link, `page.goto` it.

### 5. Brittle index-based extraction
`body.split(' ')[3]`, `substring(0, 6)`, `indexOf('code')`. Use an anchored `\d{6}` regex
with a null guard. And extract from the email body, not the live page's `innerText`.

### 6. Newest-message-overall with no recipient filter
`messages[0]` / `messages.at(-1)` collide under parallelism. Filter by recipient and use a
unique per-test address; "delete all messages between tests" alone does not fix it.

### 7. Asserting only that an email exists
No `subject` / `from` / link checks misses wrong-template and wrong-link bugs. Assert
content.

### 8. Regexing SPF/DKIM/DMARC out of the body, or trusting Mailpit for it
Auth results come from a real receiving server, not body text; Mailpit only does spam
scoring. Use Mailosaur's deliverability report, in a separate non-blocking suite.

### 9. IMAP libraries against a real mailbox
`imap-simple` / `node-imap` / `imapflow` reinvent polling and lose isolation. Use
MailSlurp `createInbox` + `waitForLatestEmail`, one inbox per test.

### 10. Ethereal in CI, or a paid service for a local preview
Ethereal delivers nothing — it's preview-only (`createTestAccount` + `getTestMessageUrl`).
Don't assert on it in CI; equally, don't spin up a paid hosted service just to eyeball a
template locally.

---

## Verification

Prove the suite actually captures and asserts, smallest check first:

- **Capture is wired:** `curl -s localhost:8025/api/v1/messages | jq '.total'` returns a
  number (Mailpit up, API reachable). For a hosted inbox, a one-line `messages.get` /
  `createInbox` smoke script returns without auth error.
- **No blind sleeps:** `grep -rE 'waitForTimeout|sleep\(|setTimeout' tests/` over the email
  specs prints nothing.
- **The flow is green and real:** run the signup/reset spec and confirm it fails when you
  temporarily break the template subject — if it still passes, you are not asserting content.
- **Determinism holds:** run the email specs with `--workers=4 --repeat-each=3`; a passing
  run proves the per-recipient filter survives parallelism.
- **Deliverability is isolated:** `--grep @deliverability` selects only the auth suite, and
  that CI job is `continue-on-error` / non-required.

## Done When

- The capture tool is chosen against the decision tree and recorded in
  `.agents/qa-project-context.md` (Mailpit for local/CI, a hosted inbox only where a real
  address is needed).
- No email test contains `waitForTimeout` / `sleep` / `setTimeout` before reading the
  inbox — `grep -rE 'waitForTimeout|sleep\(|setTimeout' tests/` over the email specs is
  clean; arrival is awaited via `expect.poll` / `.toPass` / a built-in waiter.
- Each email test uses a unique recipient (plus-address or per-test inbox) and filters
  reads by that recipient — no `messages[0]` / `messages.at(-1)` without a filter.
- OTP/link extraction uses an anchored regex (`\d{6}`, `https?://...`) with a null guard
  that fails the test on no match.
- At least the signup-confirmation (or reset / magic-link) flow has a green E2E test that
  captures the real email and completes the flow through `page.goto(link)`.
- Content assertions on `subject`, `from`, and link domain exist — not just existence.
- Deliverability (SPF/DKIM/DMARC) tests, if in scope, live in a separate `@deliverability`
  suite that is non-blocking in CI.

---

## Related Skills

- **playwright-automation** — the browser-driving half of every email flow: forms,
  navigation, fixtures, and the poll helpers. This skill adds the inbox side.
- **api-testing** — go there to test the email provider's API directly or to test that your
  app *sends* mail; this skill is about *receiving and asserting* in an E2E flow.
- **test-data-management** — generating unique per-test addresses, factories, and seeded
  users that feed the recipient strategy here.
- **qa-project-context** — records the chosen capture tool, SMTP target, and credentials so
  every email test shares one configuration.

---

## Reference Files (in `references/`)

- **mailpit-playwright.md** — docker-compose, the `expect.poll` Mailpit helper, OTP/link
  extraction utilities, and full password-reset / signup / OTP / magic-link E2E tests.
- **hosted-inboxes.md** — Mailosaur (`messages.get` auto-wait, real addresses, structured
  links/codes), MailSlurp (`createInbox` + `waitForLatestEmail`, per-test inbox), and
  Ethereal (local preview via `createTestAccount` + `getTestMessageUrl`).
- **deliverability.md** — SPF/DKIM/DMARC as a separate non-blocking suite, why body-regex
  and Mailpit don't validate auth, and the Mailosaur deliverability assertion.
