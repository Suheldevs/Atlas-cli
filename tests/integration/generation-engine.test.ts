import { beforeEach, describe, expect, it } from 'vitest';

import { GenerationEngine } from '../../src/engine/generation-engine.js';
import { DependencyInstaller } from '../../src/engine/deps/index.js';
import { Formatter } from '../../src/engine/format/index.js';
import { PlanBuilder } from '../../src/engine/plan-builder.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import type { ConflictAsk } from '../../src/engine/conflict/index.js';
import type {
  InstallRequest,
  PackageManagerService,
} from '../../src/services/package-manager.service.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { GenerationPlan } from '../../src/types/generation-plan.js';
import type { PackageManifest, ProjectContext } from '../../src/types/project-context.js';
import { FixedClock, InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

/**
 * `PlanBuilder` resolves paths with `node:path`, so the root has to be valid for the host
 * platform. `InMemoryFileSystem` normalises separators to `/`, which keeps every assertion
 * below identical on Windows and POSIX.
 */
const ROOT = process.platform === 'win32' ? 'C:\\project' : '/project';

class FakePackageManager implements PackageManagerService {
  readonly name = 'npm' as const;
  readonly requests: InstallRequest[] = [];
  available = true;
  failNext = false;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async install(request: InstallRequest): Promise<void> {
    this.requests.push(request);
    if (this.failNext) {
      throw new AtlasError({
        code: ErrorCode.DependencyInstallFailed,
        message: 'install exploded',
      });
    }
  }

  addScriptCommand(): string {
    return 'npm run';
  }
}

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    path: `${ROOT}/package.json`,
    name: 'demo',
    version: '1.0.0',
    type: 'module',
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    scripts: { test: 'vitest run' },
    raw: {},
    ...overrides,
  };
}

function project(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    root: ROOT,
    manifest: manifest(),
    framework: 'express',
    language: 'typescript',
    moduleSystem: 'esm',
    packageManager: 'npm',
    database: 'none',
    typescript: { present: true, configPath: `${ROOT}/tsconfig.json`, strict: true },
    layout: { sourceDir: 'src', flat: false },
    workspace: { isMonorepo: false, installRoot: ROOT, workspaceRoot: undefined },
    importSuffix: '.js',
    ...overrides,
  };
}

interface Harness {
  readonly fs: InMemoryFileSystem;
  readonly engine: GenerationEngine;
  readonly packageManager: FakePackageManager;
  readonly output: () => string;
  readonly asked: string[];
}

function harness(
  files: Record<string, string> = {},
  ask: ConflictAsk = async () => 'overwrite',
): Harness {
  const fs = new InMemoryFileSystem({
    [`${ROOT}/package.json`]: `{\n  "name": "demo",\n  "scripts": {\n    "test": "vitest run"\n  }\n}\n`,
    ...files,
  });

  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false, verbose: false });
  const packageManager = new FakePackageManager();
  const asked: string[] = [];

  const engine = new GenerationEngine({
    fs,
    clock: new FixedClock(),
    reporter,
    // Supplying options directly keeps prettier from walking the filesystem for a config.
    formatter: new Formatter({ reporter, resolveOptions: async () => ({ semi: true }) }),
    installer: new DependencyInstaller({ packageManager, reporter }),
    ask: async (conflict) => {
      asked.push(conflict.path);
      return ask(conflict);
    },
  });

  return { fs, engine, packageManager, output: () => stdout.text + stderr.text, asked };
}

function plan(build: (builder: PlanBuilder) => void): GenerationPlan {
  const builder = new PlanBuilder({ generator: 'demo', root: ROOT });
  build(builder);
  return builder.build();
}

describe('GenerationEngine', () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
  });

  it('writes a new file and reports it as created', async () => {
    const result = await subject.engine.apply({
      plan: plan((builder) => builder.addFile('src/logger.ts', 'export const x=1')),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect(result.files[0]?.outcome).toBe('created');
    expect(await subject.fs.readTextIfExists(`${ROOT}/src/logger.ts`)).toContain('export const x');
  });

  it('formats generated code before writing it', async () => {
    await subject.engine.apply({
      plan: plan((builder) => builder.addFile('src/a.ts', 'const   a=1')),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    // Prettier normalises the spacing and adds the semicolon the source lacked.
    expect(await subject.fs.readTextIfExists(`${ROOT}/src/a.ts`)).toBe('const a = 1;\n');
  });

  it('writes nothing at all during a dry run', async () => {
    const before = subject.fs.snapshot();

    const result = await subject.engine.apply({
      plan: plan((builder) => builder.addFile('src/a.ts', 'const a = 1;')),
      project: project(),
      dryRun: true,
      assumeYes: false,
    });

    expect(result.dryRun).toBe(true);
    expect(subject.fs.snapshot()).toEqual(before);
  });

  it('does not ask about a file whose content already matches', async () => {
    const existing = harness({ [`${ROOT}/src/a.ts`]: 'const a = 1;\n' });

    const result = await existing.engine.apply({
      plan: plan((builder) => builder.addFile('src/a.ts', 'const a = 1;')),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect(existing.asked).toEqual([]);
    expect(result.files[0]?.outcome).toBe('skipped');
  });

  it('asks before replacing a file that differs, and honours skip', async () => {
    const existing = harness({ [`${ROOT}/src/a.ts`]: 'const mine = true;\n' }, async () => 'skip');

    const result = await existing.engine.apply({
      plan: plan((builder) => builder.addFile('src/a.ts', 'const theirs = 1;')),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect(existing.asked).toHaveLength(1);
    expect(result.files[0]?.outcome).toBe('skipped');
    expect(await existing.fs.readTextIfExists(`${ROOT}/src/a.ts`)).toBe('const mine = true;\n');
  });

  it('backs up rather than overwrites under --yes', async () => {
    const existing = harness({ [`${ROOT}/src/a.ts`]: 'const mine = true;\n' });

    const result = await existing.engine.apply({
      plan: plan((builder) => builder.addFile('src/a.ts', 'const theirs = 1;')),
      project: project(),
      dryRun: false,
      assumeYes: true,
    });

    expect(existing.asked).toEqual([]);
    expect(result.files[0]?.outcome).toBe('backed-up');

    const backupPath = result.files[0]?.backupPath;
    expect(backupPath).toBeDefined();
    expect(await existing.fs.readTextIfExists(backupPath ?? '')).toBe('const mine = true;\n');
    expect(await existing.fs.readTextIfExists(`${ROOT}/src/a.ts`)).toContain('theirs');
  });

  it('aborting a conflict leaves the project untouched', async () => {
    const existing = harness({ [`${ROOT}/src/a.ts`]: 'const mine = true;\n' }, async () => 'abort');
    const before = existing.fs.snapshot();

    await expect(
      existing.engine.apply({
        plan: plan((builder) => {
          builder.addFile('src/a.ts', 'const theirs = 1;');
          builder.addFile('src/b.ts', 'const b = 2;');
        }),
        project: project(),
        dryRun: false,
        assumeYes: false,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.ConflictUnresolved });

    expect(existing.fs.snapshot()).toEqual(before);
  });

  it('rolls back completely when a write fails part-way through', async () => {
    const before = subject.fs.snapshot();
    subject.fs.failWrites.add(`${ROOT}/src/b.ts`);

    await expect(
      subject.engine.apply({
        plan: plan((builder) => {
          builder.addFile('src/a.ts', 'const a = 1;');
          builder.addFile('src/b.ts', 'const b = 2;');
          builder.addFile('src/c.ts', 'const c = 3;');
        }),
        project: project(),
        dryRun: false,
        assumeYes: false,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.GenerationFailed });

    // The whole point of the journal: a failed run is indistinguishable from no run.
    expect(subject.fs.snapshot()).toEqual(before);
  });

  it('adds scripts to package.json without disturbing existing ones', async () => {
    await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addScript('dev', 'tsx watch src/index.ts');
      }),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    const written = (await subject.fs.readTextIfExists(`${ROOT}/package.json`)) ?? '';
    expect(written).toContain('"dev"');
    expect(written).toContain('"test": "vitest run"');
  });

  it('refuses to replace a script the project already defines', async () => {
    await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addScript('test', 'jest');
      }),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect((await subject.fs.readTextIfExists(`${ROOT}/package.json`)) ?? '').toContain(
      '"test": "vitest run"',
    );
  });

  it('writes .env.example but does not create a .env that was not there', async () => {
    await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addEnv('JWT_SECRET', 'replace-me', { secret: true });
      }),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect(await subject.fs.readTextIfExists(`${ROOT}/.env.example`)).toContain('JWT_SECRET');
    expect(await subject.fs.readTextIfExists(`${ROOT}/.env`)).toBeUndefined();
  });

  it('updates an existing .env as well', async () => {
    const existing = harness({ [`${ROOT}/.env`]: 'PORT=3000\n' });

    await existing.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addEnv('REDIS_URL', 'redis://localhost:6379');
      }),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    const written = (await existing.fs.readTextIfExists(`${ROOT}/.env`)) ?? '';
    expect(written).toContain('PORT=3000');
    expect(written).toContain('REDIS_URL');
  });

  it('injects at an anchor in a file the same run created', async () => {
    const result = await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/app.ts', 'const app = 1;\n// atlas:routes\nexport default app;\n');
        builder.addInjection({
          path: 'src/app.ts',
          marker: '// atlas:routes',
          snippet: "app.use('/auth', authRouter);",
          manualHint: 'Mount authRouter yourself.',
        });
      }),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect(result.injected).toHaveLength(1);
    expect(result.manual).toHaveLength(0);
    expect((await subject.fs.readTextIfExists(`${ROOT}/src/app.ts`)) ?? '').toContain('authRouter');
  });

  it('reports work as manual when the anchor is absent, changing nothing', async () => {
    const existing = harness({ [`${ROOT}/src/app.ts`]: 'const app = 1;\n' });

    const result = await existing.engine.apply({
      plan: plan((builder) =>
        builder.addInjection({
          path: 'src/app.ts',
          marker: '// atlas:routes',
          snippet: "app.use('/auth', authRouter);",
          manualHint: 'Mount authRouter yourself.',
        }),
      ),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect(result.manual).toHaveLength(1);
    expect(await existing.fs.readTextIfExists(`${ROOT}/src/app.ts`)).toBe('const app = 1;\n');
  });

  it('installs only the dependencies the project is missing', async () => {
    const withDependency = harness();

    await withDependency.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addDependency('jsonwebtoken', '^9.0.0');
        builder.addDependency('bcrypt', '^5.1.0');
      }),
      project: project({ manifest: manifest({ dependencies: { bcrypt: '^5.1.1' } }) }),
      dryRun: false,
      assumeYes: false,
    });

    const specifiers = withDependency.packageManager.requests.flatMap(
      (request) => request.packages,
    );
    expect(specifiers).toEqual(['jsonwebtoken@^9.0.0']);
  });

  it('installs from the workspace root in a monorepo', async () => {
    await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addDependency('zod', '^3.23.0');
      }),
      project: project({
        workspace: { isMonorepo: true, installRoot: '/workspace', workspaceRoot: '/workspace' },
      }),
      dryRun: false,
      assumeYes: false,
    });

    expect(subject.packageManager.requests[0]?.cwd).toBe('/workspace');
  });

  it('does not install during a dry run', async () => {
    await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addDependency('zod', '^3.23.0');
      }),
      project: project(),
      dryRun: true,
      assumeYes: false,
    });

    expect(subject.packageManager.requests).toEqual([]);
  });

  it('warns about a version conflict instead of upgrading behind the user', async () => {
    await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addDependency('zod', '^3.23.0');
      }),
      project: project({ manifest: manifest({ dependencies: { zod: '^2.0.0' } }) }),
      dryRun: false,
      assumeYes: false,
    });

    expect(subject.output()).toContain('zod');
    expect(subject.packageManager.requests).toEqual([]);
  });

  it('rejects a plan that would write outside the project', async () => {
    await expect(
      subject.engine.apply({
        plan: plan((builder) => builder.addFile('../escape.ts', 'const a = 1;')),
        project: project(),
        dryRun: false,
        assumeYes: false,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PlanInvalid });
  });

  it('carries the plan notes through to the result', async () => {
    const result = await subject.engine.apply({
      plan: plan((builder) => {
        builder.addFile('src/a.ts', 'const a = 1;');
        builder.addNote('Set JWT_SECRET before deploying.');
      }),
      project: project(),
      dryRun: false,
      assumeYes: false,
    });

    expect(result.notes).toEqual(['Set JWT_SECRET before deploying.']);
  });
});
