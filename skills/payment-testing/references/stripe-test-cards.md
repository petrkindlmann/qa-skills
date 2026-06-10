# Stripe test cards and outcome assertions

All cards below work **only** in test mode (keys `pk_test_…` / `sk_test_…`). Using a real
PAN in any mode is a Services Agreement violation — see the PCI section in `SKILL.md`.
Verify the live list at https://docs.stripe.com/testing before relying on a number.

## Card catalogue

| PAN | Outcome | decline_code / failure_code | Use for |
|-----|---------|-----------------------------|---------|
| `4242424242424242` | Succeeds, no auth | — | Happy path Visa |
| `4000000000000002` | Declined at charge | `card_declined` (generic_decline) | Generic decline path |
| `4000000000009995` | Declined at charge | `insufficient_funds` | Insufficient-funds path |
| `4000000000009987` | Declined at charge | `lost_card` | Lost-card path |
| `4000000000000069` | Declined at charge | `expired_card` | Expired-card path |
| `4000000000000127` | Declined at charge | `incorrect_cvc` | Bad-CVC path |
| `4000000000003220` | 3DS **always** challenges | — | 3DS/SCA challenge flow |
| `4000002760003184` | 3DS required, succeeds after auth | — | SCA on first use |
| `4000000000000341` | **Attaches** to customer, **fails on later charge** | `card_declined` | Failed recurring renewal |

`4000000000000341` is the one bare agents miss: cards that decline at *attach* time
cannot be saved to a Customer, so you cannot use them to test a renewal that fails
*after* the card is on file. This card attaches cleanly and only fails when the
subscription invoice tries to charge it — exactly the dunning scenario.

## Never use these

- `4111111111111111` — a generic Luhn-valid PAN from the Braintree/PayPal era. **Not a
  Stripe test card.** It does not deterministically decline; do not reach for it.
- Any real card number, even "your own, just this once," even in CI only.

## Playwright: assert the right outcome per card

The card field lives in a cross-origin Stripe iframe — use `frameLocator`, never
`page.locator` directly (see `playwright-3ds.md`). This helper fills the Payment Element
and submits.

```ts
import { test, expect, Page } from '@playwright/test';

// Stripe keys in the app under test must be pk_test_… — assert that in setup, never pk_live_.
async function fillCard(page: Page, pan: string) {
  const card = page.frameLocator('iframe[name^="__privateStripeFrame"]');
  await card.getByPlaceholder('Card number').fill(pan);
  await card.getByPlaceholder('MM / YY').fill('12 / 34');
  await card.getByPlaceholder('CVC').fill('123');
  await card.getByPlaceholder('ZIP').fill('42424');
  await page.getByRole('button', { name: /pay/i }).click();
}

test('successful Visa payment', async ({ page }) => {
  await page.goto('/checkout');
  await fillCard(page, '4242424242424242');
  await expect(page).toHaveURL(/\/success/);
  await expect(page.getByText(/payment succeeded/i)).toBeVisible();
});

test('card_declined surfaces a decline message', async ({ page }) => {
  await page.goto('/checkout');
  await fillCard(page, '4000000000000002');
  // generic_decline → "Your card was declined."
  await expect(page.getByText(/your card was declined/i)).toBeVisible();
  await expect(page).not.toHaveURL(/\/success/);
});

test('insufficient_funds surfaces the specific message', async ({ page }) => {
  await page.goto('/checkout');
  await fillCard(page, '4000000000009995');
  await expect(page.getByText(/insufficient funds/i)).toBeVisible();
});
```

Driving by status code instead of UI copy is more robust — assert on the
`PaymentIntent.last_payment_error.decline_code` retrieved server-side
(`paymentIntents.retrieve(id)` → `card_declined` / `insufficient_funds`) rather than on
localized text when copy is volatile.
