import { dirname } from 'node:path';

import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';

/**
 * Filesystem errnos worth naming, mapped to what Atlas says about them.
 *
 * The default for an unrecognised write failure is a generic "generation failed", and for four
 * of these that answer costs the user real time. A full disk in particular looks exactly like a
 * bug in the generator until somebody thinks to run `df`, so the errno is worth translating
 * even though Atlas can do nothing about it.
 */
const FILESYSTEM_FAILURES: Readonly<
  Record<string, { readonly code: ErrorCode; readonly describe: (root: string) => string }>
> = {
  EACCES: {
    code: ErrorCode.DirectoryNotWritable,
    describe: (root) => `Atlas is not allowed to write to ${dirname(root)}.`,
  },
  EPERM: {
    code: ErrorCode.DirectoryNotWritable,
    describe: (root) => `The operating system refused Atlas permission to write to ${root}.`,
  },
  ENOSPC: {
    code: ErrorCode.DiskFull,
    describe: () => 'The disk ran out of space part-way through writing the project.',
  },
  EROFS: {
    code: ErrorCode.ReadOnlyFilesystem,
    describe: (root) => `${dirname(root)} is on a read-only filesystem.`,
  },
  ENAMETOOLONG: {
    code: ErrorCode.PathTooLong,
    describe: () => 'One of the generated paths is longer than this filesystem allows.',
  },
};

const HINTS: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.DirectoryNotWritable]:
    'Check the directory permissions, or pass --cwd to scaffold somewhere you own. Do not re-run Atlas with sudo — that leaves a project you cannot edit.',
  [ErrorCode.DiskFull]: 'Free some space and run the same command again. Nothing was kept.',
  [ErrorCode.ReadOnlyFilesystem]:
    'Remount the filesystem read-write, or pass --cwd to scaffold somewhere writable.',
  [ErrorCode.PathTooLong]:
    'Use a shorter project name, or scaffold closer to the root of the drive. On Windows, enabling long-path support also fixes this.',
};

/**
 * Re-describes a write failure in terms of the thing that actually went wrong.
 *
 * The engine wraps a commit failure as `GenerationFailed` with the original error as its cause,
 * which is right for a generator writing into an existing project — the interesting fact there
 * is that the project was restored. For `start` the interesting fact is *why*, because all four
 * causes below are things only the user can fix, and each needs a different action.
 *
 * Anything unrecognised is returned untouched. Guessing at an errno Atlas has never seen would
 * replace a true message with a plausible one.
 */
export function describeWriteFailure(error: unknown, root: string): unknown {
  const errno = findErrno(error);

  if (errno === undefined) {
    return error;
  }

  const failure = FILESYSTEM_FAILURES[errno];

  if (failure === undefined) {
    return error;
  }

  return new AtlasError({
    code: failure.code,
    message: failure.describe(root),
    hint: HINTS[failure.code] ?? 'Fix the cause below and run the same command again.',
    details: [errno, ...describeChain(error)],
    // Preserved so `--verbose` can still show the frame that threw. The presented message is
    // short; the chain behind it is complete.
    cause: error,
  });
}

/** Walks the `cause` chain for the first Node errno. The real one is usually two levels down. */
function findErrno(error: unknown): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 10 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { readonly code: unknown }).code;
      if (typeof code === 'string' && code.startsWith('E')) {
        return code;
      }
    }

    current = current instanceof Error ? current.cause : undefined;
  }

  return undefined;
}

/** Each message in the cause chain, so the details read top-down without a stack trace. */
function describeChain(error: unknown): readonly string[] {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }

  return messages;
}
