import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { loadFunctions } from '../examples/snippets.mjs';

const { accountSwitchLeaks, sentinelInBrowser } = loadFunctions(
  'skills/security-testing/references/account-switch.md', 'function accountSwitchLeaks(',
  ['accountSwitchLeaks', 'sentinelInBrowser']);

const sentinel = 'sentinel-4c1d9a7e-a-only';

// A small account app. Each fault is one way A's note stays reachable after sign-out.
//   export_cacheable   /api/export is served with max-age instead of no-store
//   worker_caches_api  the service worker stores /api/export and serves it when offline
//   profile_in_storage the page keeps the export in localStorage and IndexedDB
//   missing_guard      /api/export?owner=a answers anyone; the page also prefetches it and
//                      never reads the reply
//   clears_on_sign_out sign-out sends Clear-Site-Data (a repair, used with a fault)
async function accountApp(t, faults = []) {
  const has = fault => faults.includes(fault);
  const notes = { a: sentinel, b: 'note of account b' };
  const sessions = new Map();
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Account</title></head><body>
<h1>Account</h1><pre id="note">loading</pre><a href="/logout">Sign out</a>
<script>
(async () => {
  await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  const show = text => { document.getElementById('note').textContent = text; };
  if (${has('missing_guard')}) window.prefetched = fetch('/api/export?owner=a');
  try {
    const reply = await fetch('/api/export');
    if (!reply.ok) return show('signed out');
    const data = await reply.json();
    show(data.note);
    if (${has('profile_in_storage')}) {
      localStorage.setItem('profile', JSON.stringify(data));
      const open = indexedDB.open('app', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('notes', { autoIncrement: true });
      open.onsuccess = () => { open.result.transaction('notes', 'readwrite').objectStore('notes').put(data); };
    }
  } catch { show('offline'); }
})();
</script></body></html>`;
  const worker = `
self.addEventListener('install', event => event.waitUntil(caches.open('shell').then(cache => cache.add('/account')).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === '/account') return event.respondWith(fetch(event.request).catch(() => caches.match('/account')));
  if (${has('worker_caches_api')} && url.pathname === '/api/export') {
    event.respondWith(fetch(event.request).then(async reply => {
      if (reply.ok) await (await caches.open('data')).put('/api/export', reply.clone());
      return reply;
    }).catch(() => caches.match('/api/export')));
  }
});`;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const session = /(?:^|; )sid=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
    const user = sessions.get(session);
    const send = (status, type, body, headers = {}) => response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }).end(body);
    if (url.pathname === '/login') {
      const id = `s${sessions.size + 1}-${url.searchParams.get('as')}`;
      sessions.set(id, url.searchParams.get('as'));
      return send(302, 'text/plain', '', { location: '/account', 'set-cookie': `sid=${id}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (url.pathname === '/logout') {
      sessions.delete(session);
      return send(200, 'text/html', '<!doctype html><title>Signed out</title><p>Signed out</p>', {
        'set-cookie': 'sid=; Path=/; Max-Age=0',
        ...(has('clears_on_sign_out') ? { 'clear-site-data': '"cache", "storage"' } : {}),
      });
    }
    if (url.pathname === '/account') return send(200, 'text/html', page);
    if (url.pathname === '/sw.js') return send(200, 'text/javascript', worker);
    if (url.pathname === '/api/export') {
      const owner = has('missing_guard') ? url.searchParams.get('owner') ?? user : user;
      if (!owner) return send(401, 'application/json', '{"error":"sign in"}');
      return send(200, 'application/json', JSON.stringify({ owner, note: notes[owner] }),
        has('export_cacheable') ? { 'cache-control': 'max-age=600' } : {});
    }
    send(404, 'text/plain', 'not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const signIn = async (page, account) => {
    await page.goto(`${origin}/login?as=${account}`);
    await page.waitForFunction(() => document.getElementById('note')?.textContent !== 'loading');
  };
  return {
    origin,
    flow: (overrides = {}) => ({
      sentinel,
      urls: [`${origin}/account`, `${origin}/api/export${has('missing_guard') ? '?owner=a' : ''}`],
      signInA: page => signIn(page, 'a'),
      signOut: page => page.goto(`${origin}/logout`),
      signInB: page => signIn(page, 'b'),
      ...overrides,
    }),
  };
}

let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.QA_BROWSER_EXECUTABLE, headless: true }); });
after(async () => { await browser?.close(); });
async function newPage(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  return context.newPage();
}
const places = findings => [...new Set(findings.map(finding => `${finding.stage} | ${finding.where}`))];

test('a healthy app with an offline shell leaves nothing of A behind', async t => {
  const app = await accountApp(t);
  const page = await newPage(t);
  assert.deepEqual(await accountSwitchLeaks(page, app.flow()), []);
  // B is really signed in at the end and sees B's own note, so the flow did run as B.
  await page.goto(`${app.origin}/account`);
  await page.getByText('note of account b').waitFor();
});

test('a cacheable export is answered from the browser cache for the next visitor', async t => {
  const app = await accountApp(t, ['export_cacheable']);
  const found = places(await accountSwitchLeaks(await newPage(t), app.flow()));
  assert.ok(found.includes('signed out, online | response /api/export'), found.join('\n'));
  assert.ok(found.includes('B, online | page /api/export'), found.join('\n'));
  assert.ok(found.every(place => !place.includes('Storage') && !place.includes('service worker')), found.join('\n'));
});

test('a service worker that stores the export serves it offline to B', async t => {
  const app = await accountApp(t, ['worker_caches_api']);
  const found = places(await accountSwitchLeaks(await newPage(t), app.flow()));
  assert.ok(found.includes('signed out | Cache Storage data: /api/export'), found.join('\n'));
  assert.ok(found.includes('signed out, offline | response /api/export (service worker)'), found.join('\n'));
  assert.ok(found.includes('signed out, offline | page /account'), found.join('\n'));
  // Online, the server refuses and nothing leaks; only the offline pass shows it.
  assert.ok(found.every(place => !place.includes(', online')), found.join('\n'));
});

test('the same worker is safe when sign-out clears site data', async t => {
  const app = await accountApp(t, ['worker_caches_api', 'export_cacheable', 'profile_in_storage', 'clears_on_sign_out']);
  assert.deepEqual(await accountSwitchLeaks(await newPage(t), app.flow({ signInB: null })), []);
});

test('a profile kept in localStorage and IndexedDB survives sign-out', async t => {
  const app = await accountApp(t, ['profile_in_storage']);
  const found = places(await accountSwitchLeaks(await newPage(t), app.flow({ signInB: null })));
  assert.deepEqual(found, ['signed out | localStorage: profile', 'signed out | IndexedDB app/notes']);
});

test('a missing guard on the endpoint shows as an online response for nobody and for B', async t => {
  const app = await accountApp(t, ['missing_guard']);
  const found = places(await accountSwitchLeaks(await newPage(t), app.flow()));
  assert.ok(found.includes('signed out, online | response /api/export'), found.join('\n'));
  assert.ok(found.includes('B, online | response /api/export'), found.join('\n'));

  // From the page alone: the reply sits unread in the page, and it is still found.
  const fromPage = places(await accountSwitchLeaks(await newPage(t), app.flow({ urls: [`${app.origin}/account`], signInB: null })));
  assert.deepEqual(fromPage, ['signed out, online | response /api/export']);
});

test('without signInB only the signed-out visitor is checked', async t => {
  const app = await accountApp(t, ['export_cacheable']);
  const found = places(await accountSwitchLeaks(await newPage(t), app.flow({ signInB: null })));
  assert.ok(found.length > 0 && found.every(place => place.startsWith('signed out')), found.join('\n'));
});

test('it refuses to run when A never got the sentinel', async t => {
  const app = await accountApp(t);
  const flow = app.flow();
  await assert.rejects(accountSwitchLeaks(await newPage(t), { ...flow, timeoutMs: 2_000, urls: [`${app.origin}/missing`] }), /A did not get the sentinel from .*\/missing/);
  await assert.rejects(accountSwitchLeaks(await newPage(t), { ...flow, timeoutMs: 2_000, signInA: async () => {} }), /A did not get the sentinel/);
  await assert.rejects(accountSwitchLeaks(await newPage(t), { ...flow, sentinel: 'alice' }), /long random sentinel/);
  await assert.rejects(accountSwitchLeaks(await newPage(t), { ...flow, urls: [] }), /at least one URL/);
});

test('the flow leaves the context online and sentinelInBrowser needs an application page', async t => {
  const app = await accountApp(t, ['worker_caches_api']);
  const page = await newPage(t);
  await assert.rejects(sentinelInBrowser(page, sentinel), /open a page of the application/);
  await accountSwitchLeaks(page, app.flow({ signInB: null }));
  const reply = await page.goto(`${app.origin}/account`);
  assert.equal(reply.status(), 200);
  assert.equal(reply.fromServiceWorker(), true);
  assert.deepEqual(await sentinelInBrowser(page, sentinel), ['Cache Storage data: /api/export']);
  assert.deepEqual(await sentinelInBrowser(page, 'not-present-anywhere'), []);

  await page.evaluate(value => {
    sessionStorage.setItem('draft', `note: ${value}`);
    localStorage.setItem(`seen:${value}`, '1');
    document.cookie = `last_note=${value}; Path=/`;
  }, sentinel);
  assert.deepEqual(await sentinelInBrowser(page, sentinel),
    [`localStorage: seen:${sentinel}`, 'sessionStorage: draft', 'Cache Storage data: /api/export', 'document.cookie']);
});
