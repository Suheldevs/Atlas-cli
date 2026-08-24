import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CONFIG_FILE_NAMES, MANIFEST_FILE_NAME } from '../constants/paths.js';
import { parseJsonObject } from '../detection/manifest-reader.js';
import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type { FileSystemService } from '../services/filesystem.service.js';
import type { Reporter } from '../services/reporter.service.js';

import { parseAtlasConfig, type AtlasConfig } from './config-schema.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { mergeConfigs } from './resolved-config.js';

/** `package.json` key Atlas reads, so a project can configure it without a new file. */
const MANIFEST_CONFIG_KEY = 'atlas';

/** Extensions plain Node refuses to import. See {@link unsupportedTypeScriptConfig}. */
const TYPESCRIPT_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.mts']);

const JSON_EXTENSION = '.json';

export interface ConfigLoaderOptions {
  readonly fs: FileSystemService;
  readonly reporter: Reporter;
  /**
   * Injectable importer. Real code gets `import()`; tests pass a map lookup, which keeps
   * executable config files testable without writing to a real disk.
   */
  readonly importModule?: ((specifier: string) => Promise<unknown>) | undefined;
}

export interface LoadedConfig {
  /** The config file and the `package.json` key already folded together. */
  readonly config: AtlasConfig;
  /** Path of the highest-precedence source, or undefined when nothing configured Atlas. */
  readonly path: string | undefined;
}

function defaultImport(specifier: string): Promise<unknown> {
  // Absolute paths must become file URLs before `import()` accepts them on Windows, where a
  // bare `C:\...` string is parsed as a URL scheme.
  const target = /^[A-Za-z]:[\\/]|^\//u.test(specifier) ? pathToFileURL(specifier).href : specifier;

  return import(target) as Promise<unknown>;
}

/** Picks the config out of a module's exports, tolerating the three usual styles. */
function unwrapConfigExport(module: unknown): unknown {
  if (typeof module !== 'object' || module === null) {
    return module;
  }

  // Falling through to the module itself supports `export const sourceDir = 'src'`, where
  // the namespace object *is* the config.
  const record = module as Record<string, unknown>;
  return record['default'] ?? record['config'] ?? module;
}

/**
 * Finds and parses the target project's configuration.
 *
 * A malformed config is fatal rather than ignored. Falling back to defaults would make
 * Atlas generate something other than what the file asked for, with nothing on screen to
 * explain why — and the user would only find out by reading the generated code.
 */
export class ConfigLoader {
  readonly #fs: FileSystemService;
  readonly #reporter: Reporter;
  readonly #import: (specifier: string) => Promise<unknown>;

  constructor(options: ConfigLoaderOptions) {
    this.#fs = options.fs;
    this.#reporter = options.reporter;
    this.#import = options.importModule ?? defaultImport;
  }

  async load(root: string): Promise<LoadedConfig> {
    const manifestPath = join(root, MANIFEST_FILE_NAME);
    const manifestConfig = await this.#loadFromManifest(manifestPath);
    const configPath = await this.#findConfigFile(root);

    if (configPath === undefined) {
      // No config file at all is the normal case, not something to warn about.
      if (manifestConfig === undefined) {
        this.#reporter.debug(`config: no configuration found in ${root}`);
        return { config: DEFAULT_CONFIG, path: undefined };
      }

      this.#reporter.debug(`config: loaded ${manifestPath} ("${MANIFEST_CONFIG_KEY}" key)`);
      return { config: manifestConfig, path: manifestPath };
    }

    const fileConfig = await this.#read(configPath);
    this.#reporter.debug(`config: loaded ${configPath}`);

    // Merged, not replaced: the file outranks the manifest key, but a project that lists its
    // plugins in `package.json` and its generator options in `atlas.config.json` means both.
    return { config: mergeConfigs(manifestConfig, fileConfig), path: configPath };
  }

  /** First name in `CONFIG_FILE_NAMES` that exists wins; the tuple is the precedence order. */
  async #findConfigFile(root: string): Promise<string | undefined> {
    for (const name of CONFIG_FILE_NAMES) {
      const candidate = join(root, name);
      if (await this.#fs.exists(candidate)) return candidate;
    }

    return undefined;
  }

  async #loadFromManifest(path: string): Promise<AtlasConfig | undefined> {
    const text = await this.#fs.readTextIfExists(path);
    if (text === undefined) return undefined;

    // A `package.json` a human has hand-broken is detection's problem to report, not this
    // loader's: `parseJsonObject` returns undefined for exactly that case.
    const manifest = parseJsonObject(text);
    const raw = manifest?.[MANIFEST_CONFIG_KEY];
    if (raw === undefined) return undefined;

    return parseAtlasConfig(raw, `${path} ("${MANIFEST_CONFIG_KEY}" key)`);
  }

  async #read(path: string): Promise<AtlasConfig> {
    const extension = extname(path);

    if (TYPESCRIPT_EXTENSIONS.has(extension)) {
      throw unsupportedTypeScriptConfig(path);
    }

    return extension === JSON_EXTENSION ? this.#readJson(path) : this.#readModule(path);
  }

  async #readJson(path: string): Promise<AtlasConfig> {
    const text = await this.#fs.readText(path);
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new AtlasError({
        code: ErrorCode.InvalidUsage,
        message: `${path} is not valid JSON.`,
        hint: 'Fix the syntax error, or delete the file to fall back to Atlas defaults.',
        details: [describeCause(error)],
        cause: error,
      });
    }

    return parseAtlasConfig(parsed, path);
  }

  async #readModule(path: string): Promise<AtlasConfig> {
    let module: unknown;

    try {
      module = await this.#import(path);
    } catch (error) {
      throw new AtlasError({
        code: ErrorCode.InvalidUsage,
        message: `${path} could not be imported.`,
        hint: 'The file has to be valid ESM exporting the config as `default` or `config`.',
        details: [describeCause(error)],
        cause: error,
      });
    }

    return parseAtlasConfig(unwrapConfigExport(module), path);
  }
}

/**
 * Refuses a TypeScript config, clearly.
 *
 * Loading `atlas.config.ts` transparently would mean bundling a transpiler into the CLI and
 * paying for it on every invocation — a deliberate non-goal for a tool whose entire promise
 * is that it leaves nothing behind. Node's own type stripping is not a way out either: it is
 * unavailable on the oldest Node the CLI supports, so a `.ts` config would work or fail
 * depending on the user's runtime, which is worse than not supporting it at all. Saying so
 * beats an `ERR_UNKNOWN_FILE_EXTENSION` stack trace from inside `import()`.
 */
function unsupportedTypeScriptConfig(path: string): AtlasError {
  const alternatives = CONFIG_FILE_NAMES.filter(
    (name) => !TYPESCRIPT_EXTENSIONS.has(extname(name)),
  );

  return new AtlasError({
    code: ErrorCode.InvalidUsage,
    message: `${path} requires a TypeScript-aware loader, which Atlas does not provide.`,
    hint: 'Rename it to atlas.config.mjs, or move the settings into atlas.config.json.',
    details: [
      'Atlas does not transpile TypeScript, and it cannot rely on Node stripping the types.',
      `Supported instead: ${alternatives.join(', ')}.`,
    ],
  });
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
