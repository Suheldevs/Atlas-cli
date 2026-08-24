import { CommanderError } from 'commander';

import { ISSUES_URL } from '../constants/branding.js';
import { ExitCode } from '../constants/exit-codes.js';
import type { Reporter } from '../services/reporter.service.js';

import { AtlasError, UserAbortError } from './atlas-error.js';

/**
 * Commander throws for `--help` and `--version` too, because `exitOverride()` turns its
 * `process.exit` calls into exceptions. Those are successful outcomes, not failures.
 */
const COMMANDER_SUCCESS_CODES: ReadonlySet<string> = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

export interface PresentErrorOptions {
  readonly verbose: boolean;
}

/**
 * The single place an exception becomes user-visible output and an exit status.
 *
 * Returns rather than exits, so the caller stays in control of process lifetime and
 * tests can assert on the code without spawning a process.
 */
export function presentError(
  error: unknown,
  reporter: Reporter,
  options: PresentErrorOptions,
): ExitCode {
  if (error instanceof CommanderError) {
    return presentCommanderError(error);
  }

  if (error instanceof UserAbortError) {
    reporter.warn(error.message);
    return error.exitCode;
  }

  if (AtlasError.isAtlasError(error)) {
    return presentAtlasError(error, reporter, options);
  }

  return presentUnexpectedError(error, reporter, options);
}

function presentCommanderError(error: CommanderError): ExitCode {
  if (COMMANDER_SUCCESS_CODES.has(error.code)) {
    return ExitCode.Success;
  }

  // Commander already wrote the message through `configureOutput`, so printing here
  // would duplicate it. Only the exit code needs correcting: Commander defaults to 1,
  // and Atlas reserves 2 for "you typed something wrong".
  return ExitCode.InvalidUsage;
}

function presentAtlasError(
  error: AtlasError,
  reporter: Reporter,
  options: PresentErrorOptions,
): ExitCode {
  reporter.error(error.message);

  if (error.hint !== undefined) {
    reporter.errorDetail(`hint: ${error.hint}`);
  }

  if (error.details.length > 0) {
    reporter.errorList(error.details);
  }

  reporter.errorDetail(`docs: ${error.docsUrl}`);

  if (options.verbose) {
    reportStackChain(error, reporter);
  }

  return error.exitCode;
}

function presentUnexpectedError(
  error: unknown,
  reporter: Reporter,
  options: PresentErrorOptions,
): ExitCode {
  const normalized = error instanceof Error ? error : new Error(String(error));

  reporter.error('Atlas stopped because of an unexpected error.');
  reporter.errorDetail(normalized.message);

  if (options.verbose) {
    reportStackChain(normalized, reporter);
  } else {
    reporter.errorDetail('Re-run with --verbose for the full stack trace.');
  }

  reporter.errorDetail(`This is a bug in Atlas. Please report it: ${ISSUES_URL}`);

  return ExitCode.Failure;
}

/** Walks `cause` so a wrapped failure does not hide the frame that actually threw. */
function reportStackChain(error: Error, reporter: Reporter): void {
  reporter.debug(error.stack ?? `${error.name}: ${error.message}`);

  const { cause } = error;
  if (cause instanceof Error) {
    reporter.debug('caused by:');
    reportStackChain(cause, reporter);
  }
}
