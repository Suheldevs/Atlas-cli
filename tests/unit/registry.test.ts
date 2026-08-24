import { describe, expect, it } from 'vitest';

import { AtlasError } from '../../src/errors/atlas-error.js';
import { discoverGenerators } from '../../src/registry/discovery.js';
import { describeAvailability } from '../../src/registry/capability-index.js';
import { GeneratorRegistry } from '../../src/registry/generator-registry.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { PackageManifest, ProjectContext } from '../../src/types/project-context.js';
import type { PluginSource } from '../../src/types/plugin.js';
import { closestMatch, describeCount, editDistance } from '../../src/utils/text.js';
import { fakeGenerator } from '../helpers/fake-generator.js';
import { InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const BUILTIN: PluginSource = { kind: 'builtin', specifier: 'builtin' };
const PLUGIN: PluginSource = { kind: 'node-module', specifier: 'atlas-plugin-stripe' };

function silentReporter(): { reporter: Reporter; output: () => string } {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false, verbose: false });
  return { reporter, output: () => stdout.text + stderr.text };
}

function projectContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    root: '/project',
    manifest: undefined,
    framework: 'express',
    language: 'typescript',
    moduleSystem: 'esm',
    packageManager: 'npm',
    database: 'none',
    typescript: { present: true, configPath: '/project/tsconfig.json', strict: true },
    layout: { sourceDir: 'src', flat: false },
    workspace: { isMonorepo: false, installRoot: '/project', workspaceRoot: undefined },
    importSuffix: '.js',
    ...overrides,
  };
}

/** Runs `act`, expecting an `AtlasError`, and returns its hint. */
function hintFrom(act: () => unknown): string {
  try {
    act();
  } catch (error) {
    expect(AtlasError.isAtlasError(error)).toBe(true);
    return (error as AtlasError).hint ?? '';
  }

  expect.unreachable('expected an AtlasError');
}

function manifest(dependencies: Record<string, string>): PackageManifest {
  return {
    path: '/project/package.json',
    name: 'demo',
    version: '1.0.0',
    type: 'module',
    dependencies,
    devDependencies: {},
    peerDependencies: {},
    scripts: {},
    raw: {},
  };
}

describe('GeneratorRegistry', () => {
  it('registers and retrieves by name', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'auth' }), BUILTIN);

    expect(registry.get('auth')?.generator.meta.name).toBe('auth');
    expect(registry.size).toBe(1);
  });

  it('retrieves by alias', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'generate', aliases: ['g'] }), BUILTIN);

    expect(registry.get('g')?.generator.meta.name).toBe('generate');
  });

  it('refuses to let a plugin silently shadow a built-in', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'auth' }), BUILTIN);

    expect(() => {
      registry.register(fakeGenerator({ name: 'auth' }), PLUGIN);
    }).toThrow(/both named "auth"/u);
  });

  it('names both sides of a name collision so the culprit is obvious', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'auth' }), BUILTIN);

    try {
      registry.register(fakeGenerator({ name: 'auth' }), PLUGIN);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message + JSON.stringify(error);
      expect(message).toContain('atlas-plugin-stripe');
    }
  });

  it('rejects an alias that another generator already owns', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'crud', aliases: ['c'] }), BUILTIN);

    expect(() => {
      registry.register(fakeGenerator({ name: 'cache', aliases: ['c'] }), PLUGIN);
    }).toThrow(/alias "c"/u);
  });

  // The suggestion lives on `hint`, not `message`, because the presenter renders the two
  // differently — so these assert on the field rather than on the thrown string.
  it('suggests a near miss for an unknown name', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'crud' }), BUILTIN);

    expect(hintFrom(() => registry.require('crd'))).toContain('Did you mean "crud"');
  });

  it('points at `atlas list` when nothing is close', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'crud' }), BUILTIN);

    expect(hintFrom(() => registry.require('completely-different'))).toContain('atlas list');
  });

  it('lists generators name-sorted for stable output', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'redis' }), BUILTIN);
    registry.register(fakeGenerator({ name: 'auth' }), BUILTIN);

    expect(registry.list().map((entry) => entry.generator.meta.name)).toEqual(['auth', 'redis']);
  });
});

describe('describeAvailability', () => {
  it('treats a framework-agnostic generator as always applicable', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'logger' }), BUILTIN);

    expect(describeAvailability(registry, projectContext())[0]?.applicable).toBe(true);
  });

  it('marks a generator inapplicable when the framework does not match', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'nest-module', frameworks: ['nest'] }), BUILTIN);

    const availability = describeAvailability(
      registry,
      projectContext({ framework: 'express' }),
    )[0];

    expect(availability?.applicable).toBe(false);
    expect(availability?.reason).toContain('nest');
  });

  it('marks a TypeScript-only generator inapplicable to a JavaScript project', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'logger', languages: ['typescript'] }), BUILTIN);

    const availability = describeAvailability(
      registry,
      projectContext({ language: 'javascript' }),
    )[0];

    expect(availability?.applicable).toBe(false);
    expect(availability?.reason).toContain('typescript');
  });

  it('reports the framework mismatch first when both requirements fail', () => {
    const registry = new GeneratorRegistry();
    registry.register(
      fakeGenerator({ name: 'nest-ts', frameworks: ['nest'], languages: ['typescript'] }),
      BUILTIN,
    );

    const availability = describeAvailability(
      registry,
      projectContext({ framework: 'express', language: 'javascript' }),
    )[0];

    // One row, one reason — the first unmet requirement is enough to explain the greying out.
    expect(availability?.reason).toContain('nest');
  });

  it('assumes applicable when there is no project to judge against', () => {
    const registry = new GeneratorRegistry();
    registry.register(fakeGenerator({ name: 'nest-module', frameworks: ['nest'] }), BUILTIN);

    expect(describeAvailability(registry, undefined)[0]?.applicable).toBe(true);
  });
});

describe('discoverGenerators', () => {
  it('registers the built-in generators from the static manifest', async () => {
    const { reporter } = silentReporter();

    const registry = await discoverGenerators({
      fs: new InMemoryFileSystem(),
      reporter,
      root: '/project',
      manifest: undefined,
    });

    // Asserted by name rather than by count, so adding a generator does not break this test.
    expect(registry.has('logger')).toBe(true);
    expect(registry.get('logger')?.source.kind).toBe('builtin');
  });

  it('loads a plugin named by the project dependencies', async () => {
    const { reporter } = silentReporter();

    const registry = await discoverGenerators({
      fs: new InMemoryFileSystem(),
      reporter,
      root: '/project',
      manifest: manifest({ 'atlas-plugin-stripe': '^1.0.0', express: '^5.0.0' }),
      importModule: async () => ({
        default: {
          name: 'atlas-plugin-stripe',
          version: '1.0.0',
          generators: [fakeGenerator({ name: 'stripe' })],
        },
      }),
    });

    expect(registry.has('stripe')).toBe(true);
    expect(registry.get('stripe')?.source.kind).toBe('node-module');
  });

  it('ignores dependencies that do not follow the plugin naming convention', async () => {
    const { reporter } = silentReporter();
    let imported = 0;

    await discoverGenerators({
      fs: new InMemoryFileSystem(),
      reporter,
      root: '/project',
      manifest: manifest({ express: '^5.0.0', lodash: '^4.0.0' }),
      importModule: async () => {
        imported += 1;
        return {};
      },
    });

    expect(imported).toBe(0);
  });

  it('warns and carries on when a plugin is malformed', async () => {
    const { reporter, output } = silentReporter();

    const registry = await discoverGenerators({
      fs: new InMemoryFileSystem(),
      reporter,
      root: '/project',
      manifest: manifest({ 'atlas-plugin-broken': '^1.0.0' }),
      importModule: async () => ({ default: { name: 'broken' } }),
    });

    // The malformed plugin contributes nothing, but the built-ins are untouched: one bad
    // plugin must not cost the user every generator.
    expect(registry.has('logger')).toBe(true);
    expect(output()).toContain('atlas-plugin-broken');
  });

  it('survives a plugin whose import throws', async () => {
    const { reporter, output } = silentReporter();

    const registry = await discoverGenerators({
      fs: new InMemoryFileSystem(),
      reporter,
      root: '/project',
      manifest: manifest({ 'atlas-plugin-explodes': '^1.0.0' }),
      importModule: () => Promise.reject(new Error('boom')),
    });

    expect(registry.has('logger')).toBe(true);
    expect(output()).toContain('atlas-plugin-explodes');
  });
});

describe('text utilities', () => {
  it('measures edit distance', () => {
    expect(editDistance('crud', 'crud')).toBe(0);
    expect(editDistance('crud', 'crd')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('only suggests genuinely close candidates', () => {
    expect(closestMatch('crd', ['crud', 'auth'])).toBe('crud');
    expect(closestMatch('xyzzy', ['crud', 'auth'])).toBeUndefined();
  });

  it('pluralises counts', () => {
    expect(describeCount(1, 'file')).toBe('1 file');
    expect(describeCount(2, 'file')).toBe('2 files');
  });
});
