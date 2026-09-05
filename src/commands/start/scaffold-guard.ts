import { rmSync } from 'node:fs';

import { ExitCode } from '../../constants/exit-codes.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { FileSystemService } from '../../services/filesystem.service.js';
import type { Reporter } from '../../services/reporter.service.js';

/** Signals that mean "stop now" and must not leave a half-written project behind. */
const INTERRUPTS = ['SIGINT', 'SIGTERM'] as const;

export interface ScaffoldGuardOptions {
  readonly fs: FileSystemService;
  readonly reporter: Reporter;
  /** Absolute project root. Removed wholesale if the run does not finish. */
  readonly root: string;
  /**
   * True when the directory was already there before Atlas ran. An empty directory the user
   * created themselves is theirs to keep, so cleanup empties it rather than removing it.
   */
  readonly rootExisted: boolean;
  /** Synchronous removal, used only from a signal handler. Overridable for tests. */
  readonly removeSync?: ((path: string) => void) | undefined;
  /** Overridable for tests, which must not terminate the runner. */
  readonly exit?: ((code: number) => void) | undefined;
}

/**
 * Makes a failed `start` leave nothing behind.
 *
 * The engine's rollback journal already restores individual files, but it is scoped to one
 * `apply` and it does not remove the directories a write created on its way down. `start` needs
 * a stronger guarantee than that, for two reasons: it writes two halves through two separate
 * applies, so a failure in the second would otherwise strand the first; and its target did not
 * exist at all beforehand, which makes complete cleanup both possible and obviously correct —
 * there is no user state inside it to preserve.
 *
 * So the guarantee here is coarser and stronger than the journal's: if the run does not finish,
 * the directory Atlas created goes away entirely. If it cannot, the user is told exactly which
 * path to delete, because a half-written project nobody mentioned is the worst outcome
 * available.
 */
export class ScaffoldGuard {
  readonly #fs: FileSystemService;
  readonly #reporter: Reporter;
  readonly #root: string;
  readonly #rootExisted: boolean;
  readonly #removeSync: (path: string) => void;
  readonly #exit: (code: number) => void;
  readonly #onInterrupt: (signal: NodeJS.Signals) => void;

  #armed = false;

  constructor(options: ScaffoldGuardOptions) {
    this.#fs = options.fs;
    this.#reporter = options.reporter;
    this.#root = options.root;
    this.#rootExisted = options.rootExisted;
    this.#removeSync =
      options.removeSync ?? ((path) => rmSync(path, { recursive: true, force: true }));
    this.#exit = options.exit ?? ((code) => process.exit(code));
    this.#onInterrupt = (signal) => {
      this.handleInterrupt(signal);
    };
  }

  /**
   * Starts guarding, from the first write until `disarm`.
   *
   * `prependOnceListener` rather than `on`: `cli.ts` installs a SIGINT handler that exits
   * immediately, and an exiting handler that runs first would leave the tree on disk. Prepending
   * puts cleanup ahead of it.
   */
  arm(): void {
    if (this.#armed) return;

    this.#armed = true;
    for (const signal of INTERRUPTS) {
      process.prependOnceListener(signal, this.#onInterrupt);
    }
  }

  /** Stops guarding. Called once the project is complete and is meant to survive. */
  disarm(): void {
    if (!this.#armed) return;

    this.#armed = false;
    for (const signal of INTERRUPTS) {
      process.removeListener(signal, this.#onInterrupt);
    }
  }

  /**
   * Removes everything the run wrote.
   *
   * Never throws over a failed removal: the caller is on its way out with a more interesting
   * error, and replacing that error with "cleanup failed" would hide the actual cause. The
   * unremovable path is reported instead, which is the part the user has to act on.
   */
  async cleanUp(): Promise<void> {
    this.disarm();

    try {
      await this.#fs.remove(this.#root);

      // The user made this directory; only its contents were Atlas's doing.
      if (this.#rootExisted) {
        await this.#fs.ensureDir(this.#root);
      }
    } catch (error) {
      this.#reportCleanupFailure(error);
    }
  }

  /**
   * Cleanup on the way out of the process, so it has to be synchronous.
   *
   * A signal handler cannot await: Node runs the handler and, once it returns, has no obligation
   * to drain a pending promise before the process leaves. `rmSync` is one of the few places
   * where bypassing `FileSystemService` is the correct call rather than a shortcut.
   */
  handleInterrupt(signal: NodeJS.Signals): void {
    this.disarm();

    // Restores the terminal cursor, which ora hides while a spinner is running. Skipping this
    // leaves the user's shell with an invisible caret until they type `reset`.
    this.#reporter.stopTask();
    this.#reporter.blank();
    this.#reporter.warn(`Interrupted (${signal}). Removing the partial project.`);

    try {
      this.#removeSync(this.#root);
      this.#reporter.info('Nothing was left behind.');
    } catch (error) {
      this.#reportCleanupFailure(error);
    }

    this.#exit(ExitCode.Interrupted);
  }

  #reportCleanupFailure(error: unknown): void {
    const cleanupError = new AtlasError({
      code: ErrorCode.RollbackFailed,
      message: 'Atlas could not remove the partially written project.',
      hint: `Delete ${this.#root} by hand before running the command again.`,
      details: [this.#root, error instanceof Error ? error.message : String(error)],
      cause: error,
    });

    this.#reporter.error(cleanupError.message);
    this.#reporter.errorDetail(`hint: ${cleanupError.hint ?? ''}`);
    this.#reporter.debug(cleanupError.stack ?? cleanupError.message);
  }
}
