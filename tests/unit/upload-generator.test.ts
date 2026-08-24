import { describe, expect, it } from 'vitest';

import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { uploadGenerator } from '../../src/generators/upload/upload.generator.js';
import type { UploadOptions } from '../../src/generators/upload/upload.schema.js';
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

/** Every destination the real template ships. */
const TEMPLATE_FILES: readonly string[] = [
  'upload/config.ts',
  'upload/upload.ts',
  'upload/routes.ts',
  'upload/index.ts',
];

const MANIFEST_DEPENDENCIES: Readonly<Record<string, string>> = { multer: '^2.2.0' };

const MANIFEST_DEV_DEPENDENCIES: Readonly<Record<string, string>> = { '@types/multer': '^2.2.0' };

/** Renders the declared destinations with placeholder bodies. Token logic is tested elsewhere. */
function fakeRenderer(files: readonly string[] = TEMPLATE_FILES): TemplateRenderer {
  const template: LoadedTemplate = {
    root: '/atlas/templates/upload',
    filesRoot: '/atlas/templates/upload/files',
    manifest: {
      name: 'upload',
      version: '1.0.0',
      description: 'upload',
      dependencies: MANIFEST_DEPENDENCIES,
      devDependencies: MANIFEST_DEV_DEPENDENCIES,
      scripts: {},
      files: [],
      requires: {
        frameworks: ['express'],
        language: 'typescript',
        dependencies: { express: '^5.0.0' },
      },
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

async function planFor(
  options: UploadOptions,
  project = projectContext(),
): Promise<Awaited<ReturnType<typeof uploadGenerator.generate>>> {
  return uploadGenerator.generate(options, context(fakeRenderer(), project));
}

describe('uploadGenerator.detect', () => {
  it('accepts an Express TypeScript project', async () => {
    const verdict = await uploadGenerator.detect(context(fakeRenderer()));

    expect(verdict.supported).toBe(true);
    expect(verdict.reason).toBeUndefined();
  });

  it('refuses a JavaScript project with a reason and a hint', async () => {
    const verdict = await uploadGenerator.detect(
      context(fakeRenderer(), projectContext({ language: 'javascript' })),
    );

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('JavaScript');
    expect(verdict.hint).toContain('tsconfig.json');
  });

  it('refuses a non-Express project and names the framework it found', async () => {
    const verdict = await uploadGenerator.detect(
      context(fakeRenderer(), projectContext({ framework: 'fastify' })),
    );

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('fastify');
    expect(verdict.hint).not.toBe(undefined);
  });
});

describe('uploadGenerator options', () => {
  it('defaults the destination to the project source directory', async () => {
    const options = await uploadGenerator.prompt(
      { argument: undefined, flags: {} },
      context(fakeRenderer()),
    );

    expect(options.directory).toBe('src');
  });

  it('honours --dir', async () => {
    const options = await uploadGenerator.prompt(
      { argument: undefined, flags: { dir: 'src/modules' } },
      context(fakeRenderer()),
    );

    expect(options.directory).toBe('src/modules');
    expect(destinations((await planFor(options)).files)).toContain('src/modules/upload/index.ts');
  });

  it('rejects a --dir that escapes the project', () => {
    try {
      uploadGenerator.validate({ directory: '../escape' }, context(fakeRenderer()));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
    }
  });

  it('rejects an absolute --dir', () => {
    const absolute = process.platform === 'win32' ? 'C:\\elsewhere' : '/elsewhere';

    expect(() =>
      uploadGenerator.validate({ directory: absolute }, context(fakeRenderer())),
    ).toThrow(AtlasError);
  });
});

describe('uploadGenerator plan', () => {
  it('writes the module under the source directory', async () => {
    const files = destinations((await planFor({ directory: 'src' })).files);

    expect(files).toEqual([
      'src/upload/config.ts',
      'src/upload/index.ts',
      'src/upload/routes.ts',
      'src/upload/upload.ts',
    ]);
  });

  it('leaves destinations unprefixed in a flat project', async () => {
    const plan = await planFor(
      { directory: '.' },
      projectContext({ layout: { sourceDir: '.', flat: true } }),
    );

    expect(destinations(plan.files)).toContain('upload/index.ts');
  });

  it('declares multer as a dependency at the manifest range', async () => {
    const plan = await planFor({ directory: 'src' });

    expect(plan.dependencies).toEqual(
      expect.arrayContaining([{ name: 'multer', range: '^2.2.0', dev: false }]),
    );
  });

  it('declares @types/multer as a dev dependency at the manifest range', async () => {
    const plan = await planFor({ directory: 'src' });

    expect(plan.dependencies).toEqual(
      expect.arrayContaining([{ name: '@types/multer', range: '^2.2.0', dev: true }]),
    );
  });

  it('takes every version range from the template manifest', async () => {
    const plan = await planFor({ directory: 'src' });

    for (const dependency of plan.dependencies) {
      const declared = dependency.dev
        ? MANIFEST_DEV_DEPENDENCIES[dependency.name]
        : MANIFEST_DEPENDENCIES[dependency.name];
      expect(dependency.range).toBe(declared);
    }
  });

  it('carries notes covering the env vars and the gitignore reminder', async () => {
    const plan = await planFor({ directory: 'src' });
    const notes = plan.notes.join('\n');

    expect(plan.notes.length).toBeGreaterThan(0);
    expect(notes).toContain('UPLOAD_DIR');
    expect(notes).toContain('UPLOAD_MAX_FILE_SIZE_BYTES');
    expect(notes).toContain('.gitignore');
  });
});
