import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';

import { ExitCode } from '../../src/constants/exit-codes.js';
import { AtlasError, UsageError, UserAbortError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { presentError } from '../../src/errors/error-presenter.js';
import { Reporter } from '../../src/services/reporter.service.js';
import { MemoryStream } from '../helpers/memory-stream.js';

function harness(verbose = false): {
  reporter: Reporter;
  stdout: MemoryStream;
  stderr: MemoryStream;
  output: () => string;
} {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false, verbose });

  return { reporter, stdout, stderr, output: () => stdout.text + stderr.text };
}

describe('presentError', () => {
  it('takes the exit code from the catalog entry for the error code', () => {
    const { reporter } = harness();

    const exitCode = presentError(
      new AtlasError({ code: ErrorCode.NoPackageManager, message: 'No package manager found.' }),
      reporter,
      { verbose: false },
    );

    expect(exitCode).toBe(ExitCode.PreconditionFailed);
  });

  it('honours an explicit exit code override', () => {
    const { reporter } = harness();

    const exitCode = presentError(
      new AtlasError({
        code: ErrorCode.CommandFailed,
        message: 'Install failed.',
        exitCode: ExitCode.Conflict,
      }),
      reporter,
      { verbose: false },
    );

    expect(exitCode).toBe(ExitCode.Conflict);
  });

  it('prints the message, the hint, the details and a docs link', () => {
    const { reporter, output } = harness();

    presentError(
      new AtlasError({
        code: ErrorCode.DirectoryNotWritable,
        message: 'Cannot write to the project directory.',
        hint: 'Check the directory permissions.',
        details: ['/srv/app/src'],
      }),
      reporter,
      { verbose: false },
    );

    const text = output();
    expect(text).toContain('Cannot write to the project directory.');
    expect(text).toContain('Check the directory permissions.');
    expect(text).toContain('/srv/app/src');
    expect(text).toContain('troubleshooting.md#atlas_1004');
  });

  it('sends expected failures to stderr and keeps stdout clean', () => {
    const { reporter, stdout } = harness();

    presentError(new UsageError('Missing entity name.'), reporter, { verbose: false });

    expect(stdout.text).toBe('');
  });

  it('maps a usage error to exit code 2', () => {
    const { reporter } = harness();

    expect(presentError(new UsageError('Bad flag.'), reporter, { verbose: false })).toBe(
      ExitCode.InvalidUsage,
    );
  });

  it('treats a cancellation as an interruption, not a failure', () => {
    const { reporter, output } = harness();

    const exitCode = presentError(new UserAbortError(), reporter, { verbose: false });

    expect(exitCode).toBe(ExitCode.Interrupted);
    expect(output()).toContain('Cancelled.');
  });

  it('treats Commander help and version as success without printing anything', () => {
    const { reporter, output } = harness();

    const exitCode = presentError(
      new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)'),
      reporter,
      { verbose: false },
    );

    expect(exitCode).toBe(ExitCode.Success);
    expect(output()).toBe('');
  });

  it('re-codes a Commander usage failure to 2 without duplicating its message', () => {
    const { reporter, output } = harness();

    const exitCode = presentError(
      new CommanderError(1, 'commander.unknownOption', "error: unknown option '--nope'"),
      reporter,
      { verbose: false },
    );

    expect(exitCode).toBe(ExitCode.InvalidUsage);
    expect(output()).toBe('');
  });

  it('reports an unrecognised error as a bug and suggests --verbose', () => {
    const { reporter, output } = harness();

    const exitCode = presentError(new TypeError('x is not a function'), reporter, {
      verbose: false,
    });

    const text = output();
    expect(exitCode).toBe(ExitCode.Failure);
    expect(text).toContain('unexpected error');
    expect(text).toContain('x is not a function');
    expect(text).toContain('--verbose');
  });

  it('prints the stack and the cause chain when verbose', () => {
    const { reporter, output } = harness(true);

    const cause = new Error('socket hang up');
    presentError(new Error('request failed', { cause }), reporter, { verbose: true });

    const text = output();
    expect(text).toContain('caused by:');
    expect(text).toContain('socket hang up');
  });

  it('survives a thrown non-error value', () => {
    const { reporter, output } = harness();

    const exitCode = presentError('just a string', reporter, { verbose: false });

    expect(exitCode).toBe(ExitCode.Failure);
    expect(output()).toContain('just a string');
  });
});
