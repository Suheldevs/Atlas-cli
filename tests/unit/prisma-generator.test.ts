import { describe, expect, it } from 'vitest';

import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { prismaGenerator } from '../../src/generators/prisma/prisma.generator.js';
import { buildPrismaPlan } from '../../src/generators/prisma/prisma.plan.js';
import { readPrismaFlags } from '../../src/generators/prisma/prisma.schema.js';
import type { PrismaOptions } from '../../src/generators/prisma/prisma.schema.js';
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
import { MemoryStream } from '../helpers/memory-stream.js';

const ROOT = process.platform === 'win32' ? 'C:\\project' : '/project';

/** Every file the real template ships, with just enough content to see tokens resolve. */
const TEMPLATE_SOURCES: Readonly<Record<string, string>> = {
  'prisma/schema.prisma': 'datasource db {\n  provider = "__DATABASE__"\n}\n',
  'db/prisma.ts': "import { PrismaClient } from '@prisma/client';\n",
  'db/index.ts': "export { disconnect, prisma } from './prisma__IMPORT_SUFFIX__';\n",
};

const MANIFEST_DEPENDENCIES: Readonly<Record<string, string>> = { '@prisma/client': '^6.19.3' };

const MANIFEST_DEV_DEPENDENCIES: Readonly<Record<string, string>> = { prisma: '^6.19.3' };

/**
 * Substitutes tokens the way the real loader does, and mirrors `files/` — so every entry arrives
 * with `format: true`, which is what makes the `.prisma` assertions meaningful.
 */
function fakeRenderer(): TemplateRenderer {
  const template: LoadedTemplate = {
    root: '/atlas/templates/prisma',
    filesRoot: '/atlas/templates/prisma/files',
    manifest: {
      name: 'prisma',
      version: '1.0.0',
      description: 'prisma',
      dependencies: MANIFEST_DEPENDENCIES,
      devDependencies: MANIFEST_DEV_DEPENDENCIES,
      scripts: {},
      files: [],
      requires: { frameworks: [], language: 'typescript', dependencies: {} },
    },
  };

  return {
    load: () => Promise.resolve(template),
    render: (_template: LoadedTemplate, tokens: TokenValues): Promise<readonly RenderedFile[]> =>
      Promise.resolve(
        Object.entries(TEMPLATE_SOURCES).map(([destination, contents]): RenderedFile => ({
          destination,
          contents: substitute(contents, tokens),
          format: true,
        })),
      ),
  };
}

function substitute(contents: string, tokens: TokenValues): string {
  return Object.entries(tokens).reduce(
    (result, [token, value]) => result.split(token).join(value),
    contents,
  );
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

interface ContextOptions {
  readonly project?: ProjectContext;
  /** Project-relative paths `readFile` should report as already present. */
  readonly existing?: readonly string[];
  readonly answers?: readonly unknown[];
}

function context(renderer: TemplateRenderer, options: ContextOptions = {}): GeneratorContext {
  const project = options.project ?? projectContext();
  const existing = options.existing ?? [];
  const stream = new MemoryStream();

  return {
    project,
    globals: { cwd: project.root, yes: true, dryRun: false, verbose: false, color: false },
    reporter: new Reporter({ stdout: stream, stderr: stream, color: false, verbose: false }),
    prompts: new ScriptedPromptRunner(options.answers ?? []),
    templates: renderer,
    readFile: (path: string) =>
      Promise.resolve(
        existing.some((file) => path.split('\\').join('/').endsWith(file))
          ? 'model Post {}\n'
          : undefined,
      ),
    resolve: (...segments) => [project.root, ...segments].join('/'),
  };
}

function options(overrides: Partial<PrismaOptions> = {}): PrismaOptions {
  return { directory: 'src', provider: 'postgresql', ...overrides };
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

describe('prismaGenerator detection', () => {
  it('supports a TypeScript project', async () => {
    const verdict = await prismaGenerator.detect(context(fakeRenderer()));

    expect(verdict.supported).toBe(true);
  });

  it('refuses a JavaScript project with a reason and a hint', async () => {
    const verdict = await prismaGenerator.detect(
      context(fakeRenderer(), { project: projectContext({ language: 'javascript' }) }),
    );

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('JavaScript');
    expect(verdict.hint).toContain('tsconfig.json');
  });

  it('is framework-agnostic', async () => {
    expect(prismaGenerator.meta.frameworks).toEqual([]);

    for (const framework of ['nest', 'fastify', 'unknown'] as const) {
      const verdict = await prismaGenerator.detect(
        context(fakeRenderer(), { project: projectContext({ framework }) }),
      );
      expect(verdict.supported).toBe(true);
    }
  });
});

describe('prismaGenerator options', () => {
  it('accepts each supported provider', () => {
    for (const provider of ['postgresql', 'mysql', 'sqlite'] as const) {
      expect(readPrismaFlags({ provider }).provider).toBe(provider);
    }
  });

  it('rejects an unknown provider as invalid usage', () => {
    try {
      readPrismaFlags({ provider: 'oracle' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
      expect((error as AtlasError).code).toBe('ATLAS_2001');
    }
  });

  it('leaves an absent provider undefined so the prompt owns the default', () => {
    expect(readPrismaFlags({}).provider).toBeUndefined();
  });

  it('uses the flag when given and defaults to postgresql when not', async () => {
    const chosen = await prismaGenerator.prompt(
      { argument: undefined, flags: { provider: 'sqlite' } },
      context(fakeRenderer()),
    );
    const defaulted = await prismaGenerator.prompt(
      { argument: undefined, flags: {} },
      context(fakeRenderer()),
    );

    expect(chosen.provider).toBe('sqlite');
    expect(defaulted.provider).toBe('postgresql');
    expect(defaulted.directory).toBe('src');
  });

  it('rejects a --dir that escapes the project', () => {
    try {
      prismaGenerator.validate(options({ directory: '../elsewhere' }), context(fakeRenderer()));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
    }
  });
});

describe('buildPrismaPlan destinations', () => {
  it('writes the schema to prisma/schema.prisma, outside the source directory', async () => {
    const plan = await buildPrismaPlan(options(), context(fakeRenderer()));
    const files = destinations(plan.files);

    expect(files).toContain('prisma/schema.prisma');
    expect(files).not.toContain('src/prisma/schema.prisma');
    expect(files.some((file) => file.startsWith('src/prisma/'))).toBe(false);
  });

  it('keeps the schema at the root even for a custom --dir', async () => {
    const plan = await buildPrismaPlan(options({ directory: 'source' }), context(fakeRenderer()));
    const files = destinations(plan.files);

    expect(files).toContain('prisma/schema.prisma');
    expect(files).toContain('source/db/prisma.ts');
  });

  it('puts the client under the source directory', async () => {
    const plan = await buildPrismaPlan(options(), context(fakeRenderer()));
    const files = destinations(plan.files);

    expect(files).toContain('src/db/prisma.ts');
    expect(files).toContain('src/db/index.ts');
  });

  it('handles a flat project with no source directory', async () => {
    const plan = await buildPrismaPlan(
      options({ directory: '.' }),
      context(fakeRenderer(), {
        project: projectContext({ layout: { sourceDir: '.', flat: true } }),
      }),
    );

    expect(destinations(plan.files)).toContain('db/prisma.ts');
  });

  it('does not format the schema, which prettier cannot parse', async () => {
    const plan = await buildPrismaPlan(options(), context(fakeRenderer()));

    expect(plan.files.find((file) => file.path.endsWith('schema.prisma'))?.format).toBe(false);
    expect(plan.files.find((file) => file.path.endsWith('prisma.ts'))?.format).toBe(true);
  });
});

describe('buildPrismaPlan schema contents', () => {
  it('writes the chosen provider into the datasource block', async () => {
    for (const provider of ['postgresql', 'mysql', 'sqlite'] as const) {
      const plan = await buildPrismaPlan(options({ provider }), context(fakeRenderer()));
      const schema = plan.files.find((file) => file.path.endsWith('schema.prisma'));

      expect(schema?.contents).toContain(`provider = "${provider}"`);
    }
  });

  it('overrides the detected database rather than echoing it', async () => {
    const plan = await buildPrismaPlan(
      options({ provider: 'mysql' }),
      context(fakeRenderer(), { project: projectContext({ database: 'mongoose' }) }),
    );
    const schema = plan.files.find((file) => file.path.endsWith('schema.prisma'));

    expect(schema?.contents).toContain('provider = "mysql"');
    expect(schema?.contents).not.toContain('mongoose');
  });
});

describe('buildPrismaPlan dependencies and environment', () => {
  it('declares the client and the CLI at the manifest ranges', async () => {
    const plan = await buildPrismaPlan(options(), context(fakeRenderer()));

    expect(plan.dependencies).toEqual([
      { name: '@prisma/client', range: '^6.19.3', dev: false },
      { name: 'prisma', range: '^6.19.3', dev: true },
    ]);
  });

  it('adds DATABASE_URL as a secret, with an example in the comment', async () => {
    const plan = await buildPrismaPlan(options({ provider: 'mysql' }), context(fakeRenderer()));
    const entry = plan.env.find((item) => item.key === 'DATABASE_URL');

    expect(entry?.secret).toBe(true);
    expect(entry?.comment).toContain('mysql://');
  });
});

describe('buildPrismaPlan notes', () => {
  it('covers migrate, generate and DATABASE_URL', async () => {
    const plan = await buildPrismaPlan(options(), context(fakeRenderer()));
    const notes = plan.notes.join('\n');

    expect(notes).toContain('npx prisma migrate dev');
    expect(notes).toContain('npx prisma generate');
    expect(notes).toContain('DATABASE_URL');
  });

  it('warns when the project already has a schema', async () => {
    const plan = await buildPrismaPlan(
      options(),
      context(fakeRenderer(), { existing: ['prisma/schema.prisma'] }),
    );

    expect(plan.notes.join('\n')).toContain('already exists');
  });

  it('says nothing about an existing schema when there is none', async () => {
    const plan = await buildPrismaPlan(options(), context(fakeRenderer()));

    expect(plan.notes.join('\n')).not.toContain('already exists');
  });
});
