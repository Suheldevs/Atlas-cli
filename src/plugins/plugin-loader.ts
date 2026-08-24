import { pathToFileURL } from 'node:url';

import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type { Reporter } from '../services/reporter.service.js';
import type { LoadedPlugin } from '../types/plugin.js';

import type { ResolvedPluginSpecifier } from './plugin-resolver.js';
import { assertIsPlugin } from './plugin-validator.js';

export interface PluginLoaderOptions {
  readonly reporter: Reporter;
  /**
   * Injectable importer. Real code passes `import()`; tests pass a map lookup, which keeps
   * plugin loading testable without publishing fixture packages to a registry.
   */
  readonly importModule?: (specifier: string) => Promise<unknown>;
}

function defaultImport(specifier: string): Promise<unknown> {
  // Absolute paths must become file URLs before `import()` accepts them on Windows, where a
  // bare `C:\...` string is parsed as a URL scheme.
  const target = /^[A-Za-z]:[\\/]|^\//u.test(specifier) ? pathToFileURL(specifier).href : specifier;

  return import(target) as Promise<unknown>;
}

/** Picks the plugin object out of a module's exports, tolerating both common styles. */
function unwrap(module: unknown): unknown {
  if (typeof module !== 'object' || module === null) {
    return module;
  }

  const record = module as Record<string, unknown>;
  return record['default'] ?? record['plugin'] ?? module;
}

export class PluginLoader {
  readonly #reporter: Reporter;
  readonly #import: (specifier: string) => Promise<unknown>;

  constructor(options: PluginLoaderOptions) {
    this.#reporter = options.reporter;
    this.#import = options.importModule ?? defaultImport;
  }

  /**
   * Loads every resolved plugin, keeping the ones that work.
   *
   * A broken third-party plugin warns and is skipped rather than aborting the run: the user
   * asked to generate something, and refusing to do it because an unrelated plugin failed to
   * parse would be the wrong trade. The warning names the plugin so the fault is obvious.
   */
  async loadAll(specifiers: readonly ResolvedPluginSpecifier[]): Promise<readonly LoadedPlugin[]> {
    const loaded: LoadedPlugin[] = [];

    for (const specifier of specifiers) {
      try {
        loaded.push(await this.load(specifier));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.#reporter.warn(`Skipped plugin ${specifier.source.specifier}: ${detail}`);
        this.#reporter.debug(error instanceof Error ? (error.stack ?? detail) : detail);
      }
    }

    return loaded;
  }

  async load(specifier: ResolvedPluginSpecifier): Promise<LoadedPlugin> {
    let module: unknown;

    try {
      module = await this.#import(specifier.importSpecifier);
    } catch (error) {
      throw new AtlasError({
        code: ErrorCode.PluginLoadFailed,
        message: `Could not import ${specifier.source.specifier}.`,
        cause: error,
        hint: 'Check that the package is installed and exports ESM.',
      });
    }

    const plugin = assertIsPlugin(unwrap(module), specifier.source.specifier);
    this.#reporter.debug(`Loaded plugin ${plugin.name}@${plugin.version}`);

    return { plugin, source: specifier.source };
  }
}
