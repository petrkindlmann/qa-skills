# Record-replay — capture real responses, replay deterministically

Record-replay captures real API responses once and replays them in tests. Useful for
bootstrapping stubs when integrating a new third-party API, or creating a regression baseline for
a multi-step interaction.

**Tooling.** Use a record-replay library rather than rolling your own: **Hoverfly** (capture →
simulate → modify → synthesize modes; language-agnostic proxy), **Polly.JS** (browser/Node), or
**VCR**-style cassettes (`vcrpy` in Python, `php-vcr`, etc.). MSW itself does not record — pair it
with Hoverfly's capture mode or write the cassette format below. Writing it yourself is the
expected path when no library is installed and no dependency may be added, or when the recorded
steps must include responses the UI never triggers (a 429 after five failed logins, a 409 on a
changed replay): a recorder of about forty lines over the test runner's request context, driving
the same scenario the fidelity check replays.

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

export function assertFresh(recordedAt: string, label = "Cassette") {
  const ageDays = (Date.now() - new Date(recordedAt).getTime()) / 86_400_000;
  // A missing or garbled stamp gives NaN, and `NaN > 30` is false: without this guard the
  // gate silently passes the cassette it exists to reject.
  if (!Number.isFinite(ageDays)) {
    throw new Error(`${label} has no usable recordedAt (${JSON.stringify(recordedAt)}). Re-record it.`);
  }
  if (ageDays > MAX_AGE_DAYS) {
    throw new Error(
      `${label} is ${Math.floor(ageDays)} days old (>${MAX_AGE_DAYS}). Re-record it.`
    );
  }
}
```

Prove the gate on broken input before trusting it: `assertFresh(undefined)` and a 31-day-old
stamp must throw, a 29-day-old stamp must not.

## Fidelity check against the live provider

Age says when a cassette was made; it does not say whether the provider still answers that way.
Where the live provider can be reached from the test environment (a local service, a sandbox),
add one test that replays every recorded request unrouted and compares the response **shape**,
never the values: status, media type, presence of the headers the client reads (`Retry-After`,
`Set-Cookie`), and a recursive type signature of the body (field names and primitive types,
arrays by their first element, an empty array as `"empty"`, an unparsable body as
`"unparsable"`). Report every drifted step, not the first. Keep the request scenario in one
module shared by the recorder and the check, so what was recorded is what is replayed. Prove
the comparator on broken input: a dropped field, a changed type, a changed status, an emptied
array and a non-JSON body must each produce one named difference. A drift check against an
OpenAPI document or a Pact (`references/wiremock.md`) is the alternative when the provider
cannot be reached.

## Replaying a multi-step interaction

Replay the recorded steps through MSW so the test drives the real client through the full
sequence (create order → add items → apply coupon → checkout). The expiry check runs first, so a
stale cassette fails the test instead of silently passing against a dead API shape. The example
below consumes steps by call order, which is right for a sequential client; a page that fires
two requests in parallel would receive each other's bodies, so key the steps by `METHOD /path`
(plus a body hash when one path has several recorded variants) for browser-driven replay.

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
