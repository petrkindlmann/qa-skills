# Client rendering: the captured email in Outlook, Gmail and Apple Mail

The flow tests prove the email arrived, to the right person, with a working link. They
don't prove the reader can use it: classic Outlook lays out with Word and drops
`display: flex`, `position` and rounded corners; Gmail removes a `<style>` in the
`<body>` and most positioning; a layout that is fine in Chromium can come apart in both.
This check takes the HTML the flow test already captured and previews it as each client
draws it, in the same CI job, with nothing sent or uploaded.

It uses [`@hyper-elements/email-clients`](https://www.npmjs.com/package/@hyper-elements/email-clients)
(MIT; its client models are a separate, free package that is not open source). It is a
**model** of each client, not a screenshot from the client: classic Outlook, the Gmail
apps and the iPhone variants are marked `approximate`, and HTML not built with Hyper
Elements is modeled less closely in some clients. For screenshots from the real clients, use a paid
service (Litmus, Email on Acid) before a launch; use this one on every change.

```bash
npm i -D @hyper-elements/email-clients
```

## What it checks

- **Diagnostics**, from the HTML: CSS and markup a client removes, from caniemail's
  tables and from captures of the clients, each with its line in the HTML.
- **Previews**, one self-contained HTML file per client. Opened in Chromium, each draws
  the email as that client does and records `removed` (what the client removed or
  changed), `missing` (fonts and images that didn't load) and its own findings
  (a heading or button classic Outlook draws on more lines, text unreadable in Apple
  Mail's dark mode, where Gmail clips the email).

## Helper: preview and gate the captured email

Pass the `HTML` part of the message `waitForEmail` returned (see `mailpit-playwright.md`).
It writes every preview to `outDir` (attach that folder as a CI artifact), opens each in
the test's `page`, and fails on anything a client removes or changes that isn't listed in
`accept`. An `accept` entry that no longer matches fails too, so the list can't go stale.

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { renderInEmailClients } from '@hyper-elements/email-clients';

export async function checkInEmailClients(page: Page, html: string, outDir: string, {
  clients = ['outlook', 'outlook-com', 'gmail', 'apple-mail'],
  dark = true,
  accept = [] as string[],
  timeout = 20_000,
} = {}) {
  if (!html) throw new Error('The message has no HTML part to check');
  const { previews, skipped, diagnostics } =
    await renderInEmailClients(html, { emailClients: clients, dark, fonts: 'inline' });
  const unpreviewed = clients.filter(client => !previews.some(p => p.client === client));
  if (unpreviewed.length) {
    throw new Error(`No preview for ${unpreviewed.join(', ')}: ${JSON.stringify(skipped)}`);
  }
  const problems = diagnostics.map(d =>
    `${d.clients.join(', ')}: ${d.code}: ${d.message}${d.line ? ` (line ${d.line})` : ''}`);
  const missing: string[] = [];
  const files: string[] = [];
  await mkdir(outDir, { recursive: true });
  for (const preview of previews) {
    const file = path.join(outDir, preview.filename);
    await writeFile(file, preview.html);
    files.push(file);
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector('html[data-email-client-ready]', { state: 'attached', timeout });
    const ready = await page.getAttribute('html', 'data-email-client-ready');
    const findings = JSON.parse(await page.textContent('#email-client-findings') ?? 'null');
    if (ready === 'error' || !findings) {
      throw new Error(`The ${preview.id} preview failed: ${findings?.error ?? 'no findings'}`);
    }
    for (const r of findings.removed) problems.push(`${preview.id}: removes ${r.what}`);
    for (const d of findings.diagnostics) problems.push(`${preview.id}: ${d.code}: ${d.message}`);
    for (const m of findings.missing) missing.push(`${preview.id}: ${m.kind} ${m.family ?? m.src}`);
  }
  const open = problems.filter(p => !accept.some(a => p.includes(a)));
  const stale = accept.filter(a => !problems.some(p => p.includes(a)));
  if (open.length || stale.length) {
    throw new Error([
      `The email differs in email clients (previews in ${outDir}):`,
      ...open.map(p => `- ${p}`),
      ...stale.map(a => `- accepted, but no longer found: ${a}`),
    ].join('\n'));
  }
  return { files, missing };
}
```

`missing` is returned, not failed on: a font the CI machine doesn't have (Arial on a
Linux runner) or an image the runner can't reach says nothing about the email. Log it,
and read a preview with missing fonts as approximate.

## Using it in the flow test

```ts
// after step 2 of the password-reset test in mailpit-playwright.md
const message = await waitForEmail(request, email);
expect(message.Subject).toContain('Reset your password');
await checkInEmailClients(page, message.HTML, test.info().outputPath('email-clients'), {
  accept: ['outlook: removes border-radius'], // square corners in classic Outlook are fine
});
```

Run it before the step that navigates away, or on a second page
(`await context.newPage()`), since it drives the page it's given. Keep `accept` to
differences someone has looked at in the preview and decided are fine, each with a
comment; a long list means the template should change instead.

## Gotchas

- **Whole document only.** It takes the email from `<html>` to `</html>`, as the app sent
  it. A fragment is a `TypeError`; so is `Text` passed instead of `HTML`.
- **Model, not client.** A clean result means the models found nothing, not that every
  client renders it perfectly. Keep a periodic real-client screenshot run for launches.
- **Previews load nothing they don't need.** With `fonts: 'inline'` the open fonts are in
  each file (classic Outlook's is about 1 MB plus the email), so a runner without network
  draws them; the email's own images and web fonts are listed in `missing` if unreachable.
  The email's scripts and handlers never run in a preview.
- **Dark mode.** With `dark: true`, Apple Mail's dark previews are checked too. An email
  that declares no color scheme has its colors inverted there (reported as a change); one
  that declares `light dark` in its `color-scheme` meta without dark styles gets white
  backgrounds turned dark gray under dark text, which fails as `email/dark-contrast`.
  Declare `light` (`<meta name="color-scheme" content="light">` and
  `supported-color-schemes`) or write the dark styles.
- **One HTML, many recipients.** Run it once per template, not in every parallel attempt
  of the same flow: the output is the same for the same HTML.
