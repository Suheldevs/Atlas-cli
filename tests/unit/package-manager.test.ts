import { describe, expect, it } from 'vitest';

import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { createPackageManagerService } from '../../src/services/package-manager.service.js';
import type { ProcessRunner, RunOptions, RunResult } from '../../src/services/process.service.js';
import type { PackageManager } from '../../src/types/project-context.js';

interface RecordedCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: RunOptions;
}

interface FailureSpec {
  readonly stderr?: string;
  readonly stdout?: string;
  readonly exitCode?: number;
}

/**
 * Hand-written rather than a mocking framework: the whole contract under test is "which argv,
 * in which directory", and a recorder makes that assertion direct instead of indirect.
 */
class FakeProcessRunner implements ProcessRunner {
  readonly calls: RecordedCall[] = [];
  readonly probedFiles: string[] = [];

  #failure: FailureSpec | undefined;
  #version: string | undefined = '1.2.3';

  run(file: string, args: readonly string[] = [], options: RunOptions = {}): Promise<RunResult> {
    this.calls.push({ file, args: [...args], options });

    const command = [file, ...args].join(' ');
    const failure = this.#failure;

    if (failure === undefined) {
      return Promise.resolve({ command, exitCode: 0, stdout: '', stderr: '', failed: false });
    }

    return Promise.resolve({
      command,
      exitCode: failure.exitCode ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      failed: true,
    });
  }

  probeVersion(file: string): Promise<string | undefined> {
    this.probedFiles.push(file);
    return Promise.resolve(this.#version);
  }

  /** Mirrors `ProcessService`: a non-zero exit resolves with `failed`, it does not reject. */
  failWith(failure: FailureSpec): void {
    this.#failure = failure;
  }

  reportMissingExecutable(): void {
    this.#version = undefined;
  }
}

const CWD = '/workspace/monorepo';

function onlyCall(runner: FakeProcessRunner): RecordedCall {
  expect(runner.calls).toHaveLength(1);

  const call = runner.calls[0];
  if (call === undefined) throw new Error('expected exactly one command to have been run');

  return call;
}

async function captureAtlasError(promise: Promise<unknown>): Promise<AtlasError> {
  try {
    await promise;
  } catch (error) {
    if (AtlasError.isAtlasError(error)) return error;
    throw error;
  }

  throw new Error('expected the install to reject');
}

interface ArgvCase {
  readonly manager: PackageManager;
  readonly prod: readonly string[];
  readonly dev: readonly string[];
}

const ARGV_CASES: readonly ArgvCase[] = [
  {
    manager: 'npm',
    prod: ['install', '--no-audit', '--no-fund', 'zod@^3.0.0'],
    dev: ['install', '--save-dev', '--no-audit', '--no-fund', 'zod@^3.0.0'],
  },
  {
    manager: 'pnpm',
    prod: ['add', 'zod@^3.0.0'],
    dev: ['add', '--save-dev', 'zod@^3.0.0'],
  },
  {
    manager: 'yarn',
    prod: ['add', 'zod@^3.0.0'],
    dev: ['add', '--dev', 'zod@^3.0.0'],
  },
  {
    manager: 'bun',
    prod: ['add', 'zod@^3.0.0'],
    dev: ['add', '--dev', 'zod@^3.0.0'],
  },
];

describe('package manager argv', () => {
  for (const { manager, prod, dev } of ARGV_CASES) {
    it(`builds the production install for ${manager}`, async () => {
      const runner = new FakeProcessRunner();

      await createPackageManagerService(manager, runner).install({
        packages: ['zod@^3.0.0'],
        dev: false,
        cwd: CWD,
      });

      const call = onlyCall(runner);
      expect(call.file).toBe(manager);
      expect(call.args).toEqual(prod);
    });

    it(`builds the development install for ${manager}`, async () => {
      const runner = new FakeProcessRunner();

      await createPackageManagerService(manager, runner).install({
        packages: ['zod@^3.0.0'],
        dev: true,
        cwd: CWD,
      });

      const call = onlyCall(runner);
      expect(call.file).toBe(manager);
      expect(call.args).toEqual(dev);
    });
  }

  it('passes every specifier through in the order given', async () => {
    const runner = new FakeProcessRunner();

    await createPackageManagerService('pnpm', runner).install({
      packages: ['express@^5.0.0', 'zod@^3.0.0', '@types/node@^26.0.0'],
      dev: false,
      cwd: CWD,
    });

    expect(onlyCall(runner).args).toEqual([
      'add',
      'express@^5.0.0',
      'zod@^3.0.0',
      '@types/node@^26.0.0',
    ]);
  });
});

describe('package manager install execution', () => {
  it('runs in the requested directory', async () => {
    const runner = new FakeProcessRunner();

    await createPackageManagerService('npm', runner).install({
      packages: ['zod@^3.0.0'],
      dev: false,
      cwd: CWD,
    });

    expect(onlyCall(runner).options.cwd).toBe(CWD);
  });

  it('allows a slow install rather than timing out at the default budget', async () => {
    const runner = new FakeProcessRunner();

    await createPackageManagerService('npm', runner).install({
      packages: ['zod@^3.0.0'],
      dev: false,
      cwd: CWD,
    });

    expect(onlyCall(runner).options.timeoutMs).toBe(600_000);
  });

  it('runs nothing at all for an empty package list', async () => {
    // `npm install` with no names reinstalls the whole tree from the lockfile, which is not what
    // "nothing to install" means.
    const runner = new FakeProcessRunner();

    await createPackageManagerService('npm', runner).install({
      packages: [],
      dev: false,
      cwd: CWD,
    });

    expect(runner.calls).toEqual([]);
  });
});

describe('package manager install failure', () => {
  it('throws ATLAS_5001 carrying the command and the child stderr', async () => {
    const runner = new FakeProcessRunner();
    runner.failWith({
      exitCode: 1,
      stderr: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/zzod',
    });

    const error = await captureAtlasError(
      createPackageManagerService('npm', runner).install({
        packages: ['zzod@^3.0.0'],
        dev: false,
        cwd: CWD,
      }),
    );

    expect(error.code).toBe(ErrorCode.DependencyInstallFailed);
    expect(error.code).toBe('ATLAS_5001');
    expect(error.message).toContain('npm install --no-audit --no-fund zzod@^3.0.0');
    expect(error.details).toEqual([
      'npm error code E404',
      'npm error 404 Not Found - GET https://registry.npmjs.org/zzod',
    ]);
  });

  it('reports the exit code and points at the directory to retry in', async () => {
    const runner = new FakeProcessRunner();
    runner.failWith({ exitCode: 254, stderr: 'ERR_PNPM_FETCH_401' });

    const error = await captureAtlasError(
      createPackageManagerService('pnpm', runner).install({
        packages: ['@acme/private@^1.0.0'],
        dev: true,
        cwd: CWD,
      }),
    );

    expect(error.message).toContain('254');
    expect(error.hint).toContain(CWD);
  });

  it('falls back to stdout when the manager reported nothing on stderr', async () => {
    const runner = new FakeProcessRunner();
    runner.failWith({ stdout: 'error: lockfile is out of date', stderr: '   ' });

    const error = await captureAtlasError(
      createPackageManagerService('bun', runner).install({
        packages: ['zod@^3.0.0'],
        dev: false,
        cwd: CWD,
      }),
    );

    expect(error.details).toEqual(['error: lockfile is out of date']);
  });
});

describe('package manager availability', () => {
  it('reports available when the version probe answers', async () => {
    const runner = new FakeProcessRunner();

    expect(await createPackageManagerService('yarn', runner).isAvailable()).toBe(true);
    expect(runner.probedFiles).toEqual(['yarn']);
  });

  it('reports unavailable when the version probe finds nothing', async () => {
    const runner = new FakeProcessRunner();
    runner.reportMissingExecutable();

    expect(await createPackageManagerService('bun', runner).isAvailable()).toBe(false);
  });

  it('probes the manager it was created for', async () => {
    const runner = new FakeProcessRunner();

    await createPackageManagerService('pnpm', runner).isAvailable();

    expect(runner.probedFiles).toEqual(['pnpm']);
  });
});

describe('package manager script command', () => {
  const expected: Readonly<Record<PackageManager, string>> = {
    npm: 'npm run',
    pnpm: 'pnpm',
    yarn: 'yarn',
    bun: 'bun run',
  };

  for (const { manager } of ARGV_CASES) {
    it(`describes how to run a script with ${manager}`, () => {
      const service = createPackageManagerService(manager, new FakeProcessRunner());

      expect(service.addScriptCommand()).toBe(expected[manager]);
      expect(service.name).toBe(manager);
    });
  }
});
