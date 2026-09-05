import { join } from 'node:path';

import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { FileSystemService } from '../../services/filesystem.service.js';
import type { Language } from '../../types/project-context.js';

/**
 * Where a template's files land inside its half.
 *
 * `root` is for the templates that describe a whole package — manifest, tsconfig, entry point —
 * and `source` for the feature templates, which describe their files relative to `src/` and
 * would otherwise overwrite the package root.
 */
export type TemplatePlacement = 'root' | 'source';

export interface TemplateStep {
  /** Directory name under `templates/`. */
  readonly template: string;
  readonly placement: TemplatePlacement;
  /** Raw entity name, for the templates that generate per-entity code. */
  readonly entity: string | undefined;
}

/**
 * The resource the generated CRUD module is built around.
 *
 * Fixed rather than prompted for: `start` already asks one question, and a scaffold's example
 * resource exists to be read and replaced, not agonised over. `Item` is deliberately
 * characterless — nobody will mistake it for something the project needs.
 */
export const DEFAULT_ENTITY = 'Item';

/**
 * Which templates make up each half, per language.
 *
 * A plain lookup table, not a series of conditionals, because that is the shape the question
 * actually has: the two languages differ only in which directories are read. The TypeScript
 * column reuses the existing `auth`, `crud`, `upload` and `logger` templates unchanged — they
 * were already TypeScript — while the JavaScript column names their `-js` counterparts.
 */
const SERVER_TEMPLATES: Readonly<Record<Language, readonly TemplateStep[]>> = {
  javascript: [
    { template: 'server-base-js', placement: 'root', entity: undefined },
    { template: 'auth-js', placement: 'source', entity: undefined },
    { template: 'crud-js', placement: 'source', entity: DEFAULT_ENTITY },
    { template: 'upload-js', placement: 'source', entity: undefined },
    { template: 'logger-js', placement: 'source', entity: undefined },
  ],
  typescript: [
    { template: 'server-base-ts', placement: 'root', entity: undefined },
    { template: 'auth', placement: 'source', entity: undefined },
    { template: 'crud', placement: 'source', entity: DEFAULT_ENTITY },
    { template: 'upload', placement: 'source', entity: undefined },
    { template: 'logger', placement: 'source', entity: undefined },
  ],
};

const CLIENT_TEMPLATES: Readonly<Record<Language, readonly TemplateStep[]>> = {
  javascript: [{ template: 'client-react-js', placement: 'root', entity: undefined }],
  typescript: [{ template: 'client-react-ts', placement: 'root', entity: undefined }],
};

export function serverTemplates(language: Language): readonly TemplateStep[] {
  return SERVER_TEMPLATES[language];
}

export function clientTemplates(language: Language): readonly TemplateStep[] {
  return CLIENT_TEMPLATES[language];
}

/**
 * Fails before anything is written when a template the blueprint names is not on disk.
 *
 * The loader would raise the same class of error later, but by then half the project exists and
 * the user is left deciding what to do with it. Checked here, all missing templates are named
 * at once and the directory the user asked for is still untouched.
 */
export async function assertTemplatesAvailable(
  fs: FileSystemService,
  templatesRoot: string,
  steps: readonly TemplateStep[],
): Promise<void> {
  const missing: string[] = [];

  for (const step of steps) {
    if (!(await fs.exists(join(templatesRoot, step.template)))) {
      missing.push(step.template);
    }
  }

  if (missing.length === 0) {
    return;
  }

  throw new AtlasError({
    code: ErrorCode.TemplateNotFound,
    message: `This build of Atlas is missing ${missing.length === 1 ? 'a template' : 'templates'} that \`start\` needs.`,
    hint: `Atlas looked in ${templatesRoot}. Reinstalling should restore the shipped templates.`,
    details: missing.map((name) => `${name} (expected at ${join(templatesRoot, name)})`),
  });
}
