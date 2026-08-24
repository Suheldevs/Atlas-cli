import { isAbsolute, normalize } from 'node:path';

import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';

/** The providers this template writes a working datasource for. */
export type PrismaProvider = 'postgresql' | 'mysql' | 'sqlite';

export const PRISMA_PROVIDERS: readonly PrismaProvider[] = ['postgresql', 'mysql', 'sqlite'];

export const DEFAULT_PROVIDER: PrismaProvider = 'postgresql';

export interface PrismaOptions extends Record<string, unknown> {
  /** Destination prefix for `db/`, relative to the project root. The schema ignores it. */
  readonly directory: string;
  readonly provider: PrismaProvider;
}

/**
 * Reads whatever the command line supplied.
 *
 * An absent flag comes back undefined rather than defaulted, so the prompt step can ask — a flag
 * and a prompt must not both claim to own the default.
 */
export function readPrismaFlags(flags: Readonly<Record<string, unknown>>): {
  readonly directory: string | undefined;
  readonly provider: PrismaProvider | undefined;
} {
  const directory = flags['dir'];

  return {
    directory: typeof directory === 'string' && directory.length > 0 ? directory : undefined,
    provider: readProvider(flags['provider']),
  };
}

function readProvider(value: unknown): PrismaProvider | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' && (PRISMA_PROVIDERS as readonly string[]).includes(value)) {
    return value as PrismaProvider;
  }

  throw new AtlasError({
    code: ErrorCode.InvalidUsage,
    message: `--provider must be one of: ${PRISMA_PROVIDERS.join(', ')}.`,
    // Stringified rather than interpolated: the value arrived as `unknown`, and an object would
    // otherwise be reported as the useless `[object Object]`.
    details: [`received: ${typeof value === 'string' ? value : JSON.stringify(value)}`],
    hint: 'Other providers work too, but you would have to edit the datasource block yourself.',
  });
}

/**
 * Rejects a destination that would escape the project.
 *
 * The engine refuses out-of-project writes as well, but failing here names the flag the user
 * actually typed instead of reporting a plan they never saw.
 */
export function validatePrismaOptions(options: PrismaOptions): void {
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
