import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { FileSystemService } from '../../services/filesystem.service.js';
import type { Reporter } from '../../services/reporter.service.js';

import type { RollbackJournal } from './rollback.js';
import type { StagedOperation, VirtualFileSystem } from './virtual-file-system.js';

export interface CommitOptions {
  readonly vfs: VirtualFileSystem;
  readonly fs: FileSystemService;
  readonly journal: RollbackJournal;
  readonly reporter: Reporter;
  /** Skips every disk mutation and reports what the same walk would have done. */
  readonly dryRun: boolean;
}

/** The path each operation targets — for a copy that is the destination, not the source. */
function targetOf(operation: StagedOperation): string {
  return operation.kind === 'copy' ? operation.to : operation.path;
}

function describeOperation(operation: StagedOperation): string {
  switch (operation.kind) {
    case 'write':
      return `write ${operation.path}`;
    case 'delete':
      return `delete ${operation.path}`;
    case 'copy':
      return `copy ${operation.from} -> ${operation.to}`;
  }
}

/**
 * The only place in Atlas where staged work reaches the disk.
 *
 * Every operation is journalled before it is applied, so a failure anywhere in the sequence can
 * be undone completely. One flush point is what makes that guarantee auditable: there is no
 * second code path that writes files without a journal entry behind it.
 *
 * Returns the paths that were written, deleted, or copied to, in application order.
 */
export async function commitStagedOperations(options: CommitOptions): Promise<readonly string[]> {
  const { vfs, fs, journal, reporter, dryRun } = options;
  const operations = vfs.pending();

  if (dryRun) {
    for (const operation of operations) reporter.debug(`would ${describeOperation(operation)}`);
    return operations.map(targetOf);
  }

  const applied: string[] = [];

  try {
    for (const operation of operations) {
      await journal.capture(targetOf(operation));
      reporter.debug(describeOperation(operation));

      switch (operation.kind) {
        case 'write':
          await fs.writeText(operation.path, operation.contents);
          break;
        case 'delete':
          await fs.remove(operation.path);
          break;
        case 'copy':
          await fs.copyFile(operation.from, operation.to);
          break;
      }

      applied.push(targetOf(operation));
    }
  } catch (error: unknown) {
    reporter.warn(`Write failed after ${String(applied.length)} change(s). Rolling back.`);

    // Deliberately not wrapped: if the rollback itself fails, `RollbackFailed` names the paths
    // the user has to look at, and that is strictly more urgent than the write that started it.
    await journal.restore();

    reporter.info('Rolled back. Your project is unchanged.');

    throw new AtlasError({
      code: ErrorCode.GenerationFailed,
      message: 'Generation failed part-way through, so no changes were kept.',
      hint: 'Fix the cause below and run the same command again.',
      details: applied.length > 0 ? [`Reverted ${String(applied.length)} change(s).`] : [],
      cause: error,
    });
  }

  // Flushed work must not be flushed twice; leaving it staged invites a caller that reuses the
  // VFS to re-apply operations whose rollback entries have already been consumed.
  vfs.clear();

  return applied;
}
