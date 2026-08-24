import { describe, expect, it } from 'vitest';

import { run } from '../../src/cli.js';
import { getPackageMeta } from '../../src/config/package-meta.js';
import { ExitCode } from '../../src/constants/exit-codes.js';
import { MemoryStream } from '../helpers/memory-stream.js';

interface Invocation {
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

async function invoke(args: readonly string[]): Promise<Invocation> {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();

  // `--no-color` keeps assertions free of ANSI escapes regardless of the host terminal.
  const exitCode = await run({ argv: ['--no-color', ...args], stdout, stderr });

  return { exitCode, stdout: stdout.text, stderr: stderr.text };
}

describe('run', () => {
  it('prints the package version and succeeds', async () => {
    const result = await invoke(['--version']);

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.stdout.trim()).toBe(getPackageMeta().version);
  });

  it('prints usage for --help and succeeds', async () => {
    const result = await invoke(['--help']);

    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.stdout).toContain('Usage: atlas');
    expect(result.stdout).toContain('doctor');
  });

  it('documents every global flag in the help output', async () => {
    const result = await invoke(['--help']);

    for (const flag of ['--cwd', '--yes', '--dry-run', '--verbose', '--no-color']) {
      expect(result.stdout).toContain(flag);
    }
  });

  it('reports an unknown command as invalid usage', async () => {
    const result = await invoke(['definitely-not-a-command']);

    expect(result.exitCode).toBe(ExitCode.InvalidUsage);
    expect(result.stderr).toContain('unknown command');
  });

  it('reports an unknown option as invalid usage', async () => {
    const result = await invoke(['--definitely-not-a-flag']);

    expect(result.exitCode).toBe(ExitCode.InvalidUsage);
  });

  it('writes diagnostics to stderr, never stdout', async () => {
    const result = await invoke(['definitely-not-a-command']);

    expect(result.stdout).toBe('');
  });

  it('accepts a global flag placed after the command name', async () => {
    const result = await invoke(['doctor', '--dry-run']);

    // Exit status depends on the host: a machine with no package manager legitimately
    // fails the preflight. Either outcome proves the flag parsed.
    expect([ExitCode.Success, ExitCode.PreconditionFailed]).toContain(result.exitCode);
  });
});
