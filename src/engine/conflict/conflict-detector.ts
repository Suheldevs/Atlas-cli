import { fingerprint, type FileSystemService } from '../../services/filesystem.service.js';
import type { FileOperation } from '../../types/generation-plan.js';

export type ConflictKind = 'absent' | 'identical' | 'differs';

export interface FileConflict {
  readonly path: string;
  readonly kind: ConflictKind;
  /** Current contents on disk; undefined when `kind` is `absent`. */
  readonly existing: string | undefined;
  readonly incoming: string;
}

/** Only `differs` needs a human. Everything else has one correct answer. */
export function requiresDecision(conflict: FileConflict): boolean {
  return conflict.kind === 'differs';
}

async function classify(fs: FileSystemService, operation: FileOperation): Promise<FileConflict> {
  const existing = await fs.readTextIfExists(operation.path);

  if (existing === undefined) {
    return {
      path: operation.path,
      kind: 'absent',
      existing: undefined,
      incoming: operation.contents,
    };
  }

  // Compared by fingerprint, which normalises line endings: a file Git checked out with CRLF is
  // byte-different from the same file generated with LF, and prompting about that would teach
  // users to dismiss the prompt that actually matters. Matching content also makes re-running a
  // generator a safe no-op, which is the behaviour that lets people run `atlas add` twice
  // without thinking about it.
  const kind: ConflictKind =
    fingerprint(existing) === fingerprint(operation.contents) ? 'identical' : 'differs';

  return { path: operation.path, kind, existing, incoming: operation.contents };
}

/**
 * Classifies every target path before anything is written.
 *
 * Detection is a single up-front pass rather than a check performed as each file is reached,
 * because the entire point is to ask the user every question they need to answer before the run
 * starts changing their project. A prompt that arrives after four files have landed offers no
 * useful answer.
 */
export function detectConflicts(
  fs: FileSystemService,
  operations: readonly FileOperation[],
): Promise<readonly FileConflict[]> {
  return Promise.all(operations.map((operation) => classify(fs, operation)));
}
