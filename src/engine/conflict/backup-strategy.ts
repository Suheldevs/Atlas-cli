import { BACKUP_FILE_SUFFIX } from '../../constants/paths.js';
import type { Clock } from '../../services/clock.service.js';

/**
 * Names the sibling file a "backup and replace" answer writes: `router.ts` becomes
 * `router.ts.1767225600000.atlas-backup`.
 *
 * The timestamp sits between the original name and the suffix rather than at the end so the
 * original extension stays visible — the file still sorts next to its original, still reads as
 * "the old router.ts", and editors that highlight by the last known extension leave it
 * unreadable only for the final segment. Ending in `.atlas-backup` also means one `.gitignore`
 * line covers every backup Atlas has ever taken.
 *
 * The timestamp comes from the injected clock, so the name a test asserts on is the name the
 * user sees.
 */
export function backupPathFor(path: string, clock: Clock): string {
  return `${path}.${String(clock.timestamp())}.${BACKUP_FILE_SUFFIX}`;
}

/** True for paths Atlas produced as backups, which scans and detectors must ignore. */
export function isBackupPath(path: string): boolean {
  return path.endsWith(`.${BACKUP_FILE_SUFFIX}`);
}
