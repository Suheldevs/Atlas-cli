import { join } from 'node:path';

import type { Clock } from '../services/clock.service.js';
import type { FileSystemService } from '../services/filesystem.service.js';
import type { Reporter } from '../services/reporter.service.js';
import type {
  AppliedFile,
  DependencyRequest,
  GenerationPlan,
  GenerationResult,
  InjectionRequest,
} from '../types/generation-plan.js';
import type { ProjectContext } from '../types/project-context.js';
import { describeCount } from '../utils/text.js';

import { ConflictResolver, outcomeForDecision, type ConflictAsk } from './conflict/index.js';
import { detectConflicts } from './conflict/index.js';
import { planDependencies, type DependencyInstaller } from './deps/index.js';
import type { Formatter } from './format/index.js';
import { injectAtAnchor, mergeEnvFile, mergeJsonFile } from './inject/index.js';
import { assertPlanIsApplicable } from './plan-builder.js';
import { commitStagedOperations, RollbackJournal, VirtualFileSystem } from './vfs/index.js';

export interface GenerationEngineOptions {
  readonly fs: FileSystemService;
  readonly clock: Clock;
  readonly reporter: Reporter;
  readonly formatter: Formatter;
  readonly installer: DependencyInstaller;
  /** Supplies conflict interaction. The engine never imports a prompt library. */
  readonly ask: ConflictAsk;
}

export interface ApplyRequest {
  readonly plan: GenerationPlan;
  readonly project: ProjectContext;
  readonly dryRun: boolean;
  readonly assumeYes: boolean;
  /** Extra dependencies a generator resolved at prompt time, merged with the plan's. */
  readonly extraDependencies?: readonly DependencyRequest[];
}

/**
 * Applies a plan.
 *
 * The order below is the contract, and each step is where it is for a reason:
 *
 * 1. **Format first.** Conflict detection compares content, so formatting afterwards would
 *    report a file as differing purely because Atlas had not run prettier over it yet.
 * 2. **Detect and resolve every conflict before writing anything.** Answering "abort" must
 *    cost the user nothing, which is only true while nothing has been written.
 * 3. **Stage, then commit once.** Files, `package.json` edits, `.env` entries and injections
 *    all go through one virtual filesystem and one journalled flush, so any failure restores
 *    the project completely.
 * 4. **Install dependencies last.** A failed install leaves correct source on disk that the
 *    user can fix by re-running their package manager; installing first and then failing to
 *    write leaves packages nobody asked for.
 */
export class GenerationEngine {
  readonly #fs: FileSystemService;
  readonly #clock: Clock;
  readonly #reporter: Reporter;
  readonly #formatter: Formatter;
  readonly #installer: DependencyInstaller;
  readonly #ask: ConflictAsk;

  constructor(options: GenerationEngineOptions) {
    this.#fs = options.fs;
    this.#clock = options.clock;
    this.#reporter = options.reporter;
    this.#formatter = options.formatter;
    this.#installer = options.installer;
    this.#ask = options.ask;
  }

  async apply(request: ApplyRequest): Promise<GenerationResult> {
    const { plan, project, dryRun, assumeYes } = request;

    assertPlanIsApplicable(plan);

    const formatted = await this.#formatter.formatOperations(plan.files);

    const conflicts = await detectConflicts(this.#fs, formatted);
    const resolver = new ConflictResolver({
      reporter: this.#reporter,
      clock: this.#clock,
      ask: this.#ask,
    });
    const resolution = await resolver.resolve(conflicts, { assumeYes });

    const vfs = new VirtualFileSystem(this.#fs);
    const journal = new RollbackJournal({ fs: this.#fs, reporter: this.#reporter });

    const files: AppliedFile[] = [];

    for (const operation of formatted) {
      const decision = resolution.byPath.get(operation.path);

      if (decision === undefined || decision.choice === 'skip') {
        files.push({
          path: operation.path,
          outcome: 'skipped',
          backupPath: undefined,
        });
        continue;
      }

      if (decision.choice === 'backup' && decision.backupPath !== undefined) {
        vfs.stageCopy(operation.path, decision.backupPath);
      }

      vfs.stageWrite(operation.path, operation.contents);
      files.push({
        path: operation.path,
        outcome: outcomeForDecision(decision),
        backupPath: decision.backupPath,
      });
    }

    await this.#stageManifestScripts(vfs, plan, project);
    await this.#stageEnvironment(vfs, plan, project);

    const { injected, manual } = await this.#stageInjections(vfs, plan);

    await commitStagedOperations({
      vfs,
      fs: this.#fs,
      journal,
      reporter: this.#reporter,
      dryRun,
    });

    const installed = await this.#installDependencies(request);

    return {
      generator: plan.generator,
      dryRun,
      files,
      installed,
      injected,
      manual,
      notes: plan.notes,
    };
  }

  /**
   * Adds the plan's scripts to `package.json`.
   *
   * Merged through the JSON merger rather than rewritten, so key order and indentation
   * survive, and an existing script of the same name is never replaced — a user's own `dev`
   * command is theirs.
   */
  async #stageManifestScripts(
    vfs: VirtualFileSystem,
    plan: GenerationPlan,
    project: ProjectContext,
  ): Promise<void> {
    if (plan.scripts.length === 0) {
      return;
    }

    const manifestPath = project.manifest?.path ?? join(project.root, 'package.json');
    const existing = await vfs.readTextIfExists(manifestPath);

    if (existing === undefined) {
      this.#reporter.debug('no package.json, skipping script registration');
      return;
    }

    const scripts = Object.fromEntries(plan.scripts.map((script) => [script.name, script.command]));
    const merged = mergeJsonFile(existing, { scripts });

    if (merged.added.length > 0) {
      vfs.stageWrite(manifestPath, merged.contents);
    }

    for (const skipped of merged.skipped) {
      this.#reporter.debug(`kept existing ${skipped}`);
    }
  }

  /**
   * Writes environment entries to `.env.example` always, and to `.env` only when the project
   * already has one.
   *
   * Creating a `.env` that did not exist is the wrong default: it is gitignored, so the user
   * would end up with real-looking configuration that no teammate receives, and secrets that
   * look filled in when they are placeholders.
   */
  async #stageEnvironment(
    vfs: VirtualFileSystem,
    plan: GenerationPlan,
    project: ProjectContext,
  ): Promise<void> {
    if (plan.env.length === 0) {
      return;
    }

    const examplePath = join(project.root, '.env.example');
    const example = mergeEnvFile(await vfs.readTextIfExists(examplePath), plan.env);
    if (example.added.length > 0) {
      vfs.stageWrite(examplePath, example.contents);
    }

    const envPath = join(project.root, '.env');
    const currentEnv = await vfs.readTextIfExists(envPath);

    if (currentEnv === undefined) {
      this.#reporter.debug('.env not present; only .env.example was updated');
      return;
    }

    const merged = mergeEnvFile(currentEnv, plan.env);
    if (merged.added.length > 0) {
      vfs.stageWrite(envPath, merged.contents);
    }
  }

  /**
   * Applies injections through the pure `injectAtAnchor` and stages the result, rather than
   * using `AnchorInjector` to write directly.
   *
   * Two things fall out of that: the edit joins the same transaction as everything else, and
   * reading through the VFS means an injection can target a file this very run created.
   */
  async #stageInjections(
    vfs: VirtualFileSystem,
    plan: GenerationPlan,
  ): Promise<{ injected: readonly InjectionRequest[]; manual: readonly InjectionRequest[] }> {
    const injected: InjectionRequest[] = [];
    const manual: InjectionRequest[] = [];

    for (const request of plan.injections) {
      const existing = await vfs.readTextIfExists(request.path);

      if (existing === undefined) {
        manual.push(request);
        continue;
      }

      const result = injectAtAnchor(existing, request);

      if (result.outcome === 'injected' && result.contents !== undefined) {
        vfs.stageWrite(request.path, result.contents);
        injected.push(request);
        continue;
      }

      if (result.outcome === 'already-present') {
        this.#reporter.debug(`already wired: ${request.path}`);
        continue;
      }

      manual.push(request);
    }

    return { injected, manual };
  }

  async #installDependencies(request: ApplyRequest): Promise<readonly DependencyRequest[]> {
    const requested = [...request.plan.dependencies, ...(request.extraDependencies ?? [])];

    if (requested.length === 0) {
      return [];
    }

    const dependencyPlan = planDependencies(requested, request.project.manifest);

    // Surfaced, never resolved unilaterally: silently upgrading a range the user pinned is
    // exactly the kind of "helpful" behaviour that makes a tool untrustworthy.
    if (dependencyPlan.conflicts.length > 0) {
      this.#reporter.warn(
        `${describeCount(dependencyPlan.conflicts.length, 'dependency')} already installed at an older range.`,
      );
      this.#reporter.errorList(
        dependencyPlan.conflicts.map(
          (conflict) =>
            `${conflict.name}: have ${conflict.installedRange}, want ${conflict.requiredRange}`,
        ),
      );
    }

    return this.#installer.install(dependencyPlan, {
      // Always the workspace install root: installing inside a package of a monorepo creates a
      // nested node_modules that resolution ignores.
      cwd: request.project.workspace.installRoot,
      dryRun: request.dryRun,
    });
  }
}
