# External Dependency Stubbing — MSW Handlers

The stubbing strategy table, the contract-testing pointer, and the "stub at the HTTP boundary"
principle live in `SKILL.md`. This file holds the runnable MSW handlers and the server
lifecycle wiring. MinIO and the S3 client config live in `references/docker-compose.md`.

## MSW Handlers for External APIs

Stub at the HTTP boundary — the outbound URLs your system actually calls — not internal
service classes. MSW 2.x: import `http` and `HttpResponse` from `msw`, `setupServer` from
`msw/node`. Read the request so the stub responds to the actual input, not a fixed blob.

```typescript
// test/mocks/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  // Stripe: create payment intent
  http.post("https://api.stripe.com/v1/payment_intents", async ({ request }) => {
    const body = await request.text();
    const params = new URLSearchParams(body);
    const amount = params.get("amount");

    return HttpResponse.json({
      id: "pi_test_" + Date.now(),
      amount: Number(amount),
      currency: params.get("currency") ?? "usd",
      status: "requires_payment_method",
      client_secret: "pi_test_secret_" + Date.now(),
    });
  }),

  // SendGrid: send email
  http.post("https://api.sendgrid.com/v3/mail/send", () => {
    return HttpResponse.json({ message: "success" }, { status: 202 });
  }),

  // Geocoding API
  http.get("https://maps.googleapis.com/maps/api/geocode/json", ({ request }) => {
    const url = new URL(request.url);
    const address = url.searchParams.get("address");

    return HttpResponse.json({
      results: [{
        formatted_address: address,
        geometry: { location: { lat: 40.7128, lng: -74.006 } },
      }],
      status: "OK",
    });
  }),
];
```

## Server Lifecycle

```typescript
// test/mocks/setup.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);

// In vitest.setup.ts or jest.setup.ts:
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Setting `onUnhandledRequest: "error"` makes tests fail loudly if they hit an unmocked external
API — no silent network calls leaking into test runs. Without it, a forgotten stub turns into
a real outbound request that may pass in CI today and flake tomorrow.
