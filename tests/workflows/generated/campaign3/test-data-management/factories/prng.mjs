// Seeded randomness and sequences for the factories. No Math.random anywhere in
// this folder: the same scope name and seed always yield the same data.

// FNV-1a 32-bit, used to turn a scope name into a seed.
export function hashSeed(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// mulberry32: small, fast, good enough for test data.
export function createPrng(seed) {
  const start = (seed >>> 0) || 0x9e3779b9;
  let state = start;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const prng = {
    seed: start,
    float: next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)); },
    pick(array) { return array[prng.int(0, array.length - 1)]; },
    hex(bytes) {
      let out = '';
      for (let i = 0; i < bytes; i++) out += prng.int(0, 255).toString(16).padStart(2, '0');
      return out;
    },
    // Independent stream per factory so adding a call in one factory does not
    // shift the values another factory produces.
    fork(label) { return createPrng((start ^ hashSeed(label)) >>> 0); },
  };
  return prng;
}

export function createSequence(start = 1) {
  let current = start - 1;
  return () => ++current;
}
