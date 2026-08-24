/**
 * The stages of a generation run, in the order they execute.
 *
 * The order below is the contract, not an implementation detail. Hooks are written against
 * what has already happened by the time they run, so a handler registered for `install` may
 * assume every file is on disk, and one registered for `post-generate` may assume the project
 * builds. Reordering these stages silently breaks every hook that relied on the old sequence,
 * so the sequence is declared once, here, and the runner derives ordering from it.
 */
export const LifecycleStage = {
  /** Inspect the project: framework, language, package manager, layout. */
  Detect: 'detect',
  /** Ask the user whatever the generator could not infer. */
  Prompt: 'prompt',
  /** Reject the run before anything is planned, while it is still free to abort. */
  Validate: 'validate',
  /** Build the immutable `GenerationPlan`. Still no filesystem writes. */
  Plan: 'plan',
  /** Settle every collision with an existing file up front. */
  ResolveConflicts: 'resolve-conflicts',
  /** Commit the plan's files in a single transaction. */
  Write: 'write',
  /** Add dependencies and run the package manager. */
  Install: 'install',
  /** Run the target project's formatter over what was written. */
  Format: 'format',
  /** Apply anchor injections into files Atlas did not author. */
  Inject: 'inject',
  /** Report next steps. The run has succeeded by this point. */
  PostGenerate: 'post-generate',
} as const;

export type LifecycleStage = (typeof LifecycleStage)[keyof typeof LifecycleStage];

/** Every stage in execution order. The runner's only source of truth for sequencing. */
export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  LifecycleStage.Detect,
  LifecycleStage.Prompt,
  LifecycleStage.Validate,
  LifecycleStage.Plan,
  LifecycleStage.ResolveConflicts,
  LifecycleStage.Write,
  LifecycleStage.Install,
  LifecycleStage.Format,
  LifecycleStage.Inject,
  LifecycleStage.PostGenerate,
];

/** Position of a stage in the run, for callers that need to compare two of them. */
export function lifecycleStageIndex(stage: LifecycleStage): number {
  return LIFECYCLE_STAGES.indexOf(stage);
}
