import { describe, expect, it } from 'vitest';

import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { redisGenerator } from '../../src/generators/redis/redis.generator.js';
import type { RedisOptions } from '../../src/generators/redis/redis.schema.js';
import { ScriptedPromptRunner } from '../../src/prompts/prompt-runner.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { GeneratorContext, GeneratorInvocation } from '../../src/types/generator.js';
import type { ProjectContext } from '../../src/types/project-context.js';
import type {
  LoadedTemplate,
  RenderedFile,
  TemplateRenderer,
  TokenValues,
} from '../../src/types/template-manifest.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const ROOT = process.platform === 'win32' ? 'C:\\project' : '/project';

/** Every destination the real template ships. */
const TEMPLATE_FILES: readonly string[] = ['redis/cache.ts', 'redis/client.ts', 'redis/index.ts'];

const MANIFEST_DEPENDENCIES: Readonly<Record<string, string>> = { ioredis: '^5.11.1' };

/** Renders the declared destinations with placeholder bodies. Token logic is tested elsewhere. */
function fakeRenderer(files: readonly string[] = TEMPLATE_FILES): TemplateRenderer {
  const template: LoadedTemplate = {
    root: '/atlas/templates/redis',
    filesRoot: '/atlas/templates/redis/files',
    manifest: {
      name: 'redis',
      version: '1.0.0',
      description: 'redis',
      dependencies: MANIFEST_DEPENDENCIES,
      devDependencies: {},
      scripts: {},
      files: [],
      requires: { frameworks: [], language: 'typescript', dependencies: {} },
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

function invocation(flags: Readonly<Record<string, unknown>> = {}): GeneratorInvocation {
  return { argument: undefined, flags };
}

function options(overrides: Partial<RedisOptions> = {}): RedisOptions {
  return { directory: 'src', ...overrides };
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

describe('redisGenerator.detect', () => {
  it('supports a TypeScript project', async () => {
    const verdict = await redisGenerator.detect(context(fakeRenderer()));

    expect(verdict).toEqual({ supported: true, reason: undefined, hint: undefined });
  });

  it('refuses a JavaScript project with a reason and a hint', async () => {
    const verdict = await redisGenerator.detect(
      context(fakeRenderer(), projectContext({ language: 'javascript' })),
    );

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('JavaScript');
    expect(verdict.hint).toContain('tsconfig.json');
  });
});

describe('redisGenerator.meta', () => {
  it('is framework-agnostic, so a non-web project is still a candidate', () => {
    expect(redisGenerator.meta.frameworks).toEqual([]);
  });

  it('takes no positional argument', () => {
    expect(redisGenerator.meta.argument).toBeUndefined();
  });

  it('supports a project with no recognised framework', async () => {
    const verdict = await redisGenerator.detect(
      context(fakeRenderer(), projectContext({ framework: 'unknown' })),
    );

    expect(verdict.supported).toBe(true);
  });
});

describe('redisGenerator.prompt', () => {
  it("defaults the directory to the project's source directory", async () => {
    const resolved = await redisGenerator.prompt(invocation(), context(fakeRenderer()));

    expect(resolved.directory).toBe('src');
  });

  it('honours --dir', async () => {
    const resolved = await redisGenerator.prompt(
      invocation({ dir: 'src/infra' }),
      context(fakeRenderer()),
    );

    expect(resolved.directory).toBe('src/infra');
  });

  it('falls back to the source directory for an empty --dir', async () => {
    const resolved = await redisGenerator.prompt(invocation({ dir: '' }), context(fakeRenderer()));

    expect(resolved.directory).toBe('src');
  });
});

describe('redisGenerator.validate', () => {
  it('accepts a relative directory inside the project', () => {
    expect(() => {
      redisGenerator.validate(options({ directory: 'src/infra' }), context(fakeRenderer()));
    }).not.toThrow();
  });

  it('rejects a directory that escapes the project', () => {
    try {
      redisGenerator.validate(options({ directory: '../escape' }), context(fakeRenderer()));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
    }
  });

  it('rejects an absolute directory', () => {
    const absolute = process.platform === 'win32' ? 'C:\\elsewhere' : '/elsewhere';

    try {
      redisGenerator.validate(options({ directory: absolute }), context(fakeRenderer()));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
    }
  });
});

describe('redisGenerator.generate', () => {
  it('writes the module under the source directory', async () => {
    const plan = await redisGenerator.generate(options(), context(fakeRenderer()));

    expect(destinations(plan.files)).toEqual([
      'src/redis/cache.ts',
      'src/redis/client.ts',
      'src/redis/index.ts',
    ]);
  });

  it('honours the directory the caller resolved', async () => {
    const plan = await redisGenerator.generate(
      options({ directory: 'src/infra' }),
      context(fakeRenderer()),
    );

    expect(destinations(plan.files)).toContain('src/infra/redis/index.ts');
  });

  it('produces unprefixed destinations in a flat project', async () => {
    const plan = await redisGenerator.generate(
      options({ directory: '.' }),
      context(fakeRenderer(), projectContext({ layout: { sourceDir: '.', flat: true } })),
    );

    expect(destinations(plan.files)).toContain('redis/index.ts');
  });

  it("declares ioredis with the manifest's range and nothing else", async () => {
    const plan = await redisGenerator.generate(options(), context(fakeRenderer()));

    expect(plan.dependencies).toEqual([
      { name: 'ioredis', range: MANIFEST_DEPENDENCIES['ioredis'], dev: false },
    ]);
  });

  it('carries notes covering the env vars and the lazy connection', async () => {
    const plan = await redisGenerator.generate(options(), context(fakeRenderer()));
    const notes = plan.notes.join('\n');

    expect(plan.notes.length).toBeGreaterThan(0);
    expect(notes).toContain('REDIS_URL');
    expect(notes).toContain('REDIS_DEFAULT_TTL_SECONDS');
    expect(notes).toContain('lazy');
  });
});
