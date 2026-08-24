import { dirname, join } from 'node:path';

import type { FileSystemService } from '../../services/filesystem.service.js';
import type { PackageManifest, WorkspaceInfo } from '../../types/project-context.js';
import { readManifest } from '../manifest-reader.js';

/** Files that only exist at the root of a workspace, whatever tool manages it. */
const WORKSPACE_MARKER_FILES = ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json'] as const;

/**
 * Finds the workspace root above `root`, if there is one.
 *
 * Searched from the nearest directory outward, so a nested workspace resolves to the inner
 * root — which is the one whose lockfile and `node_modules` actually serve this package.
 */
export async function detectWorkspace(fs: FileSystemService, root: string): Promise<WorkspaceInfo> {
  for (const directory of ancestors(root)) {
    if (await isWorkspaceRoot(fs, directory)) {
      // `installRoot` is the workspace root and not the package directory. Running an
      // install inside the package creates a nested `node_modules` that Node's resolution
      // finds first and the workspace's hoisted tree never sees, so the dependency looks
      // installed, resolves to a second copy, and duplicate-instance bugs follow.
      return { isMonorepo: true, installRoot: directory, workspaceRoot: directory };
    }
  }

  return { isMonorepo: false, installRoot: root, workspaceRoot: undefined };
}

async function isWorkspaceRoot(fs: FileSystemService, directory: string): Promise<boolean> {
  for (const fileName of WORKSPACE_MARKER_FILES) {
    if (await fs.exists(join(directory, fileName))) return true;
  }

  return declaresWorkspaces(await readManifest(fs, directory));
}

/**
 * npm, Yarn and Bun all declare workspaces in `package.json` — as an array of globs, or as
 * an object with a `packages` array under Yarn's classic form.
 */
function declaresWorkspaces(manifest: PackageManifest | undefined): boolean {
  const workspaces = manifest?.raw['workspaces'];
  if (Array.isArray(workspaces)) return workspaces.length > 0;

  return typeof workspaces === 'object' && workspaces !== null;
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
