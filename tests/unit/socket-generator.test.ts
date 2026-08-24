import { describe, expect, it } from 'vitest';

import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { socketGenerator } from '../../src/generators/socket/socket.generator.js';
import type { SocketOptions } from '../../src/generators/socket/socket.schema.js';
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
  'socket/events.ts',
  'socket/server.ts',
  'socket/handlers.ts',
  'socket/index.ts',
];

const MANIFEST_DEPENDENCIES: Readonly<Record<string, string>> = {
  'socket.io': '^4.8.3',
  jose: '^6.2.4',
};

/** Renders the declared destinations with placeholder bodies. Token logic is tested elsewhere. */
function fakeRenderer(files: readonly string[] = TEMPLATE_FILES): TemplateRenderer {
  const template: LoadedTemplate = {
    root: '/atlas/templates/socket',
    filesRoot: '/atlas/templates/socket/files',
    manifest: {
      name: 'socket',
      version: '1.0.0',
      description: 'socket',
      dependencies: MANIFEST_DEPENDENCIES,
      devDependencies: {},
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

describe('socketGenerator.detect', () => {
  it('accepts an Express TypeScript project', async () => {
    const verdict = await socketGenerator.detect(context(fakeRenderer()));

    expect(verdict).toEqual({ supported: true, reason: undefined, hint: undefined });
  });

  it('refuses a JavaScript project with a reason and a hint', async () => {
    const project = projectContext({ language: 'javascript' });
    const verdict = await socketGenerator.detect(context(fakeRenderer(), project));

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('JavaScript');
    expect(verdict.hint).toContain('tsconfig.json');
  });

  it('refuses a non-Express project and names the framework it found', async () => {
    const project = projectContext({ framework: 'fastify' });
    const verdict = await socketGenerator.detect(context(fakeRenderer(), project));

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('fastify');
    expect(verdict.hint?.length).toBeGreaterThan(0);
  });
});

describe('socketGenerator.prompt', () => {
  it('defaults the directory to the project source directory', async () => {
    const options = await socketGenerator.prompt(
      { argument: undefined, flags: {} },
      context(fakeRenderer()),
    );

    expect(options.directory).toBe('src');
  });

  it('honours --dir', async () => {
    const options = await socketGenerator.prompt(
      { argument: undefined, flags: { dir: 'src/realtime' } },
      context(fakeRenderer()),
    );

    expect(options.directory).toBe('src/realtime');
  });

  it('asks nothing, so an unscripted prompt runner is never reached', async () => {
    // ScriptedPromptRunner throws when asked a question it has no answer for.
    const options = await socketGenerator.prompt(
      { argument: undefined, flags: {} },
      context(fakeRenderer(), projectContext({ layout: { sourceDir: '.', flat: true } })),
    );

    expect(options.directory).toBe('.');
  });
});

describe('socketGenerator.validate', () => {
  const options = (directory: string): SocketOptions => ({ directory });

  it('accepts a relative directory inside the project', () => {
    expect(() =>
      socketGenerator.validate(options('src/realtime'), context(fakeRenderer())),
    ).not.toThrow();
  });

  it('rejects a directory that escapes the project', () => {
    try {
      socketGenerator.validate(options('../escape'), context(fakeRenderer()));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
    }
  });

  it('rejects an absolute directory', () => {
    const absolute = process.platform === 'win32' ? 'C:\\elsewhere' : '/elsewhere';

    try {
      socketGenerator.validate(options(absolute), context(fakeRenderer()));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
    }
  });
});

describe('socketGenerator.generate', () => {
  it('writes the module under the chosen directory', async () => {
    const plan = await socketGenerator.generate(
      { directory: 'src/realtime' },
      context(fakeRenderer()),
    );

    expect(destinations(plan.files)).toEqual([
      'src/realtime/socket/events.ts',
      'src/realtime/socket/handlers.ts',
      'src/realtime/socket/index.ts',
      'src/realtime/socket/server.ts',
    ]);
  });

  it('leaves destinations unprefixed in a flat project', async () => {
    const plan = await socketGenerator.generate(
      { directory: '.' },
      context(fakeRenderer(), projectContext({ layout: { sourceDir: '.', flat: true } })),
    );

    expect(destinations(plan.files)).toContain('socket/index.ts');
  });

  it('declares socket.io with the range from the manifest', async () => {
    const plan = await socketGenerator.generate({ directory: 'src' }, context(fakeRenderer()));

    expect(plan.dependencies).toEqual(
      expect.arrayContaining([
        { name: 'socket.io', range: MANIFEST_DEPENDENCIES['socket.io'], dev: false },
      ]),
    );
  });

  it('takes every dependency range from the manifest rather than hardcoding one', async () => {
    const plan = await socketGenerator.generate({ directory: 'src' }, context(fakeRenderer()));

    for (const dependency of plan.dependencies) {
      expect(dependency.range).toBe(MANIFEST_DEPENDENCIES[dependency.name]);
    }
  });

  it('carries notes covering the env vars and the server wiring', async () => {
    const plan = await socketGenerator.generate({ directory: 'src' }, context(fakeRenderer()));
    const notes = plan.notes.join('\n');

    expect(plan.notes.length).toBeGreaterThan(0);
    expect(notes).toContain('JWT_SECRET');
    expect(notes).toContain('SOCKET_CORS_ORIGIN');
    expect(notes).toContain('createSocketServer');
  });
});
