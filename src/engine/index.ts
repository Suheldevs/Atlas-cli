/** Public surface of the generation engine. */

export {
  GenerationEngine,
  type ApplyRequest,
  type GenerationEngineOptions,
} from './generation-engine.js';

export {
  assertPlanIsApplicable,
  PlanBuilder,
  type FileOptions,
  type PlanBuilderOptions,
} from './plan-builder.js';

export * from './conflict/index.js';
export * from './deps/index.js';
export * from './format/index.js';
export * from './hooks/index.js';
export * from './inject/index.js';
export * from './vfs/index.js';
