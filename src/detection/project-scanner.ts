import { join } from 'node:path';

import { MANIFEST_FILE_NAME } from '../constants/paths.js';
import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type { FileSystemService } from '../services/filesystem.service.js';
import type { ProjectContext } from '../types/project-context.js';

import { detectDatabase } from './detectors/database.detector.js';
import { detectFramework } from './detectors/framework.detector.js';
import { detectLanguage } from './detectors/language.detector.js';
import { detectModuleSystem } from './detectors/module-system.detector.js';
import { detectWorkspace } from './detectors/monorepo.detector.js';
import { detectPackageManager } from './detectors/package-manager.detector.js';
import { detectSourceLayout } from './detectors/src-layout.detector.js';
import { readManifest } from './manifest-reader.js';

export interface ScannerDependencies {
  readonly fs: FileSystemService;
}

/**
 * Builds the `ProjectContext` every generator reads.
 *
 * Scanning is tolerant by design: a directory with no `package.json` still produces a
 * context, so `atlas info` can describe whatever the user is standing in. Commands that
 * genuinely cannot proceed without a project call `requireProject` instead.
 */
export class ProjectScanner {
  readonly #fs: FileSystemService;

  /**
   * One entry per root, for the lifetime of the process.
   *
   * Detection is a dozen small reads, and generators, prompts and the conflict planner all
   * want the context at different moments. Caching means none of them has to thread it
   * through or think about the cost of asking again — and it guarantees a single generation
   * run sees one consistent answer even if the user edits files while a prompt is open.
   */
  readonly #cache = new Map<string, ProjectContext>();

  constructor(dependencies: ScannerDependencies) {
    this.#fs = dependencies.fs;
  }

  async scan(root: string): Promise<ProjectContext> {
    const key = cacheKey(root);

    const cached = this.#cache.get(key);
    if (cached !== undefined) return cached;

    const context = await this.#detect(root);
    this.#cache.set(key, context);

    return context;
  }

  /** Same as `scan`, but refuses to describe a directory that is not a Node project. */
  async requireProject(root: string): Promise<ProjectContext> {
    const context = await this.scan(root);

    if (context.manifest === undefined) {
      throw new AtlasError({
        code: ErrorCode.NotAProject,
        message: `No ${MANIFEST_FILE_NAME} found in ${root}.`,
        hint: 'Run Atlas from your project root, or create a project there first.',
        details: [`Looked for ${join(root, MANIFEST_FILE_NAME)}`],
      });
    }

    return context;
  }

  async #detect(root: string): Promise<ProjectContext> {
    const manifest = await readManifest(this.#fs, root);

    // The module system reads the same tsconfig the language detector locates, so it waits
    // for that answer; everything below is independent and runs together.
    const { language, typescript } = await detectLanguage(this.#fs, root, manifest);

    const [moduleSystem, packageManager, layout, workspace] = await Promise.all([
      detectModuleSystem(manifest, typescript, this.#fs, root),
      detectPackageManager(this.#fs, root, manifest),
      detectSourceLayout(this.#fs, root),
      detectWorkspace(this.#fs, root),
    ]);

    return {
      root,
      manifest,
      framework: detectFramework(manifest),
      language,
      moduleSystem,
      packageManager,
      database: detectDatabase(manifest),
      typescript,
      layout,
      workspace,
      importSuffix: moduleSystem === 'esm' ? '.js' : '',
    };
  }
}

/**
 * Not a path, only a key: it exists so `C:\repo` and `C:/repo` — the same directory
 * reached through different APIs — share one cache entry instead of scanning twice.
 */
function cacheKey(root: string): string {
  return root.split('\\').join('/');
}
