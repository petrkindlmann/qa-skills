# Client compatibility: lint the captured HTML against documented client limits

The flow test proves the email arrived, went to the right person and carries a working
link. It does not prove a reader in Outlook or Gmail can use it: Mailpit and Ethereal draw
the email with a browser engine, and classic Outlook lays it out with Word. This lint reads
the HTML the flow test already captured and fails on markup those clients are documented
to drop. It runs in the test's own page, sends nothing and adds no dependency.

It is a lint, not a rendering check. A pass means "uses nothing on this list"; it does not
mean the email looks right anywhere. See "What a pass means" before reporting one.

## What it checks

| Group | Source | Examples |
|-------|--------|----------|
| Layout and content a client drops | [Can I email](https://www.caniemail.com/) data of 2026-09-16 | `display:flex` and `position` in classic Outlook, `justify-content` and `visibility` in Gmail, inline `<svg>`, `var()`, `calc()`, `data:` images, a `<style>` in the `<body>` |
| Gmail size limits | Can I email footnote (16 KB of `<style>`); Email on Acid's measurement (about 102 KB of HTML before Gmail clips the message) | A long marketing template |
| Structure a screen reader needs | The checks failed most often in the Email Markup Consortium's [2026 accessibility report](https://emailmarkup.org/en/reports/accessibility/2026/) | Missing `lang`, layout tables without `role="presentation"`, images without `alt` |
| Links and images that cannot resolve | An email has no base URL | `href="/reset"` |

Each compatibility rule names a Can I email feature and lists the clients whose latest
recorded result for it is "not supported". The feature page is
`https://www.caniemail.com/features/<id>/`. Tracked clients: classic Outlook on Windows
(`outlook.windows`), Outlook.com, Gmail on the web, iOS and Android, and Yahoo Mail.
Apple Mail supports every feature on the list, so it never appears in a finding.

Left out on purpose: cosmetic losses (`border-radius`, `box-shadow`, web fonts), partial
support, dark mode and color contrast. Most teams accept square corners in Outlook, and
contrast needs a rendered page (run axe on it, see `accessibility-testing`).

## Helper: lint the captured email

```ts
import type { Page } from '@playwright/test';

const OUTLOOK = 'outlook.windows', OUTLOOK_COM = 'outlook.outlook-com', YAHOO = 'yahoo.desktop-webmail';
const GMAIL = ['gmail.desktop-webmail', 'gmail.ios', 'gmail.android'];
const TRACKED = [OUTLOOK, OUTLOOK_COM, ...GMAIL, YAHOO];

// feature: a Can I email slug. clients: where its latest result is "n" in the data of
// 2026-09-16 or, with `note`, where that numbered footnote applies.
// prop/value match parsed declarations, text matches raw CSS, selector matches elements.
export const EMAIL_CLIENT_RULES = [
  { feature: 'css-display-flex', prop: 'display', value: '^(inline-)?flex$', clients: [OUTLOOK] },
  { feature: 'css-display-grid', prop: 'display', value: '^(inline-)?grid$', clients: [OUTLOOK] },
  { feature: 'css-flex-direction', prop: 'flex-direction', value: '^column', clients: [OUTLOOK, ...GMAIL, YAHOO] },
  { feature: 'css-justify-content', prop: 'justify-content', clients: [OUTLOOK, ...GMAIL, YAHOO] },
  { feature: 'css-align-items', prop: 'align-items', clients: [OUTLOOK, ...GMAIL, YAHOO] },
  { feature: 'css-position', prop: 'position', value: '^(relative|absolute|fixed|sticky)$', clients: [OUTLOOK, ...GMAIL] },
  { feature: 'css-float', prop: 'float', value: '^(left|right)$', clients: [OUTLOOK] },
  { feature: 'css-transform', prop: 'transform', value: '^(?!none$)', clients: TRACKED },
  { feature: 'css-visibility', prop: 'visibility', value: '^(hidden|collapse)$', clients: [OUTLOOK, ...GMAIL] },
  { feature: 'css-background-image', prop: 'background-image', value: 'url\\(', clients: [OUTLOOK] },
  { feature: 'css-variables', text: 'var\\(', clients: TRACKED },
  { feature: 'css-unit-calc', text: 'calc\\(', clients: [OUTLOOK, OUTLOOK_COM, YAHOO] },
  { feature: 'css-linear-gradient', text: 'linear-gradient\\(', clients: [OUTLOOK, OUTLOOK_COM, YAHOO] },
  { feature: 'css-at-import', sheet: '@import', clients: [OUTLOOK_COM, ...GMAIL, YAHOO] },
  { feature: 'html-style', id: 'html-style-in-body', note: 1, selector: 'body style', clients: GMAIL },
  { feature: 'html-style', id: 'html-style-16kb', note: 6, styleBytes: 16 * 1024, clients: ['gmail.desktop-webmail'] },
  { feature: 'html-svg', selector: 'svg', clients: TRACKED },
  { feature: 'html-link', selector: 'link[rel~="stylesheet" i]', clients: [OUTLOOK_COM, ...GMAIL, YAHOO] },
  { feature: 'image-base64', selector: 'img[src^="data:" i]', clients: GMAIL },
  { feature: 'image-webp', selector: 'img[src$=".webp" i]', clients: [OUTLOOK] },
  // Not in Can I email: Email on Acid measured Gmail clipping at about 102 KB of HTML.
  { id: 'gmail-clip-102kb', bytes: 102 * 1024, clients: GMAIL },
];

export async function lintEmailHtml(page: Page, html: string, {
  clients = TRACKED,
  accept = [] as string[],
  a11y = true,
} = {}) {
  if (!/<[a-z!][^>]*>/i.test(html ?? '')) throw new Error('The message has no HTML part to lint');
  const { hits, elements } = await page.evaluate(({ html, rules, a11y }) => {
    // DOMParser builds an inert document: no script runs and nothing is requested.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const hits: { id: string; where: string }[] = [];
    const name = (el: Element) =>
      `<${el.localName}${el.id ? `#${el.id}` : ''}${el.classList[0] ? `.${el.classList[0]}` : ''}>`;
    const flag = (id: string, found: Iterable<Element>) => {
      for (const el of found) hits.push({ id, where: name(el) });
    };
    const bytes = (text: string) => new TextEncoder().encode(text).length;

    const sheets = [...doc.querySelectorAll('style')].map(el => el.textContent ?? '');
    const blocks = [...doc.querySelectorAll<HTMLElement>('[style]')]
      .map(el => ({ where: name(el), style: el.style, text: el.getAttribute('style') ?? '' }));
    for (const css of sheets) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      // Top-level rules only: a rule inside @media is an enhancement a client may skip.
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSStyleRule) blocks.push({ where: rule.selectorText, style: rule.style, text: rule.cssText });
      }
    }

    for (const rule of rules) {
      const id = String(rule.id ?? rule.feature);
      const re = new RegExp(rule.value ?? rule.text ?? rule.sheet ?? '', 'i');
      for (const block of blocks) {
        const value = rule.prop ? block.style.getPropertyValue(rule.prop) : '';
        if (value && re.test(value)) hits.push({ id, where: `${block.where} ${rule.prop}: ${value}` });
        if (rule.text && re.test(block.text)) hits.push({ id, where: block.where });
      }
      if (rule.sheet && sheets.some(css => re.test(css))) hits.push({ id, where: '<style>' });
      if (rule.selector) flag(id, doc.querySelectorAll(rule.selector));
      if (rule.styleBytes && bytes(sheets.join('')) > rule.styleBytes) hits.push({ id, where: 'all <style> blocks' });
      if (rule.bytes && bytes(html) > rule.bytes) hits.push({ id, where: 'whole message' });
    }

    const absolute = /^(https?:|mailto:|tel:|sms:|cid:|data:|#)/i;
    flag('url-not-absolute', [...doc.querySelectorAll('a[href], img[src]')]
      .filter(el => !absolute.test((el.getAttribute('href') ?? el.getAttribute('src') ?? '').trim())));
    if (a11y) {
      if (!doc.documentElement.getAttribute('lang')) hits.push({ id: 'a11y-html-lang', where: '<html>' });
      if (!doc.title.trim()) hits.push({ id: 'a11y-title', where: '<head>' });
      // Webmail drops <html> and <body>, so the wrapper inside the body carries lang and dir.
      flag('a11y-body-lang-dir', [...doc.body.children].filter(el => !el.matches('style, script')
        && (el.textContent?.trim() || el.querySelector('img'))
        && !(el.hasAttribute('lang') && el.hasAttribute('dir'))));
      flag('a11y-table-role', [...doc.querySelectorAll('table:not([role])')]
        .filter(table => ![...table.querySelectorAll('th, caption')].some(cell => cell.closest('table') === table)));
      flag('a11y-img-alt', doc.querySelectorAll('img:not([alt])'));
      flag('a11y-link-text', [...doc.querySelectorAll('a[href]')].filter(a => !(a.textContent?.trim()
        || a.getAttribute('aria-label') || a.getAttribute('title') || a.querySelector('img[alt]:not([alt=""])'))));
    }
    return { hits, elements: doc.body.querySelectorAll('*').length };
  }, { html, rules: EMAIL_CLIENT_RULES, a11y });
  if (!elements) throw new Error('The HTML parsed to an empty body; nothing was linted');

  const places = new Map<string, string[]>();
  for (const hit of hits) places.set(hit.id, [...(places.get(hit.id) ?? []), hit.where]);
  const findings = [...places].flatMap(([id, where]) => {
    const rule = EMAIL_CLIENT_RULES.find(candidate => String(candidate.id ?? candidate.feature) === id);
    const affected = rule ? rule.clients.filter(client => clients.includes(client)) : ['every client'];
    return affected.length ? [{ id, clients: affected, count: where.length, where: [...new Set(where)].slice(0, 3) }] : [];
  });
  const open = findings.filter(finding => !accept.includes(finding.id));
  const stale = accept.filter(id => !findings.some(finding => finding.id === id));
  if (open.length || stale.length) {
    throw new Error([
      'The email uses markup these clients are documented to drop:',
      ...open.map(f => `- ${f.id} (${f.clients.join(', ')}) x${f.count}: ${f.where.join('; ')}`),
      ...stale.map(id => `- accepted, but no longer found: ${id}`),
    ].join('\n'));
  }
  return { findings, elements };
}
```

It parses the HTML inside the page with `DOMParser`, the same way `extractLink` does, so it
does not navigate and the page's state survives. `elements` is how many elements were
linted; an empty body throws instead of passing.

## Using it in the flow test

```ts
// after step 2 of the password-reset test in mailpit-playwright.md
const message = await waitForEmail(request, email);
expect(message.Subject).toContain('Reset your password');
await lintEmailHtml(page, message.HTML, {
  accept: ['css-background-image'], // hero image has a bgcolor fallback, checked in Outlook 2026-11
});
```

- `accept` takes finding ids. List only what someone has looked at in the real client and
  decided is fine, each with a comment. An entry that no longer matches anything fails, so
  the list cannot go stale.
- `clients` narrows the check to the clients your audience uses, for example
  `clients: ['gmail.desktop-webmail', 'gmail.ios', 'gmail.android']`.
- `a11y: false` turns off the structure checks. Prefer accepting individual ids.
- Lint once per template, not in every flow that sends it: the same HTML gives the same result.
- Hosted inboxes work the same way; pass their HTML body (`message.html.body` in Mailosaur).

## What a pass means

Report a pass as: "the reset email uses nothing on the client-compatibility list for
classic Outlook, Outlook.com, Gmail and Yahoo Mail (Can I email data of 2026-09-16);
accepted: css-background-image". Name the accepted ids.

Do not report it as "verified in Outlook and Gmail" or "renders correctly". The lint never
draws the email. It cannot see a button that wraps onto three lines, an image scaled past
the column, text that turns unreadable in dark mode, or a client quirk nobody has recorded.
A claim that the email looks right in a client needs that client:

- **Free:** send the template to seed accounts you own in Gmail and Outlook.com and open
  it there, in the apps as well as on the web. Do this when the template changes.
- **Paid:** Litmus or Email on Acid give screenshots from real clients, including the
  desktop Outlook versions that are hard to keep around.

## Mailpit's HTML Check

Mailpit ships a broader survey built on the same data: the "HTML Check" tab in its UI, or
`GET /api/v1/message/{ID}/html-check`. Use it to look around a template during development.
It is not a gate. Observed on Mailpit 1.31.6:

- It lists every client version ever tested, retired ones included: `display:flex` shows
  Yahoo Mail's 2019 "no" beside its 2020 result.
- It warns on every email. `<body>` and `padding` carry partial-support notes, so a plain
  table layout is never clean.
- It did not report `var()`, and it reports a `<style>` the same way in the `<head>` and
  in the `<body>`.
- It has no accepted list.

## Gotchas

- **`<!--[if !mso]>` content is still linted for Outlook.** The lint does not evaluate
  conditional comments. Markup hidden from Outlook that way shows up as an Outlook
  finding; accept it with a comment naming the fallback.
- **VML fallbacks are invisible to it.** A `background-image` with a VML fallback inside
  `<!--[if mso]>` is still a finding. Same answer: accept it and say what the fallback is.
- **Rules inside `@media` are skipped.** If the base layout depends on them, the lint
  will not notice.
- **Values are read as Chromium parses them.** The helper was exercised in Chromium only.
  A declaration the browser discards as invalid is not seen.
- **Classic Outlook has an end date.** Microsoft supports the Word-based Outlook until at
  least 2029, and the new Outlook renders with a browser engine. Drop `outlook.windows`
  from `clients` when your audience has moved; do not delete rules to get a pass before then.
- **The data ages.** The client lists come from the snapshot dated above. Compare a
  surprising finding with the feature page before changing the template.
