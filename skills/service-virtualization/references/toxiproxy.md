# Toxiproxy — network fault injection

Toxiproxy (`ghcr.io/shopify/toxiproxy:2.12.0`) sits between your app and a dependency as a TCP
proxy and injects latency, bandwidth limits, and connection resets. Point your app at the **proxy**
port, not the real service, so you can degrade the link at runtime.

For broader resilience work (fault-injection campaigns, game days, blast-radius limits) see
`chaos-engineering` — this file is the narrow seam for making one dependency misbehave in a test.

## Compose ports

```yaml
# In docker-compose.test.yml
toxiproxy:
  image: ghcr.io/shopify/toxiproxy:2.12.0
  ports:
    - "8474:8474"   # Toxiproxy admin API
    - "15432:15432" # Proxied PostgreSQL (app connects HERE, not to 5432)
    - "16379:16379" # Proxied Redis      (app connects HERE, not to 6379)
```

The proxy `listen` address is the published port above (e.g. `0.0.0.0:15432`); the `upstream` is
the **real** service host:port reachable from the Toxiproxy container. With docker-compose that is
the service name and its internal port (`postgres:5432`). With Testcontainers the upstream is the
container's mapped host:port — read it from `getHost()`/`getMappedPort()` and pass it into
`createProxy`. Do not assume a fixed 5432/6379 upstream when using Testcontainers.

## Helpers — note the `response.ok` checks

Every fetch is checked. A fault-injection helper that silently swallows a failed proxy creation is
worse than no helper: the test goes green while no toxic was ever applied.

```typescript
// test/helpers/toxiproxy.ts
const TOXIPROXY_API = "http://localhost:8474";

async function post(path: string, body: unknown) {
  const res = await fetch(`${TOXIPROXY_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Toxiproxy ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

// listen = the published proxy port (e.g. "0.0.0.0:15432")
// upstream = the REAL service host:port (compose: "postgres:5432"; Testcontainers: mapped host:port)
export async function createProxy(name: string, listen: string, upstream: string) {
  await post("/proxies", { name, listen, upstream, enabled: true });
}

export async function addLatency(proxyName: string, latencyMs: number) {
  await post(`/proxies/${proxyName}/toxics`, {
    name: "latency",
    type: "latency",
    attributes: { latency: latencyMs, jitter: Math.floor(latencyMs * 0.1) },
  });
}

export async function severeConnection(proxyName: string) {
  await post(`/proxies/${proxyName}/toxics`, {
    name: "reset_peer",
    type: "reset_peer",
    attributes: { timeout: 0 },
  });
}

export async function removeToxics(proxyName: string) {
  const res = await fetch(`${TOXIPROXY_API}/proxies/${proxyName}/toxics`);
  if (!res.ok) throw new Error(`Toxiproxy list toxics failed: ${res.status}`);
  const toxics = (await res.json()) as Array<{ name: string }>;
  for (const toxic of toxics) {
    const del = await fetch(`${TOXIPROXY_API}/proxies/${proxyName}/toxics/${toxic.name}`, {
      method: "DELETE",
    });
    if (!del.ok) throw new Error(`Toxiproxy delete toxic ${toxic.name} failed: ${del.status}`);
  }
}
```

## Usage in a test

```typescript
beforeAll(async () => {
  // upstream points at the real Postgres reachable from the Toxiproxy container
  await createProxy("postgres", "0.0.0.0:15432", "postgres:5432");
});

afterEach(() => removeToxics("postgres")); // always clean up — toxics leak across tests otherwise

it("handles a slow database within the timeout budget", async () => {
  await addLatency("postgres", 500);
  await expect(queryWithTimeout(300)).rejects.toThrow(/timeout/i);
});

it("reconnects after the connection is severed", async () => {
  await severeConnection("postgres");
  await removeToxics("postgres"); // restore the link
  await expect(retryUntilConnected()).resolves.toBe(true);
});
```
