import { isAbsolute, normalize } from 'node:path';

import { assertValidEntityName } from '../../engine/template/token-table.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';

export interface CrudOptions extends Record<string, unknown> {
  /** The raw name the user typed, e.g. `user profile`. Every casing is derived from it. */
  readonly entity: string;
  /** Destination prefix for the generated files, relative to the project root. */
  readonly directory: string;
}

/**
 * Reads whatever the command line supplied. `--dir` is left undefined when absent so the caller
 * can fall back to the detected source directory — a flag and a default must not both claim it.
 */
export function readCrudFlags(flags: Readonly<Record<string, unknown>>): {
  readonly directory: string | undefined;
} {
  const directory = flags['dir'];

  return {
    directory: typeof directory === 'string' && directory.length > 0 ? directory : undefined,
  };
}

/**
 * Rejects options that cannot produce a valid resource.
 *
 * The entity name is re-checked here even though `prompt` already did: `validate` is pure and is
 * the last gate a programmatic caller passes through, and a name that reaches the token table
 * unchecked becomes a file called `123.model.ts`.
 */
export function validateCrudOptions(options: CrudOptions): void {
  assertValidEntityName(options.entity);

  const { directory } = options;

  if (isAbsolute(directory)) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must be relative to the project root.',
      details: [directory],
      hint: 'Try --dir src',
    });
  }

  const normalized = normalize(directory).split('\\').join('/');

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must stay inside the project.',
      details: [directory],
      hint: 'Try --dir src',
    });
  }
}
