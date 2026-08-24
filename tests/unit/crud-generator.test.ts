import { describe, expect, it } from 'vitest';

import { crudGenerator } from '../../src/generators/crud/crud.generator.js';
import type { CrudOptions } from '../../src/generators/crud/crud.schema.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { ScriptedPromptRunner } from '../../src/prompts/prompt-runner.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type {
  DetectionVerdict,
  GeneratorContext,
  GeneratorInvocation,
} from '../../src/types/generator.js';
import type { ProjectContext } from '../../src/types/project-context.js';
import type {
  LoadedTemplate,
  RenderedFile,
  TemplateRenderer,
  TokenValues,
} from '../../src/types/template-manifest.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const ROOT = process.platform === 'win32' ? 'C:\\project' : '/project';

/** The tokenised sources the real template ships, so destinations exercise path substitution. */
const TEMPLATE_SOURCES: readonly string[] = [
  'controllers/__ENTITY_KEBAB__.controller.ts',
  'models/__ENTITY_KEBAB__.model.ts',
  'routes/__ENTITY_KEBAB__.routes.ts',
  'services/__ENTITY_KEBAB__.service.ts',
];

const MANIFEST_DEPENDENCIES: Readonly<Record<string, string>> = { zod: '^4.4.3' };

/** Every casing under test, so one render proves they all come from the same name. */
const BODY = [
  "export const name = '__ENTITY_NAME__';",
  "export const camel = '__ENTITY_CAMEL__';",
  "export const kebab = '__ENTITY_KEBAB__';",
  "export const plural = '__ENTITY_PLURAL_CAMEL__';",
  "export const constant = '__ENTITY_CONSTANT__';",
].join('\n');

function substitute(subject: string, tokens: TokenValues): string {
  return Object.entries(tokens).reduce(
    (carry, [token, value]) => carry.split(token).join(value),
    subject,
  );
}

/**
 * Substitutes for real, unlike the auth fake: the whole point of this generator is that the
 * entity name reaches both the destinations and the contents.
 */
function fakeRenderer(): TemplateRenderer {
  const template: LoadedTemplate = {
    root: '/atlas/templates/crud',
    filesRoot: '/atlas/templates/crud/files',
    manifest: {
      name: 'crud',
      version: '1.0.0',
      description: 'crud',
      dependencies: MANIFEST_DEPENDENCIES,
      devDependencies: {},
      scripts: {},
      files: [],
      requires: { frameworks: ['express'], language: 'typescript', dependencies: {} },
    },
  };

  return {
    load: () => Promise.resolve(template),
    render: (_template: LoadedTemplate, tokens: TokenValues): Promise<readonly RenderedFile[]> =>
      Promise.resolve(
        TEMPLATE_SOURCES.map((source): RenderedFile => ({
          destination: substitute(source, tokens),
          contents: substitute(`// ${source}\n${BODY}\n`, tokens),
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

function context(project = projectContext()): GeneratorContext {
  const stream = new MemoryStream();

  return {
    project,
    globals: { cwd: project.root, yes: true, dryRun: false, verbose: false, color: false },
    reporter: new Reporter({ stdout: stream, stderr: stream, color: false, verbose: false }),
    prompts: new ScriptedPromptRunner(),
    templates: fakeRenderer(),
    readFile: () => Promise.resolve(undefined),
    resolve: (...segments) => [project.root, ...segments].join('/'),
  };
}

function invocation(
  argument: string | undefined,
  flags: Record<string, unknown> = {},
): GeneratorInvocation {
  return { argument, flags };
}

function destinations(files: readonly { readonly path: string }[]): readonly string[] {
  return files
    .map((file) =>
      file.path
        .slice(ROOT.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

/** The whole lifecycle, as the command layer runs it. */
async function run(
  argument: string | undefined,
  flags: Record<string, unknown> = {},
  project = projectContext(),
): Promise<Awaited<ReturnType<typeof crudGenerator.generate>>> {
  const generatorContext = context(project);
  const options = await crudGenerator.prompt(invocation(argument, flags), generatorContext);

  crudGenerator.validate(options, generatorContext);

  return crudGenerator.generate(options, generatorContext);
}

async function expectUsageError(action: () => Promise<unknown>): Promise<AtlasError> {
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  expect(AtlasError.isAtlasError(caught)).toBe(true);

  const error = caught as AtlasError;
  expect(error.code).toBe(ErrorCode.InvalidUsage);

  return error;
}

describe('crudGenerator.meta', () => {
  it('declares the entity as a required positional argument', () => {
    expect(crudGenerator.meta.argument).toEqual({
      name: 'entity',
      description: 'Name of the entity, e.g. User',
      required: true,
    });
  });
});

describe('crudGenerator.detect', () => {
  const verdictFor = async (project = projectContext()): Promise<DetectionVerdict> =>
    crudGenerator.detect(context(project));

  it('accepts an Express TypeScript project', async () => {
    expect(await verdictFor()).toEqual({
      supported: true,
      reason: undefined,
      hint: undefined,
    });
  });

  it('refuses a JavaScript project with an actionable reason', async () => {
    const verdict = await verdictFor(projectContext({ language: 'javascript' }));

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('JavaScript');
    expect(verdict.hint).toContain('tsconfig.json');
  });

  it('refuses a non-Express project and names what it found', async () => {
    const verdict = await verdictFor(projectContext({ framework: 'fastify' }));

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('Express');
    expect(verdict.reason).toContain('fastify');
    expect(verdict.hint).not.toBe(undefined);
  });
});

describe('crudGenerator.prompt', () => {
  it('takes the entity from the positional argument', async () => {
    const options = await crudGenerator.prompt(invocation('  user profile  '), context());

    expect(options.entity).toBe('user profile');
  });

  it('asks for the entity when a programmatic caller omits it', async () => {
    // ScriptedPromptRunner answers with the question's own default.
    const options = await crudGenerator.prompt(invocation(undefined), context());

    expect(options.entity).toBe('Resource');
  });

  it('defaults the destination to the detected source directory', async () => {
    const options = await crudGenerator.prompt(invocation('User'), context());

    expect(options.directory).toBe('src');
  });

  it('honours --dir over the detected source directory', async () => {
    const options = await crudGenerator.prompt(invocation('User', { dir: 'app' }), context());

    expect(options.directory).toBe('app');
  });

  it('rejects a name that cannot become an identifier', async () => {
    const error = await expectUsageError(() =>
      crudGenerator.prompt(invocation('123bad'), context()),
    );

    expect(error.message).toContain('123bad');
  });

  it('rejects a reserved word', async () => {
    const error = await expectUsageError(() =>
      crudGenerator.prompt(invocation('class'), context()),
    );

    expect(error.message).toContain('reserved word');
  });
});

describe('crudGenerator.validate', () => {
  const options = (overrides: Partial<CrudOptions> = {}): CrudOptions => ({
    entity: 'User',
    directory: 'src',
    ...overrides,
  });

  it('accepts a relative directory inside the project', () => {
    expect(() =>
      crudGenerator.validate(options({ directory: 'src/api' }), context()),
    ).not.toThrow();
  });

  it('rejects a directory that escapes the project', async () => {
    const error = await expectUsageError(() =>
      Promise.resolve(crudGenerator.validate(options({ directory: '../escape' }), context())),
    );

    expect(error.message).toContain('inside the project');
  });

  it('rejects an absolute directory', async () => {
    const absolute = process.platform === 'win32' ? 'C:\\elsewhere' : '/elsewhere';
    const error = await expectUsageError(() =>
      Promise.resolve(crudGenerator.validate(options({ directory: absolute }), context())),
    );

    expect(error.message).toContain('relative to the project root');
  });

  it('rejects a bad entity name reaching it programmatically', async () => {
    await expectUsageError(() =>
      Promise.resolve(crudGenerator.validate(options({ entity: '123bad' }), context())),
    );
  });
});

describe('crudGenerator.generate destinations', () => {
  it('names every file after the entity, under the source directory', async () => {
    const plan = await run('User');

    expect(destinations(plan.files)).toEqual([
      'src/controllers/user.controller.ts',
      'src/models/user.model.ts',
      'src/routes/user.routes.ts',
      'src/services/user.service.ts',
    ]);
  });

  it('kebab-cases a multi-word entity in the file names', async () => {
    const plan = await run('user profile');

    expect(destinations(plan.files)).toContain('src/models/user-profile.model.ts');
  });

  it('honours --dir', async () => {
    const plan = await run('User', { dir: 'app/resources' });

    expect(destinations(plan.files)).toContain('app/resources/models/user.model.ts');
  });

  it('leaves destinations unprefixed in a flat project', async () => {
    const plan = await run('User', {}, projectContext({ layout: { sourceDir: '.', flat: true } }));

    expect(destinations(plan.files)).toContain('models/user.model.ts');
  });
});

describe('crudGenerator.generate contents', () => {
  function contentsOf(
    files: readonly { readonly path: string; readonly contents: string }[],
  ): string {
    return files.map((file) => file.contents).join('\n');
  }

  it('derives every casing from the one name the user typed', async () => {
    const plan = await run('User');
    const contents = contentsOf(plan.files);

    expect(contents).toContain("export const name = 'User';");
    expect(contents).toContain("export const camel = 'user';");
    expect(contents).toContain("export const kebab = 'user';");
    expect(contents).toContain("export const plural = 'users';");
    expect(contents).toContain("export const constant = 'USER';");
  });

  it('keeps the casings consistent for a multi-word entity', async () => {
    const plan = await run('user profile');
    const contents = contentsOf(plan.files);

    expect(contents).toContain("export const name = 'UserProfile';");
    expect(contents).toContain("export const kebab = 'user-profile';");
    expect(contents).toContain("export const plural = 'userProfiles';");
    expect(contents).toContain("export const constant = 'USER_PROFILE';");
  });

  it('leaves no unresolved token behind', async () => {
    const plan = await run('User');

    expect(contentsOf(plan.files)).not.toMatch(/__[A-Z][A-Z0-9_]*__/u);
  });
});

describe('crudGenerator.generate dependencies and notes', () => {
  it('declares zod with the range from the manifest and nothing else', async () => {
    const plan = await run('User');

    expect(plan.dependencies).toEqual([
      { name: 'zod', range: MANIFEST_DEPENDENCIES['zod'], dev: false },
    ]);
  });

  it('tells the user to mount the router and to replace the in-memory store', async () => {
    const plan = await run('User');
    const notes = plan.notes.join('\n');

    expect(notes).toContain('app.use');
    expect(notes).toContain('database');
  });
});
