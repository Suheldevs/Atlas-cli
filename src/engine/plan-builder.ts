import { isAbsolute, relative, resolve } from 'node:path';

import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type {
  DependencyRequest,
  EnvRequest,
  FileOperation,
  GenerationPlan,
  InjectionRequest,
  ScriptRequest,
} from '../types/generation-plan.js';

export interface PlanBuilderOptions {
  readonly generator: string;
  /** Absolute project root. Every relative path handed to the builder resolves against it. */
  readonly root: string;
}

export interface FileOptions {
  /** Skip the formatter — for `.env`, markdown, and anything prettier should not touch. */
  readonly format?: boolean;
  readonly label?: string;
}

/**
 * Accumulates a generator's intent and freezes it into a `GenerationPlan`.
 *
 * Generators use this instead of assembling plan literals so that path resolution,
 * duplicate detection, and ordering are decided in one place. The builder is the only
 * thing that knows a plan is supposed to be immutable and deterministic.
 */
export class PlanBuilder {
  readonly #generator: string;
  readonly #root: string;
  readonly #files = new Map<string, FileOperation>();
  readonly #dependencies = new Map<string, DependencyRequest>();
  readonly #scripts = new Map<string, ScriptRequest>();
  readonly #injections: InjectionRequest[] = [];
  readonly #env = new Map<string, EnvRequest>();
  readonly #notes: string[] = [];

  constructor(options: PlanBuilderOptions) {
    if (!isAbsolute(options.root)) {
      throw new AtlasError({
        code: ErrorCode.PlanInvalid,
        message: `Generator "${options.generator}" built a plan against a relative root.`,
        details: [options.root],
      });
    }

    this.#generator = options.generator;
    this.#root = options.root;
  }

  get root(): string {
    return this.#root;
  }

  /** Resolves a project-relative path to absolute. Absolute input passes through. */
  path(...segments: readonly string[]): string {
    return resolve(this.#root, ...segments);
  }

  /**
   * Queues a file. Two writes to the same path is a generator bug, not a conflict to
   * resolve at apply time, so it fails loudly here where the stack trace still points at
   * the culprit.
   */
  addFile(path: string, contents: string, options: FileOptions = {}): this {
    const absolute = this.path(path);

    if (this.#files.has(absolute)) {
      throw new AtlasError({
        code: ErrorCode.PlanInvalid,
        message: `Generator "${this.#generator}" queued the same file twice.`,
        details: [absolute],
        hint: 'Two template entries resolve to one destination. Rename one of them.',
      });
    }

    this.#files.set(absolute, {
      path: absolute,
      contents,
      format: options.format ?? true,
      label: options.label,
    });

    return this;
  }

  /**
   * Declares a dependency. Repeats are tolerated and collapsed — several templates in one
   * run legitimately need the same package — but a repeat that disagrees about the range is
   * a genuine inconsistency worth surfacing.
   */
  addDependency(name: string, range: string, options: { readonly dev?: boolean } = {}): this {
    const dev = options.dev ?? false;
    const key = `${dev ? 'dev' : 'prod'}:${name}`;
    const existing = this.#dependencies.get(key);

    if (existing !== undefined && existing.range !== range) {
      throw new AtlasError({
        code: ErrorCode.PlanInvalid,
        message: `Generator "${this.#generator}" asked for ${name} at two different versions.`,
        details: [`${existing.range} and ${range}`],
      });
    }

    this.#dependencies.set(key, { name, range, dev });
    return this;
  }

  addScript(name: string, command: string): this {
    this.#scripts.set(name, { name, command });
    return this;
  }

  addInjection(request: InjectionRequest): this {
    this.#injections.push({ ...request, path: this.path(request.path) });
    return this;
  }

  addEnv(
    key: string,
    value: string,
    options: { readonly comment?: string; readonly secret?: boolean } = {},
  ): this {
    this.#env.set(key, {
      key,
      value,
      comment: options.comment,
      secret: options.secret ?? false,
    });
    return this;
  }

  addNote(note: string): this {
    this.#notes.push(note);
    return this;
  }

  /**
   * Freezes the accumulated intent.
   *
   * Collections are sorted rather than left in insertion order: a plan is rendered to the
   * user and captured in snapshot tests, and output that reshuffles between runs makes both
   * of those worthless. Injections keep their declared order, because there sequence is
   * meaningful.
   */
  build(): GenerationPlan {
    return {
      generator: this.#generator,
      root: this.#root,
      files: [...this.#files.values()].sort((a, b) => a.path.localeCompare(b.path)),
      dependencies: [...this.#dependencies.values()].sort(
        (a, b) => Number(a.dev) - Number(b.dev) || a.name.localeCompare(b.name),
      ),
      scripts: [...this.#scripts.values()].sort((a, b) => a.name.localeCompare(b.name)),
      injections: [...this.#injections],
      env: [...this.#env.values()].sort((a, b) => a.key.localeCompare(b.key)),
      notes: [...this.#notes],
    };
  }
}

/**
 * True when `candidate` sits inside `root`.
 *
 * Compared via `relative` rather than `startsWith`, which would happily accept
 * `/project-evil` as being inside `/project` — a prefix match is not a path containment
 * check, and here it is a containment check that matters.
 */
function isInside(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return offset !== '' && !offset.startsWith('..') && !isAbsolute(offset);
}

/** Rejects plans that would be nonsense to apply, before anything touches disk. */
export function assertPlanIsApplicable(plan: GenerationPlan): void {
  const outside = plan.files.filter((file) => !isInside(plan.root, file.path));

  if (outside.length > 0) {
    throw new AtlasError({
      code: ErrorCode.PlanInvalid,
      message: `Generator "${plan.generator}" tried to write outside the project.`,
      details: outside.map((file) => file.path),
      hint: 'This is a bug in the generator. Please report it.',
    });
  }

  const empty = plan.files.filter((file) => file.contents.trim().length === 0);

  if (empty.length > 0) {
    throw new AtlasError({
      code: ErrorCode.PlanInvalid,
      message: `Generator "${plan.generator}" produced empty files.`,
      details: empty.map((file) => file.path),
      hint: 'An empty generated file usually means a template failed to load.',
    });
  }
}
