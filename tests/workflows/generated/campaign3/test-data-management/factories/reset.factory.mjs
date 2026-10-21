import { createSequence } from './prng.mjs';

export const RESET_SUBJECT = 'Reset your Shop password';
export const RESET_LINK = /\/reset-password\?token=([A-Za-z0-9._~-]+)/;

export function resetFactory({ scope, prng }) {
  const nextSequence = createSequence();

  // build({ user, overrides }) -> the data one reset round trip needs: which
  // inbox to read, which password to set, what the Shop must answer.
  function build({ user, overrides = {} }) {
    const sequence = nextSequence();
    const newPassword = overrides.newPassword ?? `Reset-${sequence}-${prng.hex(6)}!`; // 21 chars, above the 12 minimum
    return {
      sequence,
      scope,
      userId: user.id,
      email: overrides.email ?? user.email,
      currentPassword: user.password,
      newPassword,
      subject: RESET_SUBJECT,
      linkPattern: RESET_LINK,
      expected: { request: 202, confirm: { reset: true } },
    };
  }

  // Eleven characters: one below the limit.
  function tooShort(built) {
    return { ...built, newPassword: 'Short-12345', expected: { ...built.expected, confirm: { rejected: true } } };
  }

  return { build, tooShort };
}
