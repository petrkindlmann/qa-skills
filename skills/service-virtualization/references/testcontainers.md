# Testcontainers — ephemeral real services for integration tests

`@testcontainers/postgresql` 11.x and friends spin up real services in Docker. Containers start
before the suite and are destroyed after. Ports are **random** — always read them via
`getMappedPort()` / `getConnectionUri()`, never hardcode 5432/6379. (This is why the Testcontainers
port model and the docker-compose port model in `references/ci.md` are incompatible — pick one per
suite and don't mix.)

> **Refresh image tags periodically.** The tags below are pinned to specific minors so runs are
> reproducible, but they age. `elasticsearch:8.12.0` is notably behind Elastic 9.x (GA in 2026);
> bump it (and `postgres:17-alpine`, `redis:8-alpine`) on a cadence and re-pin.

```bash
npm i -D testcontainers @testcontainers/postgresql @testcontainers/redis
```

```typescript
// test/helpers/containers.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, StartedRedisContainer } from "@testcontainers/redis";
import { GenericContainer, StartedTestContainer, Wait } from "testcontainers";

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let elasticsearch: StartedTestContainer;

export async function startContainers() {
  // Start all containers in parallel — sequential startup is the #1 cause of slow suites
  [postgres, redis, elasticsearch] = await Promise.all([
    new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("testdb")
      .withUsername("test")
      .withPassword("test")
      .start(),

    new RedisContainer("redis:8-alpine").start(),

    new GenericContainer("elasticsearch:8.12.0") // bump to a 9.x tag periodically
      .withEnvironment({
        "discovery.type": "single-node",
        "xpack.security.enabled": "false",
      })
      .withExposedPorts(9200)
      .withWaitStrategy(Wait.forHttp("/", 9200).forStatusCode(200))
      .start(),
  ]);

  return {
    databaseUrl: postgres.getConnectionUri(),
    redisUrl: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
    elasticsearchUrl: `http://${elasticsearch.getHost()}:${elasticsearch.getMappedPort(9200)}`,
  };
}

export async function stopContainers() {
  await Promise.all([postgres?.stop(), redis?.stop(), elasticsearch?.stop()]);
}
```

## Wiring into Vitest

Use a `globalSetup` file that calls `startContainers()` in `setup()` and `stopContainers()` in
`teardown()`, exporting the URLs into `process.env` so tests read connection strings from
`process.env.DATABASE_URL` etc. Account for container startup time:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 30_000, // container startup can be slow on cold CI runners
  },
});
```

```typescript
// test/global-setup.ts
import { startContainers, stopContainers } from "./helpers/containers";

export async function setup() {
  const urls = await startContainers();
  process.env.DATABASE_URL = urls.databaseUrl;
  process.env.REDIS_URL = urls.redisUrl;
  process.env.ELASTICSEARCH_URL = urls.elasticsearchUrl;
}

export async function teardown() {
  await stopContainers();
}
```
