import { describe, expect, it } from 'vitest';

import { buildAuthPlan } from '../../src/generators/auth/auth.plan.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { ScriptedPromptRunner } from '../../src/prompts/prompt-runner.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { GeneratorContext } from '../../src/types/generator.js';
import type { ProjectContext } from '../../src/types/project-context.js';
import type {
  LoadedTemplate,
  RenderedFile,
  TemplateRenderer,
  TokenValues,
} from '../../src/types/template-manifest.js';
import type { AuthOptions } from '../../src/generators/auth/auth.schema.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const ROOT = process.platform === 'win32' ? 'C:\\project' : '/project';

/** Every destination the real template ships, both variants of each choice. */
const TEMPLATE_FILES: readonly string[] = [
  'auth/domain/user.ts',
  'auth/domain/tokens.ts',
  'auth/domain/auth-errors.ts',
  'auth/config/env-schema.ts',
  'auth/config/auth-config.ts',
  'auth/security/password-hasher.ts',
  'auth/security/bcrypt-hasher.ts',
  'auth/security/token-service.ts',
  'auth/repositories/user-repository.ts',
  'auth/repositories/refresh-token-repository.ts',
  'auth/repositories/mongoose-user-repository.ts',
  'auth/repositories/mongoose-refresh-token-repository.ts',
  'auth/repositories/prisma-user-repository.ts',
  'auth/repositories/prisma-refresh-token-repository.ts',
  'auth/services/auth-service.ts',
  'auth/http/auth-controller.ts',
  'auth/http/auth-routes.ts',
  'auth/http/auth-validators.ts',
  'auth/http/require-auth.ts',
  'auth/http/require-role.ts',
  'auth/http/error-handler.ts',
  'auth/index.ts',
  'prisma/auth.prisma',
];

const MANIFEST_DEPENDENCIES: Readonly<Record<string, string>> = {
  jsonwebtoken: '^9.0.3',
  bcryptjs: '^3.0.3',
  'cookie-parser': '^1.4.7',
  mongoose: '^9.8.0',
  '@prisma/client': '^6.19.3',
};

const MANIFEST_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@types/jsonwebtoken': '^9.0.10',
  '@types/cookie-parser': '^1.4.10',
  prisma: '^6.19.3',
};

/** Renders the declared destinations with placeholder bodies. Token logic is tested elsewhere. */
function fakeRenderer(files: readonly string[] = TEMPLATE_FILES): TemplateRenderer {
  const template: LoadedTemplate = {
    root: '/atlas/templates/auth',
    filesRoot: '/atlas/templates/auth/files',
    manifest: {
      name: 'auth',
      version: '1.0.0',
      description: 'auth',
      dependencies: MANIFEST_DEPENDENCIES,
      devDependencies: MANIFEST_DEV_DEPENDENCIES,
      scripts: {},
      files: [],
      requires: { frameworks: ['express'], language: 'typescript', dependencies: {} },
    },
  };

  return {
    load: () => Promise.resolve(template),
    render: (_template: LoadedTemplate, _tokens: TokenValues): Promise<readonly RenderedFile[]> =>
      Promise.resolve(
        files.map((destination): RenderedFile => ({
          destination,
          contents: `// ${destination}\nexport const marker = 1;\n`,
          format: true,
        })),
      ),
  };
}

function projectContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    root: ROOT,
    manifest: undefined,
    framework: 'express',
    language: 'typescript',
    moduleSystem: 'esm',
    packageManager: 'npm',
    database: 'none',
    typescript: { present: true, configPath: undefined, strict: true },
    layout: { sourceDir: 'src', flat: false },
    workspace: { isMonorepo: false, installRoot: ROOT, workspaceRoot: undefined },
    importSuffix: '.js',
    ...overrides,
  };
}

function context(renderer: TemplateRenderer, project = projectContext()): GeneratorContext {
  const stream = new MemoryStream();

  return {
    project,
    globals: { cwd: project.root, yes: true, dryRun: false, verbose: false, color: false },
    reporter: new Reporter({ stdout: stream, stderr: stream, color: false, verbose: false }),
    prompts: new ScriptedPromptRunner(),
    templates: renderer,
    readFile: () => Promise.resolve(undefined),
    resolve: (...segments) => [project.root, ...segments].join('/'),
  };
}

function options(overrides: Partial<AuthOptions> = {}): AuthOptions {
  return { directory: 'src', database: 'mongoose', ...overrides };
}

function destinations(paths: readonly { readonly path: string }[]): readonly string[] {
  return paths
    .map((file) =>
      file.path
        .slice(ROOT.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

describe('buildAuthPlan variant selection', () => {
  it('ships bcrypt as the only hasher', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));
    const files = destinations(plan.files);

    expect(files).toContain('src/auth/security/bcrypt-hasher.ts');
    expect(files).not.toContain('src/auth/security/argon2-hasher.ts');
  });

  it('does not ship a scrypt hasher', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));
    const files = destinations(plan.files);

    expect(files).not.toContain('src/auth/security/scrypt-hasher.ts');
  });

  it('ships only the mongoose repositories for mongoose', async () => {
    const plan = await buildAuthPlan(options({ database: 'mongoose' }), context(fakeRenderer()));
    const files = destinations(plan.files);

    expect(files).toContain('src/auth/repositories/mongoose-user-repository.ts');
    expect(files.some((file) => file.includes('prisma'))).toBe(false);
  });

  it('ships only the prisma repositories for prisma', async () => {
    const plan = await buildAuthPlan(options({ database: 'prisma' }), context(fakeRenderer()));
    const files = destinations(plan.files);

    expect(files).toContain('src/auth/repositories/prisma-user-repository.ts');
    expect(files.some((file) => file.includes('mongoose'))).toBe(false);
  });

  it('always ships the shared module regardless of the variants', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));
    const files = destinations(plan.files);

    for (const shared of [
      'src/auth/services/auth-service.ts',
      'src/auth/security/token-service.ts',
      'src/auth/http/require-auth.ts',
      'src/auth/index.ts',
    ]) {
      expect(files).toContain(shared);
    }
  });

  it('fails loudly if the template no longer matches the variant map', async () => {
    // A rename that the generator's tables do not know about would otherwise ship both adapters.
    const renamed = TEMPLATE_FILES.filter(
      (file) => file !== 'auth/repositories/prisma-user-repository.ts',
    );

    try {
      await buildAuthPlan(options(), context(fakeRenderer(renamed)));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.PlanInvalid);
    }
  });
});

describe('buildAuthPlan destinations', () => {
  it('prefixes source files with the chosen directory', async () => {
    const plan = await buildAuthPlan(
      options({ directory: 'source', database: 'prisma' }),
      context(fakeRenderer()),
    );

    expect(destinations(plan.files)).toContain('source/auth/index.ts');
  });

  it('keeps the prisma schema fragment out of the source directory', async () => {
    const plan = await buildAuthPlan(options({ database: 'prisma' }), context(fakeRenderer()));

    // It has to sit beside the project's existing schema, not inside src/.
    expect(destinations(plan.files)).toContain('prisma/auth.prisma');
  });

  it('does not format the prisma fragment, which prettier cannot parse', async () => {
    const plan = await buildAuthPlan(options({ database: 'prisma' }), context(fakeRenderer()));
    const fragment = plan.files.find((file) => file.path.endsWith('auth.prisma'));

    expect(fragment?.format).toBe(false);
  });

  it('handles a flat project with no source directory', async () => {
    const plan = await buildAuthPlan(
      options({ directory: '.' }),
      context(fakeRenderer(), projectContext({ layout: { sourceDir: '.', flat: true } })),
    );

    expect(destinations(plan.files)).toContain('auth/index.ts');
  });
});

describe('buildAuthPlan dependencies', () => {
  it('takes every version range from the template manifest', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));

    for (const dependency of plan.dependencies) {
      const declared = dependency.dev
        ? MANIFEST_DEV_DEPENDENCIES[dependency.name]
        : MANIFEST_DEPENDENCIES[dependency.name];
      expect(dependency.range).toBe(declared);
    }
  });

  it('never installs the packages the bcrypt rewrite removed', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));
    const names = plan.dependencies.map((entry) => entry.name);

    // A stale import left behind in one template file would otherwise reintroduce a dependency
    // nobody meant to ship, and the manifest would happily supply a version for it.
    for (const removed of ['jose', 'zod', 'argon2', 'bcrypt']) {
      expect(names).not.toContain(removed);
    }
  });

  it('installs mongoose only for the mongoose variant', async () => {
    const plan = await buildAuthPlan(options({ database: 'mongoose' }), context(fakeRenderer()));
    const names = plan.dependencies.map((entry) => entry.name);

    expect(names).toContain('mongoose');
    expect(names).not.toContain('@prisma/client');
  });

  it('adds the prisma CLI as a dev dependency only for prisma', async () => {
    const plan = await buildAuthPlan(options({ database: 'prisma' }), context(fakeRenderer()));

    expect(plan.dependencies).toEqual(
      expect.arrayContaining([{ name: 'prisma', range: '^6.19.3', dev: true }]),
    );
  });

  it('always installs jsonwebtoken, bcryptjs and cookie-parser', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));
    const names = plan.dependencies.map((entry) => entry.name);

    for (const always of ['jsonwebtoken', 'bcryptjs', 'cookie-parser']) {
      expect(names).toContain(always);
    }
  });
});

describe('buildAuthPlan environment and wiring', () => {
  it('writes a random JWT_SECRET marked as a secret', async () => {
    const first = await buildAuthPlan(options(), context(fakeRenderer()));
    const second = await buildAuthPlan(options(), context(fakeRenderer()));

    const secretOf = (plan: Awaited<ReturnType<typeof buildAuthPlan>>): string =>
      plan.env.find((entry) => entry.key === 'JWT_SECRET')?.value ?? '';

    expect(secretOf(first)).not.toBe('');
    expect(secretOf(first).length).toBeGreaterThanOrEqual(32);
    // Regenerated per run: a fixed secret shipped to every project would be catastrophic.
    expect(secretOf(first)).not.toBe(secretOf(second));
    expect(first.env.find((entry) => entry.key === 'JWT_SECRET')?.secret).toBe(true);
  });

  it('defaults the refresh cookie to secure', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));

    expect(plan.env.find((entry) => entry.key === 'AUTH_COOKIE_SECURE')?.value).toBe('true');
  });

  it('uses a short access-token lifetime', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));
    const ttl = Number(plan.env.find((entry) => entry.key === 'ACCESS_TOKEN_TTL_SECONDS')?.value);

    expect(ttl).toBeLessThanOrEqual(900);
  });

  it('requests router wiring with a manual fallback', async () => {
    const plan = await buildAuthPlan(options(), context(fakeRenderer()));
    const injection = plan.injections[0];

    expect(injection?.path.endsWith('app.ts')).toBe(true);
    expect(injection?.snippet).toContain('createAuthRouter');
    expect(injection?.manualHint.length).toBeGreaterThan(0);
  });

  it('tells prisma users to merge the schema and regenerate', async () => {
    const plan = await buildAuthPlan(options({ database: 'prisma' }), context(fakeRenderer()));

    expect(plan.notes.join('\n')).toContain('prisma generate');
  });
});
