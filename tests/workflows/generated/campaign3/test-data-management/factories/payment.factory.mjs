import { createHmac } from 'node:crypto';
import { createSequence } from './prng.mjs';

export const SIGNATURE_HEADER = 'X-Test-Payment-Signature';

export function signBody(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function envelope(event, body, signature, expected) {
  const headers = { 'content-type': 'application/json' };
  if (signature) headers[SIGNATURE_HEADER] = signature;
  // body is the exact string that was signed; send it as a string, never re-serialise.
  return { event, body, signature, headers, expected };
}

export function paymentEventFactory({ scope, secret, prng }) {
  const nextSequence = createSequence();

  // build({ order, overrides }) -> a signed envelope for payment.succeeded on that order.
  // overrides: id, type, order_id, currency, amount. A valid signature over a
  // mismatched amount is a distinct case (422), so amount overrides stay signed.
  function build({ order, overrides = {} }) {
    const sequence = nextSequence();
    const event = {
      id: overrides.id ?? `evt-${scope}-${sequence}`,
      type: overrides.type ?? 'payment.succeeded',
      data: {
        order_id: overrides.order_id ?? order.id,
        currency: overrides.currency ?? order.currency,
        amount: overrides.amount ?? order.amount,
      },
    };
    const body = JSON.stringify(event);
    return { sequence, ...envelope(event, body, signBody(body, secret), { received: true, duplicate: false, order_id: event.data.order_id }) };
  }

  // Body changed after signing; the stale signature must be refused.
  function tampered(signed, patch = { amount: signed.event.data.amount + 1 }) {
    const event = { ...signed.event, data: { ...signed.event.data, ...patch } };
    return { ...envelope(event, JSON.stringify(event), signed.signature, { rejected: 'invalid_signature' }), sequence: signed.sequence, tampered: patch };
  }

  // Same bytes, signed with a secret the Shop does not know.
  function resigned(signed, otherSecret) {
    return { ...envelope(signed.event, signed.body, signBody(signed.body, otherSecret), { rejected: 'invalid_signature' }), sequence: signed.sequence };
  }

  // Same bytes, no signature header at all.
  function unsigned(signed) {
    return { ...envelope(signed.event, signed.body, null, { rejected: 'invalid_signature' }), sequence: signed.sequence };
  }

  return { build, tampered, resigned, unsigned, sign: body => signBody(body, secret) };
}
