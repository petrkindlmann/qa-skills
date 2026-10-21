// The one abstraction layer between the tests and the virtualization tool (SKILL.md, Core
// Principle 5). Built on Playwright's page.route because the page under test is driven by a
// browser and the Shop cannot serve MSW's mockServiceWorker.js. Playwright tries route handlers
// in reverse registration order and route.fallback() hands a request to the next one, so:
//   1. the guard is registered first  -> tried last  -> aborts and logs anything unclaimed
//      (the page.route counterpart of MSW's `onUnhandledRequest: "error"`),
//   2. explicit passthroughs come next -> let named method+path pairs reach the real Shop,
//   3. stubs and holds come last       -> tried first -> opt-in error scenarios shadow success
//      (SKILL.md anti-pattern 8: an opt-in error must sit in front of the success path).
import { loadRecording } from './cassette.mjs';

function parseSpec(spec) {
  const [method, path] = spec.trim().split(/\s+/);
  if (!method || !path?.startsWith('/')) throw new Error(`Route spec must be "METHOD /path", got "${spec}"`);
  return { method: method.toUpperCase(), path };
}

const describe = request => ({ method: request.method(), path: new URL(request.url()).pathname });

export async function virtualize(page, { passthrough = [] } = {}) {
  const log = { handled: [], passed: [], unhandled: [] };

  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    log.unhandled.push(describe(route.request()));
    await route.abort('failed');
  });

  for (const spec of passthrough) {
    const { method, path } = parseSpec(spec);
    await page.route(url => url.pathname === path, async route => {
      if (route.request().method() !== method) return route.fallback();
      log.passed.push(describe(route.request()));
      await route.continue();
    });
  }

  return {
    log,

    // Fulfil `METHOD /path` with a prepared response. `once` serves it a single time and then
    // steps aside, so the same test can observe the recovery against the real Shop.
    // Resolves to the list of requests the stub answered (headers and body included).
    async stub(spec, response, { once = false } = {}) {
      const { method, path } = parseSpec(spec);
      const answered = [];
      await page.route(url => url.pathname === path, async route => {
        const request = route.request();
        if (request.method() !== method || (once && answered.length)) return route.fallback();
        answered.push({ ...describe(request), headers: request.headers(), body: request.postData() });
        log.handled.push(describe(request));
        await route.fulfill(typeof response === 'function' ? await response(request) : response);
      });
      return answered;
    },

    // Keep every matching request waiting at the proxy until release() is called, then let it
    // reach the real Shop. Deterministic "slow dependency" without sleeping on wall-clock time.
    async hold(spec) {
      const { method, path } = parseSpec(spec);
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const held = [];
      await page.route(url => url.pathname === path, async route => {
        if (route.request().method() !== method) return route.fallback();
        held.push(describe(route.request()));
        await gate;
        log.passed.push(describe(route.request()));
        await route.continue();
      });
      return { held, release };
    },
  };
}

// Build a route.fulfill() payload from a cassette. Overrides derive a variant (another status,
// a body transform, raw text) from the recorded response instead of inventing a new shape.
export function fulfillFrom(recording, { status, body, text, headers = {} } = {}) {
  const recorded = recording.response;
  const kept = {};
  for (const name of ['content-type', 'retry-after']) if (recorded.headers[name]) kept[name] = recorded.headers[name];
  const payload = typeof body === 'function' ? body(structuredClone(recorded.body)) : body ?? recorded.body;
  return {
    status: status ?? recorded.status,
    headers: { 'content-type': 'application/json', ...kept, ...headers },
    body: text ?? (payload === null ? '' : JSON.stringify(payload)),
  };
}

// The scenarios the front-end team asked for, each tied to the cassette it is derived from.
export const scenarios = {
  // The Shop never answers 500; the contract's error envelope is { error: string }, so the 500
  // keeps that envelope (recorded from the 400 invalid_order response) with a different code.
  orderCreateServerError: () => fulfillFrom(loadRecording('orders-create-invalid'), { status: 500, body: { error: 'internal_error' } }),
  ordersListServerError: () => fulfillFrom(loadRecording('orders-create-invalid'), { status: 500, body: { error: 'internal_error' } }),
  // Recorded as-is: a real 429 after five failed attempts, Retry-After included.
  loginThrottled: () => fulfillFrom(loadRecording('login-throttled')),
  // A 200 whose body stops half-way through the recorded JSON.
  loginMalformed: () => {
    const recording = loadRecording('login-ok');
    const full = JSON.stringify(recording.response.body);
    return fulfillFrom(recording, { text: full.slice(0, Math.floor(full.length / 2)) });
  },
  emptyCatalogue: () => fulfillFrom(loadRecording('catalog'), { body: recorded => ({ ...recorded, products: [] }) }),
  recordedCatalogue: () => fulfillFrom(loadRecording('catalog')),
  recordedMeUnauthenticated: () => fulfillFrom(loadRecording('me-unauthenticated')),
};
