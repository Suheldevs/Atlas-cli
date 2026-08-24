import { isAbsolute, normalize } from 'node:path';

import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';

export interface LoggerOptions extends Record<string, unknown> {
  /** Destination prefix for the generated module, relative to the project root. */
  readonly directory: string;
}

/**
 * Reads the generator's options out of raw command-line flags.
 *
 * Kept separate from the generator so the parsing rules can be tested without constructing a
 * project, a reporter, or a template loader.
 */
export function readLoggerOptions(
  flags: Readonly<Record<string, unknown>>,
  fallbackDirectory: string,
): LoggerOptions {
  const directory = flags['dir'];

  return {
    directory:
      typeof directory === 'string' && directory.length > 0 ? directory : fallbackDirectory,
  };
}

/**
 * Rejects a destination that would escape the project.
 *
 * The engine refuses out-of-project writes as well, but failing here names the flag the user
 * actually typed instead of reporting a plan the user never saw.
 */
export function validateLoggerOptions(options: LoggerOptions): void {
  const { directory } = options;

  if (isAbsolute(directory)) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must be relative to the project root.',
      details: [directory],
      hint: 'Try --dir src/lib',
    });
  }

  const normalized = normalize(directory).split('\\').join('/');

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must stay inside the project.',
      details: [directory],
      hint: 'Try --dir src/lib',
    });
  }
}
