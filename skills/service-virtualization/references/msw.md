# MSW (Mock Service Worker) — handlers, setup, and stateful flows

MSW 2.x intercepts HTTP at the network layer (Service Worker in the browser, request
interception in Node). Stub at the HTTP layer (`POST /v1/payment_intents`), never at the
SDK method — that decouples the test from the SDK version.

```bash
npm i -D msw
```

## Centralized handlers with realistic behavior

Keep a single source of truth for response shapes. The Stripe `payment_intents` shape below
(`id`, `status`, `amount`) is reused verbatim by every handler and override in the suite — do
not let two tests model the same endpoint with different field names.

```typescript
// test/mocks/handlers.ts
import { http, HttpResponse, delay } from "msw";

// Stateful handler: maintains state across requests within a test
function createPaymentHandlers() {
  const payments = new Map<string, { id: string; status: string; amount: number }>();

  return [
    // Create payment
    http.post("https://api.stripe.com/v1/payment_intents", async ({ request }) => {
      const body = await request.text();
      const params = new URLSearchParams(body);

      const id = `pi_test_${Date.now()}`;
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
const errorHandlers = [
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

export const handlers = [...createPaymentHandlers(), ...errorHandlers];
```

## Test setup (Vitest) — enforce no real calls escape

`onUnhandledRequest: "error"` is the enforcement seam. In CI it must be `error` so any request
that escapes the stubs fails the run; locally you may use `"warn"` while iterating.

```typescript
// vitest.setup.ts
import { setupServer } from "msw/node";
import { handlers } from "./mocks/handlers";

export const server = setupServer(...handlers);

const mode = process.env.CI ? "error" : "warn";
beforeAll(() => server.listen({ onUnhandledRequest: mode }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Per-test overrides — timeout and retry

```typescript
import { http, HttpResponse, delay } from "msw";
import { server } from "../vitest.setup";

it("should handle payment API timeout", async () => {
  server.use(
    http.post("https://api.stripe.com/v1/payment_intents", async () => {
      await delay(10_000); // Simulate timeout — use MSW delay, not a raw setTimeout
      return HttpResponse.json({});
    })
  );
  await expect(paymentService.createPayment(5000)).rejects.toThrow("Payment service timeout");
});

it("should retry on 503", async () => {
  let callCount = 0;
  server.use(
    http.post("https://api.stripe.com/v1/payment_intents", async () => {
      callCount++;
      if (callCount < 3) {
        return HttpResponse.json({ error: "Service unavailable" }, { status: 503 });
      }
      // Same shape as the create handler above: id, status, amount
      return HttpResponse.json(
        { id: "pi_test_success", status: "requires_confirmation", amount: 5000 },
        { status: 201 }
      );
    })
  );

  const result = await paymentService.createPayment(5000);
  expect(result.id).toBe("pi_test_success");
  expect(callCount).toBe(3);
});
```

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
