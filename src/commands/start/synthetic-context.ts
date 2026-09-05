import { join } from 'node:path';

import type {
  DatabaseLayer,
  Framework,
  Language,
  PackageManager,
  ProjectContext,
} from '../../types/project-context.js';

/** Directory the generated Express API occupies, relative to the project root. */
export const SERVER_DIR_NAME = 'server';

/** Directory the generated React application occupies, relative to the project root. */
export const CLIENT_DIR_NAME = 'client';

export interface SyntheticContextRequest {
  /** Absolute path to the directory the new project will occupy. Need not exist yet. */
  readonly root: string;
  readonly language: Language;
  /**
   * What the user's environment suggests, detected from the directory `start` was run in.
   * Falls back to npm, which ships with every Node installation.
   */
  readonly packageManager: PackageManager;
}

/** The two independent packages `start` writes. Neither has a root manifest above it. */
export interface SyntheticProject {
  readonly server: ProjectContext;
  readonly client: ProjectContext;
}

/**
 * Describes a project that does not exist yet.
 *
 * This is the whole trick behind `start`. Every other command begins by running detection over
 * a directory, and a `ProjectContext` is the result. But detection cannot describe an empty
 * directory — there is no manifest to read, no lockfile to find, no tsconfig to classify — so
 * the obvious implementation of `start` is a second generation pipeline that writes files
 * directly, with its own conflict handling, its own dry-run support, and its own bugs.
 *
 * Instead, `start` states the context it is about to make true. The decisions detection would
 * have made are simply asserted here: the server is Express on ESM with Mongoose, the client is
 * React, both keep source under `src/`, and neither is part of a workspace. With that in hand,
 * the entire existing engine works unchanged — template loading, token substitution, the plan
 * builder, conflict detection, the transactional commit, `--dry-run`, dependency installation.
 * `start` becomes an orchestrator over machinery that is already tested, rather than a parallel
 * implementation of it.
 *
 * The two halves are deliberately separate contexts rather than one. They are separate npm
 * packages with separate manifests, separate dependency trees and separate `dev` scripts, and
 * the engine installs into `workspace.installRoot` — so describing them as one project would
 * put the client's React dependencies in the server's `node_modules`.
 */
export function createSyntheticProject(request: SyntheticContextRequest): SyntheticProject {
  return {
    server: createHalf(request, join(request.root, SERVER_DIR_NAME), 'express', 'mongoose'),
    client: createHalf(request, join(request.root, CLIENT_DIR_NAME), 'react', 'none'),
  };
}

function createHalf(
  request: SyntheticContextRequest,
  root: string,
  framework: Framework,
  database: DatabaseLayer,
): ProjectContext {
  const { language, packageManager } = request;
  const typed = language === 'typescript';

  return {
    root,
    // Nothing has been written yet, so there is no manifest to describe. Consumers already
    // handle this: `atlas info` runs in directories without one, and the dependency planner
    // reads `undefined` as "nothing is installed", which is exactly right for a new project.
    manifest: undefined,
    framework,
    language,
    // ESM unconditionally. A scaffold gets to pick, and picking CommonJS in 2026 would hand
    // the user a project that fights every dependency it is about to install.
    moduleSystem: 'esm',
    packageManager,
    database,
    typescript: {
      present: typed,
      // Asserted, not probed. The base template writes this file, so by the time anything reads
      // the path it is true — and stating it here keeps the JavaScript half honestly empty.
      configPath: typed ? join(root, 'tsconfig.json') : undefined,
      strict: typed,
    },
    layout: { sourceDir: 'src', flat: false },
    workspace: {
      isMonorepo: false,
      // Each half installs into itself. There is no root manifest to hoist into, and pointing
      // both at the project root would produce one `node_modules` that neither package can
      // resolve through.
      installRoot: root,
      workspaceRoot: undefined,
    },
    // Follows from ESM: TypeScript requires the emitted extension on relative imports, and
    // Node requires it at runtime for JavaScript.
    importSuffix: '.js',
  };
}
