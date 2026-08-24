import { posix } from 'node:path';

import { PlanBuilder } from '../engine/plan-builder.js';
import { buildTokenTable } from '../engine/template/token-table.js';
import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type { GenerationPlan } from '../types/generation-plan.js';
import type { GeneratorContext } from '../types/generator.js';
import type { TokenValues } from '../types/template-manifest.js';

export interface TemplatePlanRequest {
  readonly context: GeneratorContext;
  /** Generator name, used in plan errors and progress output. */
  readonly generator: string;
  /** Template directory name under `templates/`. */
  readonly template: string;
  /** Raw entity name, for templates that generate per-entity code. */
  readonly entity?: string | undefined;
  /** Extra or overriding tokens. */
  readonly tokens?: TokenValues | undefined;
  /**
   * Prefixed to every destination. Defaults to the project's source directory, so a template
   * describes its files relative to `src/` and still lands correctly in a flat project.
   */
  readonly destinationPrefix?: string | undefined;
  readonly notes?: readonly string[] | undefined;
}

/**
 * Turns a template into a plan.
 *
 * Every template-backed generator does the same five things — load the manifest, build the
 * token table, render, declare the manifest's dependencies and scripts, prefix destinations —
 * so it lives here once. A generator with nothing special to do is then a few lines of
 * metadata, which is the point: the interesting part of a generator should be its decisions,
 * not its plumbing.
 */
export async function buildPlanFromTemplate(request: TemplatePlanRequest): Promise<GenerationPlan> {
  const { context, generator, template: templateName } = request;

  const template = await context.templates.load(templateName);

  const tokens = buildTokenTable({
    project: context.project,
    ...(request.entity === undefined ? {} : { entity: request.entity }),
    ...(request.tokens === undefined ? {} : { extra: request.tokens }),
  });

  const rendered = await context.templates.render(template, tokens);

  if (rendered.length === 0) {
    throw new AtlasError({
      code: ErrorCode.TemplateNotFound,
      message: `Template "${templateName}" produced no files.`,
      hint: 'The template directory is present but empty. This is a packaging problem.',
    });
  }

  const builder = new PlanBuilder({ generator, root: context.project.root });
  const prefix = request.destinationPrefix ?? context.project.layout.sourceDir;

  for (const file of rendered) {
    builder.addFile(withPrefix(prefix, file.destination), file.contents, {
      format: file.format,
      label: file.destination,
    });
  }

  const { manifest } = template;

  for (const [name, range] of Object.entries(manifest.dependencies)) {
    builder.addDependency(name, range);
  }

  for (const [name, range] of Object.entries(manifest.devDependencies)) {
    builder.addDependency(name, range, { dev: true });
  }

  for (const [name, command] of Object.entries(manifest.scripts)) {
    builder.addScript(name, command);
  }

  for (const note of request.notes ?? []) {
    builder.addNote(note);
  }

  return builder.build();
}

/**
 * Joins with POSIX separators regardless of platform: these are plan-relative destinations,
 * and `PlanBuilder.path` resolves them against the project root for the host afterwards.
 */
function withPrefix(prefix: string, destination: string): string {
  const normalized = destination.split('\\').join('/');

  if (prefix === '' || prefix === '.') {
    return normalized;
  }

  return posix.join(prefix, normalized);
}
