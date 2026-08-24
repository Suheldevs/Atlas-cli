import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { FileSystemService } from '../../services/filesystem.service.js';
import type { Reporter } from '../../services/reporter.service.js';

/** The file was not there before the run, so undoing it means deleting it. */
export interface RollbackRemoval {
  readonly kind: 'remove';
  readonly path: string;
}

/** The file was there, so undoing it means putting its previous contents back. */
export interface RollbackRestoration {
  readonly kind: 'restore';
  readonly path: string;
  readonly contents: string;
}

export type RollbackEntry = RollbackRemoval | RollbackRestoration;

export interface RollbackJournalOptions {
  readonly fs: FileSystemService;
  readonly reporter?: Reporter;
}

function describeFailure(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}

/**
 * The undo log for a single generation.
 *
 * An entry is recorded immediately before each real mutation, never after, so an operation that
 * throws part-way through is still covered. The journal is deliberately dumb: it stores previous
 * contents rather than trying to invert operations, because inverting a copy-over-an-existing-file
 * is the kind of cleverness that fails on the one path that mattered.
 */
export class RollbackJournal {
  readonly #fs: FileSystemService;
  readonly #reporter: Reporter | undefined;
  readonly #entries: RollbackEntry[] = [];

  constructor(options: RollbackJournalOptions) {
    this.#fs = options.fs;
    this.#reporter = options.reporter;
  }

  /** Reads the current on-disk state of `path` and records whatever it takes to get back to it. */
  async capture(path: string): Promise<void> {
    const previous = await this.#fs.readTextIfExists(path);
    this.record(path, previous);
  }

  record(path: string, previousContents: string | undefined): void {
    this.#entries.push(
      previousContents === undefined
        ? { kind: 'remove', path }
        : { kind: 'restore', path, contents: previousContents },
    );
  }

  entries(): readonly RollbackEntry[] {
    return [...this.#entries];
  }

  get size(): number {
    return this.#entries.length;
  }

  clear(): void {
    this.#entries.length = 0;
  }

  /**
   * Reverses every recorded entry, newest first, so a path written twice ends up holding the
   * state it had before the first write.
   *
   * A failing entry does not stop the others: abandoning the remaining entries would leave more
   * of the user's project modified than necessary. Every failure is collected instead and
   * reported as one error naming each path, because a partial rollback the user is not told
   * about is the worst outcome available here — they would believe the project was restored.
   */
  async restore(): Promise<void> {
    // Drained up front: a second `restore()` against the same entries would fight whatever
    // state the first one managed to reach.
    const entries = this.#entries.splice(0).reverse();
    const failures: string[] = [];

    for (const entry of entries) {
      try {
        if (entry.kind === 'remove') {
          await this.#fs.remove(entry.path);
        } else {
          await this.#fs.writeText(entry.path, entry.contents);
        }
      } catch (error: unknown) {
        failures.push(`${entry.path} — ${describeFailure(error)}`);
      }
    }

    this.#reporter?.debug(
      `Rollback reversed ${String(entries.length - failures.length)} change(s)`,
    );

    if (failures.length > 0) {
      throw new AtlasError({
        code: ErrorCode.RollbackFailed,
        message: 'Atlas could not fully restore your project after a failed run.',
        hint: 'Inspect the paths below before running Atlas again; they may be partially written.',
        details: failures,
      });
    }
  }
}
