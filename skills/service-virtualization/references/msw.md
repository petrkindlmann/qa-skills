# MSW (Mock Service Worker) — handlers, setup, and stateful flows

MSW 2.x intercepts HTTP at the network layer (Service Worker in the browser, request
interception in Node). Stub at the HTTP layer (`POST /v1/payment_intents`), never at the
SDK method — that decouples the test from the SDK version.

**Compatibility:** this recipe and its executable regression target **MSW 2.15.0**,
the latest 2.x release checked on 2026-10-20. MSW 3 is a newer major with different
imports/options; inspect the installed version before adapting this recipe. See the
[MSW 2 release API](https://mswjs.io/blog/introducing-msw-2.0/) and
[package metadata](https://registry.npmjs.org/msw).

```bash
npm i -D --save-exact msw@2.15.0
```

Contents: [handlers](#centralized-handlers-with-realistic-behavior),
[lifecycle](#test-setup-vitest--reject-unhandled-requests-and-reset-state),
[client](#small-client-for-the-executable-example),
[fault scenarios](#per-test-overrides--timeout-and-retry),
[auth](#stateful-auth-flow--create--verify--refresh--revoke).

## Centralized handlers with realistic behavior

Keep a single source of truth for response shapes. The Stripe `payment_intents` shape below
(`id`, `status`, `amount`) is reused verbatim by every handler and override in the suite — do
not let two tests model the same endpoint with different field names. This deliberately
small fixture is not the complete provider contract; validate the fields and behavior your
consumer relies on against that contract.

MSW tries handlers in order until one supplies a response. Put the opt-in error handler
**before** the matching success handler; otherwise the rate-limit case silently returns 201.
Runtime overrides added with `server.use()` take priority over existing handlers.

```typescript
// test/mocks/handlers.ts
import { http, HttpResponse, delay } from "msw";

// Stateful handler: maintains state across requests within a test
export function createPaymentHandlers() {
  const payments = new Map<string, { id: string; status: string; amount: number }>();
  let nextId = 1; // Unique within this fixture even when the clock is frozen.

  return [
    // Create payment
    http.post("https://api.stripe.com/v1/payment_intents", async ({ request }) => {
      const body = await request.text();
      const params = new URLSearchParams(body);

      const id = "pi_test_" + nextId++;
      const payment = {
        id,
        status: "requires_confirmation",
        amount: Number(params.get("amount")),
      };
      payments.set(id, payment);

      return HttpResponse.json(payment, { status: 201 });
    }),

    // Confirm payment
    http.post<{ id: string }>(
      "https://api.stripe.com/v1/payment_intents/:id/confirm",
      async ({ params }) => {
        const payment = payments.get(params.id);
        if (!payment) {
          return HttpResponse.json(
            { error: { type: "invalid_request_error", message: "No such payment intent" } },
            { status: 404 }
          );
        }
        payment.status = "succeeded";
        return HttpResponse.json(payment);
      }
    ),

    // Retrieve payment
    http.get<{ id: string }>(
      "https://api.stripe.com/v1/payment_intents/:id",
      async ({ params }) => {
        const payment = payments.get(params.id);
        if (!payment) {
          return HttpResponse.json(
            { error: { type: "invalid_request_error", message: "No such payment intent" } },
            { status: 404 }
          );
        }
        return HttpResponse.json(payment);
      }
    ),
  ];
}

// Error simulation handlers — opt-in via a test-set header
export const errorHandlers = [
  http.all("https://api.stripe.com/*", async ({ request }) => {
    if (request.headers.get("x-test-scenario") === "rate-limit") {
      await delay(100);
      return HttpResponse.json(
        { error: { type: "rate_limit_error", message: "Too many requests" } },
        { status: 429, headers: { "Retry-After": "1" } }
      );
    }
    return undefined; // Fall through to other handlers
  }),
];

export const handlers = [...errorHandlers, ...createPaymentHandlers()];
```

## Test setup (Vitest) — reject unhandled requests and reset state

`onUnhandledRequest: "error"` rejects an intercepted request without a matching handler.
Keep it enabled in CI; `"warn"` is an explicit local debugging option that permits fallback.
An application can catch a rejected request, and explicit passthrough is separate, so a
green run alone is not proof of zero egress. Verify an expected mock response and an
intentionally unhandled rejection; use CI network controls when zero egress is required.

`resetHandlers()` removes runtime overrides but does **not** clear a `Map` captured by a
handler. Rebuild stateful factories between tests. Keep tests using these shared overrides
sequential; do not use `it.concurrent` with one mutable server fixture.
Register `vitest.setup.ts` in the existing Vitest config's `test.setupFiles` array.

```typescript
// vitest.setup.ts
import { beforeAll, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { handlers, errorHandlers, createPaymentHandlers } from "./test/mocks/handlers";

export const server = setupServer(...handlers);

const mode = !process.env.CI && process.env.MSW_ALLOW_NETWORK === "1" ? "warn" : "error";
beforeAll(() => server.listen({ onUnhandledRequest: mode }));
afterEach(() => server.resetHandlers(...errorHandlers, ...createPaymentHandlers()));
afterAll(() => server.close());
```

## Small client for the executable example

This small client makes the examples runnable; replace it with your application's real
client to test that application's behavior. Its policy is a per-attempt timeout, at most
three attempts, retries for 503 only, and a surfaced `Retry-After` value for 429. Keep one
idempotency key per logical payment across its attempts. The fixture does not prove the
provider enforces idempotency.

```typescript
// test/mocks/payment-client.ts
export function createPaymentClient({
  timeoutMs = 1_000,
  maxAttempts = 3,
  wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Positive timeout and attempt limit required");
  }

  return {
    async createPayment(amount: number, options: {
      idempotencyKey: string; scenario?: string;
    }) {
      if (!options.idempotencyKey) throw new Error("Idempotency key required");
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch("https://api.stripe.com/v1/payment_intents", {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Idempotency-Key": options.idempotencyKey,
              ...(options.scenario ? { "x-test-scenario": options.scenario } : {}),
            },
            body: new URLSearchParams({ amount: String(amount), currency: "usd" }),
          });
          const body = await response.json();
          if (response.ok) return body;
          if (response.status !== 503 || attempt === maxAttempts) {
            throw Object.assign(new Error("Payment API returned " + response.status), {
              status: response.status,
              retryAfter: response.headers.get("Retry-After"),
            });
          }
        } catch (error) {
          if (controller.signal.aborted) throw new Error("Payment service timeout");
          throw error;
        } finally {
          clearTimeout(timer);
        }
        await wait(100 * 2 ** (attempt - 1));
      }
      throw new Error("Payment attempts exhausted");
    },
  };
}
```

## Per-test overrides — timeout and retry

The timeout stub is slower than the configured client deadline; MSW delay alone does not
implement a timeout. Assert that the resolver was reached so an unrelated connection
failure cannot pass the timeout case. The retry case asserts the response, attempt count,
and stable idempotency key. Runtime handlers are removed and payment state is rebuilt by
the setup above after each test.

```typescript
// test/payment-errors.test.ts
import { it, expect } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { server } from "../vitest.setup";
import { createPaymentClient } from "./mocks/payment-client";

it("should handle payment API timeout", async () => {
  let requestSeen = false;
  server.use(
    http.post("https://api.stripe.com/v1/payment_intents", async () => {
      requestSeen = true;
      await delay(500);
      return HttpResponse.json(
        { id: "pi_test_slow", status: "requires_confirmation", amount: 5000 },
        { status: 201 }
      );
    })
  );
  const paymentService = createPaymentClient({ timeoutMs: 50, maxAttempts: 1 });
  await expect(paymentService.createPayment(5000, { idempotencyKey: "timeout-case" }))
    .rejects.toThrow("Payment service timeout");
  expect(requestSeen).toBe(true);
});

it("should retry on 503", async () => {
  let callCount = 0;
  const keys: Array<string | null> = [];
  server.use(
    http.post("https://api.stripe.com/v1/payment_intents", async ({ request }) => {
      callCount++;
      keys.push(request.headers.get("Idempotency-Key"));
      if (callCount < 3) {
        return HttpResponse.json(
          { error: { type: "api_error", message: "Service unavailable" } },
          { status: 503 }
        );
      }
      // Same shape as the create handler above: id, status, amount
      return HttpResponse.json(
        { id: "pi_test_success", status: "requires_confirmation", amount: 5000 },
        { status: 201 }
      );
    })
  );

  const paymentService = createPaymentClient();
  const result = await paymentService.createPayment(5000, { idempotencyKey: "retry-case" });
  expect(result).toEqual({
    id: "pi_test_success", status: "requires_confirmation", amount: 5000,
  });
  expect(callCount).toBe(3);
  expect(keys).toEqual(["retry-case", "retry-case", "retry-case"]);
});
```

Run the examples through your Vitest setup, or validate this repository's actual code
fences with `node --test --test-isolation=none tests/examples/msw.test.mjs`. The regression
uses real MSW and controlled HTTP requests, including a known successful response and an
unhandled request rejected before fallback. It validates the recipe and sample client,
not a live payment integration.

## Stateful auth flow — create / verify / refresh / revoke

A session lives in a `Map` keyed by access token. `POST /sessions` mints a token, `GET` verifies
it via the `Authorization: Bearer` header, `POST /sessions/refresh` rotates it, and `DELETE`
revokes it. Every handler has an error case (missing/invalid/expired token) so retry and re-auth
paths get exercised.

```typescript
// test/mocks/auth-handlers.ts
import { http, HttpResponse } from "msw";

type Session = { userId: string; expiresAt: number; refreshToken: string };

export function createAuthHandlers() {
  const sessions = new Map<string, Session>(); // accessToken -> session

  const tokenFrom = (req: Request) =>
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return [
    // Create session (login)
    http.post("https://api.example.com/sessions", async ({ request }) => {
      const { userId } = (await request.json()) as { userId: string };
      const accessToken = `at_${Date.now()}`;
      const refreshToken = `rt_${Date.now()}`;
      sessions.set(accessToken, { userId, expiresAt: Date.now() + 60_000, refreshToken });
      return HttpResponse.json({ accessToken, refreshToken }, { status: 201 });
    }),

    // Verify token
    http.get("https://api.example.com/sessions/me", ({ request }) => {
      const token = tokenFrom(request);
      const session = token && sessions.get(token);
      if (!session) {
        return HttpResponse.json({ error: "invalid_token" }, { status: 401 });
      }
      if (session.expiresAt < Date.now()) {
        return HttpResponse.json({ error: "token_expired" }, { status: 401 });
      }
      return HttpResponse.json({ userId: session.userId });
    }),

    // Refresh token
    http.post("https://api.example.com/sessions/refresh", async ({ request }) => {
      const { refreshToken } = (await request.json()) as { refreshToken: string };
      const entry = [...sessions.entries()].find(([, s]) => s.refreshToken === refreshToken);
      if (!entry) {
        return HttpResponse.json({ error: "invalid_refresh_token" }, { status: 401 });
      }
      sessions.delete(entry[0]); // rotate: old access token is invalidated
      const accessToken = `at_${Date.now()}`;
      sessions.set(accessToken, { ...entry[1], expiresAt: Date.now() + 60_000 });
      return HttpResponse.json({ accessToken });
    }),

    // Revoke session (logout)
    http.delete("https://api.example.com/sessions/me", ({ request }) => {
      const token = tokenFrom(request);
      if (!token || !sessions.delete(token)) {
        return HttpResponse.json({ error: "invalid_token" }, { status: 401 });
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
```
