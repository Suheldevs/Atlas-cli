import { resolve } from 'node:path';

import { GenerationEngine } from '../engine/generation-engine.js';
import { DependencyInstaller } from '../engine/deps/index.js';
import { Formatter } from '../engine/format/index.js';
import { TemplateLoader } from '../engine/template/template-loader.js';
import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import { createConflictPrompt, nonInteractiveConflictAsk } from '../prompts/conflict.prompt.js';
import { InteractivePromptRunner } from '../prompts/prompt-runner.js';
import type { RegisteredGenerator } from '../registry/generator-registry.js';
import { createPackageManagerService } from '../services/package-manager.service.js';
import type { GenerationResult } from '../types/generation-plan.js';
import type { GeneratorContext, GeneratorInvocation } from '../types/generator.js';
import type { ProjectContext } from '../types/project-context.js';
import { describeCount } from '../utils/text.js';

import type { CommandContext } from './register-commands.js';

export interface RunGeneratorRequest {
  readonly context: CommandContext;
  readonly entry: RegisteredGenerator;
  readonly invocation: GeneratorInvocation;
}

/**
 * Drives one generator through its lifecycle.
 *
 * This is the only place the contract's ordering is enforced — detect, prompt, validate,
 * generate, apply, post-generate — so a generator cannot accidentally skip a step and no
 * command has to know the sequence. Commands stay what they should be: argument parsing.
 */
export async function runGenerator(request: RunGeneratorRequest): Promise<void> {
  const { context, entry, invocation } = request;
  const { reporter } = context;
  const globals = context.globals();
  const generator = entry.generator;

  const detecting = reporter.task('Detecting project');
  const project = await context.scanner.requireProject(globals.cwd);
  detecting.succeed(`Detected ${describeProject(project)}`);

  const generatorContext = buildGeneratorContext(context, project);

  const verdict = await generator.detect(generatorContext);
  if (!verdict.supported) {
    throw new AtlasError({
      code: ErrorCode.UnsupportedFramework,
      message: `The ${generator.meta.name} generator does not support this project.`,
      ...(verdict.reason === undefined ? {} : { details: [verdict.reason] }),
      ...(verdict.hint === undefined ? {} : { hint: verdict.hint }),
    });
  }

  const options = await generator.prompt(invocation, generatorContext);
  generator.validate(options, generatorContext);

  const plan = await generator.generate(options, generatorContext);
  const extraDependencies = await generator.installDependencies?.(options, generatorContext);

  if (globals.dryRun) {
    reporter.blank();
    reporter.warn('Dry run — nothing will be written.');
  }

  const engine = buildEngine(context, project);
  const result = await engine.apply({
    plan,
    project,
    dryRun: globals.dryRun,
    assumeYes: globals.yes,
    ...(extraDependencies === undefined ? {} : { extraDependencies }),
  });

  reportResult(context, result);

  await generator.postGenerate?.(options, generatorContext, result);
}

function describeProject(project: ProjectContext): string {
  const parts = [project.framework === 'unknown' ? 'a Node project' : project.framework];
  parts.push(project.language === 'typescript' ? 'TypeScript' : 'JavaScript');
  parts.push(project.moduleSystem.toUpperCase());
  return parts.join(' · ');
}

function buildGeneratorContext(context: CommandContext, project: ProjectContext): GeneratorContext {
  const globals = context.globals();

  return {
    project,
    globals,
    reporter: context.reporter,
    prompts: new InteractivePromptRunner({
      reporter: context.reporter,
      assumeYes: globals.yes,
    }),
    templates: new TemplateLoader({ fs: context.fs, reporter: context.reporter }),
    // Reads resolve against the project, so a generator can pass a relative path without
    // knowing where it is running from.
    readFile: (path) => context.fs.readTextIfExists(resolve(project.root, path)),
    resolve: (...segments) => resolve(project.root, ...segments),
  };
}

function buildEngine(context: CommandContext, project: ProjectContext): GenerationEngine {
  const globals = context.globals();

  const prompts = new InteractivePromptRunner({
    reporter: context.reporter,
    assumeYes: globals.yes,
  });

  return new GenerationEngine({
    fs: context.fs,
    clock: context.clock,
    reporter: context.reporter,
    formatter: new Formatter({ reporter: context.reporter }),
    installer: new DependencyInstaller({
      // The project's own package manager, not whatever Atlas was installed with.
      packageManager: createPackageManagerService(project.packageManager, context.processes),
      reporter: context.reporter,
    }),
    ask: prompts.interactive
      ? createConflictPrompt({ reporter: context.reporter, prompts, color: globals.color })
      : nonInteractiveConflictAsk,
  });
}

/**
 * Reports what happened.
 *
 * Skipped files are listed rather than omitted: after a re-run, "nothing changed" is the
 * answer the user is looking for, and silence is indistinguishable from a broken generator.
 */
function reportResult(context: CommandContext, result: GenerationResult): void {
  const { reporter } = context;
  const verb = result.dryRun ? 'Would write' : 'Wrote';

  reporter.blank();

  const written = result.files.filter((file) => file.outcome !== 'skipped');
  const skipped = result.files.filter((file) => file.outcome === 'skipped');

  if (written.length > 0) {
    reporter.heading(`${verb} ${describeCount(written.length, 'file')}`);
    for (const file of written) {
      reporter.success(`${file.outcome.padEnd(11)} ${file.path}`);
      if (file.backupPath !== undefined) {
        reporter.detail(`backup: ${file.backupPath}`);
      }
    }
  }

  if (skipped.length > 0) {
    reporter.blank();
    reporter.heading(`Left alone (${String(skipped.length)})`);
    for (const file of skipped) {
      reporter.plain(`  ${file.path}`);
    }
  }

  if (result.installed.length > 0) {
    reporter.blank();
    reporter.heading(
      `Installed ${describeCount(result.installed.length, 'dependency', 'dependencies')}`,
    );
    reporter.list(result.installed.map((entry) => `${entry.name}@${entry.range}`));
  }

  if (result.manual.length > 0) {
    reporter.blank();
    reporter.warn('Some wiring could not be applied automatically:');
    for (const injection of result.manual) {
      reporter.errorDetail(`${injection.path} — ${injection.manualHint}`);
      reporter.errorDetail(`  add: ${injection.snippet}`);
    }
  }

  if (result.notes.length > 0) {
    reporter.blank();
    reporter.heading('Next steps');
    reporter.list(result.notes);
  }

  reporter.blank();
  reporter.success(result.dryRun ? 'Dry run complete. Nothing was written.' : 'Done.');
}
