/**
 * bcrypt password hashing, and the policy every password has to satisfy before it is hashed.
 *
 * bcryptjs rather than the native `bcrypt` package: it is pure JavaScript, so it installs on any
 * machine without a compiler and cannot break a deploy because a prebuilt binary is missing for the
 * runtime. The trade-off is speed — pure JS is several times slower than the native binding at the
 * same cost factor, which is why the default cost is 10 and not 12. Raising it costs login latency
 * on every request, so measure before changing it.
 *
 * The hasher is built through a factory rather than exported as a bare object so a test can install
 * a fast stub in place of it — `createAuthService({ hasher })` — instead of paying bcrypt's cost per
 * fixture. Any object with `hash`, `verify` and `needsRehash` will do.
 */

import { compare, getRounds, hash, truncates } from 'bcryptjs';

import { authConfig } from '../config/auth-config__IMPORT_SUFFIX__';
import { WeakPasswordError } from '../domain/auth-errors__IMPORT_SUFFIX__';

/**
 * The password-hashing seam.
 *
 * @typedef {object} PasswordHasher
 * @property {(password: string) => Promise<string>} hash
 * @property {(password: string, storedHash: string) => Promise<boolean>} verify
 * @property {(storedHash: string) => boolean} needsRehash True when the stored hash used a lower
 *   cost factor than the current config.
 */

/**
 * Length, not composition rules.
 *
 * NIST SP 800-63B advises against "must contain an uppercase letter, a digit and a symbol", because
 * those rules do not buy the entropy they appear to: users satisfy them with a small set of
 * predictable substitutions (`Password1!`, `Summer2025!`, `p@ssw0rd`) that every cracking dictionary
 * already models, while the rules push people towards shorter secrets and towards reusing the one
 * string that satisfies every site. Length is the term that actually dominates the search space.
 *
 * To raise the bar, screen candidates against a breached-password corpus. That is the control NIST
 * recommends instead, and it rejects `Password1!` on the evidence that it is already public rather
 * than on a guess about its shape.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * 72 **bytes**, because that is bcrypt's hard limit and it is not a guideline.
 *
 * bcrypt hashes only the first 72 bytes of its input and discards the rest without complaint. A
 * password longer than that would authenticate against any other password sharing its first 72
 * bytes, so `hunter2…<60 more bytes>…AAAA` and the same prefix followed by `BBBB` become the same
 * credential. Rejecting the input is the only honest response: silently truncating stores a secret
 * that is not the one the user chose, and there is no way to tell them later.
 *
 * UTF-8, so a multi-byte character costs more than one. An emoji is four.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * UTF-8 byte length without allocating a Buffer.
 *
 * `Buffer.byteLength` would do the same, but this keeps the module free of Node built-ins so the
 * password policy can also run in a browser-side form validator sharing the same rules.
 *
 * @param {string} value
 * @returns {number}
 */
function byteLength(value) {
  let bytes = 0;

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }

  return bytes;
}

/**
 * Throws `WeakPasswordError` for a password this application will not store.
 *
 * The last line of defence rather than the first: `validateSignup` applies the same bounds at the
 * HTTP edge and reports them as field-level issues. This exists because the service must not depend
 * on having been called through a validated route — a seed script, an admin tool or a future
 * password-reset flow reaches `signup` directly, and the 72-byte rule is not optional for any of
 * them.
 *
 * The password itself is never trimmed. Leading and trailing whitespace a user typed on purpose is
 * part of the secret; silently stripping it would make two different passwords hash alike. Nor does
 * any message here echo the password back.
 *
 * @param {string} password
 * @returns {void}
 */
export function assertPasswordAcceptable(password) {
  // Byte length is checked against a cheap upper bound on the character count first, so a
  // megabyte-long body is rejected by one comparison rather than by encoding all of it. UTF-8 never
  // uses more than four bytes per UTF-16 code unit.
  if (password.length > MAX_PASSWORD_BYTES || byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new WeakPasswordError(
      `Password must be at most ${MAX_PASSWORD_BYTES} bytes long. ` +
        'Characters outside ASCII count as more than one byte',
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }

  if (password.trim().length === 0) {
    throw new WeakPasswordError('Password must contain at least one non-whitespace character');
  }
}

/**
 * @param {import('../config/auth-config__IMPORT_SUFFIX__').AuthConfig} [config]
 * @returns {PasswordHasher}
 */
export function createBcryptHasher(config = authConfig) {
  return {
    async hash(password) {
      // `assertPasswordAcceptable` already rejects anything over 72 bytes, so reaching this is a
      // programming error — some other call path hashed a password without checking it first. Asked
      // of the library rather than recomputed, because bcryptjs owns the definition of where its
      // own limit falls.
      if (truncates(password)) {
        throw new WeakPasswordError(
          'Password exceeds the 72 bytes bcrypt can hash and would be silently truncated',
        );
      }

      return hash(password, config.bcryptRounds);
    },

    async verify(password, storedHash) {
      try {
        return await compare(password, storedHash);
      } catch {
        // A malformed hash — a truncated column, a row written by a different scheme, an empty
        // string — makes bcryptjs throw. That is a failed verification, not a server error: the
        // caller gets the same "invalid credentials" it would get for a wrong password, and the bad
        // row shows up in the logs of whatever wrote it.
        //
        // Note the asymmetry this creates and why the login path compensates for it. Throwing
        // returns *faster* than a real comparison, so a code path that reached this branch on one
        // input and did the real work on another would leak the difference in its response time.
        // See TIMING_DECOY_HASH in the auth service.
        return false;
      }
    },

    needsRehash(storedHash) {
      try {
        return getRounds(storedHash) < config.bcryptRounds;
      } catch {
        // Unreadable cost factor. Treated as needing a rehash so the next successful login replaces
        // the row with one this application can actually reason about.
        return true;
      }
    },
  };
}

/** @type {PasswordHasher} */
export const bcryptHasher = createBcryptHasher();
