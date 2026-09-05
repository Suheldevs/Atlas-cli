/**
 * Request-body validators for the auth endpoints.
 *
 * Input is validated here and nowhere else: everything below `http/` is handed values that are
 * already the right shape, so the service and repository layers never re-check what a caller sent.
 *
 * Unknown keys are ignored rather than rejected, which is what you want at a public boundary: a
 * client that sends `rememberMe` gets an account, not a 400. The extra field still cannot reach the
 * service, because these functions build a fresh object and copy across only what they validated.
 *
 * That last sentence is the security-relevant one. A `role` key in a signup body is read by nothing
 * here, so it cannot reach `users.create` — signup always produces a `user`, and the only way to get
 * an admin is to promote one directly in the database.
 *
 * Neither function throws. Both return `{ ok: true, value }` or `{ ok: false, errors }`; the
 * controller is what turns the second into a 400.
 */

import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
} from '../security/bcrypt-hasher__IMPORT_SUFFIX__';

import { asRecord, emailField, fail, IssueCollector, ok, requiredString } from './validate__IMPORT_SUFFIX__';

/**
 * @typedef {object} SignupInput
 * @property {string} name
 * @property {string} email
 * @property {string} password
 */

/**
 * @typedef {object} LoginInput
 * @property {string} email
 * @property {string} password
 */

/**
 * The upper bound at the HTTP edge, which is larger than what bcrypt will accept.
 *
 * The two limits answer different questions. This one stops an unbounded string being copied and
 * scanned; `assertPasswordAcceptable` stops a password bcrypt would silently truncate. Rejecting an
 * 80-byte password here with "must be at most 72 bytes" would be the wrong message at the wrong
 * layer, so the length check that produces that message stays where the hashing rules live.
 */
const MAX_SUBMITTED_PASSWORD_LENGTH = 1024;

/** Long enough for any real name, short enough that it cannot be used as a storage field. */
const MAX_NAME_LENGTH = 120;

/**
 * Length is the only property enforced on a new password, and only the minimum.
 *
 * NIST SP 800-63B advises against composition rules — "must contain an uppercase letter, a digit and
 * a symbol" — because they do not buy the entropy they appear to. See the note on
 * `MIN_PASSWORD_LENGTH` in `security/bcrypt-hasher.js` for the full reasoning.
 *
 * The upper bound is checked here too, so a client gets a field-level message rather than the
 * `WeakPasswordError` the hasher would raise later.
 *
 * @param {unknown} raw
 * @param {IssueCollector} issues
 * @returns {string | undefined}
 */
function newPassword(raw, issues) {
  const value = requiredString(raw, 'password', issues, {
    maxLength: MAX_SUBMITTED_PASSWORD_LENGTH,
  });

  if (value === undefined) {
    return undefined;
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    issues.add('password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    return undefined;
  }

  // Counted in UTF-16 code units here, which can only over-estimate the byte length, so this never
  // rejects a password bcrypt would have accepted. The exact byte check lives in the hasher.
  if (value.length > MAX_PASSWORD_BYTES) {
    issues.add(
      'password',
      `Password must be at most ${MAX_PASSWORD_BYTES} bytes long. ` +
        'Characters outside ASCII count as more than one byte',
    );
    return undefined;
  }

  return value;
}

/**
 * @param {unknown} body
 * @returns {import('./validate__IMPORT_SUFFIX__').ValidationResult<SignupInput>}
 */
export function validateSignup(body) {
  const raw = asRecord(body);

  if (raw === undefined) {
    return fail('', 'Expected a JSON object body');
  }

  const issues = new IssueCollector();

  const name = requiredString(raw.name, 'name', issues, { maxLength: MAX_NAME_LENGTH, trim: true });
  const email = emailField(raw.email, 'email', issues);
  const password = newPassword(raw.password, issues);

  // Checked as a set rather than with three non-null assertions: every field was either produced or
  // recorded an issue, so `valid` and "all three defined" are the same condition — but only one of
  // them is enforced by code that runs.
  if (!issues.valid || name === undefined || email === undefined || password === undefined) {
    return issues.toResult();
  }

  // A fresh object. Nothing from `raw` reaches the service except the three fields above — most
  // importantly not `role`.
  return ok({ name, email, password });
}

/**
 * Login deliberately does *not* apply the signup minimum.
 *
 * It is not a policy gate. An account whose password predates a raised minimum would be permanently
 * locked out by a 400 it cannot act on, and telling a caller their guess was "too short" answers a
 * question about the stored password that a 401 refuses to. A wrong password is a wrong password.
 *
 * @param {unknown} body
 * @returns {import('./validate__IMPORT_SUFFIX__').ValidationResult<LoginInput>}
 */
export function validateLogin(body) {
  const raw = asRecord(body);

  if (raw === undefined) {
    return fail('', 'Expected a JSON object body');
  }

  const issues = new IssueCollector();

  const email = emailField(raw.email, 'email', issues);

  // No trim on any password field. Whitespace is a legal character in a passphrase, and trimming
  // would silently change the credential — accepting a password at signup that then fails to
  // authenticate, or worse, authenticating on a value the user did not type.
  const password = requiredString(raw.password, 'password', issues, {
    maxLength: MAX_SUBMITTED_PASSWORD_LENGTH,
  });

  if (!issues.valid || email === undefined || password === undefined) {
    return issues.toResult();
  }

  return ok({ email, password });
}
