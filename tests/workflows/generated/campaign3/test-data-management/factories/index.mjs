import { createPrng, hashSeed } from './prng.mjs';
import { orderFactory } from './order.factory.mjs';
import { paymentEventFactory } from './payment.factory.mjs';
import { resetFactory } from './reset.factory.mjs';

export { ITEMS, canonicalItems } from './order.factory.mjs';
export { catalogue, catalogueView, unitAmount } from './catalogue.mjs';
export { signBody, SIGNATURE_HEADER } from './payment.factory.mjs';
export { RESET_SUBJECT, RESET_LINK } from './reset.factory.mjs';
export { createPrng, hashSeed } from './prng.mjs';

// Idempotency keys and event ids carry the scope name, so it must fit the
// Shop's key alphabet (letters, digits, dot, underscore, colon, hyphen).
export function sanitiseScope(name) {
  const clean = String(name).replace(/[^A-Za-z0-9._:-]/g, '-').replace(/-+/g, '-');
  return clean.slice(0, 80) || 'default';
}

// One factory set per scope. The seed defaults to a hash of the scope name,
// so two tests with different names get different data and the same test
// gets the same data on every run. Pass seed explicitly to pin or vary it.
export function createFactories({ scope = 'default', seed, secret = 'local-payment-secret' } = {}) {
  const name = sanitiseScope(scope);
  const root = createPrng(seed ?? hashSeed(name));
  return {
    scope: name,
    seed: root.seed,
    order: orderFactory({ scope: name, prng: root.fork('order') }),
    payment: paymentEventFactory({ scope: name, secret, prng: root.fork('payment') }),
    reset: resetFactory({ scope: name, prng: root.fork('reset') }),
  };
}
