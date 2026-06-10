# Determinism recipes

A reproduction that depends on the wall clock, an unseeded RNG, or a live third-party
call is not a reproduction — it is a coin flip. Pin all three: **time, randomness,
network**. The bug must fail the same way on every run, on every machine.

## Vitest unit / integration repro

The bug: an order total goes wrong only around midnight, when a random discount code is
generated, and when the third-party pricing API returns a particular shape. Freeze the
clock with `vi.useFakeTimers` + `vi.setSystemTime`, seed the RNG with `faker.seed`, and
stub the pricing call with an MSW `setupServer`.

```ts
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { faker } from '@faker-js/faker'
import { computeOrderTotal } from '../src/checkout'

// 1. NETWORK — stub the third-party pricing API. No live calls during the repro.
const server = setupServer(
  http.get('https://pricing.vendor.example/quote', () =>
    HttpResponse.json({ unitPrice: 1000, currency: 'USD', taxRate: 0.0825 }),
  ),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })) // fail loudly on a missed stub
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  // 2. TIME — freeze the system clock at the failing instant (just after midnight UTC).
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-15T00:00:03.000Z'))
  // 3. RANDOMNESS — seed faker so the "random" discount code is identical every run.
  faker.seed(1337)
})

afterEach(() => {
  vi.useRealTimers()
})

it('computes the wrong total just after midnight with the seeded discount code', async () => {
  const discountCode = faker.string.alphanumeric(8) // deterministic now that faker is seeded
  const total = await computeOrderTotal({ qty: 3, discountCode })
  // Assert the REAL expected value. This is red until the bug is fixed.
  expect(total).toBe(2754) // 3 * 1000 * (1 - discount) * (1 + tax), rounded
})
```

Notes:
- `vi.setSystemTime` only takes effect after `vi.useFakeTimers()`. Order matters.
- `onUnhandledRequest: 'error'` turns any un-stubbed network call into a test failure, so
  you cannot accidentally hit the live API.
- Reset faker's seed in `beforeEach`, not once at the top — otherwise test order leaks
  state between cases.

### If randomness comes from `Math.random` rather than faker

Stub it deterministically instead of leaving it live:

```ts
vi.spyOn(Math, 'random').mockReturnValue(0.42) // or a small scripted sequence
```

**Avoid:** `jest.useFakeTimers('legacy')` (and the `timers: 'legacy'` config) — legacy fake
timers are deprecated and do **not** mock `Date`/`Date.now`, so the system clock stays live
and your "frozen" time still drifts. Modern timers are the default since Jest 27. Use
`vi.useFakeTimers()` (Vitest) or `jest.useFakeTimers()` + `jest.setSystemTime()` (Jest 30+).

## Playwright end-to-end repro

Same midnight / random-discount / live-pricing bug, reproduced through the browser flow.
Freeze the browser clock with `page.clock`, stub the pricing XHR with `page.route`.

```ts
import { expect, test } from '@playwright/test'

test('checkout total is wrong just after midnight', async ({ page }) => {
  // 1. TIME — install and pin the page clock BEFORE navigation so app startup sees it.
  await page.clock.install({ time: new Date('2026-03-15T00:00:03.000Z') })
  await page.clock.setFixedTime(new Date('2026-03-15T00:00:03.000Z'))

  // 2. NETWORK — fulfill the pricing request from a fixed fixture; never hit the live endpoint.
  await page.route('**/pricing.vendor.example/quote*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unitPrice: 1000, currency: 'USD', taxRate: 0.0825 }),
    }),
  )

  // 3. RANDOMNESS — pin the app's RNG seed via the hook the app exposes (query param,
  //    localStorage, or an injected init script). Example with addInitScript:
  await page.addInitScript(() => {
    // @ts-expect-error test-only deterministic seed hook
    window.__TEST_DISCOUNT_SEED__ = 1337
  })

  await page.goto('/checkout?qty=3')
  await expect(page.getByTestId('order-total')).toHaveText('$27.54') // real expected value
})
```

Notes:
- `page.clock.install({ time })` must run before `page.goto`/any clock call, or behaviour
  is undefined. `setFixedTime` locks `Date.now()`/`new Date()` and stops timers — right for
  date-sensitive UI. Use `setSystemTime` instead when intervals must still advance.
- `page.route` glob `**` matches any leading path; pass `*` after the path to catch query
  strings.
- These replace the wrong instincts: do **not** `page.waitForTimeout(...)` to "wait for
  midnight," do **not** bump the test timeout, and do **not** let the test hit the live
  pricing endpoint. `page.clock` exists and is the supported API — do not fall back to a
  hand-rolled `Date` override.

## Determinism checklist (carry into the ticket)

- [ ] Time frozen — exact instant recorded (`2026-03-15T00:00:03Z`).
- [ ] RNG seeded — seed value recorded (`faker.seed(1337)` / `Math.random` stub).
- [ ] Network stubbed — every external call fulfilled from a fixture; un-stubbed calls error.
- [ ] Locale/timezone/currency pinned if the bug is locale-sensitive (`TZ=UTC`, `LANG`).
- [ ] Test passes/fails identically across 10 consecutive runs (`--repeat-each 10`).
