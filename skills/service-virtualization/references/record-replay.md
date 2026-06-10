# Record-replay — capture real responses, replay deterministically

Record-replay captures real API responses once and replays them in tests. Useful for
bootstrapping stubs when integrating a new third-party API, or creating a regression baseline for
a multi-step interaction.

**Tooling.** Use a record-replay library rather than rolling your own: **Hoverfly** (capture →
simulate → modify → synthesize modes; language-agnostic proxy), **Polly.JS** (browser/Node), or
**VCR**-style cassettes (`vcrpy` in Python, `php-vcr`, etc.). MSW itself does not record — pair it
with Hoverfly's capture mode or write the cassette format below.

**When it works:** bootstrapping initial stubs, regression baselines for stable response shapes.

**When it does NOT work:** APIs with dynamic data (timestamps, UUIDs), stateful sequences that
depend on prior writes, and long-term maintenance — recordings go stale within weeks. Always stamp
a `recordedAt` and fail the test when a recording is older than 30 days, forcing a re-record.

## Cassette format with expiry

```typescript
// test/cassettes/checkout-flow.json shape
// { "recordedAt": "2026-05-20T10:00:00Z", "steps": [ {request, response}, ... ] }

import cassette from "./cassettes/checkout-flow.json";

const MAX_AGE_DAYS = 30;

export function assertFresh(recordedAt: string) {
  const ageDays = (Date.now() - new Date(recordedAt).getTime()) / 86_400_000;
  if (ageDays > MAX_AGE_DAYS) {
    throw new Error(
      `Cassette is ${Math.floor(ageDays)} days old (>${MAX_AGE_DAYS}). Re-record it.`
    );
  }
}
```

## Replaying a multi-step interaction

Replay the recorded steps in order through MSW so the test drives the real client through the full
sequence (create order → add items → apply coupon → checkout). The expiry check runs first, so a
stale cassette fails the test instead of silently passing against a dead API shape.

```typescript
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import cassette from "./cassettes/checkout-flow.json";
import { assertFresh } from "./cassette-utils";

assertFresh(cassette.recordedAt); // fails the test if the recording is stale

let step = 0;
const server = setupServer(
  http.all("https://api.shop.example.com/*", () => {
    const recorded = cassette.steps[step++];
    return HttpResponse.json(recorded.response.body, { status: recorded.response.status });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

it("replays the recorded checkout flow", async () => {
  const order = await api.createOrder();          // step 0
  await api.addItem(order.id, "sku-1");           // step 1
  await api.applyCoupon(order.id, "SAVE10");      // step 2
  const receipt = await api.checkout(order.id);   // step 3
  expect(receipt.status).toBe("paid");
  expect(step).toBe(cassette.steps.length);       // every recorded step was consumed
});
```
