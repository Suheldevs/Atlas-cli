import { describe, expect, it, vi } from 'vitest';

import { ProcessService } from '../../src/services/process.service.js';

/** A binary name chosen to be absent from every PATH. */
const MISSING_BINARY = 'atlas-definitely-not-installed-xyz';

/** Runs a snippet in a child Node process — always available, no fixtures needed. */
function evaluate(source: string): ReturnType<ProcessService['run']> {
  return new ProcessService().run(process.execPath, ['-e', source]);
}

describe('ProcessService.run', () => {
  it('captures stdout from a command that succeeds', async () => {
    const result = await evaluate('process.stdout.write("hello")');

    expect(result.failed).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
  });

  it('captures stderr separately from stdout', async () => {
    const result = await evaluate('process.stderr.write("warning")');

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('warning');
  });

  it('resolves rather than rejects on a non-zero exit status', async () => {
    const result = await evaluate('process.exit(3)');

    expect(result.failed).toBe(true);
    expect(result.exitCode).toBe(3);
  });

  it('reports a missing executable as a failure instead of throwing', async () => {
    const result = await new ProcessService().run(MISSING_BINARY);

    // Only `failed` is asserted, and deliberately so: on Windows the command goes through a
    // shell, so a missing binary arrives as exit status 1 with no ENOENT to be found. Use
    // `probeVersion` when the question is "is this installed?".
    expect(result.failed).toBe(true);
  });

  it('reports the command verbatim so it can be retyped', async () => {
    const result = await new ProcessService().run('git', ['status', '--short']);

    expect(result.command).toBe('git status --short');
  });

  it('honours a timeout instead of hanging', async () => {
    const result = await new ProcessService({ defaultTimeoutMs: 200 }).run(process.execPath, [
      '-e',
      'setTimeout(() => {}, 10_000)',
    ]);

    expect(result.failed).toBe(true);
  });

  it('runs the child in the requested directory', async () => {
    const result = await new ProcessService().run(
      process.execPath,
      ['-e', 'process.stdout.write(process.cwd())'],
      { cwd: process.cwd() },
    );

    expect(result.stdout).toBe(process.cwd());
  });
});

describe('ProcessService environment sanitisation', () => {
  it('withholds npm_package_* from the child', async () => {
    // Set when Atlas is launched via `npm run`; these describe Atlas's own manifest, and a
    // child package manager reading them would misidentify the project it is working on.
    vi.stubEnv('npm_package_name', 'leaked');

    const result = await evaluate('process.stdout.write(process.env.npm_package_name ?? "absent")');

    expect(result.stdout).toBe('absent');
  });

  it('withholds npm_lifecycle_* from the child', async () => {
    vi.stubEnv('npm_lifecycle_event', 'leaked');

    const result = await evaluate(
      'process.stdout.write(process.env.npm_lifecycle_event ?? "absent")',
    );

    expect(result.stdout).toBe('absent');
  });

  it('matches the leaked prefixes case-insensitively', async () => {
    // Windows enumerates environment names upper-cased, so a case-sensitive prefix test
    // silently passes everything through. This asserts the platform-independent behaviour.
    vi.stubEnv('NPM_PACKAGE_VERSION', 'leaked');

    const result = await evaluate(
      'process.stdout.write(process.env.npm_package_version ?? "absent")',
    );

    expect(result.stdout).toBe('absent');
  });

  it('passes npm_config_* through, because the child needs the registry settings', async () => {
    vi.stubEnv('npm_config_registry', 'https://registry.example.test/');

    const result = await evaluate(
      'process.stdout.write(process.env.npm_config_registry ?? "absent")',
    );

    expect(result.stdout).toBe('https://registry.example.test/');
  });

  it('applies explicit overrides on top of the inherited environment', async () => {
    const result = await new ProcessService().run(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.ATLAS_TEST_TOKEN ?? "absent")'],
      { env: { ATLAS_TEST_TOKEN: 'provided' } },
    );

    expect(result.stdout).toBe('provided');
  });
});

describe('ProcessService.probeVersion', () => {
  it('returns the first line of version output', async () => {
    const version = await new ProcessService().probeVersion(process.execPath);

    expect(version).toBe(process.version);
  });

  it('returns undefined for a missing executable', async () => {
    expect(await new ProcessService().probeVersion(MISSING_BINARY)).toBeUndefined();
  });

  it('returns undefined when the probed path is not executable', async () => {
    // A directory can be spawned neither on Windows nor on POSIX, so this exercises the
    // failure branch without depending on a tool that rejects `--version`.
    expect(await new ProcessService().probeVersion(process.cwd())).toBeUndefined();
  });
});
