import { resolve } from 'node:path';

import { getPackageMeta, resolveTemplatesRoot } from '../../config/package-meta.js';
import { CLI_NAME } from '../../constants/branding.js';
import { ExitCode } from '../../constants/exit-codes.js';
import { TOKENS } from '../../constants/tokens.js';
import { detectPackageManager } from '../../detection/detectors/package-manager.detector.js';
import { DependencyInstaller, planDependencies } from '../../engine/deps/index.js';
import { Formatter } from '../../engine/format/index.js';
import { GenerationEngine } from '../../engine/generation-engine.js';
import { PlanBuilder } from '../../engine/plan-builder.js';
import { TemplateLoader } from '../../engine/template/template-loader.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { buildPlanFromTemplate } from '../../generators/template-plan.js';
import { nonInteractiveConflictAsk } from '../../prompts/conflict.prompt.js';
import { resolveLanguage } from '../../prompts/language.prompt.js';
import { InteractivePromptRunner } from '../../prompts/prompt-runner.js';
import { GitCommandService } from '../../services/git.service.js';
import { createPackageManagerService } from '../../services/package-manager.service.js';
import type {
  DependencyRequest,
  GenerationPlan,
  GenerationResult,
} from '../../types/generation-plan.js';
import type { GeneratorContext } from '../../types/generator.js';
import type { Language, ProjectContext } from '../../types/project-context.js';
import { compareVersions, extractMinimumVersion } from '../../utils/semver.js';

import type { CommandContext } from '../register-commands.js';

import {
  assertTemplatesAvailable,
  clientTemplates,
  serverTemplates,
  type TemplateStep,
} from './blueprint.js';
import { describeWriteFailure } from './failure.js';
import { renderHalfManifest } from './manifest.js';
import { assertTargetIsUsable, assertValidProjectName } from './preflight.js';
import { ScaffoldGuard } from './scaffold-guard.js';
import { reportStartSummary } from './summary.js';
import { CLIENT_DIR_NAME, createSyntheticProject, SERVER_DIR_NAME } from './synthetic-context.js';

/** Name recorded on every plan, so plan errors say which command produced them. */
const GENERATOR_NAME = 'start';

export interface StartRequest {
  readonly context: CommandContext;
  /** Directory to create, as the user typed it. */
  readonly name: string;
  /** Raw `--language` value, or undefined when the flag was absent. */
  readonly language: unknown;
  readonly skipInstall: boolean;
  readonly skipGit: boolean;
  /** Defaults to the shipped templates directory. Overridable for tests. */
  readonly templatesRoot?: string | undefined;
  /** Overrides the guard's synchronous interrupt cleanup. Overridable for tests. */
  readonly removeSync?: ((path: string) => void) | undefined;
  /** Overrides how an interrupt terminates the process. Overridable for tests. */
  readonly exit?: ((code: number) => void) | undefined;
}

/** One half of the project, after it has been written but before anything is installed. */
interface HalfOutcome {
  readonly label: string;
  readonly project: ProjectContext;
  readonly result: GenerationResult;
  /** Held back from the plan so a failed install cannot roll back a finished scaffold. */
  readonly dependencies: readonly DependencyRequest[];
}

/**
 * Scaffolds a new full-stack project.
 *
 * The shape of this function is dictated by one property: `start` creates a directory tree from
 * nothing, so a run that stops half way leaves rubbish only the user can clear up. Everything
 * below follows from refusing to allow that.
 *
 * 1. **Decide before writing.** The name, the language, the target directory and the templates
 *    are all settled first, so every avoidable failure happens while the disk is untouched.
 * 2. **Guard the write.** Both halves are written under a {@link ScaffoldGuard}: any failure,
 *    and any interrupt, removes the whole tree rather than leaving part of it.
 * 3. **Install afterwards, and never fatally.** Dependencies are stripped from the plans and
 *    installed once the project is complete, because a dead registry is not a reason to delete
 *    somebody's freshly generated project.
 */
export async function runStart(request: StartRequest): Promise<void> {
  const { context } = request;
  const { reporter } = context;
  const globals = context.globals();

  assertValidProjectName(request.name);

  const root = resolve(globals.cwd, request.name);
  await assertTargetIsUsable(context.fs, root);
  const rootExisted = await context.fs.exists(root);

  const prompts = new InteractivePromptRunner({ reporter, assumeYes: globals.yes });
  const language = await resolveLanguage(request.language, prompts);

  // Read from the directory `start` was run in, not from the project — the project has no
  // lockfile yet, so the best available evidence is what the user works with nearby.
  const packageManager = await detectPackageManager(context.fs, globals.cwd, undefined);

  const project = createSyntheticProject({ root, language, packageManager });

  const templatesRoot = request.templatesRoot ?? resolveTemplatesRoot();
  const server = serverTemplates(language);
  const client = clientTemplates(language);
  await assertTemplatesAvailable(context.fs, templatesRoot, [...server, ...client]);

  reporter.banner(
    `${CLI_NAME} v${getPackageMeta().version}`,
    `Creating ${request.name} — ${describeLanguage(language)} · express + react`,
  );

  if (globals.dryRun) {
    reporter.warn('Dry run — nothing will be written.');
    reporter.blank();
  }

  // One loader for the whole run so its template cache is actually used: the TypeScript path
  // reads four templates the `add` commands already know, and re-parsing each manifest per half
  // buys nothing.
  const templates = new TemplateLoader({ fs: context.fs, reporter, templatesRoot });

  const total = countSteps(request);
  const guard = new ScaffoldGuard({
    fs: context.fs,
    reporter,
    root,
    rootExisted,
    removeSync: request.removeSync,
    exit: request.exit,
  });

  // A dry run writes nothing, so there is nothing to guard and nothing an interrupt could
  // strand. Arming anyway would mean a Ctrl+C deleting a directory Atlas never created.
  if (!globals.dryRun) {
    guard.arm();
  }

  let halves: readonly HalfOutcome[];

  try {
    halves = [
      await scaffoldHalf({
        request,
        project: project.server,
        steps: server,
        templates,
        label: SERVER_DIR_NAME,
        description: `Express API for ${request.name}.`,
        index: 1,
        total,
      }),
      await scaffoldHalf({
        request,
        project: project.client,
        steps: client,
        templates,
        label: CLIENT_DIR_NAME,
        description: `React client for ${request.name}.`,
        index: 2,
        total,
      }),
    ];
  } catch (error) {
    reporter.stopTask();
    await guard.cleanUp();
    // Re-described on the way out: a full disk and a read-only mount both surface here as an
    // opaque commit failure, and the difference is the only part the user can act on.
    throw describeWriteFailure(error, root);
  }

  // From here the project is complete and is meant to survive, whatever else goes wrong.
  guard.disarm();

  const installed = await installAll(request, halves, total);

  if (!request.skipGit) {
    await initialiseRepository(request, root, total, total);
  }

  reportStartSummary({
    reporter,
    processes: context.processes,
    projectName: request.name,
    root,
    packageManager,
    files: halves.flatMap((half) => half.result.files.map((file) => file.path)),
    dryRun: globals.dryRun,
    installed,
  });

  reportNotes(context, halves);
}

/** Two halves, an install per half unless skipped, and the repository unless skipped. */
function countSteps(request: StartRequest): number {
  return 2 + (request.skipInstall ? 0 : 2) + (request.skipGit ? 0 : 1);
}

interface ScaffoldHalfRequest {
  readonly request: StartRequest;
  readonly project: ProjectContext;
  readonly steps: readonly TemplateStep[];
  readonly templates: TemplateLoader;
  readonly label: string;
  /** One line for the generated `package.json`. */
  readonly description: string;
  readonly index: number;
  readonly total: number;
}

async function scaffoldHalf(input: ScaffoldHalfRequest): Promise<HalfOutcome> {
  const { request, project, label, index, total } = input;
  const { context } = request;
  const globals = context.globals();

  const task = context.reporter.step(index, total, `Scaffolding ${label}`);

  let plan: GenerationPlan;
  try {
    plan = await buildHalfPlan(input);
  } catch (error) {
    // The spinner owns the current line; leaving it spinning would smear the error over it.
    task.fail(`Could not scaffold the ${label}.`);
    throw error;
  }

  const engine = new GenerationEngine({
    fs: context.fs,
    clock: context.clock,
    reporter: context.reporter,
    formatter: new Formatter({ reporter: context.reporter }),
    installer: new DependencyInstaller({
      packageManager: createPackageManagerService(project.packageManager, context.processes),
      reporter: context.reporter,
    }),
    // A conflict cannot arise: the target was empty before this run, and the plan builder rejects
    // two templates writing the same file. This callback exists to satisfy the engine's contract.
    ask: nonInteractiveConflictAsk,
  });

  let result: GenerationResult;
  try {
    result = await engine.apply({
      // Dependencies are withheld from the plan so the engine writes files and nothing else.
      // Installing them is a separate, non-fatal step once both halves exist — see `installAll`.
      plan: { ...plan, dependencies: [] },
      project,
      dryRun: globals.dryRun,
      // Nothing to confirm, and a question here would hang a run that is meant to be unattended.
      assumeYes: true,
    });
  } catch (error) {
    task.fail(`Could not write the ${label}.`);
    throw error;
  }

  const verb = globals.dryRun ? 'planned' : 'written';
  task.succeed(`${capitalize(label)} ${verb} — ${String(result.files.length)} files`);

  return {
    label,
    project,
    result,
    dependencies: request.skipInstall ? [] : plan.dependencies,
  };
}

/**
 * Installs each half's dependencies, treating a failure as news rather than a catastrophe.
 *
 * The project is already on disk by the time this runs, and it is a complete, correct project —
 * what is missing is a `node_modules` the user can produce themselves with one command. Deleting
 * their scaffold because a registry was unreachable would be strictly worse than handing them
 * that command, so that is what happens instead. The exit status still goes non-zero, because
 * something did fail and a script deserves to be able to see it.
 *
 * Returns whether the dependencies are actually installed, which the summary uses to decide what
 * to say about the install step it prints.
 */
async function installAll(
  request: StartRequest,
  halves: readonly HalfOutcome[],
  total: number,
): Promise<boolean> {
  if (request.skipInstall) {
    return false;
  }

  const { context } = request;
  const globals = context.globals();
  const failures: string[] = [];

  // The two scaffold steps are already done, so the install steps are three and four.
  let index = 2;

  for (const half of halves) {
    index += 1;
    const task = context.reporter.step(index, total, `Installing ${half.label} dependencies`);
    const installer = new DependencyInstaller({
      packageManager: createPackageManagerService(half.project.packageManager, context.processes),
      reporter: context.reporter,
    });

    try {
      // No manifest to reconcile against: nothing is installed in a directory that did not exist
      // a moment ago, so every declared dependency is genuinely missing.
      await installer.install(planDependencies(half.dependencies, undefined), {
        cwd: half.project.workspace.installRoot,
        dryRun: globals.dryRun,
      });

      task.succeed(
        `${capitalize(half.label)} dependencies ${globals.dryRun ? 'planned' : 'installed'}.`,
      );
    } catch (error) {
      task.fail(`Could not install the ${half.label} dependencies.`);
      failures.push(half.label);
      reportInstallFailure(request, half, error);
    }
  }

  if (failures.length > 0) {
    // Non-zero, but only after the project has been kept and with the summary still to come: the
    // user gets a working scaffold, and a script gets an honest status.
    context.setExitCode(ExitCode.Failure);
    return false;
  }

  return !globals.dryRun;
}

function reportInstallFailure(request: StartRequest, half: HalfOutcome, error: unknown): void {
  const { reporter } = request.context;

  reporter.blank();
  reporter.warn(
    `The ${half.label} dependencies were not installed. The project itself is complete and has been kept.`,
  );

  if (AtlasError.isAtlasError(error)) {
    reporter.errorDetail(error.message);
    reporter.errorList(error.details.slice(0, 5));
  } else {
    reporter.errorDetail(error instanceof Error ? error.message : String(error));
  }

  reporter.errorDetail('Finish the install yourself with:');
  reporter.errorDetail(
    `  cd ${request.name}/${half.label} && ${half.project.packageManager} install`,
  );
  reporter.debug(error instanceof Error ? (error.stack ?? error.message) : String(error));
}

/**
 * Merges every template in a half into one plan.
 *
 * One plan rather than one per template, so the whole half commits as a single transaction: a
 * template that fails part-way leaves nothing behind, and the plan builder gets to reject two
 * templates claiming the same destination before anything is written.
 */
async function buildHalfPlan(input: ScaffoldHalfRequest): Promise<GenerationPlan> {
  const { request, project, steps } = input;
  const generatorContext = buildGeneratorContext(input);
  const builder = new PlanBuilder({ generator: GENERATOR_NAME, root: project.root });
  const declared: DependencyRequest[] = [];

  for (const step of steps) {
    const plan = await buildPlanFromTemplate({
      context: generatorContext,
      generator: GENERATOR_NAME,
      template: step.template,
      entity: step.entity,
      // The project name comes from the directory the user asked for. Left to the token table it
      // would be derived from the half's own root, naming every generated project "server".
      tokens: { [TOKENS.projectName]: request.name },
      destinationPrefix: step.placement === 'root' ? '.' : project.layout.sourceDir,
    });

    absorb(builder, plan);
    declared.push(...plan.dependencies);
  }

  for (const dependency of reconcileDependencies(declared, input)) {
    builder.addDependency(dependency.name, dependency.range, { dev: dependency.dev });
  }

  return withManifest(builder, input);
}

/**
 * Adds the half's `package.json`, unless a template already supplied one.
 *
 * Built from the finished plan rather than alongside it, because its two most important fields —
 * scripts and dependencies — only exist once every template in the half has been merged and the
 * ranges reconciled. Asking the builder for the plan twice is free: `build()` reads the
 * accumulated state and does not consume it.
 */
function withManifest(builder: PlanBuilder, input: ScaffoldHalfRequest): GenerationPlan {
  const draft = builder.build();
  const manifestPath = builder.path('package.json');

  // A template that ships its own manifest owns it. Writing a second one would be a duplicate
  // destination, which the builder rejects — correctly, but with a message about a generator bug
  // rather than about the template that changed.
  if (draft.files.some((file) => file.path === manifestPath)) {
    return draft;
  }

  builder.addFile(
    'package.json',
    renderHalfManifest({
      projectName: input.request.name,
      half: input.label,
      description: input.description,
      scripts: draft.scripts,
      dependencies: draft.dependencies,
    }),
    { format: true, label: 'package.json' },
  );

  return builder.build();
}

/**
 * Picks one range per package when several templates ask for the same one.
 *
 * The plan builder treats a range disagreement as a generator bug and refuses the plan, which is
 * right when one generator contradicts itself. Here it is not: a half is assembled from five
 * independently authored templates, and two of them naming `mongoose` at `^9.0.0` and `^9.8.0` is
 * ordinary drift, not a bug — they are compatible, and only one of them can be installed.
 *
 * The higher minimum wins, because it is the only choice that satisfies both: any range that
 * needs 9.8 is not satisfied by 9.0, while everything that asked for 9.0 is happy with 9.8. A
 * range with no parseable minimum (`*`, a git URL, `latest`) never displaces one that has one.
 */
function reconcileDependencies(
  declared: readonly DependencyRequest[],
  input: ScaffoldHalfRequest,
): readonly DependencyRequest[] {
  const chosen = new Map<string, DependencyRequest>();

  for (const request of declared) {
    const key = `${request.dev ? 'dev' : 'prod'}:${request.name}`;
    const existing = chosen.get(key);

    if (existing === undefined) {
      chosen.set(key, request);
      continue;
    }

    if (existing.range === request.range) {
      continue;
    }

    const winner = higherMinimum(existing, request);
    chosen.set(key, winner);

    // Debug rather than a warning: the ranges are compatible by construction, and telling a user
    // scaffolding their first project about a patch-level disagreement between two templates is
    // noise they cannot act on.
    input.request.context.reporter.debug(
      `${input.label}: ${request.name} declared as ${existing.range} and ${request.range}; using ${winner.range}`,
    );
  }

  return [...chosen.values()];
}

function higherMinimum(left: DependencyRequest, right: DependencyRequest): DependencyRequest {
  const leftMinimum = extractMinimumVersion(left.range);
  const rightMinimum = extractMinimumVersion(right.range);

  if (leftMinimum === undefined) return rightMinimum === undefined ? left : right;
  if (rightMinimum === undefined) return left;

  return compareVersions(rightMinimum, leftMinimum) > 0 ? right : left;
}

/**
 * Folds one template's plan into the half's builder, preserving the builder's own guarantees.
 *
 * Dependencies are the one thing left out: they are reconciled across the whole half by
 * `reconcileDependencies`, because the builder's per-generator strictness is the wrong rule for a
 * plan assembled from several templates.
 */
function absorb(builder: PlanBuilder, plan: GenerationPlan): void {
  for (const file of plan.files) {
    builder.addFile(file.path, file.contents, {
      format: file.format,
      ...(file.label === undefined ? {} : { label: file.label }),
    });
  }

  for (const script of plan.scripts) {
    builder.addScript(script.name, script.command);
  }

  for (const injection of plan.injections) {
    builder.addInjection(injection);
  }

  for (const entry of plan.env) {
    builder.addEnv(entry.key, entry.value, {
      ...(entry.comment === undefined ? {} : { comment: entry.comment }),
      secret: entry.secret,
    });
  }

  for (const note of plan.notes) {
    builder.addNote(note);
  }
}

function buildGeneratorContext(input: ScaffoldHalfRequest): GeneratorContext {
  const { request, project, templates } = input;
  const { context } = request;

  return {
    project,
    globals: context.globals(),
    reporter: context.reporter,
    prompts: new InteractivePromptRunner({ reporter: context.reporter, assumeYes: true }),
    templates,
    // Every read misses, because nothing exists yet. Wired up anyway so the context is a real
    // `GeneratorContext` and a template plan cannot tell it apart from an `add` run.
    readFile: (path) => context.fs.readTextIfExists(resolve(project.root, path)),
    resolve: (...segments) => resolve(project.root, ...segments),
  };
}

/**
 * Initialises a repository at the project root, above both halves.
 *
 * One repository rather than two: the halves are separate npm packages but they are one piece of
 * work, and a user who wanted them versioned apart can split them far more easily than they can
 * merge two histories.
 *
 * A missing or failing Git is a warning, never a failure. The project is complete by this point,
 * and refusing to finish over a version-control convenience would leave the user holding a whole
 * scaffold and a misleading error.
 */
async function initialiseRepository(
  request: StartRequest,
  root: string,
  index: number,
  total: number,
): Promise<void> {
  const { context } = request;
  const globals = context.globals();
  const task = context.reporter.step(index, total, 'Initialising a Git repository');

  if (globals.dryRun) {
    task.succeed('Would initialise a Git repository.');
    return;
  }

  const git = new GitCommandService(context.processes);

  if (!(await git.isAvailable())) {
    task.warn('Git is not installed — skipping repository setup.');
    return;
  }

  try {
    await git.init(root);
    task.succeed('Git repository initialised.');
  } catch (error) {
    task.warn('Could not initialise a Git repository. The project is unaffected.');
    context.reporter.debug(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
}

/** Notes the templates asked to be shown, de-duplicated across the two halves. */
function reportNotes(context: CommandContext, halves: readonly HalfOutcome[]): void {
  const notes = [...new Set(halves.flatMap((half) => half.result.notes))];

  if (notes.length === 0) {
    return;
  }

  context.reporter.blank();
  context.reporter.heading('Worth knowing');
  context.reporter.list(notes);
}

function describeLanguage(language: Language): string {
  return language === 'typescript' ? 'TypeScript' : 'JavaScript';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
