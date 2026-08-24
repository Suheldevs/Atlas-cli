import { isAbsolute, normalize } from 'node:path';

import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';

export interface SocketOptions extends Record<string, unknown> {
  /** Destination prefix for the generated module, relative to the project root. */
  readonly directory: string;
}

/**
 * Reads the generator's options out of raw command-line flags.
 *
 * Separate from the generator so the parsing rules can be tested without a project, a reporter
 * or a template loader.
 */
export function readSocketOptions(
  flags: Readonly<Record<string, unknown>>,
  fallbackDirectory: string,
): SocketOptions {
  const directory = flags['dir'];

  return {
    directory:
      typeof directory === 'string' && directory.length > 0 ? directory : fallbackDirectory,
  };
}

/**
 * Rejects a destination that would escape the project.
 *
 * The engine refuses out-of-project writes too, but failing here names the flag the user actually
 * typed instead of reporting a plan they never saw.
 */
export function validateSocketOptions(options: SocketOptions): void {
  const { directory } = options;

  if (isAbsolute(directory)) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must be relative to the project root.',
      details: [directory],
      hint: 'Try --dir src/realtime',
    });
  }

  const normalized = normalize(directory).split('\\').join('/');

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must stay inside the project.',
      details: [directory],
      hint: 'Try --dir src/realtime',
    });
  }
}
