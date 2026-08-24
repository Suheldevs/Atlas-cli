import { isAbsolute, normalize } from 'node:path';

import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';

export type AuthDatabase = 'mongoose' | 'prisma';

export const AUTH_DATABASES: readonly AuthDatabase[] = ['mongoose', 'prisma'];

/**
 * There is no hashing option. bcrypt is the only algorithm this template generates, so a flag
 * offering a choice would have exactly one valid value — and every generated file would still have
 * to be written as though the other branches existed.
 */
export interface AuthOptions extends Record<string, unknown> {
  /** Destination prefix for the module, relative to the project root. */
  readonly directory: string;
  readonly database: AuthDatabase;
}

function readChoice<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  flag: string,
): TValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as TValue;
  }

  throw new AtlasError({
    code: ErrorCode.InvalidUsage,
    message: `${flag} must be one of: ${allowed.join(', ')}.`,
    // `JSON.stringify` rather than `String`: the value came off the command line as `unknown`, and
    // an object would otherwise be reported as the useless `[object Object]`.
    details: [`received: ${typeof value === 'string' ? value : JSON.stringify(value)}`],
  });
}

/**
 * Reads whatever the command line supplied. Anything absent is left undefined so the prompt
 * step can ask — a flag and a prompt must not both claim to own the default.
 */
export function readAuthFlags(flags: Readonly<Record<string, unknown>>): {
  readonly directory: string | undefined;
  readonly database: AuthDatabase | undefined;
} {
  const directory = flags['dir'];

  return {
    directory: typeof directory === 'string' && directory.length > 0 ? directory : undefined,
    database: readChoice(flags['database'], AUTH_DATABASES, '--database'),
  };
}

/**
 * Rejects a destination that would escape the project.
 *
 * The engine refuses out-of-project writes too, but failing here names the flag the user typed
 * rather than reporting a plan they never saw.
 */
export function validateAuthOptions(options: AuthOptions): void {
  if (isAbsolute(options.directory)) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must be relative to the project root.',
      details: [options.directory],
      hint: 'Try --dir src',
    });
  }

  const normalized = normalize(options.directory).split('\\').join('/');

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: '--dir must stay inside the project.',
      details: [options.directory],
      hint: 'Try --dir src',
    });
  }
}
