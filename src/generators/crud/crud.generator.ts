import { assertValidEntityName } from '../../engine/template/token-table.js';
import type { GenerationPlan } from '../../types/generation-plan.js';
import type {
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from '../../types/generator.js';
import { buildPlanFromTemplate } from '../template-plan.js';

import { readCrudFlags, validateCrudOptions, type CrudOptions } from './crud.schema.js';

const META: GeneratorMeta = {
  name: 'crud',
  summary: 'A CRUD resource for one entity: model, Zod schemas, service, controller and router.',
  aliases: [],
  version: '1.0.0',
  argument: {
    name: 'entity',
    description: 'Name of the entity, e.g. User',
    required: true,
  },
  flags: [
    {
      flag: '--dir <path>',
      description: "Where to write the files. Defaults to the project's source directory.",
      defaultValue: undefined,
    },
  ],
  // Express only: the controller and router are written against Express types, which the
  // template's own `requires` declares.
  frameworks: ['express'],
  languages: ['typescript'],
};

/** Asked only when a caller supplied no positional argument. */
const ENTITY_FALLBACK = 'Resource';

const NOTES: readonly string[] = [
  'Mount the router where you register your routes: app.use("/<resource>", <resource>Router).',
  'The service keeps records in a Map so the endpoints work immediately — swap it for your database.',
  'Errors are thrown, not caught. Add an error middleware that renders ZodError as 400 and reads the `status` on the not-found error.',
];

/**
 * The CRUD generator.
 *
 * One template, one positional argument, and the token table does the rest: every casing of the
 * name the user typed — `User`, `user`, `users`, `user-profile`, `USER_PROFILE` — comes from that
 * single string, so the class, the file name and the route can never disagree.
 */
export const crudGenerator: Generator<CrudOptions> = {
  meta: META,

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.language !== 'typescript') {
      return {
        supported: false,
        reason: 'The crud template is TypeScript, and this project is JavaScript.',
        hint: 'Add a tsconfig.json, or install typescript, and run this again.',
      };
    }

    if (context.project.framework !== 'express') {
      return {
        supported: false,
        reason: `The crud template targets Express, and this looks like ${context.project.framework}.`,
        hint: 'Run `atlas info` to see what Atlas detected about this project.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<CrudOptions> {
    const { directory } = readCrudFlags(invocation.flags);
    const supplied = invocation.argument?.trim() ?? '';

    // Commander enforces the positional, so this only runs for a programmatic caller. Asking is
    // still better than failing: the question has a default, so it is answerable without a human.
    const entity =
      supplied === ''
        ? await context.prompts.text({
            message: 'Name of the entity to generate',
            defaultValue: ENTITY_FALLBACK,
            validate: (value) => (value.trim() === '' ? 'An entity name is required.' : undefined),
          })
        : supplied;

    // Before anything is derived from it, so `atlas crud 123bad` fails as usage rather than
    // producing a file called `123.model.ts`.
    assertValidEntityName(entity);

    return {
      entity,
      directory: directory ?? context.project.layout.sourceDir,
    };
  },

  validate(options: CrudOptions): void {
    validateCrudOptions(options);
  },

  generate(options: CrudOptions, context: GeneratorContext): Promise<GenerationPlan> {
    return buildPlanFromTemplate({
      context,
      generator: META.name,
      template: 'crud',
      entity: options.entity,
      destinationPrefix: options.directory,
      notes: NOTES,
    });
  },
};
