import { describe, expect, it } from 'vitest';

import { TemplateLoader } from '../../src/engine/template/template-loader.js';
import {
  checkRequirements,
  parseTemplateManifest,
} from '../../src/engine/template/template-manifest.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { ProjectContext } from '../../src/types/project-context.js';
import type { TemplateManifest } from '../../src/types/template-manifest.js';
import { InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const TEMPLATES_ROOT = '/templates';
const SOURCE = '/templates/http/template.json';

/** The manifest every parser test starts from: the three fields Atlas insists on. */
const MINIMAL = { name: 'http', version: '1.0.0', description: 'HTTP layer.' };

function loaderFor(fs: InMemoryFileSystem): TemplateLoader {
  return new TemplateLoader({
    fs,
    reporter: new Reporter({
      stdout: new MemoryStream(),
      stderr: new MemoryStream(),
      color: false,
    }),
    templatesRoot: TEMPLATES_ROOT,
  });
}

function loaderWith(files: Readonly<Record<string, string>>): TemplateLoader {
  return loaderFor(new InMemoryFileSystem(files));
}

function manifestJson(manifest: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(manifest);
}

function project(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    root: '/project',
    manifest: {
      path: '/project/package.json',
      name: 'demo',
      version: '1.0.0',
      type: 'module',
      dependencies: { express: '^5.1.0' },
      devDependencies: { typescript: '^6.0.0' },
      peerDependencies: {},
      scripts: {},
      raw: {},
    },
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

function parsed(manifest: Readonly<Record<string, unknown>>): TemplateManifest {
  return parseTemplateManifest(manifest, SOURCE);
}

function rejection(value: unknown): AtlasError {
  try {
    parseTemplateManifest(value, SOURCE);
  } catch (error) {
    if (AtlasError.isAtlasError(error)) return error;
    throw error;
  }
  return expect.unreachable('expected the manifest to be rejected');
}

async function failure(operation: () => Promise<unknown>): Promise<AtlasError> {
  try {
    await operation();
  } catch (error) {
    if (AtlasError.isAtlasError(error)) return error;
    throw error;
  }
  return expect.unreachable('expected an AtlasError');
}

function detailsOf(error: AtlasError): string {
  return error.details.join('\n');
}

describe('parseTemplateManifest', () => {
  it('accepts a three-field manifest and fills in empty defaults', () => {
    const manifest = parsed(MINIMAL);

    expect(manifest.name).toBe('http');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.description).toBe('HTTP layer.');
    expect(manifest.dependencies).toEqual({});
    expect(manifest.devDependencies).toEqual({});
    expect(manifest.scripts).toEqual({});
    expect(manifest.files).toEqual([]);
    expect(manifest.requires).toEqual({ frameworks: [], language: undefined, dependencies: {} });
  });

  it('reports a missing required field and names the source file', () => {
    const error = rejection({ version: '1.0.0', description: 'No name.' });

    expect(error.code).toBe(ErrorCode.TemplateManifestInvalid);
    expect(error.message).toContain(SOURCE);
    expect(detailsOf(error)).toContain('"name" is required');
  });

  it('rejects an unknown top-level key and lists the recognised ones', () => {
    const error = rejection({ ...MINIMAL, dependancies: { zod: '^3.0.0' } });

    expect(error.code).toBe(ErrorCode.TemplateManifestInvalid);
    expect(detailsOf(error)).toContain('dependancies');
    expect(detailsOf(error)).toContain('devDependencies');
    expect(detailsOf(error)).toContain('requires');
  });

  it('reports every problem at once rather than failing on the first', () => {
    const error = rejection({
      name: '',
      version: 2,
      description: 'Broken.',
      scripts: { build: 7 },
      extra: true,
    });

    const details = detailsOf(error);
    expect(details).toContain('"name" must not be empty');
    expect(details).toContain('"version" is required');
    expect(details).toContain('"scripts.build" must be a string');
    expect(details).toContain('extra');
    expect(error.details.length).toBeGreaterThanOrEqual(4);
  });

  it('names the offending key when a dependency version is not a string', () => {
    const error = rejection({ ...MINIMAL, dependencies: { zod: '^3.0.0', bcrypt: 5 } });

    expect(detailsOf(error)).toContain('"dependencies.bcrypt" must be a string');
    expect(detailsOf(error)).not.toContain('zod');
  });

  it('rejects a framework the detector could never produce, by name', () => {
    const error = rejection({ ...MINIMAL, requires: { frameworks: ['express', 'expres'] } });

    expect(detailsOf(error)).toContain('"expres"');
    expect(detailsOf(error)).toContain('fastify');
  });

  it('rejects an unknown language by name', () => {
    const error = rejection({ ...MINIMAL, requires: { language: 'ts' } });

    expect(detailsOf(error)).toContain('"ts"');
    expect(detailsOf(error)).toContain('typescript');
  });

  it('rejects an unknown key inside requires', () => {
    const error = rejection({ ...MINIMAL, requires: { framework: ['express'] } });

    expect(detailsOf(error)).toContain('framework');
    expect(detailsOf(error)).toContain('frameworks');
  });

  it('keeps a valid requires block', () => {
    const manifest = parsed({
      ...MINIMAL,
      requires: {
        frameworks: ['express', 'fastify'],
        language: 'typescript',
        dependencies: { express: '^5.0.0' },
      },
    });

    expect(manifest.requires.frameworks).toEqual(['express', 'fastify']);
    expect(manifest.requires.language).toBe('typescript');
    expect(manifest.requires.dependencies).toEqual({ express: '^5.0.0' });
  });

  it('expands the string shorthand in files to source, destination and format', () => {
    const manifest = parsed({ ...MINIMAL, files: ['src/http/error.ts'] });

    expect(manifest.files).toEqual([
      { source: 'src/http/error.ts', destination: 'src/http/error.ts', format: true },
    ]);
  });

  it('accepts the object form and defaults format to true', () => {
    const manifest = parsed({
      ...MINIMAL,
      files: [
        { source: 'error.ts', destination: 'src/http/error.ts' },
        { source: 'env.example', destination: '.env.example', format: false },
      ],
    });

    expect(manifest.files).toEqual([
      { source: 'error.ts', destination: 'src/http/error.ts', format: true },
      { source: 'env.example', destination: '.env.example', format: false },
    ]);
  });

  it('rejects a file entry that is neither a string nor an object with a source', () => {
    const error = rejection({ ...MINIMAL, files: [42, { destination: 'a.ts' }] });

    expect(detailsOf(error)).toContain('"files[0]"');
    expect(detailsOf(error)).toContain('"files[1].source"');
  });

  it('rejects a misspelled key inside a file entry, which would silently change the destination', () => {
    const error = rejection({ ...MINIMAL, files: [{ source: 'a.ts', dest: 'src/a.ts' }] });

    expect(detailsOf(error)).toContain('dest');
    expect(detailsOf(error)).toContain('destination');
  });

  it('rejects a manifest that is not an object at all', () => {
    const error = rejection(['http']);

    expect(error.code).toBe(ErrorCode.TemplateManifestInvalid);
    expect(detailsOf(error)).toContain('an array');
  });
});

describe('checkRequirements', () => {
  it('is satisfied when every requirement matches', () => {
    const manifest = parsed({
      ...MINIMAL,
      requires: {
        frameworks: ['express'],
        language: 'typescript',
        dependencies: { express: '^5.0.0' },
      },
    });

    expect(checkRequirements(manifest, project())).toEqual({ satisfied: true, reasons: [] });
  });

  it('treats an empty frameworks list as framework-agnostic', () => {
    const manifest = parsed(MINIMAL);

    expect(checkRequirements(manifest, project({ framework: 'next' })).satisfied).toBe(true);
  });

  it('explains a framework mismatch in terms of both sides', () => {
    const manifest = parsed({ ...MINIMAL, requires: { frameworks: ['express', 'fastify'] } });

    const result = checkRequirements(manifest, project({ framework: 'next' }));

    expect(result.satisfied).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('express or fastify');
    expect(result.reasons[0]).toContain('next');
  });

  it('explains a language mismatch', () => {
    const manifest = parsed({ ...MINIMAL, requires: { language: 'typescript' } });

    const result = checkRequirements(manifest, project({ language: 'javascript' }));

    expect(result.satisfied).toBe(false);
    expect(result.reasons[0]).toContain('typescript');
    expect(result.reasons[0]).toContain('javascript');
  });

  it('reports a required dependency the project does not have', () => {
    const manifest = parsed({ ...MINIMAL, requires: { dependencies: { mongoose: '^8.0.0' } } });

    const result = checkRequirements(manifest, project());

    expect(result.satisfied).toBe(false);
    expect(result.reasons[0]).toContain('mongoose@^8.0.0');
  });

  it('accepts a required dependency found among devDependencies', () => {
    const manifest = parsed({ ...MINIMAL, requires: { dependencies: { typescript: '^6.0.0' } } });

    expect(checkRequirements(manifest, project()).satisfied).toBe(true);
  });

  it('reports every unmet requirement together', () => {
    const manifest = parsed({
      ...MINIMAL,
      requires: {
        frameworks: ['nest'],
        language: 'javascript',
        dependencies: { mongoose: '^8.0.0' },
      },
    });

    expect(checkRequirements(manifest, project()).reasons).toHaveLength(3);
  });

  it('treats a project with no package.json as missing every required dependency', () => {
    const manifest = parsed({ ...MINIMAL, requires: { dependencies: { express: '^5.0.0' } } });

    const result = checkRequirements(manifest, project({ manifest: undefined }));

    expect(result.satisfied).toBe(false);
  });
});

describe('TemplateLoader.load', () => {
  it('parses the manifest and resolves the template and files roots', async () => {
    const loader = loaderWith({
      [SOURCE]: manifestJson({ ...MINIMAL, dependencies: { express: '^5.1.0' } }),
    });

    const template = await loader.load('http');

    expect(template.manifest.name).toBe('http');
    expect(template.manifest.dependencies).toEqual({ express: '^5.1.0' });
    expect(template.root.replace(/\\/gu, '/')).toBe('/templates/http');
    expect(template.filesRoot.replace(/\\/gu, '/')).toBe('/templates/http/files');
  });

  it('reports the searched path when the template directory is absent', async () => {
    const loader = loaderWith({ [SOURCE]: manifestJson(MINIMAL) });

    const error = await failure(() => loader.load('graphql'));

    expect(error.code).toBe(ErrorCode.TemplateNotFound);
    expect(error.message).toContain('graphql');
    expect(`${error.hint ?? ''}${detailsOf(error)}`.replace(/\\/gu, '/')).toContain(
      '/templates/graphql',
    );
  });

  it('reports the searched path when template.json is absent', async () => {
    const loader = loaderWith({ '/templates/http/files/index.ts': 'export {};' });

    const error = await failure(() => loader.load('http'));

    expect(error.code).toBe(ErrorCode.TemplateNotFound);
    expect(error.message).toContain('template.json');
    expect(`${error.hint ?? ''}`.replace(/\\/gu, '/')).toContain('/templates/http/template.json');
  });

  it('rejects malformed JSON as an invalid manifest, not a missing one', async () => {
    const loader = loaderWith({ [SOURCE]: '{ "name": "http", }' });

    const error = await failure(() => loader.load('http'));

    expect(error.code).toBe(ErrorCode.TemplateManifestInvalid);
    expect(detailsOf(error).replace(/\\/gu, '/')).toContain(SOURCE);
  });

  it('reads and validates template.json once per process', async () => {
    class CountingFileSystem extends InMemoryFileSystem {
      jsonReads = 0;

      override async readJson(path: string): Promise<unknown> {
        this.jsonReads += 1;
        return super.readJson(path);
      }
    }

    const fs = new CountingFileSystem({ [SOURCE]: manifestJson(MINIMAL) });
    const loader = loaderFor(fs);

    const first = await loader.load('http');
    // Rewriting the file proves the second call never went near the filesystem.
    fs.setFile(SOURCE, manifestJson({ ...MINIMAL, description: 'Rewritten.' }));
    const second = await loader.load('http');

    expect(fs.jsonReads).toBe(1);
    expect(second).toBe(first);
    expect(second.manifest.description).toBe('HTTP layer.');
  });
});

describe('TemplateLoader.render', () => {
  const tokens = { __ENTITY_NAME__: 'User' };

  it('mirrors a nested files tree in a deterministic order when files is empty', async () => {
    const loader = loaderWith({
      [SOURCE]: manifestJson(MINIMAL),
      '/templates/http/files/z-last.ts': 'export const z = 1;',
      '/templates/http/files/routes/user.route.ts': 'export const user = 1;',
      '/templates/http/files/routes/nested/deep.ts': 'export const deep = 1;',
      '/templates/http/files/a-first.ts': 'export const a = 1;',
    });

    const rendered = await loader.render(await loader.load('http'), {});

    expect(rendered.map((file) => file.destination)).toEqual([
      'a-first.ts',
      'routes/nested/deep.ts',
      'routes/user.route.ts',
      'z-last.ts',
    ]);
    expect(rendered[0]?.contents).toBe('export const a = 1;');
    expect(rendered.every((file) => file.format)).toBe(true);
  });

  it('uses the declared file list verbatim, ignoring anything else under files/', async () => {
    const loader = loaderWith({
      [SOURCE]: manifestJson({
        ...MINIMAL,
        files: [
          { source: 'error.ts', destination: 'src/http/error.ts' },
          { source: 'env.example', destination: '.env.example', format: false },
        ],
      }),
      '/templates/http/files/error.ts': 'export class HttpError {}',
      '/templates/http/files/env.example': 'PORT=3000',
      '/templates/http/files/unlisted.ts': 'export const ignored = 1;',
    });

    const rendered = await loader.render(await loader.load('http'), {});

    expect(rendered.map((file) => file.destination)).toEqual(['src/http/error.ts', '.env.example']);
    expect(rendered.map((file) => file.format)).toEqual([true, false]);
    expect(rendered[1]?.contents).toBe('PORT=3000');
  });

  it('substitutes tokens in both the contents and the destination path', async () => {
    const loader = loaderWith({
      [SOURCE]: manifestJson({
        ...MINIMAL,
        files: [{ source: 'entity.service.ts', destination: 'src/__ENTITY_NAME__.service.ts' }],
      }),
      '/templates/http/files/entity.service.ts': 'export class __ENTITY_NAME__Service {}',
    });

    const rendered = await loader.render(await loader.load('http'), tokens);

    expect(rendered).toEqual([
      {
        destination: 'src/User.service.ts',
        contents: 'export class UserService {}',
        format: true,
      },
    ]);
  });

  it('fails loudly on an unresolved token, naming the template and the source file', async () => {
    const loader = loaderWith({
      [SOURCE]: manifestJson({ ...MINIMAL, files: ['entity.ts'] }),
      '/templates/http/files/entity.ts': 'export const name = "__NOT_A_REAL_TOKEN__";',
    });
    const template = await loader.load('http');

    const error = await failure(() => loader.render(template, tokens));

    expect(error.message).toContain('http');
    expect(error.message).toContain('entity.ts');
    expect(detailsOf(error).replace(/\\/gu, '/')).toContain('/templates/http/files/entity.ts');
  });

  it('treats a missing files/ directory as a packaging mistake', async () => {
    const loader = loaderWith({ [SOURCE]: manifestJson(MINIMAL) });

    const error = await failure(async () => loader.render(await loader.load('http'), {}));

    expect(error.code).toBe(ErrorCode.TemplateNotFound);
    expect(`${error.hint ?? ''}`.replace(/\\/gu, '/')).toContain('/templates/http/files');
  });

  it('never skips a declared file that is missing from the package', async () => {
    const loader = loaderWith({
      [SOURCE]: manifestJson({ ...MINIMAL, files: ['present.ts', 'absent.ts'] }),
      '/templates/http/files/present.ts': 'export const present = 1;',
    });

    const error = await failure(async () => loader.render(await loader.load('http'), {}));

    expect(error.code).toBe(ErrorCode.TemplateNotFound);
    expect(detailsOf(error).replace(/\\/gu, '/')).toContain('/templates/http/files/absent.ts');
  });
});
