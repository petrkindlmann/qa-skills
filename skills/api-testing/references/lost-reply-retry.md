# The write committed and the reply was lost

A client sends a write. The service commits it and answers, and the answer never arrives:
a proxy timed out, the pod was replaced, the phone left the tunnel. The client cannot tell
this from a request that never got there, so it sends the write again. Whether that makes a
second order depends on what the service remembered.

The usual idempotency test sends the same key twice and reads two good replies. That skips
the case above, because the client had the first reply. This recipe puts a proxy in front
of the service that lets the write through, waits for the service's answer and then drops
the connection. Afterwards it counts the business effects by an independent read.

It applies to any write over HTTP: a REST `POST`, a webhook receiver, a job submission, or a
`tools/call` on an MCP server over Streamable HTTP. An agent that retries a tool call after
a lost response re-runs the tool's side effect unless the server deduplicates; the question
is open in the MCP specification
([modelcontextprotocol#3394](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3394)).

## The helper

```ts
import http from 'node:http';
import https from 'node:https';

type Exchange = { method: string; path: string; requestBody: string; status: number; body: string };

// Forwards every request to `target`. When `drop` says so, the service's reply is read in
// full and thrown away, and the caller's connection is cut instead of answered.
export async function startReplyDroppingProxy(target: string, { drop = null as null | ((exchange: Exchange) => boolean) } = {}) {
  const dropped: Exchange[] = [], forwarded: Exchange[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const method = request.method ?? 'GET', path = request.url ?? '/';
      const url = new URL(path, target);
      // agent: false gives each call its own connection, so a restart of the service
      // between the attempts cannot leave the proxy holding a dead one.
      const upstream = (url.protocol === 'https:' ? https : http).request(url, {
        method, agent: false, headers: { ...request.headers, host: url.host, connection: 'close' },
      }, reply => {
        const parts: Buffer[] = [];
        reply.on('data', part => parts.push(part));
        reply.on('end', () => {
          const text = Buffer.concat(parts);
          const exchange = { method, path, requestBody: body.toString(), status: reply.statusCode ?? 0, body: text.toString() };
          // By default: the first write, once.
          const lose = drop ? drop(exchange) : !dropped.length && !['GET', 'HEAD', 'OPTIONS'].includes(method);
          (lose ? dropped : forwarded).push(exchange);
          if (lose) return request.socket.destroy();
          const { connection, 'transfer-encoding': chunked, ...headers } = reply.headers;
          response.writeHead(exchange.status, { ...headers, 'content-length': text.length }).end(text);
        });
      });
      upstream.on('error', error => response.writeHead(502).end(`The proxy could not reach ${target}: ${error.message}`));
      upstream.end(body);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    dropped, forwarded,
    close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

// send(baseUrl) performs the write through the application's own client and returns its result.
// countEffects() reads how many business effects exist, from the database or an admin API.
export async function retryAfterLostReply({ target, send, countEffects, restart = null, drop = null }: {
  target: string; send: (baseUrl: string) => Promise<unknown>; countEffects: () => Promise<number>;
  restart?: null | (() => Promise<void>); drop?: null | ((exchange: Exchange) => boolean);
}) {
  const proxy = await startReplyDroppingProxy(target, { drop });
  const outcome = (verdict: string, reason: string, more = {}) => ({ verdict, reason, lost: proxy.dropped[0] ?? null, ...more });
  try {
    const before = await countEffects();
    let result: unknown, firstError: unknown = null, retryError: unknown = null;
    try { result = await send(proxy.url); } catch (error) { firstError = error; }

    if (proxy.dropped.length !== 1) return outcome('inconclusive', `${proxy.dropped.length} replies were dropped; the write did not go through the proxy exactly once`);
    const lost = proxy.dropped[0];
    if (lost.status < 200 || lost.status > 299) return outcome('inconclusive', `the service answered ${lost.status}, so no committed write was lost`);
    const clientRetried = firstError === null;
    if (!clientRetried && await countEffects() !== before + 1) return outcome('inconclusive', 'the service answered 2xx but countEffects() does not see one new effect; the counter looks at the wrong thing or the effect is asynchronous');
    if (clientRetried && restart) return outcome('inconclusive', 'the client retried on its own, so the service could not be restarted between the attempts; send a single attempt to test a restart');

    if (!clientRetried) {
      if (restart) await restart();
      try { result = await send(target); } catch (error) { retryError = error; }
    }
    const effects = await countEffects() - before;
    const facts = { effects, clientRetried, restarted: Boolean(restart) && !clientRetried, result, retryError };
    if (effects > 1) return outcome('duplicated', `one logical write produced ${effects} effects`, facts);
    if (effects < 1) return outcome('missing', 'the service acknowledged the write and no effect exists after the retry', facts);
    return outcome('one_effect', 'the write was retried after a lost reply and exists once', facts);
  } finally {
    await proxy.close();
  }
}
```

## Using it

```ts
test('an order whose reply is lost is not placed twice', async ({ request }) => {
  const reference = `lost-${crypto.randomUUID()}`;
  const outcome = await retryAfterLostReply({
    target: process.env.API_URL,
    send: baseUrl => placeOrder({ baseUrl, reference, sku: 'SKU-1' }),   // the app's real client
    countEffects: async () => (await (await request.get(`/admin/orders?reference=${reference}`)).json()).length,
    restart: () => restartApi(),                                          // when the project can
  });
  expect(outcome.verdict, outcome.reason).toBe('one_effect');
  expect(outcome.retryError).toBeNull();
  expect(outcome.result.id).toBe(JSON.parse(outcome.lost.body).id);       // the retry returns the first order
});
```

Three things decide whether the result means anything:

- **`send` is the code path that retries in production.** Call the application's client, SDK
  or job, with the same arguments both times, and let it produce the idempotency key the
  way it does in production. A test that passes one hard-coded key to two raw requests
  checks the server and misses a client that makes a fresh key for every attempt. If the
  client retries by itself, `send` returns normally and `clientRetried` is `true`.
- **`countEffects` reads the effect, not the reply.** Count orders, ledger rows, queued
  emails or outbound provider calls, scoped to this test's data. For an effect in another
  system (a charge, an email), count there: the provider's sandbox, the mail capture.
- **`restart` covers the deduplication that lives in memory.** A key cache in the process
  passes without a restart and duplicates after a deploy. Run it with a restart wherever
  the project can restart the service under test.

### An MCP tool call

The caller here is the official TypeScript SDK client. Its first `POST` is `initialize`, so
the default `drop` would lose the handshake and the verdict would be `inconclusive`. Pick
the tool call by its body:

```ts
let lostOnce = false;
const outcome = await retryAfterLostReply({
  target: serverUrl,
  send: async baseUrl => {                          // what an agent host does: connect, call, read
    const client = new Client({ name: 'agent', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
      return (await client.callTool({ name: 'create_note', arguments: { text, idempotency_key: key } })).content[0].text;
    } finally {
      await client.close().catch(() => {});
    }
  },
  countEffects: async () => (await readNotes()).filter(note => note.text === text).length,
  drop: exchange => !lostOnce && /"method":"tools\/call"/.test(exchange.requestBody) && (lostOnce = true),
  restart: () => restartServer(),
});
```

Run on 2026-11-16 with `@modelcontextprotocol/sdk` 1.32.2, a stateless
`StreamableHTTPServerTransport` and a tool that appends a note to a file: the tool as written
gave `duplicated`, and so did a tool that received `idempotency_key` and ignored it. Keys
remembered in memory gave `one_effect`, and `duplicated` again once the server was restarted
between the attempts. Keys on disk gave `one_effect` across the restart. The SDK client did
not retry by itself (`clientRetried` was `false`); the second call stands for an agent that
sees the error and calls the tool again. The SDK is not a dependency of this repository, so
its tests do not repeat this run.

## Verdicts

| Verdict | Observed |
|---|---|
| `one_effect` | The service committed, the reply was dropped, the write was sent again, and one effect exists |
| `duplicated` | One logical write left more than one effect |
| `missing` | The service answered 2xx and no effect exists after the retry |
| `inconclusive` | No committed write was lost: the service refused the first attempt, the request did not pass through the proxy once, the counter did not see the effect, or a restart was requested while the client retried on its own |

`one_effect` is not the whole contract. Also assert what the caller gets back: the retry
should return the original result (`outcome.result` against `outcome.lost.body`), not a
`409` the client cannot interpret and not a new identifier for the old order.

When the operation has no idempotency key and cannot get one, the correct client does not
resend. It asks what happened (a status lookup by its own reference) and escalates when the
answer is unknown. `send` may do exactly that on its second call; the helper only counts
effects.

## What a pass means

One write, on this build, survived one lost reply and one retry, with or without a restart
as recorded in `restarted`. Report it with those words.

It is not "exactly-once", and it does not cover concurrent duplicates (two attempts in
flight at once, see the idempotency line in `SKILL.md`), a retry after the key has expired,
a retry that reaches another region or replica, or effects the counter does not look at.
The mirror case, an answer sent before the commit, needs a fault inside the service.

## Gotchas

- **The proxy drops by closing the socket.** A client sees `ECONNRESET` or "socket hang up".
  To model a gateway timeout instead, pass `drop` and answer the retry yourself; the
  service-side question is the same.
- **`drop` receives `{ method, path, requestBody, status, body }`.** The default drops the
  first non-GET request once. Narrow it by `path` when `send` makes other writes first, such
  as a login.
- **Streaming replies are buffered.** The proxy reads the whole reply before it decides, so
  it fits request/response calls and an MCP `tools/call` answered as JSON or as a single
  server-sent event that then closes, which is what the TypeScript SDK's Streamable HTTP
  transport sent. It was not run against a server that keeps an event stream open.
- **TLS and absolute URLs.** The proxy listens on plain HTTP on loopback. It has code for
  an HTTPS `target`, and this repository's tests only run it against HTTP. A client that
  pins the host or builds absolute URLs from a discovery document will bypass it;
  `inconclusive` reports that no reply was dropped.
- **Compressed replies pass through untouched.** `lost.body` is then compressed bytes read
  as text. Send `Accept-Encoding: identity` from the client under test when the assertion
  needs the lost body.
- **Do not point it at production.** The second attempt is a real write.
