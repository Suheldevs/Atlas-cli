/**
 * Secret redaction.
 *
 * A logger that copies a request context, a config object or an upstream response into a log
 * aggregator verbatim turns every credential it touches into a security incident — one that is
 * unrecoverable, because the secret is now in a system with its own retention policy, its own
 * access list and its own backups.
 *
 * The places a secret hides are exactly the places a shallow pass misses: a nested
 * `headers.authorization`, an array of session objects, a `cause` chain three errors deep. So the
 * walk below is recursive, cycle-safe, and replaces rather than deletes — a record reading
 * `{ password: '[REDACTED]' }` still says a password was sent, which is often the fact you need.
 */
import { format } from 'winston';

import { serializeError } from './serialize-error__IMPORT_SUFFIX__';

export const REDACTED = '[REDACTED]';

/** Stands in for a reference already on the current path, so the copy stays a tree. */
export const CIRCULAR = '[Circular]';

/** @type {readonly string[]} */
export const SENSITIVE_FIELD_NAMES = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',
  'creditCard',
  'ssn',
];

/**
 * Collapses a field name to its letters and digits, so `accessToken`, `access_token`,
 * `Access-Token` and `ACCESSTOKEN` are one name rather than four rules.
 *
 * @param {string} key
 * @returns {string}
 */
function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** @type {ReadonlySet<string>} */
const SENSITIVE_KEYS = new Set(SENSITIVE_FIELD_NAMES.map(normalizeKey));

/**
 * Exact match on the normalised name, deliberately not a substring test. `includes('token')` would
 * also redact `tokenCount` and `tokenizer`, and a redaction rule people route around because it
 * eats harmless fields protects less than one they trust.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/**
 * A redacted, JSON-safe copy of `value`. Never mutates its input.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactValue(value) {
  return walk(value, new Set());
}

/**
 * @param {unknown} value
 * @param {Set<object>} path Objects on the current branch, not every object ever seen.
 * @returns {unknown}
 */
function walk(value, path) {
  // `JSON.stringify` throws on a bigint, and a logger that throws while logging takes the request
  // down with it — so the one primitive it cannot handle is converted here rather than guarded for
  // at every call site downstream.
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  // Dates serialise correctly on their own, and walking one would flatten it to `{}`.
  if (value instanceof Date) return value;
  if (path.has(value)) return CIRCULAR;

  path.add(value);

  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, path));

    const plain = walkEntries(value, path);
    return value instanceof Error ? { ...plain, ...serializeError(value) } : plain;
  } finally {
    // Removed on the way back out, so `path` holds the current chain rather than every object ever
    // seen: two sibling fields referencing one shared object is not a cycle, and reporting the
    // second as `[Circular]` would lose data that is perfectly safe to log.
    path.delete(value);
  }
}

/**
 * @param {object} value
 * @param {Set<object>} path
 * @returns {Record<string, unknown>}
 */
function walkEntries(value, path) {
  /** @type {Record<string, unknown>} */
  const result = {};

  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : walk(item, path);
  }

  return result;
}

/**
 * Redacts every value on a log record.
 *
 * Symbol keys are skipped on purpose: winston stores the level it routes on and the rendered output
 * line under `Symbol.for('level')` and `Symbol.for('message')`, and rewriting either would break the
 * transport rather than protect anything. `Object.keys` sees neither.
 */
export const redactSecrets = format((info) => {
  for (const key of Object.keys(info)) {
    info[key] = isSensitiveKey(key) ? REDACTED : redactValue(info[key]);
  }

  return info;
});
