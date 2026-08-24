/**
 * Options that apply to every command, parsed once on the root program.
 *
 * Commands receive this resolved shape rather than reading Commander's raw option bag,
 * so a flag rename touches one file instead of every command.
 */
export interface GlobalOptions {
  /** Absolute path to the directory Atlas operates on. Always resolved, never relative. */
  readonly cwd: string;
  /** Accept every prompt's default answer instead of asking. */
  readonly yes: boolean;
  /** Compute and display all changes without writing anything. */
  readonly dryRun: boolean;
  /** Print diagnostic output and full stack traces. */
  readonly verbose: boolean;
  /** Emit ANSI colour. False when `--no-color` was passed or the environment forbids it. */
  readonly color: boolean;
}
