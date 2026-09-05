/**
 * Hand-written request validation for __ENTITY_TITLE__.
 *
 * There is no validation library here on purpose. Two rules keep that honest:
 *
 * 1. **Nothing throws.** A malformed body is an expected outcome at a public boundary, not an
 *    exception. Every validator returns `{ ok: true, value }` or `{ ok: false, errors }`, and the
 *    controller turns the second into `new ApiError(400, 'Validation failed', errors)` so a bad
 *    request renders through the same envelope as every other failure.
 * 2. **Validators build a fresh object.** Unknown keys are ignored rather than rejected — a client
 *    that sends `createdAt` gets a record, not a 400 — but nothing it sent can reach the database,
 *    because only fields checked here are copied across.
 *
 * @typedef {{ field: string, message: string }} FieldError
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, errors: FieldError[] }} Validated
 */
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH } from './__ENTITY_KEBAB__.model__IMPORT_SUFFIX__';

export const MAX_SEARCH_LENGTH = 200;

export const DEFAULT_LIMIT = 20;

/**
 * The cap that makes `GET /__ENTITY_PLURAL_KEBAB__` safe to expose.
 *
 * Without it, `?limit=1000000` is a request for the entire collection: one query that reads every
 * document, serialises all of them, and holds the result in memory — a denial of service anybody can
 * trigger with a URL. A client that needs everything pages through it.
 */
export const MAX_LIMIT = 100;

/** Sorting is an allowlist, never a caller-supplied field name. */
export const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'name'];

const DEFAULT_SORT_FIELD = 'createdAt';
const DEFAULT_SORT_ORDER = 'desc';

/**
 * Narrows a parsed body to something with readable keys.
 *
 * `req.body` is whatever the JSON parser produced: an object, an array, a string, a number, `null`,
 * or `undefined` when no body arrived. Arrays are excluded deliberately — `[]` would otherwise pass
 * an object check and then report every field as missing, which is a confusing way to say "send an
 * object".
 *
 * @param {unknown} body
 * @returns {Record<string, unknown> | undefined}
 */
function asRecord(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return body;
}

/**
 * A trimmed string, or `undefined` with an issue recorded.
 *
 * Recording rather than throwing is what lets a client see all the problems with a form in one
 * response instead of one per round trip. The length bound is applied after trimming and before any
 * further work, so no unbounded string is ever scanned twice.
 *
 * @param {unknown} raw
 * @param {string} field
 * @param {FieldError[]} errors
 * @param {{ maxLength: number, required: boolean }} options
 * @returns {string | undefined}
 */
function stringField(raw, field, errors, options) {
  if (raw === undefined || raw === null) {
    if (options.required) errors.push({ field, message: `${label(field)} is required.` });
    return undefined;
  }

  if (typeof raw !== 'string') {
    errors.push({ field, message: `${label(field)} must be a string.` });
    return undefined;
  }

  const value = raw.trim();

  if (value.length === 0) {
    if (options.required) errors.push({ field, message: `${label(field)} is required.` });
    return undefined;
  }

  if (value.length > options.maxLength) {
    errors.push({
      field,
      message: `${label(field)} must be at most ${options.maxLength} characters.`,
    });
    return undefined;
  }

  return value;
}

/**
 * A query-string integer, clamped to a range.
 *
 * `req.query` values are `string | string[] | undefined`, and that union is exactly where
 * hand-rolled validation usually goes wrong: `Number(['5'])` is `5`, so a repeated parameter would
 * slip through a naive check. A repeat is rejected here rather than silently resolved.
 *
 * The parse is strict — `Number('12abc')` is `NaN`, but `parseInt('12abc')` is `12`, and quietly
 * accepting `?limit=12abc` is how a typo becomes a page size nobody asked for.
 *
 * @param {unknown} raw
 * @param {string} field
 * @param {FieldError[]} errors
 * @param {{ min: number, max: number, fallback: number }} options
 * @returns {number}
 */
function integerField(raw, field, errors, options) {
  if (raw === undefined || raw === '') return options.fallback;

  if (typeof raw !== 'string') {
    errors.push({ field, message: `${label(field)} must be sent once.` });
    return options.fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    errors.push({ field, message: `${label(field)} must be an integer.` });
    return options.fallback;
  }

  if (parsed < options.min || parsed > options.max) {
    errors.push({
      field,
      message: `${label(field)} must be between ${options.min} and ${options.max}.`,
    });
    return options.fallback;
  }

  return parsed;
}

/**
 * @param {unknown} raw
 * @param {string} field
 * @param {readonly string[]} allowed
 * @param {string} fallback
 * @param {FieldError[]} errors
 * @returns {string}
 */
function enumField(raw, field, allowed, fallback, errors) {
  if (raw === undefined || raw === '') return fallback;

  if (typeof raw !== 'string' || !allowed.includes(raw)) {
    errors.push({ field, message: `${label(field)} must be one of ${allowed.join(', ')}.` });
    return fallback;
  }

  return raw;
}

/**
 * `createdAt` -> "Created at". Only used for messages, never for lookups.
 *
 * @param {string} field
 * @returns {string}
 */
function label(field) {
  if (field.length === 0) return 'Body';
  const spaced = field.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * @typedef {object} Create__ENTITY_NAME__Input
 * @property {string} name
 * @property {string} [description]
 */

/**
 * @param {unknown} body
 * @returns {Validated<Create__ENTITY_NAME__Input>}
 */
export function validateCreate__ENTITY_NAME__(body) {
  const raw = asRecord(body);

  if (raw === undefined) {
    return { ok: false, errors: [{ field: '', message: 'Expected a JSON object body.' }] };
  }

  /** @type {FieldError[]} */
  const errors = [];

  const name = stringField(raw.name, 'name', errors, {
    maxLength: MAX_NAME_LENGTH,
    required: true,
  });
  const description = stringField(raw.description, 'description', errors, {
    maxLength: MAX_DESCRIPTION_LENGTH,
    required: false,
  });

  if (errors.length > 0 || name === undefined) return { ok: false, errors };

  /** @type {Create__ENTITY_NAME__Input} */
  const value = { name };
  if (description !== undefined) value.description = description;

  return { ok: true, value };
}

/**
 * @typedef {object} Update__ENTITY_NAME__Input
 * @property {string} [name]
 * @property {string} [description]
 */

/**
 * A PATCH names the fields it changes; anything absent keeps its current value.
 *
 * An empty patch is a 400 rather than a silent no-op. A request that changes nothing and answers
 * `200 OK` is indistinguishable from one that worked, so a client whose field name is misspelled —
 * `discription` — sees success on every attempt and never finds the bug. Presence is tested with
 * `in`, not against `undefined`, so `{ "name": undefined }` after a JSON round trip is treated as
 * the absent field it is.
 *
 * @param {unknown} body
 * @returns {Validated<Update__ENTITY_NAME__Input>}
 */
export function validateUpdate__ENTITY_NAME__(body) {
  const raw = asRecord(body);

  if (raw === undefined) {
    return { ok: false, errors: [{ field: '', message: 'Expected a JSON object body.' }] };
  }

  /** @type {FieldError[]} */
  const errors = [];
  /** @type {Update__ENTITY_NAME__Input} */
  const value = {};

  if ('name' in raw) {
    const name = stringField(raw.name, 'name', errors, {
      maxLength: MAX_NAME_LENGTH,
      required: true,
    });
    if (name !== undefined) value.name = name;
  }

  if ('description' in raw) {
    // `null` clears the description; a string replaces it. Both are edits, so neither is an error.
    if (raw.description === null) {
      value.description = '';
    } else {
      const description = stringField(raw.description, 'description', errors, {
        maxLength: MAX_DESCRIPTION_LENGTH,
        required: true,
      });
      if (description !== undefined) value.description = description;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  if (Object.keys(value).length === 0) {
    return {
      ok: false,
      errors: [{ field: '', message: 'Send at least one field to update.' }],
    };
  }

  return { ok: true, value };
}

/**
 * @typedef {object} List__ENTITY_PLURAL__Query
 * @property {number} page
 * @property {number} limit
 * @property {string} sort
 * @property {'asc' | 'desc'} order
 * @property {string} [search]
 */

/**
 * @param {unknown} query
 * @returns {Validated<List__ENTITY_PLURAL__Query>}
 */
export function validateList__ENTITY_PLURAL__Query(query) {
  const raw = asRecord(query) ?? {};

  /** @type {FieldError[]} */
  const errors = [];

  const page = integerField(raw.page, 'page', errors, {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 1,
  });
  const limit = integerField(raw.limit, 'limit', errors, {
    min: 1,
    max: MAX_LIMIT,
    fallback: DEFAULT_LIMIT,
  });
  const sort = enumField(raw.sort, 'sort', SORTABLE_FIELDS, DEFAULT_SORT_FIELD, errors);
  const order = enumField(raw.order, 'order', ['asc', 'desc'], DEFAULT_SORT_ORDER, errors);
  const search = stringField(raw.search, 'search', errors, {
    maxLength: MAX_SEARCH_LENGTH,
    required: false,
  });

  if (errors.length > 0) return { ok: false, errors };

  /** @type {List__ENTITY_PLURAL__Query} */
  const value = { page, limit, sort, order: /** @type {'asc' | 'desc'} */ (order) };
  if (search !== undefined) value.search = search;

  return { ok: true, value };
}
