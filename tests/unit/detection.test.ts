import { describe, expect, it, vi } from 'vitest';

import {
  detectDatabase,
  detectFramework,
  detectLanguage,
  detectModuleSystem,
  detectPackageManager,
  detectSourceLayout,
  detectWorkspace,
  hasDependency,
  ProjectScanner,
  readManifest,
  type ProjectContext,
} from '../../src/detection/index.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';

const ROOT = '/project';

type Files = Readonly<Record<string, string>>;

function manifestJson(contents: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(contents, undefined, 2);
}

/** Every project needs a manifest; this keeps the interesting field the only visible one. */
function projectWith(contents: Readonly<Record<string, unknown>>): Files {
  return { [`${ROOT}/package.json`]: manifestJson(contents) };
}

function fileSystem(files: Files = {}): InMemoryFileSystem {
  return new InMemoryFileSystem(files);
}

function scanner(files: Files = {}): ProjectScanner {
  return new ProjectScanner({ fs: fileSystem(files) });
}

function scan(files: Files, root = ROOT): Promise<ProjectContext> {
  return scanner(files).scan(root);
}

/**
 * The suite runs under a package manager, which exports `npm_config_user_agent`. Clearing
 * it keeps tests of the lower-precedence fallbacks honest.
 */
function withoutUserAgent(): void {
  vi.stubEnv('npm_config_user_agent', undefined);
}

/** Detection joins paths with `node:path`, which emits backslashes on Windows. */
function toPosix(path: string | undefined): string | undefined {
  return path?.split('\\').join('/');
}

describe('readManifest', () => {
  it('normalises absent dependency blocks to empty records', async () => {
    const manifest = await readManifest(fileSystem(projectWith({ name: 'api' })), ROOT);

    expect(manifest?.name).toBe('api');
    expect(toPosix(manifest?.path)).toBe('/project/package.json');
    expect(manifest?.dependencies).toEqual({});
    expect(manifest?.devDependencies).toEqual({});
    expect(manifest?.peerDependencies).toEqual({});
    expect(manifest?.scripts).toEqual({});
  });

  it('freezes the normalised records so a generator cannot mutate shared state', async () => {
    const manifest = await readManifest(
      fileSystem(projectWith({ dependencies: { express: '^5.0.0' } })),
      ROOT,
    );

    expect(Object.isFrozen(manifest?.dependencies)).toBe(true);
    expect(Object.isFrozen(manifest?.raw)).toBe(true);
  });

  it('drops non-string dependency versions rather than trusting them', async () => {
    const manifest = await readManifest(
      fileSystem(projectWith({ dependencies: { express: '^5.0.0', broken: 42 } })),
      ROOT,
    );

    expect(manifest?.dependencies).toEqual({ express: '^5.0.0' });
  });

  it('preserves unread fields under raw', async () => {
    const manifest = await readManifest(
      fileSystem(projectWith({ name: 'api', packageManager: 'pnpm@9.1.0' })),
      ROOT,
    );

    expect(manifest?.raw['packageManager']).toBe('pnpm@9.1.0');
  });

  it('returns undefined when there is no package.json', async () => {
    expect(await readManifest(fileSystem(), ROOT)).toBeUndefined();
  });

  it('returns undefined for a malformed package.json instead of throwing', async () => {
    const fs = fileSystem({ [`${ROOT}/package.json`]: '{ "name": "api", }' });

    await expect(readManifest(fs, ROOT)).resolves.toBeUndefined();
  });

  it('returns undefined when the manifest parses to something other than an object', async () => {
    const fs = fileSystem({ [`${ROOT}/package.json`]: '["not", "a", "manifest"]' });

    expect(await readManifest(fs, ROOT)).toBeUndefined();
  });
});

describe('hasDependency', () => {
  it('looks in dependencies, devDependencies and peerDependencies alike', async () => {
    const manifest = await readManifest(
      fileSystem(
        projectWith({
          dependencies: { express: '^5.0.0' },
          devDependencies: { typescript: '^6.0.0' },
          peerDependencies: { react: '^19.0.0' },
        }),
      ),
      ROOT,
    );

    expect(hasDependency(manifest, 'express')).toBe(true);
    expect(hasDependency(manifest, 'typescript')).toBe(true);
    expect(hasDependency(manifest, 'react')).toBe(true);
    expect(hasDependency(manifest, 'fastify')).toBe(false);
  });

  it('reports false for a project with no manifest at all', () => {
    expect(hasDependency(undefined, 'express')).toBe(false);
  });
});

describe('detectFramework', () => {
  async function frameworkOf(dependencies: Readonly<Record<string, string>>): Promise<string> {
    const manifest = await readManifest(fileSystem(projectWith({ dependencies })), ROOT);
    return detectFramework(manifest);
  }

  it('prefers next over react, because every Next app also ships React', async () => {
    expect(await frameworkOf({ next: '^15.0.0', react: '^19.0.0' })).toBe('next');
  });

  it('prefers nest over express, because Nest runs on Express underneath', async () => {
    expect(await frameworkOf({ '@nestjs/core': '^11.0.0', express: '^5.0.0' })).toBe('nest');
  });

  it('prefers fastify over express when both are present', async () => {
    expect(await frameworkOf({ fastify: '^5.0.0', express: '^5.0.0' })).toBe('fastify');
  });

  it('detects a plain express project', async () => {
    expect(await frameworkOf({ express: '^5.0.0' })).toBe('express');
  });

  it('detects a react project with no server framework', async () => {
    expect(await frameworkOf({ react: '^19.0.0' })).toBe('react');
  });

  it('reports unknown when nothing recognisable is installed', async () => {
    expect(await frameworkOf({ lodash: '^4.17.21' })).toBe('unknown');
    expect(detectFramework(undefined)).toBe('unknown');
  });
});

describe('detectDatabase', () => {
  async function databaseOf(dependencies: Readonly<Record<string, string>>): Promise<string> {
    const manifest = await readManifest(fileSystem(projectWith({ dependencies })), ROOT);
    return detectDatabase(manifest);
  }

  it('detects prisma from either of its two packages', async () => {
    expect(await databaseOf({ '@prisma/client': '^6.0.0' })).toBe('prisma');
    expect(await databaseOf({ prisma: '^6.0.0' })).toBe('prisma');
  });

  it('prefers prisma over a mongoose left behind by a migration', async () => {
    expect(await databaseOf({ '@prisma/client': '^6.0.0', mongoose: '^8.0.0' })).toBe('prisma');
  });

  it('detects mongoose, typeorm and drizzle', async () => {
    expect(await databaseOf({ mongoose: '^8.0.0' })).toBe('mongoose');
    expect(await databaseOf({ typeorm: '^0.3.20' })).toBe('typeorm');
    expect(await databaseOf({ 'drizzle-orm': '^0.44.0' })).toBe('drizzle');
  });

  it('reports none when no data layer is installed', async () => {
    expect(await databaseOf({ express: '^5.0.0' })).toBe('none');
    expect(detectDatabase(undefined)).toBe('none');
  });
});

describe('detectLanguage', () => {
  it('detects typescript from a tsconfig.json and records its path', async () => {
    const fs = fileSystem({
      ...projectWith({ name: 'api' }),
      [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "strict": true } }',
    });

    const { language, typescript } = await detectLanguage(fs, ROOT, undefined);

    expect(language).toBe('typescript');
    expect(typescript.present).toBe(true);
    expect(toPosix(typescript.configPath)).toBe('/project/tsconfig.json');
    expect(typescript.strict).toBe(true);
  });

  it('detects typescript from the dependency alone, with no config to point at', async () => {
    const files = projectWith({ devDependencies: { typescript: '^6.0.0' } });
    const fs = fileSystem(files);
    const manifest = await readManifest(fs, ROOT);

    const { language, typescript } = await detectLanguage(fs, ROOT, manifest);

    expect(language).toBe('typescript');
    expect(typescript.configPath).toBeUndefined();
    expect(typescript.strict).toBe(false);
  });

  it('reads strict through // and /* */ comments, as real configs contain them', async () => {
    const fs = fileSystem({
      ...projectWith({ name: 'api' }),
      [`${ROOT}/tsconfig.json`]: [
        '{',
        '  // Extends nothing on purpose.',
        '  "compilerOptions": {',
        '    /* Non-negotiable. */',
        '    "strict": true,',
        '    "outDir": "dist" // build output',
        '  }',
        '}',
      ].join('\n'),
    });

    const { typescript } = await detectLanguage(fs, ROOT, undefined);

    expect(typescript.strict).toBe(true);
  });

  it('does not mistake a // inside a string for a comment', async () => {
    const fs = fileSystem({
      ...projectWith({ name: 'api' }),
      [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "strict": true }, "x": "https://a.test" }',
    });

    const { typescript } = await detectLanguage(fs, ROOT, undefined);

    expect(typescript.strict).toBe(true);
  });

  it('falls back to a text search when the config cannot be parsed at all', async () => {
    const fs = fileSystem({
      ...projectWith({ name: 'api' }),
      // A trailing comma survives comment stripping and still defeats JSON.parse.
      [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "strict": true, } }',
    });

    const { typescript } = await detectLanguage(fs, ROOT, undefined);

    expect(typescript.strict).toBe(true);
  });

  it('reports strict false when the config omits it', async () => {
    const fs = fileSystem({
      ...projectWith({ name: 'api' }),
      [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "target": "ES2023" } }',
    });

    const { typescript } = await detectLanguage(fs, ROOT, undefined);

    expect(typescript.strict).toBe(false);
  });

  it('detects javascript when neither a config nor the dependency is present', async () => {
    const fs = fileSystem(projectWith({ dependencies: { express: '^5.0.0' } }));

    const { language, typescript } = await detectLanguage(fs, ROOT, await readManifest(fs, ROOT));

    expect(language).toBe('javascript');
    expect(typescript.present).toBe(false);
    expect(typescript.configPath).toBeUndefined();
  });
});

describe('detectModuleSystem', () => {
  const NO_TYPESCRIPT = { present: false, configPath: undefined, strict: false } as const;

  async function moduleSystemOf(files: Files): Promise<string> {
    const fs = fileSystem(files);
    const manifest = await readManifest(fs, ROOT);
    const { typescript } = await detectLanguage(fs, ROOT, manifest);

    return detectModuleSystem(manifest, typescript, fs, ROOT);
  }

  it('detects esm from "type": "module"', async () => {
    expect(await moduleSystemOf(projectWith({ type: 'module' }))).toBe('esm');
  });

  it('detects esm from tsconfig module NodeNext when package.json has no type field', async () => {
    expect(
      await moduleSystemOf({
        ...projectWith({ name: 'api' }),
        [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "module": "NodeNext" } }',
      }),
    ).toBe('esm');
  });

  it('detects esm from a year-numbered module target', async () => {
    expect(
      await moduleSystemOf({
        ...projectWith({ name: 'api' }),
        [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "module": "es2022" } }',
      }),
    ).toBe('esm');
  });

  it('detects cjs from tsconfig module commonjs', async () => {
    expect(
      await moduleSystemOf({
        ...projectWith({ name: 'api' }),
        [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "module": "CommonJS" } }',
      }),
    ).toBe('cjs');
  });

  it('lets an explicit "type": "commonjs" override tsconfig, since Node obeys only type', async () => {
    expect(
      await moduleSystemOf({
        ...projectWith({ type: 'commonjs' }),
        [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "module": "NodeNext" } }',
      }),
    ).toBe('cjs');
  });

  it('reads module from the raw text when the config cannot be parsed', async () => {
    expect(
      await moduleSystemOf({
        ...projectWith({ name: 'api' }),
        [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "module": "NodeNext", } }',
      }),
    ).toBe('esm');
  });

  it('defaults to cjs when nothing indicates otherwise', async () => {
    expect(await moduleSystemOf(projectWith({ name: 'api' }))).toBe('cjs');
  });

  it('defaults to cjs when an unrecognised module target is declared', async () => {
    expect(
      await moduleSystemOf({
        ...projectWith({ name: 'api' }),
        [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "module": "umd" } }',
      }),
    ).toBe('cjs');
  });

  it('defaults to cjs for a directory with no manifest and no config', async () => {
    expect(await detectModuleSystem(undefined, NO_TYPESCRIPT, fileSystem(), ROOT)).toBe('cjs');
  });
});

describe('detectPackageManager', () => {
  async function packageManagerOf(files: Files, root = ROOT): Promise<string> {
    const fs = fileSystem(files);
    return detectPackageManager(fs, root, await readManifest(fs, root));
  }

  it('trusts the packageManager field over a conflicting lockfile', async () => {
    expect(
      await packageManagerOf({
        ...projectWith({ packageManager: 'pnpm@9.1.0' }),
        [`${ROOT}/package-lock.json`]: '{}',
      }),
    ).toBe('pnpm');
  });

  it('ignores the Corepack integrity hash appended to the packageManager field', async () => {
    expect(await packageManagerOf(projectWith({ packageManager: 'yarn@4.9.1+sha512.abc' }))).toBe(
      'yarn',
    );
  });

  it('falls through when the packageManager field names something unsupported', async () => {
    withoutUserAgent();

    expect(
      await packageManagerOf({
        ...projectWith({ packageManager: 'cnpm@1.0.0' }),
        [`${ROOT}/bun.lockb`]: '',
      }),
    ).toBe('bun');
  });

  it('finds a lockfile one directory above the package', async () => {
    expect(
      await packageManagerOf(
        {
          '/repo/yarn.lock': '',
          '/repo/packages/api/package.json': manifestJson({ name: 'api' }),
        },
        '/repo/packages/api',
      ),
    ).toBe('yarn');
  });

  it('prefers the nearest lockfile when the tree holds more than one', async () => {
    expect(
      await packageManagerOf(
        {
          '/repo/yarn.lock': '',
          '/repo/packages/api/pnpm-lock.yaml': '',
          '/repo/packages/api/package.json': manifestJson({ name: 'api' }),
        },
        '/repo/packages/api',
      ),
    ).toBe('pnpm');
  });

  it('recognises every known lockfile name', async () => {
    expect(await packageManagerOf({ [`${ROOT}/npm-shrinkwrap.json`]: '{}' })).toBe('npm');
    expect(await packageManagerOf({ [`${ROOT}/pnpm-lock.yaml`]: '' })).toBe('pnpm');
    expect(await packageManagerOf({ [`${ROOT}/bun.lock`]: '' })).toBe('bun');
  });

  it('uses the launching package manager when there is no lockfile', async () => {
    vi.stubEnv('npm_config_user_agent', 'bun/1.2.0 npm/? node/v22.13.0 linux x64');

    expect(await packageManagerOf(projectWith({ name: 'api' }))).toBe('bun');
  });

  it('defaults to npm when there is no evidence at all', async () => {
    withoutUserAgent();

    expect(await packageManagerOf(projectWith({ name: 'api' }))).toBe('npm');
  });
});

describe('detectWorkspace', () => {
  it('points installRoot at the workspace root, not the package', async () => {
    const fs = fileSystem({
      '/repo/pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      '/repo/packages/api/package.json': manifestJson({ name: 'api' }),
    });

    const workspace = await detectWorkspace(fs, '/repo/packages/api');

    expect(workspace.isMonorepo).toBe(true);
    expect(workspace.workspaceRoot).toBe('/repo');
    expect(workspace.installRoot).toBe('/repo');
  });

  it('recognises a workspaces array in an ancestor package.json', async () => {
    const fs = fileSystem({
      '/repo/package.json': manifestJson({ name: 'repo', workspaces: ['packages/*'] }),
      '/repo/packages/api/package.json': manifestJson({ name: 'api' }),
    });

    expect(await detectWorkspace(fs, '/repo/packages/api')).toEqual({
      isMonorepo: true,
      workspaceRoot: '/repo',
      installRoot: '/repo',
    });
  });

  it("recognises Yarn's object form of the workspaces field", async () => {
    const fs = fileSystem({
      '/repo/package.json': manifestJson({ workspaces: { packages: ['packages/*'] } }),
    });

    expect((await detectWorkspace(fs, '/repo')).isMonorepo).toBe(true);
  });

  it('ignores an empty workspaces array', async () => {
    const fs = fileSystem({ '/repo/package.json': manifestJson({ workspaces: [] }) });

    expect((await detectWorkspace(fs, '/repo')).isMonorepo).toBe(false);
  });

  it('recognises lerna.json and turbo.json', async () => {
    const lerna = fileSystem({ '/repo/lerna.json': '{}', '/repo/apps/web/package.json': '{}' });
    const turbo = fileSystem({ '/repo/turbo.json': '{}', '/repo/apps/web/package.json': '{}' });

    expect((await detectWorkspace(lerna, '/repo/apps/web')).workspaceRoot).toBe('/repo');
    expect((await detectWorkspace(turbo, '/repo/apps/web')).workspaceRoot).toBe('/repo');
  });

  it('resolves to the innermost workspace root when workspaces are nested', async () => {
    const fs = fileSystem({
      '/repo/pnpm-workspace.yaml': '',
      '/repo/group/turbo.json': '{}',
      '/repo/group/api/package.json': manifestJson({ name: 'api' }),
    });

    expect((await detectWorkspace(fs, '/repo/group/api')).workspaceRoot).toBe('/repo/group');
  });

  it('installs in place for a standalone project', async () => {
    const fs = fileSystem(projectWith({ name: 'api' }));

    expect(await detectWorkspace(fs, ROOT)).toEqual({
      isMonorepo: false,
      workspaceRoot: undefined,
      installRoot: ROOT,
    });
  });

  it('terminates at the filesystem root rather than walking forever', async () => {
    await expect(detectWorkspace(fileSystem(), '/a/b/c/d/e')).resolves.toMatchObject({
      isMonorepo: false,
    });
  });
});

describe('detectSourceLayout', () => {
  it('uses src when it exists', async () => {
    const fs = fileSystem({ [`${ROOT}/src/index.ts`]: '' });

    expect(await detectSourceLayout(fs, ROOT)).toEqual({ sourceDir: 'src', flat: false });
  });

  it('falls back to app for app-router style projects', async () => {
    const fs = fileSystem({ [`${ROOT}/app/page.tsx`]: '' });

    expect(await detectSourceLayout(fs, ROOT)).toEqual({ sourceDir: 'app', flat: false });
  });

  it('prefers src over app when both exist', async () => {
    const fs = fileSystem({ [`${ROOT}/src/index.ts`]: '', [`${ROOT}/app/page.tsx`]: '' });

    expect((await detectSourceLayout(fs, ROOT)).sourceDir).toBe('src');
  });

  it('reports a flat layout when there is no source directory', async () => {
    const fs = fileSystem(projectWith({ name: 'api' }));

    expect(await detectSourceLayout(fs, ROOT)).toEqual({ sourceDir: '.', flat: true });
  });
});

describe('ProjectScanner.scan', () => {
  it('describes a typical strict ESM TypeScript Express project', async () => {
    const context = await scan({
      ...projectWith({
        name: 'api',
        type: 'module',
        packageManager: 'pnpm@9.1.0',
        dependencies: { express: '^5.0.0', mongoose: '^8.0.0' },
        devDependencies: { typescript: '^6.0.0' },
      }),
      [`${ROOT}/tsconfig.json`]: '{ "compilerOptions": { "strict": true } }',
      [`${ROOT}/src/index.ts`]: '',
    });

    expect(context).toMatchObject({
      root: ROOT,
      framework: 'express',
      language: 'typescript',
      moduleSystem: 'esm',
      packageManager: 'pnpm',
      database: 'mongoose',
      importSuffix: '.js',
    });
    expect(context.typescript.strict).toBe(true);
    expect(context.layout).toEqual({ sourceDir: 'src', flat: false });
    expect(context.workspace.installRoot).toBe(ROOT);
  });

  it('uses a .js import suffix under ESM', async () => {
    const context = await scan(projectWith({ type: 'module' }));

    expect(context.importSuffix).toBe('.js');
  });

  it('uses an empty import suffix under CommonJS', async () => {
    const context = await scan(projectWith({ name: 'api' }));

    expect(context.moduleSystem).toBe('cjs');
    expect(context.importSuffix).toBe('');
  });

  it('describes a directory that is not a project instead of failing', async () => {
    const context = await scan({ '/elsewhere/notes.txt': 'hello' }, '/elsewhere');

    expect(context.manifest).toBeUndefined();
    expect(context.framework).toBe('unknown');
    expect(context.language).toBe('javascript');
    expect(context.moduleSystem).toBe('cjs');
    expect(context.database).toBe('none');
    expect(context.layout.flat).toBe(true);
  });

  it('survives a malformed package.json', async () => {
    const context = await scan({ [`${ROOT}/package.json`]: '{ "name": "api" oops }' });

    expect(context.manifest).toBeUndefined();
    expect(context.framework).toBe('unknown');
  });

  it('carries the workspace install root into the context', async () => {
    const context = await scan(
      {
        '/repo/pnpm-workspace.yaml': '',
        '/repo/packages/api/package.json': manifestJson({ dependencies: { fastify: '^5.0.0' } }),
      },
      '/repo/packages/api',
    );

    expect(context.framework).toBe('fastify');
    expect(context.workspace).toEqual({
      isMonorepo: true,
      workspaceRoot: '/repo',
      installRoot: '/repo',
    });
  });

  it('returns the cached context for a repeated scan of the same root', async () => {
    const instance = scanner(projectWith({ name: 'api' }));

    expect(await instance.scan(ROOT)).toBe(await instance.scan(ROOT));
  });

  it('does no further I/O once a root is cached', async () => {
    const fs = fileSystem(projectWith({ name: 'api' }));
    const instance = new ProjectScanner({ fs });

    expect((await instance.scan(ROOT)).language).toBe('javascript');
    fs.setFile(`${ROOT}/tsconfig.json`, '{ "compilerOptions": { "strict": true } }');

    expect((await instance.scan(ROOT)).language).toBe('javascript');
  });

  it('keys the cache per root, so a sibling package is scanned on its own terms', async () => {
    const instance = scanner({
      '/repo/api/package.json': manifestJson({ dependencies: { express: '^5.0.0' } }),
      '/repo/web/package.json': manifestJson({ dependencies: { next: '^15.0.0' } }),
    });

    expect((await instance.scan('/repo/api')).framework).toBe('express');
    expect((await instance.scan('/repo/web')).framework).toBe('next');
  });
});

describe('ProjectScanner.requireProject', () => {
  it('returns the context when a manifest was found', async () => {
    const context = await scanner(projectWith({ name: 'api' })).requireProject(ROOT);

    expect(context.manifest?.name).toBe('api');
  });

  it('throws ATLAS_2002 with a hint when there is no package.json', async () => {
    const failure = await scanner()
      .requireProject('/elsewhere')
      .catch((error: unknown) => error);

    expect(AtlasError.isAtlasError(failure)).toBe(true);
    expect((failure as AtlasError).code).toBe(ErrorCode.NotAProject);
    expect((failure as AtlasError).code).toBe('ATLAS_2002');
    expect((failure as AtlasError).hint).toBeDefined();
    expect((failure as AtlasError).message).toContain('/elsewhere');
  });

  it('throws ATLAS_2002 when the manifest exists but is unparseable', async () => {
    const instance = scanner({ [`${ROOT}/package.json`]: 'not json' });

    await expect(instance.requireProject(ROOT)).rejects.toThrow(AtlasError);
  });
});
