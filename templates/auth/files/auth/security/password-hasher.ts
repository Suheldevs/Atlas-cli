/**
 * The password hashing seam, and the policy every password has to satisfy before it is hashed.
 *
 * The interface stays even though `bcrypt-hasher.ts` is the only implementation shipped: it is
 * what lets a test install a fast stub instead of paying bcrypt's cost per fixture, and it keeps
 * the auth service from importing a specific algorithm.
 */

import { WeakPasswordError } from '../domain/auth-errors__IMPORT_SUFFIX__';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, storedHash: string): Promise<boolean>;
  /** True when the stored hash used a lower cost factor than the current config. */
  needsRehash(storedHash: string): boolean;
}

/**
 * Length, not composition rules. Character-class requirements push people towards `Passw0rd!`
 * and are no longer recommended (NIST SP 800-63B); length is the term that actually dominates
 * the search space.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * 72 **bytes**, because that is bcrypt's hard limit and it is not a guideline.
 *
 * bcrypt hashes only the first 72 bytes of its input and discards the rest without complaint. A
 * password longer than that would authenticate against any other password sharing its first 72
 * bytes, so `hunter2…<60 more bytes>…AAAA` and the same prefix followed by `BBBB` become the same
 * credential. Rejecting the input is the only honest response: silently truncating stores a
 * secret that is not the one the user chose, and there is no way to tell them later.
 *
 * UTF-8, so a multi-byte character costs more than one. An emoji is four.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * Throws `WeakPasswordError` for a password this application will not store.
 *
 * The password itself is never trimmed. Leading and trailing whitespace a user typed on purpose
 * is part of the secret; silently stripping it would make two different passwords hash alike.
 */
export function assertPasswordAcceptable(password: string): void {
  // Byte length is checked against a cheap upper bound on the character count first, so a
  // megabyte-long body is rejected by one comparison rather than by encoding all of it. UTF-8
  // never uses more than four bytes per UTF-16 code unit.
  if (password.length > MAX_PASSWORD_BYTES || byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new WeakPasswordError(
      `Password must be at most ${MAX_PASSWORD_BYTES} bytes long. ` +
        'Characters outside ASCII count as more than one byte.',
    );
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    );
  }

  if (password.trim().length === 0) {
    throw new WeakPasswordError('Password must contain at least one non-whitespace character.');
  }
}

/**
 * UTF-8 byte length without allocating a Buffer.
 *
 * `Buffer.byteLength` would do the same, but this keeps the module free of Node built-ins so the
 * password policy can also run in a browser-side form validator sharing the same rules.
 */
function byteLength(value: string): number {
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
