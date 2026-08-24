/**
 * The immutable description of everything a generator wants to change.
 *
 * Generators build one of these and never touch disk. The engine validates the whole plan,
 * resolves every conflict up front, then applies it in a single transaction. That split is
 * what makes `--dry-run` honest and a failed run recoverable.
 */

export interface FileOperation {
  /** Absolute destination path. */
  readonly path: string;
  readonly contents: string;
  /**
   * Whether to run the target project's formatter over the contents. False for files
   * prettier cannot parse or must not touch, such as `.env` and generated lockfiles.
   */
  readonly format: boolean;
  /** Short description used in progress output; falls back to the path. */
  readonly label: string | undefined;
}

export interface DependencyRequest {
  readonly name: string;
  /** Semver range as declared in the template manifest. Never invented in code. */
  readonly range: string;
  readonly dev: boolean;
}

export interface ScriptRequest {
  readonly name: string;
  readonly command: string;
}

/**
 * A request to add a line to a file Atlas did not author.
 *
 * Applied at `marker` when that comment is present. When it is absent the engine prints
 * `manualHint` instead of guessing where the snippet belongs — a wrong guess corrupts a
 * file the user owns.
 */
export interface InjectionRequest {
  readonly path: string;
  readonly marker: string;
  readonly snippet: string;
  readonly manualHint: string;
}

export interface EnvRequest {
  readonly key: string;
  readonly value: string;
  readonly comment: string | undefined;
  /** True for values the user must replace before deploying. */
  readonly secret: boolean;
}

export interface GenerationPlan {
  /** Name of the generator that produced this plan, for logs and error messages. */
  readonly generator: string;
  /** Project root every relative decision in this plan was made against. */
  readonly root: string;
  readonly files: readonly FileOperation[];
  readonly dependencies: readonly DependencyRequest[];
  readonly scripts: readonly ScriptRequest[];
  readonly injections: readonly InjectionRequest[];
  readonly env: readonly EnvRequest[];
  /** Lines printed after a successful run: next steps, manual wiring, warnings. */
  readonly notes: readonly string[];
}

/** What actually happened, so the engine can report it and tests can assert on it. */
export interface AppliedFile {
  readonly path: string;
  readonly outcome: 'created' | 'overwritten' | 'skipped' | 'backed-up';
  /** Absolute path of the backup, when one was taken. */
  readonly backupPath: string | undefined;
}

export interface GenerationResult {
  readonly generator: string;
  readonly dryRun: boolean;
  readonly files: readonly AppliedFile[];
  readonly installed: readonly DependencyRequest[];
  readonly injected: readonly InjectionRequest[];
  /** Injections whose marker was missing; the user must wire these by hand. */
  readonly manual: readonly InjectionRequest[];
  readonly notes: readonly string[];
}
