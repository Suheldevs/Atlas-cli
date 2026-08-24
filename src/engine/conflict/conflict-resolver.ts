import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { Clock } from '../../services/clock.service.js';
import type { Reporter } from '../../services/reporter.service.js';
import type { AppliedFile } from '../../types/generation-plan.js';

import { backupPathFor } from './backup-strategy.js';
import { requiresDecision, type FileConflict } from './conflict-detector.js';

export type ConflictChoice = 'overwrite' | 'skip' | 'backup' | 'abort';

/** Everything except `abort`, which ends the run instead of producing a decision. */
export type ResolvedChoice = Exclude<ConflictChoice, 'abort'>;

/**
 * Supplies the interaction. The resolver never imports a prompt library: keeping the question
 * behind a callback is what lets every branch of this logic be exercised without a terminal, and
 * lets the caller answer with a diff-then-re-ask loop if it wants one.
 */
export type ConflictAsk = (conflict: FileConflict) => Promise<ConflictChoice>;

export interface ConflictDecision {
  readonly path: string;
  readonly kind: FileConflict['kind'];
  readonly choice: ResolvedChoice;
  /** Where the previous contents will be copied, when the answer was `backup`. */
  readonly backupPath: string | undefined;
}

export interface ConflictResolution {
  readonly decisions: readonly ConflictDecision[];
  /** Same decisions keyed by path, for the commit walk that looks each file up once. */
  readonly byPath: ReadonlyMap<string, ConflictDecision>;
}

export interface ConflictResolverOptions {
  readonly reporter: Reporter;
  readonly clock: Clock;
  readonly ask: ConflictAsk;
}

export interface ResolveOptions {
  /** `--yes`: no terminal is available, or the user asked not to be interrupted. */
  readonly assumeYes: boolean;
}

/** Translates a decision into the outcome the run reports for that file. */
export function outcomeForDecision(decision: ConflictDecision): AppliedFile['outcome'] {
  switch (decision.choice) {
    case 'skip':
      return 'skipped';
    case 'backup':
      return 'backed-up';
    case 'overwrite':
      return decision.kind === 'absent' ? 'created' : 'overwritten';
  }
}

/**
 * Turns detected conflicts into a decision per file.
 *
 * Every question is asked before the caller writes anything, so answering `abort` costs the user
 * nothing and leaves their project untouched.
 */
export class ConflictResolver {
  readonly #reporter: Reporter;
  readonly #clock: Clock;
  readonly #ask: ConflictAsk;

  constructor(options: ConflictResolverOptions) {
    this.#reporter = options.reporter;
    this.#clock = options.clock;
    this.#ask = options.ask;
  }

  async resolve(
    conflicts: readonly FileConflict[],
    options: ResolveOptions,
  ): Promise<ConflictResolution> {
    const decisions: ConflictDecision[] = [];

    for (const conflict of conflicts) {
      decisions.push(await this.#decide(conflict, conflicts, options));
    }

    return {
      decisions,
      byPath: new Map(decisions.map((decision) => [decision.path, decision])),
    };
  }

  async #decide(
    conflict: FileConflict,
    all: readonly FileConflict[],
    options: ResolveOptions,
  ): Promise<ConflictDecision> {
    if (conflict.kind === 'absent') {
      return { path: conflict.path, kind: 'absent', choice: 'overwrite', backupPath: undefined };
    }

    if (conflict.kind === 'identical') {
      // Silent on purpose: telling the user about a file that is already exactly what Atlas
      // would write is noise, and it turns a repeat run into a wall of non-events.
      this.#reporter.debug(`unchanged, skipping: ${conflict.path}`);
      return { path: conflict.path, kind: 'identical', choice: 'skip', backupPath: undefined };
    }

    if (options.assumeYes) {
      // `--yes` resolves to `backup`, never `overwrite`. Non-interactive means nobody is watching,
      // and the destructive answer must never be the one Atlas picks on the user's behalf — a
      // recoverable surprise is acceptable, an unrecoverable one is not.
      this.#reporter.warn(`${conflict.path} already exists — backing it up rather than replacing.`);
      return this.#backup(conflict);
    }

    const choice = await this.#ask(conflict);

    switch (choice) {
      case 'abort':
        throw new AtlasError({
          code: ErrorCode.ConflictUnresolved,
          message: 'Stopped at a file conflict. Nothing was written.',
          hint: 'Re-run with --yes to back up every conflicting file instead of being asked.',
          details: all.filter(requiresDecision).map((entry) => entry.path),
        });
      case 'backup':
        return this.#backup(conflict);
      case 'skip':
        this.#reporter.info(`Keeping your version of ${conflict.path}.`);
        return { path: conflict.path, kind: 'differs', choice: 'skip', backupPath: undefined };
      case 'overwrite':
        this.#reporter.warn(`Replacing ${conflict.path}.`);
        return { path: conflict.path, kind: 'differs', choice: 'overwrite', backupPath: undefined };
    }
  }

  #backup(conflict: FileConflict): ConflictDecision {
    const backupPath = backupPathFor(conflict.path, this.#clock);
    this.#reporter.detail(`backup: ${backupPath}`);
    return { path: conflict.path, kind: conflict.kind, choice: 'backup', backupPath };
  }
}
