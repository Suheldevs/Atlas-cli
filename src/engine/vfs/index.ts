/**
 * Transactional filesystem for generation: stage everything, commit once, undo on failure.
 *
 * Nothing outside this directory writes generated files.
 */

export { commitStagedOperations, type CommitOptions } from './commit.js';
export {
  RollbackJournal,
  type RollbackEntry,
  type RollbackJournalOptions,
  type RollbackRemoval,
  type RollbackRestoration,
} from './rollback.js';
export {
  VirtualFileSystem,
  type StagedCopy,
  type StagedDelete,
  type StagedOperation,
  type StagedWrite,
} from './virtual-file-system.js';
