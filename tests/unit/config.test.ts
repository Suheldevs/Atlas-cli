import { describe, expect, it } from 'vitest';

import {
  ATLAS_CONFIG_KEYS,
  ConfigLoader,
  DEFAULT_CONFIG,
  defaultsFor,
  mergeConfigs,
  parseAtlasConfig,
  resolveConfig,
  type AtlasConfig,
  type LoadedConfig,
} from '../../src/config/index.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { GlobalOptions } from '../../src/types/cli-options.js';
import { InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const ROOT = '/project';
const SOURCE = `${ROOT}/atlas.config.json`;

type Files = Readonly<Record<string, string>>;
type Modules = Readonly<Record<string, unknown>>;

/** The loader joins with `node:path`, which emits backslashes on Windows. */
function toPosix(path: string): string {
  return path.split('\\').join('/');
}

const GLOBALS: GlobalOptions = {
  cwd: ROOT,
  yes: false,
  dryRun: false,
  verbose: false,
  color: false,
};

/** Shorthand for a single-setting precedence layer. */
function layer(overrides: Partial<AtlasConfig>): AtlasConfig {
  return defaultsFor(overrides);
}

function manifest(contents: Readonly<Record<string, unknown>>): Files {
  return { [`${ROOT}/package.json`]: JSON.stringify(contents, undefined, 2) };
}

function json(contents: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(contents, undefined, 2);
}

interface Harness {
  readonly loader: ConfigLoader;
  readonly stdout: MemoryStream;
  readonly stderr: MemoryStream;
  /** Specifiers the loader asked for, so probe order is observable. */
  readonly imported: string[];
}

function harness(files: Files = {}, modules: Modules = {}, verbose = false): Harness {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const imported: string[] = [];

  const loader = new ConfigLoader({
    fs: new InMemoryFileSystem(files),
    reporter: new Reporter({ stdout, stderr, color: false, verbose }),
    importModule: async (specifier: string): Promise<unknown> => {
      const key = toPosix(specifier);
      imported.push(key);

      const module = modules[key];
      if (module === undefined) {
        throw new Error(`ERR_MODULE_NOT_FOUND: ${specifier}`);
      }

      return module;
    },
  });

  return { loader, stdout, stderr, imported };
}

function load(files: Files, modules: Modules = {}): Promise<LoadedConfig> {
  return harness(files, modules).loader.load(ROOT);
}

function detailsOf(error: AtlasError): string {
  return error.details.join('\n');
}

async function rejection(action: Promise<unknown>): Promise<AtlasError> {
  const error: unknown = await action.catch((caught: unknown) => caught);

  expect(AtlasError.isAtlasError(error)).toBe(true);
  return error as AtlasError;
}

function parseFailure(value: unknown, source = SOURCE): AtlasError {
  try {
    parseAtlasConfig(value, source);
  } catch (error) {
    expect(AtlasError.isAtlasError(error)).toBe(true);
    return error as AtlasError;
  }

  throw new Error('Expected parseAtlasConfig to reject the value.');
}

describe('parseAtlasConfig', () => {
  it('fills in the defaults for a config that overrides nothing', () => {
    expect(parseAtlasConfig({}, SOURCE)).toEqual(DEFAULT_CONFIG);
  });

  it('reads every recognised field', () => {
    const config = parseAtlasConfig(
      {
        sourceDir: 'lib',
        plugins: ['atlas-plugin-graphql', './tools/local-plugin.js'],
        disabledGenerators: ['crud'],
        format: false,
        generators: { auth: { strategy: 'jwt', rounds: 12 } },
      },
      SOURCE,
    );

    expect(config).toEqual({
      sourceDir: 'lib',
      plugins: ['atlas-plugin-graphql', './tools/local-plugin.js'],
      disabledGenerators: ['crud'],
      format: false,
      generators: { auth: { strategy: 'jwt', rounds: 12 } },
    });
  });

  it('treats an explicit undefined as absent, as a JavaScript config produces', () => {
    expect(parseAtlasConfig({ sourceDir: undefined, format: undefined }, SOURCE)).toEqual(
      DEFAULT_CONFIG,
    );
  });

  it('keeps generator option values untouched, since only the generator knows its schema', () => {
    const config = parseAtlasConfig(
      { generators: { auth: { rounds: 12, nested: { deep: [1, 2] }, off: null } } },
      SOURCE,
    );

    expect(config.generators['auth']).toEqual({ rounds: 12, nested: { deep: [1, 2] }, off: null });
  });

  it('rejects an unknown top-level key and lists the ones it recognises', () => {
    const error = parseFailure({ sourceDirs: 'lib' });

    expect(error.code).toBe(ErrorCode.InvalidUsage);
    expect(error.message).toContain(SOURCE);
    expect(detailsOf(error)).toContain('Unknown key "sourceDirs"');
    expect(detailsOf(error)).toContain('Did you mean "sourceDir"?');

    for (const key of ATLAS_CONFIG_KEYS) {
      expect(detailsOf(error)).toContain(key);
    }
  });

  it('does not mistake an inherited property for a recognised key', () => {
    expect(detailsOf(parseFailure({ toString: 'nope' }))).toContain('Unknown key "toString"');
  });

  it('names the file and the offending key for a wrong-typed field', () => {
    const error = parseFailure({ format: 'yes' });

    expect(error.code).toBe(ErrorCode.InvalidUsage);
    expect(error.message).toContain(SOURCE);
    expect(detailsOf(error)).toContain('format: expected true or false, received a string.');
  });

  it('reports every problem together rather than one per run', () => {
    const error = parseFailure({
      plugin: ['atlas-plugin-graphql'],
      sourceDir: 42,
      disabledGenerators: 'crud',
      generators: { auth: 'jwt' },
    });

    expect(detailsOf(error)).toContain('Unknown key "plugin"');
    expect(detailsOf(error)).toContain('sourceDir: expected a string');
    expect(detailsOf(error)).toContain('disabledGenerators: expected an array of strings');
    expect(detailsOf(error)).toContain('generators.auth: expected an object of options');
  });

  it('names the index of a non-string array entry', () => {
    expect(detailsOf(parseFailure({ plugins: ['fine', 7] }))).toContain(
      'plugins[1]: expected a string, received a number.',
    );
  });

  it('rejects a blank sourceDir, which would silently mean the project root', () => {
    expect(detailsOf(parseFailure({ sourceDir: '   ' }))).toContain(
      'sourceDir: expected a non-empty string.',
    );
  });

  it('rejects a config that is not an object at all', () => {
    expect(detailsOf(parseFailure(['atlas-plugin-graphql']))).toContain('received an array');
    expect(detailsOf(parseFailure(null))).toContain('received null');
    expect(detailsOf(parseFailure('src'))).toContain('received a string');
  });

  it('freezes the result so one generator cannot rewrite what the next one reads', () => {
    const config = parseAtlasConfig(
      { plugins: ['a'], generators: { auth: { rounds: 12 } } },
      SOURCE,
    );

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.plugins)).toBe(true);
    expect(Object.isFrozen(config.generators)).toBe(true);
    expect(Object.isFrozen(config.generators['auth'])).toBe(true);
  });
});

describe('ConfigLoader', () => {
  it('returns the defaults, silently, when the project configures nothing', async () => {
    const { loader, stdout, stderr } = harness(manifest({ name: 'api' }));

    const loaded = await loader.load(ROOT);

    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.path).toBeUndefined();
    expect(stdout.text).toBe('');
    expect(stderr.text).toBe('');
  });

  it('returns the defaults for a directory that is not a project at all', async () => {
    const loaded = await load({});

    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.path).toBeUndefined();
  });

  it('parses atlas.config.json', async () => {
    const loaded = await load({
      ...manifest({ name: 'api' }),
      [SOURCE]: json({ sourceDir: 'lib', format: true, generators: { auth: { rounds: 12 } } }),
    });

    expect(loaded.config.sourceDir).toBe('lib');
    expect(loaded.config.format).toBe(true);
    expect(loaded.config.generators['auth']).toEqual({ rounds: 12 });
    expect(toPosix(loaded.path ?? '')).toBe(SOURCE);
  });

  it('probes the config file names in order, stopping at the first hit', async () => {
    const { loader, imported } = harness(
      {
        [`${ROOT}/atlas.config.js`]: '',
        [`${ROOT}/atlas.config.mjs`]: '',
        [SOURCE]: json({ sourceDir: 'from-json' }),
      },
      { [`${ROOT}/atlas.config.js`]: { default: { sourceDir: 'from-js' } } },
    );

    const loaded = await loader.load(ROOT);

    expect(loaded.config.sourceDir).toBe('from-js');
    expect(toPosix(loaded.path ?? '')).toBe(`${ROOT}/atlas.config.js`);
    expect(imported).toEqual([`${ROOT}/atlas.config.js`]);
  });

  it('prefers atlas.config.mjs over atlas.config.json', async () => {
    const loaded = await load(
      { [`${ROOT}/atlas.config.mjs`]: '', [SOURCE]: json({ sourceDir: 'from-json' }) },
      { [`${ROOT}/atlas.config.mjs`]: { default: { sourceDir: 'from-mjs' } } },
    );

    expect(loaded.config.sourceDir).toBe('from-mjs');
  });

  it('honours the package.json "atlas" key when there is no config file', async () => {
    const loaded = await load(
      manifest({ name: 'api', atlas: { plugins: ['./tools/plugin.js'], format: false } }),
    );

    expect(loaded.config.plugins).toEqual(['./tools/plugin.js']);
    expect(loaded.config.format).toBe(false);
    expect(toPosix(loaded.path ?? '')).toBe(`${ROOT}/package.json`);
  });

  it('lets a config file outrank the package.json key while arrays still union', async () => {
    const loaded = await load({
      ...manifest({
        name: 'api',
        atlas: { sourceDir: 'lib', plugins: ['from-manifest'], format: true },
      }),
      [SOURCE]: json({ sourceDir: 'source', plugins: ['from-file'] }),
    });

    expect(loaded.config.sourceDir).toBe('source');
    expect(loaded.config.plugins).toEqual(['from-manifest', 'from-file']);
    // Omitted by the file, so the lower layer's value survives.
    expect(loaded.config.format).toBe(true);
    expect(toPosix(loaded.path ?? '')).toBe(SOURCE);
  });

  it('validates the package.json key with the same rules as a config file', async () => {
    const error = await rejection(load(manifest({ name: 'api', atlas: { plugins: 'one' } })));

    expect(error.code).toBe(ErrorCode.InvalidUsage);
    expect(error.message).toContain('"atlas" key');
    expect(detailsOf(error)).toContain('plugins: expected an array of strings');
  });

  it('leaves a hand-broken package.json to detection instead of failing on it', async () => {
    const loaded = await load({
      [`${ROOT}/package.json`]: '{ "name": "api", }',
      [SOURCE]: json({ sourceDir: 'lib' }),
    });

    expect(loaded.config.sourceDir).toBe('lib');
  });

  it('treats malformed JSON as fatal rather than falling back to the defaults', async () => {
    const error = await rejection(load({ [SOURCE]: '{ "sourceDir": "lib", }' }));

    expect(error.code).toBe(ErrorCode.InvalidUsage);
    expect(error.message).toContain('is not valid JSON');
    expect(error.details.length).toBeGreaterThan(0);
  });

  it('loads a .mjs config from its default export', async () => {
    const loaded = await load(
      { [`${ROOT}/atlas.config.mjs`]: '' },
      { [`${ROOT}/atlas.config.mjs`]: { default: { disabledGenerators: ['crud'] } } },
    );

    expect(loaded.config.disabledGenerators).toEqual(['crud']);
  });

  it('loads a .mjs config from a named config export', async () => {
    const loaded = await load(
      { [`${ROOT}/atlas.config.mjs`]: '' },
      { [`${ROOT}/atlas.config.mjs`]: { config: { sourceDir: 'lib' } } },
    );

    expect(loaded.config.sourceDir).toBe('lib');
  });

  it('accepts a module whose own exports are the config', async () => {
    const loaded = await load(
      { [`${ROOT}/atlas.config.mjs`]: '' },
      { [`${ROOT}/atlas.config.mjs`]: { sourceDir: 'lib' } },
    );

    expect(loaded.config.sourceDir).toBe('lib');
  });

  it('validates an imported config, so a typo in a .mjs file is caught too', async () => {
    const error = await rejection(
      load(
        { [`${ROOT}/atlas.config.mjs`]: '' },
        { [`${ROOT}/atlas.config.mjs`]: { default: { plugin: [] } } },
      ),
    );

    expect(detailsOf(error)).toContain('Unknown key "plugin"');
  });

  it('reports an import failure against the config path', async () => {
    const error = await rejection(load({ [`${ROOT}/atlas.config.mjs`]: '' }));

    expect(error.code).toBe(ErrorCode.InvalidUsage);
    expect(error.message).toContain('atlas.config.mjs');
    expect(error.message).toContain('could not be imported');
    expect(detailsOf(error)).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('explains atlas.config.ts instead of failing with a stack trace', async () => {
    const error = await rejection(
      load({ [`${ROOT}/atlas.config.ts`]: 'export default { sourceDir: "lib" };' }),
    );

    expect(error.code).toBe(ErrorCode.InvalidUsage);
    expect(error.message).toContain('atlas.config.ts');
    expect(error.message).toContain('TypeScript-aware loader');
    expect(error.hint).toContain('atlas.config.mjs');
    expect(detailsOf(error)).toContain('atlas.config.json');
    expect(detailsOf(error)).not.toContain('atlas.config.mts');
  });

  it('refuses atlas.config.mts for the same reason', async () => {
    const error = await rejection(load({ [`${ROOT}/atlas.config.mts`]: 'export default {};' }));

    expect(error.message).toContain('TypeScript-aware loader');
  });

  it('logs the resolved path at debug', async () => {
    const { loader, stderr } = harness({ [SOURCE]: json({ sourceDir: 'lib' }) }, {}, true);

    await loader.load(ROOT);

    expect(stderr.text).toContain('[debug]');
    expect(toPosix(stderr.text)).toContain(`config: loaded ${SOURCE}`);
  });
});

describe('mergeConfigs', () => {
  it('returns the defaults when given nothing', () => {
    expect(mergeConfigs()).toEqual(DEFAULT_CONFIG);
  });

  it('skips undefined layers', () => {
    expect(mergeConfigs(undefined, layer({ sourceDir: 'lib' }), undefined).sourceDir).toBe('lib');
  });

  it('never lets an undefined field clobber a defined one', () => {
    const merged = mergeConfigs(layer({ sourceDir: 'lib', format: true }), layer({}));

    expect(merged.sourceDir).toBe('lib');
    expect(merged.format).toBe(true);
  });

  it('lets a later layer override a scalar, false included', () => {
    const merged = mergeConfigs(
      layer({ sourceDir: 'lib', format: true }),
      layer({ sourceDir: 'source', format: false }),
    );

    expect(merged.sourceDir).toBe('source');
    expect(merged.format).toBe(false);
  });

  it('unions array fields, de-duplicated and order-stable', () => {
    const merged = mergeConfigs(
      layer({ plugins: ['a', 'b'], disabledGenerators: ['crud'] }),
      layer({ plugins: ['b', 'c'] }),
      layer({ plugins: ['a', 'd'], disabledGenerators: ['crud', 'upload'] }),
    );

    expect(merged.plugins).toEqual(['a', 'b', 'c', 'd']);
    expect(merged.disabledGenerators).toEqual(['crud', 'upload']);
  });

  it('deep-merges generators per generator name', () => {
    const merged = mergeConfigs(
      layer({ generators: { auth: { strategy: 'jwt', rounds: 10 }, crud: { paginate: true } } }),
      layer({ generators: { auth: { rounds: 12 }, upload: { driver: 's3' } } }),
    );

    expect(merged.generators).toEqual({
      auth: { strategy: 'jwt', rounds: 12 },
      crud: { paginate: true },
      upload: { driver: 's3' },
    });
  });

  it('leaves the layers it was given untouched', () => {
    const base = layer({ plugins: ['a'], generators: { auth: { rounds: 10 } } });

    mergeConfigs(base, layer({ plugins: ['b'], generators: { auth: { rounds: 12 } } }));

    expect(base.plugins).toEqual(['a']);
    expect(base.generators['auth']).toEqual({ rounds: 10 });
  });

  it('freezes what it returns', () => {
    const merged = mergeConfigs(layer({ plugins: ['a'], generators: { auth: { rounds: 10 } } }));

    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged.plugins)).toBe(true);
    expect(Object.isFrozen(merged.generators['auth'])).toBe(true);
  });
});

describe('resolveConfig', () => {
  it('applies defaults, then the package.json key, then the config file, then flags', () => {
    const resolved = resolveConfig({
      manifestConfig: layer({ sourceDir: 'manifest', format: true, plugins: ['from-manifest'] }),
      fileConfig: layer({ sourceDir: 'file', plugins: ['from-file'] }),
      flags: layer({ format: false, plugins: ['from-flag'] }),
      globals: GLOBALS,
      source: SOURCE,
    });

    expect(resolved.sourceDir).toBe('file');
    expect(resolved.format).toBe(false);
    expect(resolved.plugins).toEqual(['from-manifest', 'from-file', 'from-flag']);
    expect(resolved.source).toBe(SOURCE);
  });

  it('resolves to the defaults when nothing configured Atlas', () => {
    const resolved = resolveConfig({
      fileConfig: DEFAULT_CONFIG,
      manifestConfig: undefined,
      globals: GLOBALS,
      source: undefined,
    });

    expect(resolved).toEqual({ ...DEFAULT_CONFIG, source: undefined });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it('resolves a loaded config into one immutable answer', async () => {
    const loaded = await load({
      ...manifest({ name: 'api', atlas: { disabledGenerators: ['upload'] } }),
      [SOURCE]: json({ sourceDir: 'lib', disabledGenerators: ['crud'] }),
    });

    const resolved = resolveConfig({
      fileConfig: loaded.config,
      manifestConfig: undefined,
      globals: GLOBALS,
      source: loaded.path,
    });

    expect(resolved.sourceDir).toBe('lib');
    expect(resolved.disabledGenerators).toEqual(['upload', 'crud']);
    expect(toPosix(resolved.source ?? '')).toBe(SOURCE);
  });
});
