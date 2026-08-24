import type { ExitCode } from '../constants/exit-codes.js';

import { describeErrorCode, docsUrlForErrorCode, ErrorCode } from './error-catalog.js';

export interface AtlasErrorOptions {
  readonly code: ErrorCode;
  /** One sentence, addressed to the user, describing what went wrong. */
  readonly message: string;
  /** One sentence telling the user what to do about it. */
  readonly hint?: string;
  /** Supporting lines — failed paths, command output, conflicting versions. */
  readonly details?: readonly string[];
  readonly cause?: unknown;
  /** Overrides the exit code the catalog assigns to this error code. */
  readonly exitCode?: ExitCode;
}

/**
 * An expected failure.
 *
 * Anything thrown as an `AtlasError` is a situation Atlas anticipated, so the top-level
 * handler prints a clean message instead of a stack trace. Genuine bugs stay as plain
 * `Error`s and are reported as bugs — that distinction is the whole point of the class.
 */
export class AtlasError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly details: readonly string[];
  readonly exitCode: ExitCode;
  readonly docsUrl: string;

  constructor(options: AtlasErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });

    // `new.target` rather than a literal, so subclasses report their own name.
    this.name = new.target.name;
    this.code = options.code;
    this.hint = options.hint;
    this.details = options.details ?? [];
    this.exitCode = options.exitCode ?? describeErrorCode(options.code).exitCode;
    this.docsUrl = docsUrlForErrorCode(options.code);

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }

  static isAtlasError(value: unknown): value is AtlasError {
    return value instanceof AtlasError;
  }
}

/**
 * The user pressed Ctrl+C or answered "abort" at a prompt. Presented as a warning
 * rather than an error, because nothing actually went wrong.
 */
export class UserAbortError extends AtlasError {
  constructor(message = 'Cancelled.') {
    super({ code: ErrorCode.Cancelled, message });
  }
}

/** The command line was wrong. Exits 2 so scripts can distinguish it from a real failure. */
export class UsageError extends AtlasError {
  constructor(message: string, hint?: string) {
    super({
      code: ErrorCode.InvalidUsage,
      message,
      ...(hint === undefined ? {} : { hint }),
    });
  }
}
