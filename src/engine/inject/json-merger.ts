import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';

/**
 * Sections to merge, keyed by top-level field: `{ scripts: { dev: 'tsx watch src/index.ts' } }`.
 *
 * Only string-valued fields nested one level deep, which is every edit Atlas needs to make to
 * a `package.json` — scripts, and occasionally a dependency range.
 */
export type JsonMergeChanges = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface JsonMergeResult {
  readonly contents: string;
  /** Dotted paths that were written, e.g. `scripts.dev`. */
  readonly added: readonly string[];
  /** Dotted paths left alone because the project already defines them. */
  readonly skipped: readonly string[];
}

/** Matches the indentation of the first indented line, which in JSON is the first member. */
const FIRST_INDENT = /\n([ \t]+)"/u;

const DEFAULT_INDENT = '  ';

/**
 * Detects the file's own indentation.
 *
 * A four-space or tab-indented `package.json` reformatted to two spaces is a diff on every
 * line of the file — for the sake of adding one script.
 */
function detectIndent(source: string): string {
  return FIRST_INDENT.exec(source)?.[1] ?? DEFAULT_INDENT;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges string entries into the top-level sections of a JSON document.
 *
 * Key order survives because `JSON.parse` builds objects in document order and
 * `JSON.stringify` walks them in insertion order, so new keys land at the end of their
 * section and nothing above them moves. (Integer-like keys are the one exception JavaScript
 * reorders; `package.json` has none, and neither does anything else Atlas edits.)
 *
 * Existing values are never replaced. A user whose `dev` script runs their own toolchain must
 * find it untouched afterwards, so a collision is reported as skipped and left to them.
 */
export function mergeJsonFile(existing: string, changes: JsonMergeChanges): JsonMergeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch (error: unknown) {
    throw new AtlasError({
      code: ErrorCode.GenerationFailed,
      message: 'The JSON file Atlas needs to update is not valid JSON.',
      hint: 'Fix the syntax error and run the command again.',
      details: [error instanceof Error ? error.message : String(error)],
      cause: error,
    });
  }

  if (!isPlainObject(parsed)) {
    throw new AtlasError({
      code: ErrorCode.GenerationFailed,
      message: 'The JSON file Atlas needs to update does not contain an object.',
      hint: 'Atlas can only merge into a JSON object, such as a package.json.',
    });
  }

  const added: string[] = [];
  const skipped: string[] = [];
  let changed = false;

  for (const [section, entries] of Object.entries(changes)) {
    const current = parsed[section];

    // A section that exists but is not an object is the user's data, not a place to append to.
    if (current !== undefined && !isPlainObject(current)) {
      skipped.push(...Object.keys(entries).map((key) => `${section}.${key}`));
      continue;
    }

    const target: Record<string, unknown> = isPlainObject(current) ? current : {};

    for (const [key, value] of Object.entries(entries)) {
      if (Object.hasOwn(target, key)) {
        skipped.push(`${section}.${key}`);
        continue;
      }
      target[key] = value;
      added.push(`${section}.${key}`);
      changed = true;
    }

    if (current === undefined && Object.keys(target).length > 0) parsed[section] = target;
  }

  // Nothing to write means nothing to reformat: returning the input verbatim guarantees a
  // no-op merge leaves no diff at all, whatever the file's original layout was.
  if (!changed) return { contents: existing, added, skipped };

  const serialized = JSON.stringify(parsed, undefined, detectIndent(existing));
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const body = eol === '\n' ? serialized : serialized.split('\n').join(eol);

  return {
    contents: existing.endsWith('\n') ? `${body}${eol}` : body,
    added,
    skipped,
  };
}
