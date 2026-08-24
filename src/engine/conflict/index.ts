/**
 * Conflict handling: classify what is already on disk, ask about it once, and never replace a
 * file the user wrote without either their answer or a backup beside it.
 */

export { backupPathFor, isBackupPath } from './backup-strategy.js';
export {
  detectConflicts,
  requiresDecision,
  type ConflictKind,
  type FileConflict,
} from './conflict-detector.js';
export {
  ConflictResolver,
  outcomeForDecision,
  type ConflictAsk,
  type ConflictChoice,
  type ConflictDecision,
  type ConflictResolution,
  type ConflictResolverOptions,
  type ResolvedChoice,
  type ResolveOptions,
} from './conflict-resolver.js';
export { renderUnifiedDiff, type DiffOptions } from './diff-renderer.js';
