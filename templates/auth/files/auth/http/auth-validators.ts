/**
 * Request-body validators for the auth endpoints.
 *
 * Input is validated here and nowhere else: everything below `http/` is handed values that are
 * already the right shape, so the service and repository layers never re-check what a caller sent.
 *
 * Unknown keys are ignored rather than rejected, which is what you want at a public boundary: a
 * client that sends `rememberMe` gets an account, not a 400. The extra field still cannot reach the
 * service, because these functions build a fresh object and copy across only what they validated.
 */

import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
} from '../security/password-hasher__IMPORT_SUFFIX__';

import { asRecord, emailField, IssueCollector, requiredString } from './validate__IMPORT_SUFFIX__';

export interface SignupInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/**
 * The upper bound at the HTTP edge, which is larger than what bcrypt will accept.
 *
 * The two limits answer different questions. This one stops an unbounded string being copied and
 * scanned; `assertPasswordAcceptable` stops a password bcrypt would silently truncate. Rejecting an
 * 80-byte password here with "must be at most 72 bytes" would be the wrong message at the wrong
 * layer, so the length check that produces that message stays where the hashing rules live.
 */
const MAX_SUBMITTED_PASSWORD_LENGTH = 1024;

/**
 * Length is the only property enforced on a new password, and only the minimum.
 *
 * NIST SP 800-63B advises against composition rules — "must contain an uppercase letter, a digit and
 * a symbol" — because they do not buy the entropy they appear to. Users satisfy them with a small
 * set of predictable substitutions (`Password1!`, `Summer2025!`, `p@ssw0rd`) that every cracking
 * dictionary already models, while the rules push people towards shorter secrets and towards reusing
 * the one string that satisfies every site. A long lowercase passphrase beats anything a composition
 * rule produces, and rejecting it would be actively harmful.
 *
 * To raise the bar, screen candidates against a breached-password corpus. That is the control NIST
 * recommends instead, and it rejects `Password1!` on the evidence that it is already public rather
 * than on a guess about its shape.
 *
 * The upper bound is checked here too, so a client gets a field-level message rather than the
 * `WeakPasswordError` the hasher would raise later.
 */
export function validateSignup(body: unknown): SignupInput {
  const raw = asRecord(body);
  const issues = new IssueCollector();

  const email = emailField(raw['email'], 'email', issues);
  const password = newPassword(raw['password'], issues);

  issues.throwIfInvalid();

  // Non-null assertions would be wrong here: `throwIfInvalid` has already returned, so both values
  // are set, but nothing in the type system knows that. The explicit re-check costs one comparison
  // and keeps the file free of assertions that would silently become lies if a field were reordered.
  if (email === undefined || password === undefined) {
    throw new Error('validateSignup reached an unreachable state.');
  }

  return { email, password };
}

/**
 * Login deliberately does *not* apply the signup minimum.
 *
 * It is not a policy gate. An account whose password predates a raised minimum would be permanently
 * locked out by a 400 it cannot act on, and telling a caller their guess was "too short" answers a
 * question about the stored password that a 401 refuses to. A wrong password is a wrong password.
 */
export function validateLogin(body: unknown): LoginInput {
  const raw = asRecord(body);
  const issues = new IssueCollector();

  const email = emailField(raw['email'], 'email', issues);

  // No trim on any password field. Whitespace is a legal character in a passphrase, and trimming
  // would silently change the credential — accepting a password at signup that then fails to
  // authenticate, or worse, authenticating on a value the user did not type.
  const password = requiredString(raw['password'], 'password', issues, {
    maxLength: MAX_SUBMITTED_PASSWORD_LENGTH,
  });

  issues.throwIfInvalid();

  if (email === undefined || password === undefined) {
    throw new Error('validateLogin reached an unreachable state.');
  }

  return { email, password };
}

function newPassword(raw: unknown, issues: IssueCollector): string | undefined {
  const value = requiredString(raw, 'password', issues, {
    maxLength: MAX_SUBMITTED_PASSWORD_LENGTH,
  });

  if (value === undefined) {
    return undefined;
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    issues.add('password', `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
    return undefined;
  }

  // Counted in UTF-16 code units here, which can only over-estimate the byte length, so this never
  // rejects a password bcrypt would have accepted. The exact byte check lives in the hasher.
  if (value.length > MAX_PASSWORD_BYTES) {
    issues.add(
      'password',
      `Password must be at most ${String(MAX_PASSWORD_BYTES)} bytes long. ` +
        'Characters outside ASCII count as more than one byte.',
    );
    return undefined;
  }

  return value;
}
