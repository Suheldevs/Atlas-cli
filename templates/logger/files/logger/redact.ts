/**
 * Secret redaction.
 *
 * A logger that copies a request context, a config object or an upstream response into a log
 * aggregator verbatim turns every credential it touches into a security incident — one that is
 * unrecoverable, because the secret is now in a system with its own retention policy, its own
 * access list and its own backups.
 *
 * The places a secret hides are exactly the places a shallow pass misses: a nested
 * `headers.authorization`, an array of session objects, a `cause` chain three errors deep. So
 * the walk below is recursive, cycle-safe, and replaces rather than deletes — a record reading
 * `{ password: '[REDACTED]' }` still says a password was sent, which is often the fact you need.
 */
import { format } from 'winston';

import { serializeError } from './errors__IMPORT_SUFFIX__';

export const REDACTED = '[REDACTED]';

/** Stands in for a reference already on the current path, so the copy stays a tree. */
export const CIRCULAR = '[Circular]';

export const SENSITIVE_FIELD_NAMES: readonly string[] = [
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
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SENSITIVE_KEYS: ReadonlySet<string> = new Set(SENSITIVE_FIELD_NAMES.map(normalizeKey));

/**
 * Exact match on the normalised name, deliberately not a substring test. `includes('token')`
 * would also redact `tokenCount` and `tokenizer`, and a redaction rule people route around
 * because it eats harmless fields protects less than one they trust.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/** A redacted, JSON-safe copy of `value`. Never mutates its input. */
export function redactValue(value: unknown): unknown {
  return walk(value, new Set<object>());
}

function walk(value: unknown, path: Set<object>): unknown {
  // `JSON.stringify` throws on a bigint, and a logger that throws while logging takes the request
  // down with it — so the one primitive it cannot handle is converted here rather than guarded
  // for at every call site downstream.
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  // Dates serialise correctly on their own, and walking one would flatten it to `{}`.
  if (value instanceof Date) return value;
  if (path.has(value)) return CIRCULAR;

  path.add(value);

  try {
    if (isArray(value)) return value.map((item) => walk(item, path));

    const plain = walkEntries(value, path);
    return value instanceof Error ? { ...plain, ...serializeError(value) } : plain;
  } finally {
    // Removed on the way back out, so `path` holds the current chain rather than every object
    // ever seen: two sibling fields referencing one shared object is not a cycle, and reporting
    // the second as `[Circular]` would lose data that is perfectly safe to log.
    path.delete(value);
  }
}

function walkEntries(value: object, path: Set<object>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const entries: readonly (readonly [string, unknown])[] = Object.entries(value);

  for (const [key, item] of entries) {
    result[key] = isSensitiveKey(key) ? REDACTED : walk(item, path);
  }

  return result;
}

function isArray(value: object): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Redacts every value on a log record.
 *
 * Symbol keys are skipped on purpose: winston stores the level it routes on and the rendered
 * output line under `Symbol.for('level')` and `Symbol.for('message')`, and rewriting either would
 * break the transport rather than protect anything. `Object.keys` sees neither.
 */
export const redactSecrets = format((info) => {
  for (const key of Object.keys(info)) {
    info[key] = isSensitiveKey(key) ? REDACTED : redactValue(info[key]);
  }

  return info;
});
