import { BUILTIN_GENERATORS } from '../generators/index.js';
import { PluginLoader } from '../plugins/plugin-loader.js';
import { PluginResolver } from '../plugins/plugin-resolver.js';
import type { FileSystemService } from '../services/filesystem.service.js';
import type { Reporter } from '../services/reporter.service.js';
import type { PackageManifest } from '../types/project-context.js';
import type { PluginSource } from '../types/plugin.js';

import { GeneratorRegistry } from './generator-registry.js';

const BUILTIN_SOURCE: PluginSource = { kind: 'builtin', specifier: 'builtin' };

export interface DiscoveryOptions {
  readonly fs: FileSystemService;
  readonly reporter: Reporter;
  /** Project root, used to resolve locally-configured plugin paths. */
  readonly root: string;
  readonly manifest: PackageManifest | undefined;
  /** Plugin entries from `atlas.config.*`. */
  readonly configuredPlugins?: readonly string[];
  /** Injectable importer, so tests can supply plugins without publishing packages. */
  readonly importModule?: (specifier: string) => Promise<unknown>;
}

/**
 * Builds the registry for one invocation.
 *
 * Built-ins go in from a static manifest; external plugins are resolved and imported. Both
 * paths end at `registry.register`, so a plugin generator is indistinguishable downstream
 * from a bundled one — that equivalence is the whole reason the plugin system exists.
 */
export async function discoverGenerators(options: DiscoveryOptions): Promise<GeneratorRegistry> {
  const registry = new GeneratorRegistry();

  for (const generator of BUILTIN_GENERATORS) {
    registry.register(generator, BUILTIN_SOURCE);
  }

  const resolver = new PluginResolver({ fs: options.fs });
  const loader = new PluginLoader({
    reporter: options.reporter,
    ...(options.importModule === undefined ? {} : { importModule: options.importModule }),
  });

  const specifiers = [
    ...resolver.fromDependencies(dependencyNames(options.manifest)),
    ...(await resolver.fromConfiguredPaths(options.root, options.configuredPlugins ?? [])),
  ];

  for (const loaded of await loader.loadAll(specifiers)) {
    for (const generator of loaded.plugin.generators) {
      try {
        registry.register(generator, loaded.source);
      } catch (error) {
        // A name collision disqualifies the one generator, not the whole plugin: its other
        // generators are still perfectly usable.
        const detail = error instanceof Error ? error.message : String(error);
        options.reporter.warn(detail);
      }
    }
  }

  options.reporter.debug(`Registered ${String(registry.size)} generator(s)`);

  return registry;
}

function dependencyNames(manifest: PackageManifest | undefined): readonly string[] {
  if (manifest === undefined) {
    return [];
  }

  return [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)];
}
