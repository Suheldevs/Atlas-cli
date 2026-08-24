import { isAbsolute, join, resolve } from 'node:path';

import type { FileSystemService } from '../services/filesystem.service.js';
import type { PluginSource } from '../types/plugin.js';

/** Packages named like this are picked up from the project's dependencies automatically. */
const PLUGIN_NAME_PREFIX = 'atlas-plugin-';

const SCOPED_PLUGIN_PATTERN = /^@[^/]+\/atlas-plugin-/u;

export interface ResolvedPluginSpecifier {
  readonly source: PluginSource;
  /** What to hand to `import()`. Absolute for local plugins, bare for packages. */
  readonly importSpecifier: string;
}

function isPluginPackageName(name: string): boolean {
  return name.startsWith(PLUGIN_NAME_PREFIX) || SCOPED_PLUGIN_PATTERN.test(name);
}

/**
 * Finds plugins to load.
 *
 * Discovery is deliberately limited to two sources: packages the project already depends on
 * whose names follow the convention, and paths the project explicitly listed in its Atlas
 * config. Atlas never scans `node_modules` wholesale — that is slow on a large tree and it
 * would mean a transitive dependency could inject a generator the user never asked for.
 */
export class PluginResolver {
  readonly #fs: FileSystemService;

  constructor(dependencies: { readonly fs: FileSystemService }) {
    this.#fs = dependencies.fs;
  }

  /** Plugin packages named in the project's own dependency lists. */
  fromDependencies(dependencyNames: readonly string[]): readonly ResolvedPluginSpecifier[] {
    return dependencyNames
      .filter((name) => isPluginPackageName(name))
      .sort()
      .map((name) => ({
        source: { kind: 'node-module', specifier: name },
        importSpecifier: name,
      }));
  }

  /**
   * Plugin paths listed explicitly in configuration.
   *
   * Missing files are dropped rather than fatal: a stale entry in a shared config file
   * should not stop a teammate from generating anything at all.
   */
  async fromConfiguredPaths(
    root: string,
    configured: readonly string[],
  ): Promise<readonly ResolvedPluginSpecifier[]> {
    const resolved: ResolvedPluginSpecifier[] = [];

    for (const entry of configured) {
      if (isPluginPackageName(entry) && !entry.startsWith('.') && !isAbsolute(entry)) {
        resolved.push({
          source: { kind: 'node-module', specifier: entry },
          importSpecifier: entry,
        });
        continue;
      }

      const absolute = resolve(root, entry);
      const target = (await this.#fs.isDirectory(absolute)) ? join(absolute, 'index.js') : absolute;

      if (await this.#fs.exists(target)) {
        resolved.push({
          source: { kind: 'local', specifier: absolute },
          importSpecifier: target,
        });
      }
    }

    return resolved;
  }
}
