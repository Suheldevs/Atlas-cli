import { dirname, join } from 'node:path';

import { LOCKFILE_NAMES } from '../../constants/paths.js';
import type { FileSystemService } from '../../services/filesystem.service.js';
import type { PackageManager, PackageManifest } from '../../types/project-context.js';

const PACKAGE_MANAGERS: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

/**
 * Identifies the package manager Atlas should invoke to install dependencies.
 *
 * Precedence, strongest evidence first:
 *
 * 1. `packageManager` in `package.json` — an explicit declaration by the project and what
 *    Corepack enforces, so it outranks a stale lockfile left behind by another tool.
 * 2. The nearest lockfile at or above `root`. Walking upward matters: a package inside a
 *    workspace has no lockfile of its own, and the workspace's is the one that governs it.
 * 3. `npm_config_user_agent`, set when Atlas was itself launched through a package manager
 *    (`pnpm dlx atlas`), which is decent evidence of what the user reaches for.
 * 4. npm, which ships with every Node installation and is therefore always safe.
 */
export async function detectPackageManager(
  fs: FileSystemService,
  root: string,
  manifest: PackageManifest | undefined,
): Promise<PackageManager> {
  const declared = parseDeclaration(manifest?.raw['packageManager']);
  if (declared !== undefined) return declared;

  const fromLockfile = await findLockfileManager(fs, root);
  if (fromLockfile !== undefined) return fromLockfile;

  return parseUserAgent(process.env['npm_config_user_agent']) ?? 'npm';
}

/** `"pnpm@9.1.0+sha512.abc"` — the name is everything before the version separator. */
function parseDeclaration(value: unknown): PackageManager | undefined {
  if (typeof value !== 'string') return undefined;

  return toPackageManager(value.trim().split('@')[0]);
}

/** `"pnpm/9.1.0 npm/? node/v22.13.0 linux x64"` — the launching tool comes first. */
function parseUserAgent(value: string | undefined): PackageManager | undefined {
  return toPackageManager(value?.trim().split('/')[0]);
}

function toPackageManager(value: string | undefined): PackageManager | undefined {
  return PACKAGE_MANAGERS.find((candidate) => candidate === value);
}

/**
 * Searched one directory at a time so the nearest lockfile always wins over a more distant
 * one. Within a single directory — a repository that has switched managers and kept both
 * files — ties break on the declaration order of `LOCKFILE_NAMES`.
 */
async function findLockfileManager(
  fs: FileSystemService,
  root: string,
): Promise<PackageManager | undefined> {
  for (const directory of ancestors(root)) {
    for (const [fileName, manager] of Object.entries(LOCKFILE_NAMES)) {
      if (await fs.exists(join(directory, fileName))) return manager;
    }
  }

  return undefined;
}

/** Yields `from` and every directory above it, stopping at the filesystem root. */
function* ancestors(from: string): Generator<string> {
  let current = from;

  for (;;) {
    yield current;

    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
