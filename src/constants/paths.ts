/**
 * File and directory names Atlas looks for or creates.
 *
 * Names only — no path resolution happens here, so this module stays import-free and
 * usable from anywhere. Resolution against a real package root lives in
 * `src/config/package-meta.ts`.
 */

export const MANIFEST_FILE_NAME = 'package.json';

/** Directory holding the shipped templates, relative to the package root. */
export const TEMPLATES_DIR_NAME = 'templates';

/** Per-template metadata file. Dependencies are declared here and nowhere else. */
export const TEMPLATE_MANIFEST_FILE_NAME = 'template.json';

/**
 * Suffix appended when the user chooses "backup and replace" on a conflict. The
 * timestamp is inserted before it, giving `router.ts.1753564800000.atlas-backup`.
 */
export const BACKUP_FILE_SUFFIX = 'atlas-backup';

/** Config file names Atlas probes in the target project, in precedence order. */
export const CONFIG_FILE_NAMES = [
  'atlas.config.ts',
  'atlas.config.mts',
  'atlas.config.js',
  'atlas.config.mjs',
  'atlas.config.json',
] as const;

/** Lockfiles, mapped to the package manager that produces them. */
export const LOCKFILE_NAMES = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
} as const;
