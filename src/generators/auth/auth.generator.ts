import type { GenerationPlan } from '../../types/generation-plan.js';
import type {
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from '../../types/generator.js';

import { buildAuthPlan } from './auth.plan.js';
import { resolveAuthOptions } from './auth.prompts.js';
import { validateAuthOptions, type AuthOptions } from './auth.schema.js';

const META: GeneratorMeta = {
  name: 'auth',
  summary: 'JWT auth with signup, login, refresh rotation, bcrypt hashing and role middleware.',
  aliases: [],
  version: '2.0.0',
  argument: undefined,
  flags: [
    {
      flag: '--dir <path>',
      description: "Where to write the module. Defaults to the project's source directory.",
      defaultValue: undefined,
    },
    {
      flag: '--database <adapter>',
      description: 'Token store adapter: mongoose or prisma. Defaults to what the project uses.',
      defaultValue: undefined,
    },
  ],
  // Express only, as the template's own `requires` declares. The HTTP layer imports Express
  // types deliberately, which is honest precisely because the requirement is declared.
  frameworks: ['express'],
  languages: ['typescript'],
};

export const authGenerator: Generator<AuthOptions> = {
  meta: META,

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.language !== 'typescript') {
      return {
        supported: false,
        reason: 'The auth template is TypeScript, and this project is JavaScript.',
        hint: 'Add a tsconfig.json, or install typescript, and run this again.',
      };
    }

    if (context.project.framework !== 'express') {
      return {
        supported: false,
        reason: `The auth template targets Express, and this looks like ${context.project.framework}.`,
        hint: 'Nest and Fastify need different idioms; those generators are not written yet.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<AuthOptions> {
    return resolveAuthOptions(invocation, context);
  },

  validate(options: AuthOptions): void {
    validateAuthOptions(options);
  },

  generate(options: AuthOptions, context: GeneratorContext): Promise<GenerationPlan> {
    return buildAuthPlan(options, context);
  },
};
