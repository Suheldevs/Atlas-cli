/**
 * Project configuration.
 *
 * `atlas.config.*` and the `package.json` `"atlas"` key in, one immutable config out. The
 * precedence chain lives in `resolved-config.ts` and nowhere else, so "which layer wins?"
 * has exactly one answer to read.
 *
 * `package-meta.ts` is intentionally not re-exported here: it reads *Atlas's own* manifest
 * and has nothing to do with the target project's configuration.
 */

export { ATLAS_CONFIG_KEYS, parseAtlasConfig, type AtlasConfig } from './config-schema.js';
export { DEFAULT_CONFIG, defaultsFor } from './defaults.js';
export { ConfigLoader, type ConfigLoaderOptions, type LoadedConfig } from './config-loader.js';
export {
  mergeConfigs,
  resolveConfig,
  type ResolveConfigOptions,
  type ResolvedConfig,
} from './resolved-config.js';
