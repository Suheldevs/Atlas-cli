import type { Reporter } from '../../services/reporter.service.js';

import type { LifecycleStage } from './lifecycle.js';

/**
 * A hook. Returning a promise is supported and awaited; returning nothing is fine.
 */
export type HookHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

/**
 * What each stage hands its hooks.
 *
 * Callers declare their own map — `{ write: WriteContext; install: InstallContext; ... }` —
 * and get a `HookRunner` that type-checks both registration and dispatch against it.
 */
export type HookPayloads = Readonly<Record<LifecycleStage, unknown>>;

/**
 * Handlers are stored erased, because a single map holds handlers for stages with different
 * payload types. `never` as the parameter type is what makes the erased form assignable from
 * every concrete handler; `register` and `run` are the type-safe boundary around it.
 */
type ErasedHandler = (payload: never) => void | Promise<void>;

export interface HookRunnerOptions {
  readonly reporter?: Reporter | undefined;
}

/**
 * Registry and dispatcher for lifecycle hooks.
 */
export class HookRunner<TPayloads extends HookPayloads = HookPayloads> {
  readonly #handlers = new Map<LifecycleStage, ErasedHandler[]>();
  readonly #reporter: Reporter | undefined;

  constructor(options: HookRunnerOptions = {}) {
    this.#reporter = options.reporter;
  }

  register<TStage extends LifecycleStage>(
    stage: TStage,
    handler: HookHandler<TPayloads[TStage]>,
  ): void {
    const existing = this.#handlers.get(stage);
    if (existing === undefined) {
      this.#handlers.set(stage, [handler]);
      return;
    }
    existing.push(handler);
  }

  has(stage: LifecycleStage): boolean {
    return (this.#handlers.get(stage)?.length ?? 0) > 0;
  }

  /**
   * Runs a stage's hooks in registration order, one at a time.
   *
   * Sequential and not `Promise.all`: hooks exist to have side effects, and a later hook is
   * entitled to observe an earlier one's — a hook that writes a config file followed by one
   * that reads it is the ordinary case. Running them concurrently would make that a race.
   *
   * A throwing hook aborts the stage and the error propagates untouched, cancelling the run.
   * Swallowing it would leave the project in a state that half a hook produced, which is worse
   * than not running the hook at all — and the caller's rollback is what makes the failure safe.
   */
  async run<TStage extends LifecycleStage>(
    stage: TStage,
    payload: TPayloads[TStage],
  ): Promise<void> {
    const handlers = this.#handlers.get(stage);
    if (handlers === undefined || handlers.length === 0) return;

    this.#reporter?.debug(`hooks: running ${String(handlers.length)} for stage '${stage}'`);

    for (const handler of handlers) {
      await handler(payload as never);
    }
  }
}
