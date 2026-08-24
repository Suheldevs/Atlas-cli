import type { Reporter } from '../services/reporter.service.js';

import type { DependencyRequest, GenerationPlan, GenerationResult } from './generation-plan.js';
import type { Framework, Language, ProjectContext } from './project-context.js';
import type { TemplateRenderer } from './template-manifest.js';
import type { PromptRunner } from './prompts.js';
import type { GlobalOptions } from './cli-options.js';

/** Positional argument a generator accepts, e.g. the `User` in `atlas crud User`. */
export interface GeneratorArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

/** A generator-specific flag, described so the command layer can register it verbatim. */
export interface GeneratorFlag {
  /** Commander flag syntax, e.g. `--database <name>`. */
  readonly flag: string;
  readonly description: string;
  readonly defaultValue: string | boolean | undefined;
}

export interface GeneratorMeta {
  /** Unique, kebab-case. Also the subcommand name and the `atlas <name>` shortcut. */
  readonly name: string;
  readonly summary: string;
  readonly aliases: readonly string[];
  readonly version: string;
  readonly argument: GeneratorArgument | undefined;
  readonly flags: readonly GeneratorFlag[];
  /**
   * Frameworks this generator can write for. Empty means framework-agnostic.
   * Used by `atlas list` to mark generators that cannot apply to the current project.
   */
  readonly frameworks: readonly Framework[];
  /**
   * Languages this generator can write for. Empty means either.
   *
   * Declared rather than left to `detect()` so that `atlas list` can be honest without
   * running every generator's detector: metadata covers the cheap, static conditions, and
   * `detect()` remains authoritative for anything that needs to look at the project.
   */
  readonly languages: readonly Language[];
}

export interface DetectionVerdict {
  readonly supported: boolean;
  /** Why not, when unsupported. Shown to the user verbatim. */
  readonly reason: string | undefined;
  /** What the user could do about it. */
  readonly hint: string | undefined;
}

/** Raw command-line input, before a generator turns it into validated options. */
export interface GeneratorInvocation {
  readonly argument: string | undefined;
  readonly flags: Readonly<Record<string, unknown>>;
}

export interface GeneratorContext {
  readonly project: ProjectContext;
  readonly globals: GlobalOptions;
  readonly reporter: Reporter;
  readonly prompts: PromptRunner;
  /**
   * Loads and renders templates. Injected rather than constructed by the generator, so a
   * generator stays a plain value with no dependencies of its own and can be listed in a
   * static manifest.
   */
  readonly templates: TemplateRenderer;
  /**
   * Read-only peek at the target project, for decisions a generator cannot make from the
   * `ProjectContext` alone. There is no write counterpart on purpose: changes only ever
   * reach disk through the returned plan.
   */
  readFile(path: string): Promise<string | undefined>;
  /** Resolves a path inside the target project. */
  resolve(...segments: string[]): string;
}

/**
 * The contract every feature implements — built-in or third-party, both reach the registry
 * through the same door.
 *
 * The lifecycle runs in declaration order: `detect` decides whether this project is even a
 * candidate, `prompt` gathers options, `validate` rejects impossible combinations, and
 * `generate` returns a plan. Note what `generate` does *not* do: it never writes. The
 * engine owns the filesystem, which is what makes `--dry-run` truthful and a failed run
 * recoverable.
 */
export interface Generator<TOptions extends object = Record<string, unknown>> {
  readonly meta: GeneratorMeta;

  detect(context: GeneratorContext): Promise<DetectionVerdict> | DetectionVerdict;

  prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<TOptions>;

  /** Throws `AtlasError` on invalid options. Pure: no I/O, no prompting. */
  validate(options: TOptions, context: GeneratorContext): void;

  generate(options: TOptions, context: GeneratorContext): Promise<GenerationPlan> | GenerationPlan;

  /**
   * Optional. The engine already installs everything the plan declares, so this exists only
   * for generators whose dependency set cannot be known until options are resolved — a
   * database driver chosen at prompt time, for instance. Anything returned here is merged
   * with the plan's dependencies.
   */
  installDependencies?(
    options: TOptions,
    context: GeneratorContext,
  ): Promise<readonly DependencyRequest[]>;

  /** Optional. Runs after a successful apply; the place for follow-up commands and advice. */
  postGenerate?(
    options: TOptions,
    context: GeneratorContext,
    result: GenerationResult,
  ): Promise<void>;
}

/**
 * Type-erased generator, for the registry and command layer, which handle heterogeneous
 * generators.
 *
 * Method syntax makes the *parameter* positions bivariant, so `validate(options: MyOptions)`
 * is accepted here. The `prompt` **return** type is not covered by that: it is covariant, so
 * `Promise<MyOptions>` only satisfies `Promise<Record<string, unknown>>` when `MyOptions` is
 * assignable to it — which an interface is not, because interfaces get no implicit index
 * signature.
 *
 * The practical consequence, and it is worth knowing before writing a generator: declare
 * options as `interface MyOptions extends Record<string, unknown>`. The alternative was
 * erasing the lifecycle behind an untyped `run()`, which would cost every generator author
 * type safety on their own options to save one clause on the declaration.
 */
export type AnyGenerator = Generator<Record<string, unknown>>;
