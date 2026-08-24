/**
 * bcrypt password hashing.
 *
 * bcryptjs rather than the native `bcrypt` package: it is pure JavaScript, so it installs on any
 * machine without a compiler and cannot break a deploy because a prebuilt binary is missing for
 * the runtime. The trade-off is speed — pure JS is several times slower than the native binding at
 * the same cost factor, which is why the default below is 10 and not 12. Raising it costs login
 * latency on every request, so measure before changing it.
 */

import { compare, getRounds, hash, truncates } from 'bcryptjs';

import { authConfig, type AuthConfig } from '../config/auth-config__IMPORT_SUFFIX__';
import { WeakPasswordError } from '../domain/auth-errors__IMPORT_SUFFIX__';

import { type PasswordHasher } from './password-hasher__IMPORT_SUFFIX__';

export function createBcryptHasher(config: AuthConfig = authConfig): PasswordHasher {
  return {
    async hash(password: string): Promise<string> {
      // `assertPasswordAcceptable` already rejects anything over 72 bytes, so reaching this is a
      // programming error — some other call path hashed a password without checking it first.
      // Asked of the library rather than recomputed, because bcryptjs owns the definition of where
      // its own limit falls.
      if (truncates(password)) {
        throw new WeakPasswordError(
          'Password exceeds the 72 bytes bcrypt can hash and would be silently truncated.',
        );
      }

      return hash(password, config.bcryptRounds);
    },

    async verify(password: string, storedHash: string): Promise<boolean> {
      try {
        return await compare(password, storedHash);
      } catch {
        // A malformed hash — a truncated column, a row written by a different scheme, an empty
        // string — makes bcryptjs throw. That is a failed verification, not a server error: the
        // caller gets the same "invalid credentials" it would get for a wrong password, and the
        // bad row shows up in the logs of whatever wrote it.
        return false;
      }
    },

    needsRehash(storedHash: string): boolean {
      try {
        return getRounds(storedHash) < config.bcryptRounds;
      } catch {
        // Unreadable cost factor. Treated as needing a rehash so the next successful login
        // replaces the row with one this application can actually reason about.
        return true;
      }
    },
  };
}

export const bcryptHasher: PasswordHasher = createBcryptHasher();
