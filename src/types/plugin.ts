import type { AnyGenerator } from './generator.js';

/** Where a plugin came from. Reported by `atlas list` so users can see what is extending Atlas. */
export interface PluginSource {
  readonly kind: 'builtin' | 'node-module' | 'local';
  /** Package name, file path, or `builtin`. */
  readonly specifier: string;
}

/**
 * The object a third-party package exports to add generators.
 *
 * Deliberately tiny: a plugin is a name, a version, and some generators. Everything a
 * generator can do is already expressed by the `Generator` contract, so the plugin wrapper
 * has no reason to grow its own capabilities.
 */
export interface AtlasPlugin {
  readonly name: string;
  readonly version: string;
  readonly generators: readonly AnyGenerator[];
}

export interface LoadedPlugin {
  readonly plugin: AtlasPlugin;
  readonly source: PluginSource;
}
