/**
 * Hand-written request validation.
 *
 * There is no validation library here on purpose, and no exceptions either. Every function below
 * either produces a value or records an issue; a validator finishes by returning one of two shapes:
 *
 *   { ok: true,  value }
 *   { ok: false, errors: [{ field, message }, …] }
 *
 * A malformed body is an expected outcome of a public endpoint, not an exceptional one, so it is a
 * value the caller inspects rather than control flow it has to catch. `throw` in this module would
 * also make the "collect every issue" behaviour impossible: the first bad field would end the run
 * and a client fixing a form would learn about its four problems one round trip at a time.
 *
 * The single conversion from a failed result into an HTTP failure happens in the controller, which
 * turns it into `ValidationFailedError` — an `ApiError` — so the response envelope is the one the
 * global error handler produces for every other route in the application.
 */

/**
 * One thing wrong with one field. `field` is the request-body key, so a form can map it back.
 *
 * @typedef {object} ValidationIssue
 * @property {string} field
 * @property {string} message
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, errors: readonly ValidationIssue[] }} ValidationResult
 */

/**
 * Collects issues instead of stopping at the first one.
 *
 * A validator runs every field and then asks once whether anything failed. That is what lets a
 * client see all four problems with a form in one response.
 */
export class IssueCollector {
  /** @type {ValidationIssue[]} */
  #issues = [];

  /**
   * @param {string} field
   * @param {string} message
   * @returns {void}
   */
  add(field, message) {
    this.#issues.push({ field, message });
  }

  /** @returns {boolean} */
  get valid() {
    return this.#issues.length === 0;
  }

  /** @returns {readonly ValidationIssue[]} A copy, so a caller cannot mutate the collector. */
  get issues() {
    return [...this.#issues];
  }

  /**
   * The failing result carrying everything collected.
   *
   * @template T
   * @returns {ValidationResult<T>}
   */
  toResult() {
    return { ok: false, errors: this.issues };
  }
}

/**
 * @template T
 * @param {T} value
 * @returns {ValidationResult<T>}
 */
export function ok(value) {
  return { ok: true, value };
}

/**
 * @template T
 * @param {string} field
 * @param {string} message
 * @returns {ValidationResult<T>}
 */
export function fail(field, message) {
  return { ok: false, errors: [{ field, message }] };
}

/**
 * Narrows `req.body` to something with readable keys, or `undefined`.
 *
 * `req.body` is whatever the JSON parser produced: an object, an array, a string, a number, `null`,
 * or `undefined` when no body arrived and nothing parsed it. Arrays are excluded deliberately — `[]`
 * would otherwise pass an object check and then report every field as missing, which is a confusing
 * way to say "send an object".
 *
 * @param {unknown} body
 * @returns {Record<string, unknown> | undefined}
 */
export function asRecord(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }

  return /** @type {Record<string, unknown>} */ (body);
}

/**
 * `passwordHash` → "Password hash". Only used for messages, never for lookups.
 *
 * @param {string} field
 * @returns {string}
 */
function label(field) {
  if (field.length === 0) {
    return 'Body';
  }

  const spaced = field.replace(/([A-Z])/gu, ' $1').toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A required string, optionally trimmed, or `undefined` with an issue recorded.
 *
 * Returning `undefined` rather than throwing is what allows the caller to keep checking the
 * remaining fields. The length bound is applied *before* any pattern runs, so no regular expression
 * is ever handed an arbitrarily long string — an unbounded input to a backtracking regex is a
 * denial-of-service waiting for a bad day.
 *
 * The type check is not a formality. `{ "email": { "$ne": null } }` is valid JSON, and passing that
 * object through to a Mongo query is how a query-operator injection starts; rejecting anything that
 * is not a string is what stops it at the edge.
 *
 * @param {unknown} raw
 * @param {string} field
 * @param {IssueCollector} issues
 * @param {{ maxLength: number, minLength?: number, trim?: boolean }} options
 * @returns {string | undefined}
 */
export function requiredString(raw, field, issues, options) {
  if (raw === undefined || raw === null) {
    issues.add(field, `${label(field)} is required`);
    return undefined;
  }

  if (typeof raw !== 'string') {
    issues.add(field, `${label(field)} must be a string`);
    return undefined;
  }

  const value = options.trim === true ? raw.trim() : raw;

  if (value.length === 0) {
    issues.add(field, `${label(field)} is required`);
    return undefined;
  }

  if (options.minLength !== undefined && value.length < options.minLength) {
    issues.add(field, `${label(field)} must be at least ${options.minLength} characters`);
    return undefined;
  }

  if (value.length > options.maxLength) {
    issues.add(field, `${label(field)} must be at most ${options.maxLength} characters`);
    return undefined;
  }

  return value;
}

/**
 * The longest address SMTP has to carry (RFC 5321): a 64-octet local part and a 255-octet domain,
 * which together with the `@` cannot exceed 254.
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately not RFC 5322.
 *
 * The full grammar permits quoted strings, comments, and bracketed IP literals, and every regular
 * expression claiming to implement it is either wrong or unreadable. This checks the shape that
 * matters — one `@`, something before it, a dotted domain after it, no whitespace — and leaves the
 * question of whether the address *exists* to the only thing that can answer it, which is sending
 * mail to it. Being slightly stricter than the RFC is the right failure direction here: it rejects a
 * handful of legal-but-unheard-of addresses and no realistic user's.
 *
 * Every quantified group is bounded by a preceding length check, so there is no nested repetition
 * for a crafted input to exploit.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

/**
 * A validated, normalised email address.
 *
 * Trimmed and lower-cased *before* the format check, so ` Ada@Example.COM ` is accepted and comes
 * back as `ada@example.com`. Validating first would reject the padded value.
 *
 * @param {unknown} raw
 * @param {string} field
 * @param {IssueCollector} issues
 * @returns {string | undefined}
 */
export function emailField(raw, field, issues) {
  const value = requiredString(raw, field, issues, { maxLength: MAX_EMAIL_LENGTH, trim: true });

  if (value === undefined) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (!EMAIL_PATTERN.test(normalized)) {
    issues.add(field, 'Must be a valid email address');
    return undefined;
  }

  return normalized;
}
