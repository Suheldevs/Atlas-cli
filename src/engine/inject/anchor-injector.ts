import type { FileSystemService } from '../../services/filesystem.service.js';
import type { Reporter } from '../../services/reporter.service.js';
import type { InjectionRequest } from '../../types/generation-plan.js';

export type InjectionOutcome = 'injected' | 'already-present' | 'marker-missing' | 'file-missing';

export interface InjectionResult {
  readonly request: InjectionRequest;
  readonly outcome: InjectionOutcome;
  /** The rewritten file, and only when `outcome` is `injected`. */
  readonly contents: string | undefined;
}

interface SourceLine {
  /** Offset of the first character of the line within the source string. */
  readonly start: number;
  /** The line without its terminator. */
  readonly text: string;
}

const LEADING_WHITESPACE = /^[ \t]*/u;

/**
 * Splits a source into lines while remembering where each one began.
 *
 * The offsets are what make injection a splice rather than a rewrite: everything outside the
 * inserted range comes back byte-for-byte identical.
 */
function scanLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '\n') continue;
    const end = index > start && source[index - 1] === '\r' ? index - 1 : index;
    lines.push({ start, text: source.slice(start, end) });
    start = index + 1;
  }

  if (start < source.length) lines.push({ start, text: source.slice(start) });

  return lines;
}

/**
 * The line ending to use for inserted lines.
 *
 * Detected rather than assumed, and applied only to the new lines: normalising a
 * CRLF-checked-out file to LF turns a three-line addition into a whole-file diff, which
 * buries the actual change and makes the commit impossible to review.
 */
function detectLineEnding(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/** Trims each line and drops blanks, so comparisons ignore indentation and spacing. */
function significantLines(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;

  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    if (needle.every((line, index) => haystack[offset + index] === line)) return true;
  }

  return false;
}

/**
 * Re-indents a snippet to sit at `indent`, keeping its own internal structure.
 *
 * The snippet's own common indentation is stripped first so that a template authored inside
 * a nested block does not arrive with that nesting baked in. Blank lines stay empty rather
 * than becoming trailing whitespace.
 */
function reindent(snippet: string, indent: string): string[] {
  const lines = snippet.split(/\r?\n/u);

  while (lines.length > 0 && (lines.at(-1) ?? '').trim().length === 0) lines.pop();
  while (lines.length > 0 && (lines[0] ?? '').trim().length === 0) lines.shift();

  const ownIndents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => (LEADING_WHITESPACE.exec(line)?.[0] ?? '').length);
  const common = ownIndents.length === 0 ? 0 : Math.min(...ownIndents);

  return lines.map((line) => (line.trim().length === 0 ? '' : `${indent}${line.slice(common)}`));
}

/**
 * Inserts `request.snippet` immediately above `request.marker`.
 *
 * Pure by design: string in, string out, no I/O. This is the only sanctioned way Atlas edits
 * a file it did not author, so it has to be the piece that is easiest to reason about and
 * exhaustively testable without a filesystem.
 */
export function injectAtAnchor(existing: string, request: InjectionRequest): InjectionResult {
  const snippetLines = significantLines(request.snippet);

  // Idempotency first, and before the marker lookup: re-running a generator must never
  // register the same route twice, and the marker is still present after a prior injection.
  if (containsSequence(significantLines(existing), snippetLines)) {
    return { request, outcome: 'already-present', contents: undefined };
  }

  const lines = scanLines(existing);
  const anchor = lines.find((line) => line.text.includes(request.marker));

  // No guessing. A snippet dropped in the wrong place breaks a file the user owns, so the
  // caller reports `manualHint` and lets them wire it up deliberately.
  if (anchor === undefined) {
    return { request, outcome: 'marker-missing', contents: undefined };
  }

  const indent = LEADING_WHITESPACE.exec(anchor.text)?.[0] ?? '';
  const eol = detectLineEnding(existing);
  const insertion = reindent(request.snippet, indent)
    .map((line) => `${line}${eol}`)
    .join('');

  return {
    request,
    outcome: 'injected',
    contents: `${existing.slice(0, anchor.start)}${insertion}${existing.slice(anchor.start)}`,
  };
}

export interface AnchorInjectorOptions {
  readonly fs: FileSystemService;
  readonly reporter: Reporter;
  /** Compute every result but write nothing. */
  readonly dryRun?: boolean | undefined;
}

/**
 * Applies injection requests to real files.
 *
 * Requests are folded in memory before anything is written, so several requests against the
 * same marker compose instead of the last one winning — two generators registering two routes
 * in one `router.ts` is the normal case, not the exotic one.
 */
export class AnchorInjector {
  readonly #fs: FileSystemService;
  readonly #reporter: Reporter;
  readonly #dryRun: boolean;

  constructor(options: AnchorInjectorOptions) {
    this.#fs = options.fs;
    this.#reporter = options.reporter;
    this.#dryRun = options.dryRun ?? false;
  }

  async apply(requests: readonly InjectionRequest[]): Promise<readonly InjectionResult[]> {
    const results: InjectionResult[] = [];
    const pending = new Map<string, string>();

    for (const request of requests) {
      const existing = pending.get(request.path) ?? (await this.#fs.readTextIfExists(request.path));

      if (existing === undefined) {
        this.#reporter.debug(`inject: ${request.path} does not exist`);
        results.push({ request, outcome: 'file-missing', contents: undefined });
        continue;
      }

      const result = injectAtAnchor(existing, request);
      if (result.outcome === 'injected' && result.contents !== undefined) {
        pending.set(request.path, result.contents);
      }

      this.#reporter.debug(`inject: ${request.path} ${result.outcome} (${request.marker})`);
      results.push(result);
    }

    if (!this.#dryRun) {
      for (const [path, contents] of pending) {
        await this.#fs.writeText(path, contents);
      }
    }

    return results;
  }
}
