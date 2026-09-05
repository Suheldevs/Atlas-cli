import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { CommandContext } from '../../src/commands/register-commands.js';
import {
  assertTemplatesAvailable,
  clientTemplates,
  serverTemplates,
} from '../../src/commands/start/blueprint.js';
import { describeWriteFailure } from '../../src/commands/start/failure.js';
import { renderHalfManifest } from '../../src/commands/start/manifest.js';
import {
  assertTargetIsUsable,
  assertValidProjectName,
} from '../../src/commands/start/preflight.js';
import { ScaffoldGuard } from '../../src/commands/start/scaffold-guard.js';
import { runStart } from '../../src/commands/start/start-runner.js';
import {
  CLIENT_DIR_NAME,
  createSyntheticProject,
  SERVER_DIR_NAME,
} from '../../src/commands/start/synthetic-context.js';
import { ExitCode } from '../../src/constants/exit-codes.js';
import { ProjectScanner } from '../../src/detection/index.js';
import { clearPrettierOptionsCache } from '../../src/engine/format/index.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { DEFAULT_LANGUAGE, parseLanguageFlag } from '../../src/prompts/language.prompt.js';
import { InteractivePromptRunner } from '../../src/prompts/prompt-runner.js';
import { resolveLanguage } from '../../src/prompts/language.prompt.js';
import { ProcessService, type RunResult } from '../../src/services/process.service.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { GlobalOptions } from '../../src/types/cli-options.js';
import { FixedClock, InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const WORK_DIR = '/work';
const TEMPLATES_ROOT = '/templates';
const PROJECT_NAME = 'my-app';

/** Every directory the blueprint can name, so a fixture run never depends on the shipped set. */
const BASE_TEMPLATES = ['server-base-js', 'server-base-ts', 'client-react-js', 'client-react-ts'];
const FEATURE_TEMPLATES = [
  'auth-js',
  'crud-js',
  'upload-js',
  'logger-js',
  'auth',
  'crud',
  'upload',
  'logger',
];

interface Harness {
  readonly fs: InMemoryFileSystem;
  readonly context: CommandContext;
  readonly stdout: MemoryStream;
  readonly stderr: MemoryStream;
  readonly exitCodes: number[];
}

function seedTemplate(
  fs: InMemoryFileSystem,
  name: string,
  files: Readonly<Record<string, string>>,
  dependencies: Readonly<Record<string, string>> = {},
): void {
  fs.setFile(
    `${TEMPLATES_ROOT}/${name}/template.json`,
    JSON.stringify({ name, version: '1.0.0', description: `${name} fixture`, dependencies }),
  );

  for (const [path, contents] of Object.entries(files)) {
    fs.setFile(`${TEMPLATES_ROOT}/${name}/files/${path}`, contents);
  }
}

function seedTemplates(fs: InMemoryFileSystem): void {
  for (const name of BASE_TEMPLATES) {
    seedTemplate(fs, name, {
      // A whole-package template: these land at the half's root, not under `src/`.
      'package.json': `{ "name": "__PROJECT_NAME__" }\n`,
      'src/main.js': `export const name = '__PROJECT_NAME__';\n`,
    });
  }

  for (const name of FEATURE_TEMPLATES) {
    seedTemplate(fs, name, {
      [`${name}/index.js`]: `export const feature = '${name}';\n`,
    });
  }

  // The CRUD templates are the only ones with a per-entity filename, which is what proves the
  // entity token reaches both the path and the contents.
  for (const name of ['crud-js', 'crud']) {
    seedTemplate(fs, name, {
      'models/__ENTITY_KEBAB__.model.js': `export const __ENTITY_CAMEL__ = '__ENTITY_NAME__';\n`,
    });
  }
}

function createHarness(
  overrides: Partial<GlobalOptions> = {},
  processes: ProcessService = new ProcessService(),
): Harness {
  const fs = new InMemoryFileSystem();
  seedTemplates(fs);

  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false });
  const exitCodes: number[] = [];

  const globals: GlobalOptions = {
    cwd: WORK_DIR,
    yes: true,
    dryRun: false,
    verbose: false,
    color: false,
    ...overrides,
  };

  return {
    fs,
    stdout,
    stderr,
    exitCodes,
    context: {
      reporter,
      processes,
      fs,
      clock: new FixedClock(),
      scanner: new ProjectScanner({ fs }),
      globals: () => globals,
      setExitCode: (code) => exitCodes.push(code),
    },
  };
}

/** Every child process fails, which is what an offline registry looks like from here. */
class FailingProcesses extends ProcessService {
  override async run(file: string, args: readonly string[] = []): Promise<RunResult> {
    return {
      command: [file, ...args].join(' '),
      exitCode: 1,
      stdout: '',
      stderr: 'ENOTFOUND registry.npmjs.org',
      failed: true,
    };
  }
}

beforeEach(() => {
  // The resolver caches per directory across tests, and these runs use paths that do not exist.
  clearPrettierOptionsCache();
});

describe('createSyntheticProject', () => {
  const project = createSyntheticProject({
    root: '/work/my-app',
    language: 'typescript',
    packageManager: 'pnpm',
  });

  it('roots each half in its own directory', () => {
    expect(project.server.root).toBe(join('/work/my-app', SERVER_DIR_NAME));
    expect(project.client.root).toBe(join('/work/my-app', CLIENT_DIR_NAME));
  });

  it('describes the server as an Express project on Mongoose', () => {
    expect(project.server.framework).toBe('express');
    expect(project.server.database).toBe('mongoose');
  });

  it('describes the client as React with no database', () => {
    expect(project.client.framework).toBe('react');
    expect(project.client.database).toBe('none');
  });

  it('shares the language, module system, layout and import suffix across both halves', () => {
    for (const half of [project.server, project.client]) {
      expect(half.language).toBe('typescript');
      expect(half.moduleSystem).toBe('esm');
      expect(half.packageManager).toBe('pnpm');
      expect(half.importSuffix).toBe('.js');
      expect(half.layout).toEqual({ sourceDir: 'src', flat: false });
    }
  });

  it('has no manifest, because the project does not exist yet', () => {
    expect(project.server.manifest).toBeUndefined();
    expect(project.client.manifest).toBeUndefined();
  });

  it('installs into each half rather than a shared root', () => {
    expect(project.server.workspace).toEqual({
      isMonorepo: false,
      installRoot: join('/work/my-app', SERVER_DIR_NAME),
      workspaceRoot: undefined,
    });
    expect(project.client.workspace.installRoot).toBe(join('/work/my-app', CLIENT_DIR_NAME));
  });

  it('claims a tsconfig only for the TypeScript language', () => {
    expect(project.server.typescript).toEqual({
      present: true,
      configPath: join('/work/my-app', SERVER_DIR_NAME, 'tsconfig.json'),
      strict: true,
    });

    const javascript = createSyntheticProject({
      root: '/work/my-app',
      language: 'javascript',
      packageManager: 'npm',
    });

    expect(javascript.server.typescript).toEqual({
      present: false,
      configPath: undefined,
      strict: false,
    });
  });
});

describe('parseLanguageFlag', () => {
  it('accepts both the short and the long spelling', () => {
    expect(parseLanguageFlag('js')).toBe('javascript');
    expect(parseLanguageFlag('javascript')).toBe('javascript');
    expect(parseLanguageFlag('ts')).toBe('typescript');
    expect(parseLanguageFlag('typescript')).toBe('typescript');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(parseLanguageFlag('  TS  ')).toBe('typescript');
  });

  it('rejects an unrecognised value as invalid usage', () => {
    expect(() => parseLanguageFlag('typscript')).toThrowError(AtlasError);

    try {
      parseLanguageFlag('typscript');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AtlasError).code).toBe(ErrorCode.InvalidUsage);
    }
  });

  it('rejects a flag given without a value', () => {
    expect(() => parseLanguageFlag(true)).toThrowError(AtlasError);
  });
});

describe('resolveLanguage', () => {
  function prompts(assumeYes: boolean): InteractivePromptRunner {
    const reporter = new Reporter({
      stdout: new MemoryStream(),
      stderr: new MemoryStream(),
      color: false,
    });
    return new InteractivePromptRunner({ reporter, assumeYes, interactive: !assumeYes });
  }

  it('uses the flag when one was given, without asking', async () => {
    await expect(resolveLanguage('ts', prompts(false))).resolves.toBe('typescript');
  });

  it('defaults to JavaScript under --yes', async () => {
    await expect(resolveLanguage(undefined, prompts(true))).resolves.toBe('javascript');
    expect(DEFAULT_LANGUAGE).toBe('javascript');
  });
});

describe('blueprint', () => {
  it('keys the server templates by language', () => {
    expect(serverTemplates('javascript').map((step) => step.template)).toEqual([
      'server-base-js',
      'auth-js',
      'crud-js',
      'upload-js',
      'logger-js',
    ]);

    expect(serverTemplates('typescript').map((step) => step.template)).toEqual([
      'server-base-ts',
      'auth',
      'crud',
      'upload',
      'logger',
    ]);
  });

  it('keys the client templates by language', () => {
    expect(clientTemplates('javascript')[0]?.template).toBe('client-react-js');
    expect(clientTemplates('typescript')[0]?.template).toBe('client-react-ts');
  });

  it('names every missing template in one error rather than crashing', async () => {
    const fs = new InMemoryFileSystem();
    fs.setFile(`${TEMPLATES_ROOT}/server-base-js/template.json`, '{}');

    await expect(
      assertTemplatesAvailable(fs, TEMPLATES_ROOT, serverTemplates('javascript')),
    ).rejects.toMatchObject({ code: ErrorCode.TemplateNotFound });
  });
});

describe('runStart', () => {
  async function start(harness: Harness, flags: { language?: string } = {}): Promise<void> {
    await runStart({
      context: harness.context,
      name: PROJECT_NAME,
      language: flags.language,
      skipInstall: true,
      skipGit: true,
      templatesRoot: TEMPLATES_ROOT,
    });
  }

  it('writes both halves into their own directories', async () => {
    const harness = createHarness();
    await start(harness, { language: 'js' });

    const written = Object.keys(harness.fs.snapshot()).filter((path) =>
      path.startsWith(`${WORK_DIR}/${PROJECT_NAME}/`),
    );

    expect(written).toContain(`${WORK_DIR}/${PROJECT_NAME}/server/package.json`);
    expect(written).toContain(`${WORK_DIR}/${PROJECT_NAME}/client/package.json`);
    expect(written).toContain(`${WORK_DIR}/${PROJECT_NAME}/server/src/auth-js/index.js`);
  });

  it('substitutes the project name rather than the half directory name', async () => {
    const harness = createHarness();
    await start(harness, { language: 'js' });

    const manifest = await harness.fs.readText(`${WORK_DIR}/${PROJECT_NAME}/server/package.json`);
    expect(JSON.parse(manifest)).toEqual({ name: PROJECT_NAME });
  });

  it('follows the language flag into the template lookup table', async () => {
    const harness = createHarness();
    await start(harness, { language: 'ts' });

    const paths = Object.keys(harness.fs.snapshot());
    expect(paths).toContain(`${WORK_DIR}/${PROJECT_NAME}/server/src/auth/index.js`);
    expect(paths).not.toContain(`${WORK_DIR}/${PROJECT_NAME}/server/src/auth-js/index.js`);
  });

  it('writes nothing under --dry-run', async () => {
    const harness = createHarness({ dryRun: true });
    const before = Object.keys(harness.fs.snapshot());

    await start(harness, { language: 'js' });

    expect(Object.keys(harness.fs.snapshot())).toEqual(before);
    expect(harness.fs.operations).toEqual([]);
    expect(await harness.fs.exists(`${WORK_DIR}/${PROJECT_NAME}`)).toBe(false);
  });

  it('still reports the tree and next steps under --dry-run', async () => {
    const harness = createHarness({ dryRun: true });
    await start(harness, { language: 'js' });

    expect(harness.stdout.text).toContain('Would create');
    expect(harness.stdout.text).toContain(`cd ${PROJECT_NAME}/server`);
    expect(harness.stdout.text).toContain(`cd ${PROJECT_NAME}/client`);
    expect(harness.stdout.text).toContain('npm run dev');
    expect(harness.stdout.text).toContain('Nothing was written.');
  });

  it('refuses a target directory that already has files in it', async () => {
    const harness = createHarness();
    harness.fs.setFile(`${WORK_DIR}/${PROJECT_NAME}/README.md`, '# mine\n');

    await expect(start(harness, { language: 'js' })).rejects.toMatchObject({
      code: ErrorCode.TargetNotEmpty,
    });
  });

  it('names what it found in an occupied target so the user can see it', async () => {
    const harness = createHarness();
    harness.fs.setFile(`${WORK_DIR}/${PROJECT_NAME}/README.md`, '# mine\n');

    await expect(start(harness, { language: 'js' })).rejects.toMatchObject({
      details: expect.arrayContaining(['README.md']),
    });
  });

  it('scaffolds into a directory holding only a fresh git repository', async () => {
    const harness = createHarness();
    await harness.fs.ensureDir(`${WORK_DIR}/${PROJECT_NAME}/.git`);

    await expect(start(harness, { language: 'js' })).resolves.toBeUndefined();
  });

  it('refuses a name that cannot be a directory and a package name', async () => {
    const harness = createHarness();

    await expect(
      runStart({
        context: harness.context,
        name: 'my app/../etc',
        language: 'js',
        skipInstall: true,
        skipGit: true,
        templatesRoot: TEMPLATES_ROOT,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidProjectName });
  });

  it('removes everything it wrote when a write fails part-way through', async () => {
    const harness = createHarness();
    // The client is written second, so the server half is already on disk when this throws.
    harness.fs.failWrites.add(`${WORK_DIR}/${PROJECT_NAME}/client/package.json`);

    await expect(start(harness, { language: 'js' })).rejects.toThrow();

    const survivors = Object.keys(harness.fs.snapshot()).filter((path) =>
      path.startsWith(`${WORK_DIR}/${PROJECT_NAME}`),
    );

    expect(survivors).toEqual([]);
    expect(await harness.fs.exists(`${WORK_DIR}/${PROJECT_NAME}`)).toBe(false);
  });
});

describe('assertValidProjectName', () => {
  const rejected: readonly (readonly [string, string, string])[] = [
    ['', 'empty', 'required'],
    ['   ', 'whitespace only', 'required'],
    ['/srv/app', 'an absolute path', 'absolute path'],
    ['nested/app', 'a path separator', 'path separator'],
    ['..', 'a parent reference', 'relative directory'],
    ['../app', 'a parent reference', 'path separator'],
    ['.hidden', 'a leading dot', "starts with '.'"],
    ['_private', 'a leading underscore', "starts with '_'"],
    ['MyApp', 'uppercase letters', 'uppercase'],
    ['con', 'a Windows device name', 'reserved device name'],
    ['NUL.txt', 'a Windows device name with an extension', 'uppercase'],
    ['lpt9', 'a Windows device name', 'reserved device name'],
    ['a'.repeat(215), 'an over-long name', 'more than npm allows'],
    ['my app', 'a space', 'not safe'],
    ['app!', 'punctuation', 'not safe'],
  ];

  for (const [name, why, expected] of rejected) {
    it(`rejects ${why} and says which rule was broken`, () => {
      try {
        assertValidProjectName(name);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(AtlasError.isAtlasError(error)).toBe(true);
        expect((error as AtlasError).code).toBe(ErrorCode.InvalidProjectName);
        expect((error as AtlasError).exitCode).toBe(ExitCode.InvalidUsage);
        expect((error as AtlasError).message.toLowerCase()).toContain(expected.toLowerCase());
        expect((error as AtlasError).hint).toBeTruthy();
      }
    });
  }

  for (const name of ['my-app', 'app', 'a1', 'my.app', 'my_app', 'x'.repeat(214)]) {
    it(`accepts '${name.slice(0, 12)}'`, () => {
      expect(() => {
        assertValidProjectName(name);
      }).not.toThrow();
    });
  }
});

describe('assertTargetIsUsable', () => {
  it('accepts a directory that does not exist', async () => {
    const fs = new InMemoryFileSystem();
    await expect(assertTargetIsUsable(fs, '/work/my-app')).resolves.toBeUndefined();
  });

  it('accepts an empty directory the user created themselves', async () => {
    const fs = new InMemoryFileSystem();
    await fs.ensureDir('/work/my-app');
    await expect(assertTargetIsUsable(fs, '/work/my-app')).resolves.toBeUndefined();
  });

  it('ignores .git and .DS_Store when deciding whether a directory is occupied', async () => {
    const fs = new InMemoryFileSystem();
    await fs.ensureDir('/work/my-app/.git');
    fs.setFile('/work/my-app/.DS_Store', 'noise');

    await expect(assertTargetIsUsable(fs, '/work/my-app')).resolves.toBeUndefined();
  });

  it('rejects a target that exists as a file', async () => {
    const fs = new InMemoryFileSystem();
    fs.setFile('/work/my-app', 'not a directory');

    await expect(assertTargetIsUsable(fs, '/work/my-app')).rejects.toMatchObject({
      code: ErrorCode.TargetNotADirectory,
      exitCode: ExitCode.PreconditionFailed,
    });
  });

  it('summarises the remainder when a target holds more entries than it lists', async () => {
    const fs = new InMemoryFileSystem();
    for (let index = 0; index < 8; index += 1) {
      fs.setFile(`/work/my-app/file-${String(index)}.txt`, 'x');
    }

    await expect(assertTargetIsUsable(fs, '/work/my-app')).rejects.toMatchObject({
      code: ErrorCode.TargetNotEmpty,
      details: expect.arrayContaining(['and 3 more']),
    });
  });
});

describe('describeWriteFailure', () => {
  const cases: readonly (readonly [string, ErrorCode])[] = [
    ['EACCES', ErrorCode.DirectoryNotWritable],
    ['EPERM', ErrorCode.DirectoryNotWritable],
    ['ENOSPC', ErrorCode.DiskFull],
    ['EROFS', ErrorCode.ReadOnlyFilesystem],
    ['ENAMETOOLONG', ErrorCode.PathTooLong],
  ];

  for (const [errno, code] of cases) {
    it(`turns ${errno} into a distinct, actionable error`, () => {
      const cause = Object.assign(new Error(`${errno}: it failed`), { code: errno });
      const wrapped = new Error('Generation failed part-way through.', { cause });

      const described = describeWriteFailure(wrapped, '/work/my-app');

      expect(AtlasError.isAtlasError(described)).toBe(true);
      expect((described as AtlasError).code).toBe(code);
      expect((described as AtlasError).exitCode).toBe(ExitCode.PreconditionFailed);
      expect((described as AtlasError).hint).toBeTruthy();
      // The chain is preserved so `--verbose` can still reach the frame that threw.
      expect((described as AtlasError).cause).toBe(wrapped);
      expect((described as AtlasError).details).toContain(errno);
    });
  }

  it('leaves an error it does not recognise exactly as it found it', () => {
    const error = new Error('something else entirely');
    expect(describeWriteFailure(error, '/work/my-app')).toBe(error);
  });
});

describe('ScaffoldGuard', () => {
  function guardFor(removed: string[], exits: number[], rootExisted = false): ScaffoldGuard {
    const fs = new InMemoryFileSystem();
    return new ScaffoldGuard({
      fs,
      reporter: new Reporter({
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
        color: false,
      }),
      root: '/work/my-app',
      rootExisted,
      removeSync: (path) => removed.push(path),
      exit: (code) => exits.push(code),
    });
  }

  it('removes the tree and exits 130 when interrupted', () => {
    const removed: string[] = [];
    const exits: number[] = [];

    guardFor(removed, exits).handleInterrupt('SIGINT');

    expect(removed).toEqual(['/work/my-app']);
    expect(exits).toEqual([ExitCode.Interrupted]);
  });

  it('adds and removes its own signal listeners rather than leaking them', () => {
    const before = process.listenerCount('SIGINT');
    const guard = guardFor([], []);

    guard.arm();
    expect(process.listenerCount('SIGINT')).toBe(before + 1);

    guard.disarm();
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('empties, rather than removes, a directory the user already had', async () => {
    const fs = new InMemoryFileSystem();
    fs.setFile('/work/my-app/server/package.json', '{}');

    const guard = new ScaffoldGuard({
      fs,
      reporter: new Reporter({
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
        color: false,
      }),
      root: '/work/my-app',
      rootExisted: true,
    });

    await guard.cleanUp();

    expect(await fs.exists('/work/my-app')).toBe(true);
    expect(Object.keys(fs.snapshot())).toEqual([]);
  });

  it('reports the path to delete by hand when cleanup itself fails', async () => {
    const stderr = new MemoryStream();
    const fs = new InMemoryFileSystem();
    fs.remove = () => Promise.reject(new Error('EBUSY: device or resource busy'));

    const guard = new ScaffoldGuard({
      fs,
      reporter: new Reporter({ stdout: new MemoryStream(), stderr, color: false }),
      root: '/work/my-app',
      rootExisted: false,
    });

    await guard.cleanUp();

    expect(stderr.text).toContain('could not remove');
    expect(stderr.text).toContain('/work/my-app');
  });
});

describe('runStart install failures', () => {
  it('keeps the project, reports the manual command, and exits non-zero', async () => {
    const harness = createHarness({}, new FailingProcesses());
    // A dependency is what makes the installer reach for a package manager at all.
    seedTemplate(
      harness.fs,
      'server-base-js',
      {
        'package.json': `{ "name": "__PROJECT_NAME__" }\n`,
        'src/main.js': `export const name = '__PROJECT_NAME__';\n`,
      },
      { express: '^5.0.0' },
    );

    await runStart({
      context: harness.context,
      name: PROJECT_NAME,
      language: 'js',
      skipInstall: false,
      skipGit: true,
      templatesRoot: TEMPLATES_ROOT,
    });

    // The scaffold survives a failed install: it is complete, and only node_modules is missing.
    expect(await harness.fs.exists(`${WORK_DIR}/${PROJECT_NAME}/server/package.json`)).toBe(true);
    expect(harness.exitCodes).toContain(ExitCode.Failure);
    expect(harness.stderr.text).toContain('has been kept');
    expect(harness.stderr.text).toContain(`cd ${PROJECT_NAME}/server && npm install`);
  });
});

describe('renderHalfManifest', () => {
  const manifest = JSON.parse(
    renderHalfManifest({
      projectName: 'my-app',
      half: 'server',
      description: 'Express API for my-app.',
      scripts: [
        { name: 'start', command: 'node src/server.js' },
        { name: 'dev', command: 'nodemon src/server.js' },
      ],
      dependencies: [
        { name: 'express', range: '^5.2.1', dev: false },
        { name: 'nodemon', range: '^3.1.10', dev: true },
      ],
    }),
  ) as Record<string, unknown>;

  it('names the package after the project and the half', () => {
    expect(manifest['name']).toBe('my-app-server');
  });

  it('is private and ESM, matching the synthetic context', () => {
    expect(manifest['private']).toBe(true);
    expect(manifest['type']).toBe('module');
  });

  it('splits production and development dependencies', () => {
    expect(manifest['dependencies']).toEqual({ express: '^5.2.1' });
    expect(manifest['devDependencies']).toEqual({ nodemon: '^3.1.10' });
  });

  it('carries the scripts the templates declared, sorted', () => {
    expect(Object.keys(manifest['scripts'] as object)).toEqual(['dev', 'start']);
  });

  it('omits an empty dependency section rather than writing an empty object', () => {
    const bare = JSON.parse(
      renderHalfManifest({
        projectName: 'my-app',
        half: 'client',
        description: 'React client.',
        scripts: [],
        dependencies: [],
      }),
    ) as Record<string, unknown>;

    expect(bare).not.toHaveProperty('dependencies');
    expect(bare).not.toHaveProperty('devDependencies');
  });
});

describe('runStart manifest generation', () => {
  it('writes a package.json for each half when no template ships one', async () => {
    const harness = createHarness();
    // Mirrors the real base templates, which declare scripts and dependencies in template.json
    // and leave the manifest to be assembled.
    for (const name of ['server-base-js', 'client-react-js']) {
      await harness.fs.remove(`${TEMPLATES_ROOT}/${name}`);
      seedTemplate(
        harness.fs,
        name,
        { 'src/main.js': `export const name = '__PROJECT_NAME__';\n` },
        { express: '^5.2.1' },
      );
    }

    await runStart({
      context: harness.context,
      name: PROJECT_NAME,
      language: 'js',
      skipInstall: true,
      skipGit: true,
      templatesRoot: TEMPLATES_ROOT,
    });

    const server = JSON.parse(
      await harness.fs.readText(`${WORK_DIR}/${PROJECT_NAME}/server/package.json`),
    ) as Record<string, unknown>;

    expect(server['name']).toBe(`${PROJECT_NAME}-server`);
    expect(server['dependencies']).toEqual({ express: '^5.2.1' });
    expect(await harness.fs.exists(`${WORK_DIR}/${PROJECT_NAME}/client/package.json`)).toBe(true);
  });

  it('leaves a template-supplied package.json alone', async () => {
    const harness = createHarness();
    await runStart({
      context: harness.context,
      name: PROJECT_NAME,
      language: 'js',
      skipInstall: true,
      skipGit: true,
      templatesRoot: TEMPLATES_ROOT,
    });

    // The fixture base templates ship their own manifest, so the generated one must not appear.
    const manifest = JSON.parse(
      await harness.fs.readText(`${WORK_DIR}/${PROJECT_NAME}/server/package.json`),
    ) as Record<string, unknown>;

    expect(manifest).toEqual({ name: PROJECT_NAME });
  });
});
