/**
 * Error serialisation.
 *
 * `name`, `message` and `stack` are non-enumerable own properties of an `Error`, so the two
 * mechanisms that normally copy a value into a log record — object spread and `JSON.stringify` —
 * both produce `{}`. Left alone, `logger.error(err)` reaches the aggregator with no stack and
 * nothing to indicate one ever existed. Everything in this file exists to stop that.
 */
import { format } from 'winston';

/**
 * Depth limit on `cause` chains: deep enough for real wrapping (driver -> repository -> service ->
 * handler), shallow enough that one error cannot dominate a record.
 */
const MAX_CAUSE_DEPTH = 8;

/**
 * @typedef {object} SerializedError
 * @property {string} name
 * @property {string} message
 * @property {string | undefined} stack
 * @property {SerializedError | undefined} cause Taken from `Error.cause`, followed to
 *   `MAX_CAUSE_DEPTH`.
 */

/**
 * Works on anything: `throw 'boom'` and `Promise.reject(undefined)` are both legal.
 *
 * @param {unknown} value
 * @returns {SerializedError}
 */
export function serializeError(value) {
  return serialize(value, new Set(), MAX_CAUSE_DEPTH);
}

/**
 * @param {unknown} value
 * @param {Set<object>} seen
 * @param {number} depth
 * @returns {SerializedError}
 */
function serialize(value, seen, depth) {
  if (!(value instanceof Error)) {
    return {
      name: typeTag(value),
      message: describe(value),
      stack: undefined,
      cause: undefined,
    };
  }

  seen.add(value);

  return {
    name: value.name,
    message: value.message,
    stack: value.stack,
    cause: serializeCause(value.cause, seen, depth),
  };
}

/**
 * `error.cause === error` is legal, and a retry wrapper that re-wraps its own failure produces it.
 * Following the chain without the `seen` guard would recurse until the stack ran out and take the
 * process down from inside the logger — the one place that must never be the cause.
 *
 * @param {unknown} cause
 * @param {Set<object>} seen
 * @param {number} depth
 * @returns {SerializedError | undefined}
 */
function serializeCause(cause, seen, depth) {
  if (cause === undefined || cause === null || depth <= 0) return undefined;
  if (typeof cause === 'object' && seen.has(cause)) return undefined;
  return serialize(cause, seen, depth - 1);
}

/**
 * `Object.prototype.toString` rather than `constructor.name`: it survives a null prototype.
 *
 * @param {unknown} value
 * @returns {string}
 */
function typeTag(value) {
  return Object.prototype.toString.call(value).slice(8, -1);
}

/**
 * A logger must not throw. `String(value)` can, through a hostile or simply broken `toString`, so
 * the one place a non-`Error` throwable becomes text is guarded.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (typeof value === 'string') return value;

  try {
    return String(value);
  } catch {
    return `[unstringifiable ${typeTag(value)}]`;
  }
}

/**
 * Replaces a record that *is* an `Error` with a plain record carrying a serialised `error`.
 *
 * winston passes `logger.error(err)` through as the record itself, so the object arriving at the
 * transports is an `Error` and `format.json()` would render it as `{}`. The spread keeps whatever
 * enumerable fields the error carried — `statusCode`, `code` — and the explicit `level` and
 * `message` restore the two properties the spread cannot see. Symbol keys, which is where winston
 * keeps the level it routes on, are copied by the spread.
 *
 * Errors nested inside metadata are handled by the redaction walk instead, because that is the only
 * pass that visits every value in a record at every depth.
 */
export const errorSerializer = format((info) => {
  if (!(info instanceof Error)) return info;
  return { ...info, level: info.level, message: info.message, error: serializeError(info) };
});
