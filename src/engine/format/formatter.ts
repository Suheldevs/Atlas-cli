import { basename, extname } from 'node:path';

import { type BuiltInParserName, format } from 'prettier';

import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { Reporter } from '../../services/reporter.service.js';
import type { FileOperation } from '../../types/generation-plan.js';

import {
  type PrettierOptionsResolver,
  resolvePrettierOptions,
} from './prettier-config-resolver.js';

/**
 * Extensions Atlas hands to prettier, mapped to the parser to use.
 *
 * An allow-list rather than a deny-list: an unrecognised extension is left alone, which is
 * always safe, whereas guessing a parser for it risks mangling a file. The parser is passed
 * explicitly instead of relying on inference so that an unsupported file is identified
 * before prettier is loaded and asked to fail.
 */
const PARSERS_BY_EXTENSION: Readonly<Record<string, BuiltInParserName>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'babel',
  '.jsx': 'babel',
  '.mjs': 'babel',
  '.cjs': 'babel',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.json5': 'json5',
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.vue': 'vue',
};

/**
 * Files whose *name* disqualifies them regardless of extension.
 *
 * `.env.example` has the extension `.example` and `.env` has none at all, so extension
 * matching alone would let them through — and prettier has no parser for dotenv syntax.
 */
const UNFORMATTABLE_NAME_PATTERN = /^\.env(\..+)?$/u;

/** Lockfiles are machine-owned; reformatting one produces a diff nobody wants to review. */
const LOCKFILE_EXTENSIONS: readonly string[] = ['.lock', '.lockb'];

export interface FormatterOptions {
  readonly reporter: Reporter;
  /**
   * Overridable so callers that already know the project's style — and tests — can supply
   * options without a filesystem walk.
   */
  readonly resolveOptions?: PrettierOptionsResolver | undefined;
  /**
   * Turns a formatting failure into a hard error. Off by default; see
   * {@link Formatter.formatFile} for why lenient is the right default.
   */
  readonly strict?: boolean | undefined;
}

const describeCause = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Resolves the prettier parser for a path, or `undefined` when Atlas must not format it. */
export function parserForPath(path: string): BuiltInParserName | undefined {
  const name = basename(path);
  if (UNFORMATTABLE_NAME_PATTERN.test(name)) return undefined;

  const extension = extname(name).toLowerCase();
  if (LOCKFILE_EXTENSIONS.includes(extension)) return undefined;

  return PARSERS_BY_EXTENSION[extension];
}

/**
 * Runs the target project's prettier over generated code.
 *
 * Formatting is the last step before a file is written, and it is the step that decides
 * whether the result reads as handwritten or as output from a tool.
 */
export class Formatter {
  readonly #reporter: Reporter;
  readonly #resolveOptions: PrettierOptionsResolver;
  readonly #strict: boolean;

  constructor(options: FormatterOptions) {
    this.#reporter = options.reporter;
    this.#resolveOptions = options.resolveOptions ?? resolvePrettierOptions;
    this.#strict = options.strict ?? false;
  }

  /**
   * Formats `contents` as the file at `path`, returning the input unchanged when it cannot
   * be formatted.
   *
   * Prettier throws for two reasons: the generated code has a genuine syntax error, or the
   * file type has no parser. Neither is worth aborting a generation for. Unformatted but
   * correct output is vastly better than a half-applied run, and the user can fix the
   * cosmetics with one `prettier --write`; prettier's own diagnostic is on the debug log for
   * whoever is actually debugging the template. `strict` exists for exactly that case — the
   * template test suite, where a syntax error must fail loudly.
   */
  async formatFile(path: string, contents: string): Promise<string> {
    const parser = parserForPath(path);
    if (parser === undefined) {
      this.#reporter.debug(`format: skipped ${path} (no prettier parser for this file type)`);
      return contents;
    }

    try {
      const options = await this.#resolveOptions(path);
      return await format(contents, { ...options, filepath: path, parser });
    } catch (error: unknown) {
      const reason = describeCause(error);

      if (this.#strict) {
        throw new AtlasError({
          code: ErrorCode.FormatFailed,
          message: `Prettier could not format ${path}.`,
          hint: 'The generated code is not syntactically valid. This is a template bug.',
          details: [reason],
          cause: error,
        });
      }

      this.#reporter.debug(`format: left ${path} unformatted (${reason})`);
      return contents;
    }
  }

  /**
   * Formats every operation that asked for it, preserving input order.
   *
   * Operations run sequentially: they share one config cache, and the first file in a
   * directory is the one that populates it.
   */
  async formatOperations(operations: readonly FileOperation[]): Promise<readonly FileOperation[]> {
    const formatted: FileOperation[] = [];

    for (const operation of operations) {
      if (!operation.format) {
        formatted.push(operation);
        continue;
      }

      const contents = await this.formatFile(operation.path, operation.contents);
      formatted.push(contents === operation.contents ? operation : { ...operation, contents });
    }

    return formatted;
  }
}
