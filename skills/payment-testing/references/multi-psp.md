# Multi-PSP sandbox testing: Adyen, PayPal, Braintree

The trap: assuming Stripe test cards work across other PSPs. They do not. Each PSP ships
its own sandbox cards and its own sandbox buyer accounts. Generalize the *pattern*, never
the literal Stripe numbers. Verify each PSP's current list at its docs before use.

## What stays the same vs Stripe

| Concept | Stripe | General pattern (all PSPs) |
|---------|--------|----------------------------|
| Test mode isolation | `pk_test_`/`sk_test_` | Every PSP has separate sandbox/test credentials — never live keys |
| Triggering outcomes | Specific PANs | Either specific sandbox PANs **or** magic amounts (PSP-dependent) |
| Async confirmation | webhooks (`payment_intent.succeeded`) | webhooks / notifications — fulfill on the verified server event, never the redirect |
| No real cards | mandatory | mandatory everywhere — PCI applies to all |
| Local event delivery | `stripe listen` | PSP-specific (Adyen CLI / dashboard replay; PayPal webhook simulator) |

## Adyen

- Test cards are **different** from Stripe's, e.g. `4212 3456 7891 0014` for the 3DS2
  challenge flow. Use Adyen's own list.
- Many decline outcomes are driven by the **transaction amount**, not the card: amounts
  ending `.13` → refused, `.51` → referral. So the same test card can succeed or decline
  depending on amount.
- Events arrive as Adyen **notifications** (webhooks); verify the HMAC signature, not a
  Stripe signature.

## PayPal

- Use **sandbox buyer accounts** (a sandbox personal account email + password) to log in
  and approve, not card numbers. Create them in the PayPal Developer Dashboard.
- For PayPal-via-card testing, pick a sandbox test card and put a rejection trigger in the
  cardholder **name** field.
- Confirm payment server-side via the Orders API / webhooks; never fulfill on the
  client-side `onApprove` callback alone.

## Braintree (a PayPal company)

- Sandbox accepts only **specific Braintree test card numbers** (its own list, not
  Stripe's). Integrations use **Drop-in UI** or **Hosted Fields**.
- Transaction success vs decline is driven by the **test amount**; card verification
  (Vault, recurring) is driven by the **card number**.
- Has its own 3DS testing cards and flows distinct from Stripe's.

## Rule of thumb

When adding a PSP: find that PSP's sandbox credentials, its sandbox cards/buyer accounts,
and its event/notification mechanism. Port the *structure* of your Stripe tests
(happy path, decline, 3DS, webhook reconciliation) but swap in that PSP's sandbox values.
Never reuse Stripe PANs or live keys.
