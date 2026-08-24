/**
 * Programmatic surface.
 *
 * Exists so tests and future editor integrations can drive Atlas in-process instead of
 * spawning the binary. Generated projects never import this — or anything else from
 * Atlas — by design.
 */

export { main, run, type CliRunOptions } from './cli.js';

export { getPackageMeta, resolveTemplatesRoot, type PackageMeta } from './config/package-meta.js';

export { CLI_NAME, PACKAGE_NAME, SUPPORTED_NODE_RANGE } from './constants/branding.js';
export { ExitCode } from './constants/exit-codes.js';

export { ProjectScanner, readManifest, hasDependency } from './detection/index.js';

export {
  assertPlanIsApplicable,
  GenerationEngine,
  PlanBuilder,
  type ApplyRequest,
  type GenerationEngineOptions,
} from './engine/index.js';

export { GeneratorRegistry, describeSource } from './registry/generator-registry.js';
export { applicableGenerators, describeAvailability } from './registry/capability-index.js';
export { discoverGenerators, type DiscoveryOptions } from './registry/discovery.js';

export { InteractivePromptRunner, ScriptedPromptRunner } from './prompts/prompt-runner.js';
export {
  createConflictPrompt,
  nonInteractiveConflictAsk,
  type ConflictPromptOptions,
} from './prompts/conflict.prompt.js';

// Third-party generators target these anchors, so the vocabulary has to be importable
// rather than something plugin authors copy as string literals and get subtly wrong.
export * from './constants/markers.js';

export {
  AtlasError,
  UsageError,
  UserAbortError,
  type AtlasErrorOptions,
} from './errors/atlas-error.js';
export { describeErrorCode, docsUrlForErrorCode, ErrorCode } from './errors/error-catalog.js';
export { presentError, type PresentErrorOptions } from './errors/error-presenter.js';

export {
  ProcessService,
  type ProcessRunner,
  type RunOptions,
  type RunResult,
} from './services/process.service.js';
export {
  Reporter,
  type OutputStream,
  type ReporterConfig,
  type ReporterOptions,
  type TaskHandle,
} from './services/reporter.service.js';

export type { GlobalOptions } from './types/cli-options.js';
export type {
  AnyGenerator,
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from './types/generator.js';
export type {
  AppliedFile,
  DependencyRequest,
  EnvRequest,
  FileOperation,
  GenerationPlan,
  GenerationResult,
  InjectionRequest,
  ScriptRequest,
} from './types/generation-plan.js';
export type { AtlasPlugin, LoadedPlugin, PluginSource } from './types/plugin.js';
export type {
  DatabaseLayer,
  Framework,
  Language,
  ModuleSystem,
  PackageManager,
  PackageManifest,
  ProjectContext,
} from './types/project-context.js';
export type { PromptRunner } from './types/prompts.js';
