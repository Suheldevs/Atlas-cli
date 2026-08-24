/**
 * Hand-written request validation.
 *
 * There is no validation library here on purpose, which puts one obligation on this file that a
 * schema library would have handled for free: **the declared type and the runtime check have to be
 * kept in agreement by hand.** With `z.infer` the type was derived from the check and could not
 * drift. Here, adding a field to an input interface without adding a line to its validator produces
 * code that compiles and lies — the field is typed as present and is never verified.
 *
 * The pattern that makes that survivable is below: a validator builds its result field by field and
 * returns the concrete input type, so TypeScript rejects the object if a field is missing. Adding a
 * required field to the interface breaks the validator until it is handled. That check is the whole
 * reason the return types are written out rather than inferred.
 */

import { ValidationError, type ValidationIssue } from '../domain/auth-errors__IMPORT_SUFFIX__';

/**
 * Collects issues instead of throwing on the first one.
 *
 * A validator runs every field, then calls `throwIfInvalid` once. That is what lets a client see
 * all four problems with a form in one response rather than one per round trip.
 */
export class IssueCollector {
  readonly #issues: ValidationIssue[] = [];

  add(field: string, message: string): void {
    this.#issues.push({ field, message });
  }

  get valid(): boolean {
    return this.#issues.length === 0;
  }

  /** Throws `ValidationError` with everything collected, or returns cleanly. */
  throwIfInvalid(): void {
    if (this.#issues.length > 0) {
      throw new ValidationError([...this.#issues]);
    }
  }
}

/**
 * Narrows `req.body` to something with readable keys.
 *
 * `req.body` is whatever the JSON parser produced: an object, an array, a string, a number, `null`,
 * or `undefined` when no body arrived and nothing parsed it. Arrays are excluded deliberately —
 * `[]` would otherwise pass an object check and then report every field as missing, which is a
 * confusing way to say "send an object".
 */
export function asRecord(body: unknown): Readonly<Record<string, unknown>> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: '', message: 'Expected a JSON object body.' }]);
  }

  return body as Readonly<Record<string, unknown>>;
}

/**
 * A required string, trimmed, or `undefined` with an issue recorded.
 *
 * Returning `undefined` rather than throwing is what allows the caller to keep checking the
 * remaining fields. The bound is applied *before* any pattern runs, so no regular expression is
 * ever handed an arbitrarily long string.
 */
export function requiredString(
  raw: unknown,
  field: string,
  issues: IssueCollector,
  options: { readonly maxLength: number; readonly trim?: boolean },
): string | undefined {
  if (raw === undefined || raw === null) {
    issues.add(field, `${label(field)} is required.`);
    return undefined;
  }

  if (typeof raw !== 'string') {
    issues.add(field, `${label(field)} must be a string.`);
    return undefined;
  }

  const value = options.trim === true ? raw.trim() : raw;

  if (value.length === 0) {
    issues.add(field, `${label(field)} is required.`);
    return undefined;
  }

  if (value.length > options.maxLength) {
    issues.add(field, `${label(field)} must be at most ${String(options.maxLength)} characters.`);
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
 * mail to it. Being slightly stricter than the RFC is the right failure direction here: it rejects
 * a handful of legal-but-unheard-of addresses and no realistic user's.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

/**
 * A validated, normalised email address.
 *
 * Trimmed and lower-cased *before* the format check, so ` Ada@Example.COM ` is accepted and comes
 * back as `ada@example.com`. Validating first would reject the padded value.
 */
export function emailField(
  raw: unknown,
  field: string,
  issues: IssueCollector,
): string | undefined {
  const value = requiredString(raw, field, issues, { maxLength: MAX_EMAIL_LENGTH, trim: true });

  if (value === undefined) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (!EMAIL_PATTERN.test(normalized)) {
    issues.add(field, 'Must be a valid email address.');
    return undefined;
  }

  return normalized;
}

/** `passwordHash` → "Password hash". Only used for messages, never for lookups. */
function label(field: string): string {
  if (field.length === 0) {
    return 'Body';
  }

  const spaced = field.replace(/([A-Z])/gu, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
