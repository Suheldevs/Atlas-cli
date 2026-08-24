import { freezeConfig, type AtlasConfig } from './config-schema.js';

/**
 * The neutral configuration: nothing chosen, nothing forbidden.
 *
 * Deliberately unopinionated. `sourceDir` and `format` are left absent rather than given a
 * plausible value like `'src'` or `true`, because detection produces a better answer than
 * any constant could — and a default that is indistinguishable from a user's explicit
 * choice cannot be overridden by a lower-precedence layer without guessing.
 */
export const DEFAULT_CONFIG: AtlasConfig = freezeConfig({
  sourceDir: undefined,
  plugins: [],
  disabledGenerators: [],
  format: undefined,
  generators: {},
});

/**
 * Completes a partial config, so a caller with one setting in hand can produce a full
 * layer to merge without restating the other four.
 */
export function defaultsFor(overrides: Partial<AtlasConfig> = {}): AtlasConfig {
  return freezeConfig({
    sourceDir: overrides.sourceDir ?? DEFAULT_CONFIG.sourceDir,
    plugins: overrides.plugins ?? DEFAULT_CONFIG.plugins,
    disabledGenerators: overrides.disabledGenerators ?? DEFAULT_CONFIG.disabledGenerators,
    format: overrides.format ?? DEFAULT_CONFIG.format,
    generators: overrides.generators ?? DEFAULT_CONFIG.generators,
  });
}
