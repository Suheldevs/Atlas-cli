/**
 * Process exit codes.
 *
 * These are part of Atlas's public contract: shell scripts and CI pipelines branch on
 * them, so a value must never be reassigned to a different meaning once released.
 * New failure categories get new numbers.
 */
export const ExitCode = {
  Success: 0,
  /** A genuine failure that is nobody's fault in particular — a child process died, an internal bug. */
  Failure: 1,
  /** The command line itself was wrong: unknown command, bad flag, missing argument. */
  InvalidUsage: 2,
  /** The environment or project is not in a state where the command can run. */
  PreconditionFailed: 3,
  /** Generation stopped because of an unresolved file conflict. */
  Conflict: 4,
  /** Terminated by SIGINT. 128 + 2, the shell convention. */
  Interrupted: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
