import type { GlobalOptions } from '../types/cli-options.js';

import { freezeConfig, type AtlasConfig } from './config-schema.js';
import { DEFAULT_CONFIG } from './defaults.js';

/** An `AtlasConfig` that knows where it came from, for `atlas info` and for diagnostics. */
export interface ResolvedConfig extends AtlasConfig {
  /** Absolute path of the highest-precedence source, or undefined when nothing was found. */
  readonly source: string | undefined;
}

export interface ResolveConfigOptions {
  /** Contents of `atlas.config.*`, already parsed. `DEFAULT_CONFIG` when there is no file. */
  readonly fileConfig: AtlasConfig;
  /** Contents of the `package.json` `"atlas"` key, or undefined when it is absent. */
  readonly manifestConfig: AtlasConfig | undefined;
  /**
   * The parsed command line.
   *
   * None of `--cwd`, `--yes`, `--dry-run`, `--verbose` or `--no-color` has an `AtlasConfig`
   * counterpart today, so this layer currently contributes nothing — `--dry-run` in
   * particular must *not* switch formatting off, because the engine formats before it
   * detects conflicts and a dry run that skipped formatting would preview a result the real
   * run would not produce. Taking the options here anyway keeps the mapping in one place
   * for the first flag that does overlap.
   */
  readonly globals: GlobalOptions;
  /**
   * Config-shaped overrides taken from flags, highest precedence of all. Build one with
   * `defaultsFor({ ... })`.
   */
  readonly flags?: AtlasConfig | undefined;
  /** Path recorded on the result; usually the config file that `ConfigLoader` found. */
  readonly source: string | undefined;
}

/**
 * Folds layers together, lowest precedence first, starting from `DEFAULT_CONFIG`.
 *
 * Scalars follow the obvious rule: a later layer's defined value wins, and `undefined`
 * never clobbers — an omitted key is not a request to reset anything.
 *
 * Arrays deliberately break that rule and union instead. `plugins` and `disabledGenerators`
 * are additive statements about the project, not single choices: a workspace-root config
 * disabling a generator and a package-level config adding a plugin are both true at the
 * same time, and letting the higher layer replace the array would erase a decision it never
 * mentioned. The price is that a lower layer's entry cannot be removed from above, which is
 * the cheaper of the two mistakes to live with.
 *
 * `generators` is merged per generator name, for the same reason one layer deep.
 */
export function mergeConfigs(...layers: readonly (AtlasConfig | undefined)[]): AtlasConfig {
  let merged: AtlasConfig = DEFAULT_CONFIG;

  for (const layer of layers) {
    if (layer === undefined) continue;

    merged = {
      // `??`, never a truthiness test: `format: false` is an answer, not an absence.
      sourceDir: layer.sourceDir ?? merged.sourceDir,
      plugins: union(merged.plugins, layer.plugins),
      disabledGenerators: union(merged.disabledGenerators, layer.disabledGenerators),
      format: layer.format ?? merged.format,
      generators: mergeGenerators(merged.generators, layer.generators),
    };
  }

  return freezeConfig(merged);
}

/**
 * The precedence chain, in one place: defaults → `package.json#atlas` → config file → flags.
 */
export function resolveConfig(options: ResolveConfigOptions): ResolvedConfig {
  const merged = mergeConfigs(options.manifestConfig, options.fileConfig, options.flags);

  return Object.freeze({ ...merged, source: options.source });
}

/** De-duplicated, order-stable: lower-layer entries keep their position. */
function union(base: readonly string[], addition: readonly string[]): readonly string[] {
  if (addition.length === 0) return base;

  return [...new Set([...base, ...addition])];
}

function mergeGenerators(
  base: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  addition: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const names = Object.keys(addition);
  if (names.length === 0) return base;

  const merged: Record<string, Readonly<Record<string, unknown>>> = { ...base };

  for (const name of names) {
    merged[name] = { ...merged[name], ...addition[name] };
  }

  return merged;
}
