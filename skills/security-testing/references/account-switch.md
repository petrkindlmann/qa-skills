# One browser, two accounts: what the first leaves for the second

The IDOR test in `owasp-tests.md` asks the server for another user's record with a fresh
client. This recipe asks a different question: person A used the app in this browser, signed
out, and person B (or nobody) now sits at the same browser profile. Can they still get A's
data?

The server can be correct and the answer still yes. A service worker cached the account
page for offline use. An export was served with `Cache-Control: max-age` and the browser
answers the next request from disk. The app kept a profile in `localStorage` and sign-out
only dropped the cookie. A request made with a new, empty client finds none of these.

The helper drives one real browser context through A, signed-out and B, online and offline,
and reports every place where A's sentinel turns up.

## The helper

```ts
import type { Page, Request, Response } from '@playwright/test';

// Storage of the page's current origin that still holds the sentinel.
export async function sentinelInBrowser(page: Page, sentinel: string) {
  if (!/^https?:/.test(page.url())) throw new Error(`The page is at ${page.url()}; open a page of the application before reading its storage`);
  return page.evaluate(async (needle: string) => {
    const hits: string[] = [];
    const has = (value: unknown) => {
      try { return (typeof value === 'string' ? value : JSON.stringify(value) ?? '').includes(needle); } catch { return false; }
    };
    for (const [label, store] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]] as const) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index) ?? '';
        if (has(key) || has(store.getItem(key))) hits.push(`${label}: ${key}`);
      }
    }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (has(request.url) || has(response ? await response.text() : '')) hits.push(`Cache Storage ${name}: ${new URL(request.url).pathname}`);
      }
    }
    for (const { name = '' } of await indexedDB.databases()) {
      const database: IDBDatabase = await new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      for (const store of database.objectStoreNames) {
        const rows = await new Promise(resolve => {
          const all = database.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => resolve([]);
        });
        if (has(rows)) hits.push(`IndexedDB ${name}/${store}`);
      }
      database.close();
    }
    if (has(document.cookie)) hits.push('document.cookie');
    return hits;
  }, sentinel);
}

// signInA(page) signs A in through the UI. urls are pages or endpoints that show A the sentinel.
// signOut(page) uses the app's own sign-out. signInB is optional; without it only the
// signed-out visitor is checked. settled(page) says when a page has finished loading its
// data; by default that is every request answered and then 500 ms without network activity.
export async function accountSwitchLeaks(page: Page, { sentinel, urls, signInA, signOut, signInB = null, settled = null, timeoutMs = 15_000 }: {
  sentinel: string; urls: string[]; signInA: (page: Page) => Promise<void>; signOut: (page: Page) => Promise<void>;
  signInB?: null | ((page: Page) => Promise<void>); settled?: null | ((page: Page) => Promise<void>); timeoutMs?: number;
}) {
  if (!sentinel || sentinel.length < 12) throw new Error('Use a long random sentinel that only account A owns');
  if (!urls?.length) throw new Error('Name at least one URL that shows A the sentinel');
  const context = page.context();
  const findings: { stage: string; where: string }[] = [];
  const unanswered = new Set<Request>();
  let stage = '', reads: Promise<void>[] = [], lastActivity = Date.now();
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const onRequest = (request: Request) => { unanswered.add(request); lastActivity = Date.now(); };
  const onFailed = (request: Request) => { unanswered.delete(request); lastActivity = Date.now(); };
  // Chromium never reports a fetch as finished while the page leaves its body unread, and
  // response.text() waits for that. Such a GET is read again from the page instead.
  const again = (url: string) => page.evaluate((target: string) => fetch(target).then(reply => reply.text()), url).catch(() => '');
  const onResponse = (response: Response) => {
    const at = stage;
    unanswered.delete(response.request());
    lastActivity = Date.now();
    const body = Promise.race([response.text().catch(() => ''), pause(1_000).then(() => null)])
      .then(text => text ?? (response.request().method() === 'GET' ? again(response.url()) : ''));
    reads.push(body.then(text => {
      if (text.includes(sentinel)) findings.push({ stage: at, where: `response ${new URL(response.url()).pathname}${response.fromServiceWorker() ? ' (service worker)' : ''}` });
    }));
  };
  const quiet = async (url: string) => {
    const deadline = Date.now() + timeoutMs;
    while (unanswered.size || Date.now() - lastActivity < 500) {
      if (Date.now() > deadline) {
        const waiting = [...unanswered].slice(0, 3).map(request => request.url()).join(', ') || 'none, the page kept making requests';
        throw new Error(`${url} still had ${unanswered.size} unanswered request(s) after ${timeoutMs} ms (${stage}): ${waiting}; pass settled() to say when the page is loaded`);
      }
      await pause(50);
    }
  };
  const look = async (url: string) => {
    while (reads.length) await Promise.all(reads.splice(0));
    if ((await page.content().catch(() => '')).includes(sentinel)) findings.push({ stage, where: `page ${new URL(url).pathname}` });
  };
  const open = async (url: string) => {
    unanswered.clear();
    try { await page.goto(url, { waitUntil: 'load', timeout: timeoutMs }); } catch { /* offline with nothing cached */ }
    await (settled ? settled(page) : quiet(url));
    await look(url);
  };
  const check = async (who: string) => {
    stage = who;
    for (const where of await sentinelInBrowser(page, sentinel)) findings.push({ stage, where });
    for (const offline of [false, true]) {
      stage = `${who}, ${offline ? 'offline' : 'online'}`;
      await context.setOffline(offline);
      for (const url of urls) await open(url);
    }
    await context.setOffline(false);
  };

  page.on('request', onRequest);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);
  try {
    await signInA(page);
    stage = 'A';
    for (const url of urls) {
      await look(url);          // replies still arriving from the sign-in or the previous URL
      findings.length = 0;
      await open(url);
      // A denial later means nothing unless the owner could get the data here. A first
      // visit may still be installing a service worker, so give it until the timeout.
      for (const deadline = Date.now() + timeoutMs; !findings.length && Date.now() < deadline;) {
        await pause(100);
        await look(url);
      }
      if (!findings.length) throw new Error(`A did not get the sentinel from ${url}; fix the URL or the sentinel before trusting a denial`);
    }
    stage = 'A signing out';
    await signOut(page);
    await check('signed out');
    if (signInB) {
      stage = 'B';
      await signInB(page);
      await check('B');
    }
  } finally {
    page.off('request', onRequest);
    page.off('requestfailed', onFailed);
    page.off('response', onResponse);
    await context.setOffline(false);
  }
  // What A received while signed in is not a leak; everything after sign-out is.
  return findings.filter((finding, index) => !finding.stage.startsWith('A')
    && findings.findIndex(other => other.stage === finding.stage && other.where === finding.where) === index);
}
```

## Using it

```ts
test('nothing of A is left for the next person at this browser', async ({ page, request }) => {
  const sentinel = `sentinel-${crypto.randomUUID()}`;
  await request.post('/test-support/notes', { data: { owner: accountA.email, text: sentinel } });  // or create it as A in the UI

  const findings = await accountSwitchLeaks(page, {
    sentinel,
    urls: [`${baseURL}/account`, `${baseURL}/api/export`],
    signInA: page => signIn(page, accountA),
    signOut: page => page.getByRole('button', { name: 'Sign out' }).click().then(() => page.waitForURL('**/login')),
    signInB: page => signIn(page, accountB),
  });
  expect(findings).toEqual([]);
});
```

- The sentinel is a random string that exists only in A's data. Do not use A's email or
  name: the app may legitimately show them to B (a shared workspace, an "invite" list).
- `urls` are the places where A's data appears: the account page, an export, a document
  URL with A's id. Each must show A the sentinel, or the helper stops before the check.
- Use one `page` for the whole flow. A second context has its own cache and storage and
  would see nothing, which is the mistake this recipe exists to avoid.
- Sign out through the app's control. Clearing cookies from the test skips whatever
  cleanup the app's sign-out does or forgets.

Each finding names a stage and a place:

| Finding | What it usually means |
|---|---|
| `signed out` / `B`, `localStorage: profile` or `IndexedDB app/notes` | Sign-out does not clear client storage |
| `… , online`, `response /api/export` | The server answered with A's data (missing guard), or the browser's HTTP cache did because the response was cacheable |
| `… , offline`, `response /api/export (service worker)` | The service worker stored a personal response and still serves it |
| `… , offline`, `page /account` | A's data is rendered without the network, from one of the above |

An online finding needs one more step to tell the two causes apart: repeat the request with
a new `request` context carrying the same cookies. If the sentinel comes back there too, the
server sent it.

## Repairs to look for

- Personal responses carry `Cache-Control: no-store`. `private` alone still lets this
  browser reuse them for the next account.
- The service worker caches the application shell and static assets only, or keeps a cache
  per account and deletes it at sign-out.
- Sign-out clears storage the app wrote. `Clear-Site-Data: "cache", "storage"` on the
  sign-out response does it in one header where the browser supports it.
- The server invalidates the session (see `auth-tests.md`); dropping the cookie is not enough.

## What a pass means

For these URLs and this pair of accounts, in the Chromium that ran the test, A's sentinel
was not found in responses, pages or the origin's storage after sign-out, online or offline.
Say that, with the browser version.

It is not "the app is secure" and it is not "row-level security verified". It does not test
other URLs, other roles, tokens that stay valid after sign-out (`auth-tests.md`), data in
other origins or in the operating system (downloads, the print spooler), or what the Back
button shows from the back/forward cache. A database policy is tested at the database with
two roles; this recipe only shows what reached the browser.

## Gotchas

- **Chromium only, as verified.** The recipe was run in Playwright's Chromium. Service
  workers and offline emulation behave differently in Firefox and WebKit under Playwright;
  run it there and read the result before relying on it.
- **Do not add `page.route` to this test.** Routing turns the browser's HTTP cache off, and a
  cached export then looks safe.
- **Storage is per origin.** `sentinelInBrowser` reads the origin the page is on. An app
  that spans `app.` and `api.` hosts needs a scan on a page of each.
- **Binary values are not searched.** A sentinel inside a `Blob` or an `ArrayBuffer` in
  IndexedDB or inside an opaque cached response is missed. Keep the sentinel in text.
- **The helper does not use `networkidle`.** Chromium does not report a `fetch` as finished
  while the page leaves the body unread, and a signed-out page that only checks for `401`
  does exactly that. `networkidle` and `response.text()` then wait until the timeout. The
  helper waits until every request has an answer and 500 ms pass with no network activity.
  An app that polls or holds a request open (a notification stream, a long poll) needs
  `settled`, for example `page => page.getByTestId('account-loaded').waitFor()`. Without it
  the helper stops with an error that names the requests it was still waiting for.
- **Unread bodies are requested a second time.** A response the page did not read within a
  second is fetched again from the page, with the same cookies, cache and service worker,
  and that copy is searched. Only `GET` is repeated. A `POST` reply the page ignores, or a
  cross-origin reply the page cannot read, is not inspected.
- **The first visit must finish caching.** A service worker that precaches in the
  background may not be done when A's page looks loaded. Wait for the app's own "ready for
  offline" signal in `signInA`, or the offline pass has nothing to find.
- **A finding in one URL out of several is normal.** On a self-hosted application checked
  with this recipe on 2026-11-16, the pages that render a private file left nothing and the
  file's direct download did: it was served with `Cache-Control: private` and a `max-age`,
  and the browser showed it after sign-out without asking the server. List the download,
  export and raw endpoints in `urls`, not only the pages.
- **A shared device is the threat here.** Where a product is only ever used on personal
  devices, record that as an accepted risk; do not delete the test to get a green run.
