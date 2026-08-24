import type { GenerationPlan } from '../../types/generation-plan.js';
import type {
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from '../../types/generator.js';

import { buildPrismaPlan } from './prisma.plan.js';
import {
  DEFAULT_PROVIDER,
  readPrismaFlags,
  validatePrismaOptions,
  type PrismaOptions,
  type PrismaProvider,
} from './prisma.schema.js';

const META: GeneratorMeta = {
  name: 'prisma',
  summary: 'Prisma schema and a shared client that survives dev-server reloads.',
  aliases: [],
  version: '1.0.0',
  argument: undefined,
  flags: [
    {
      flag: '--dir <path>',
      description: "Where to write db/. Defaults to the project's source directory.",
      defaultValue: undefined,
    },
    {
      flag: '--provider <name>',
      description: 'Datasource provider: postgresql (default), mysql or sqlite.',
      // Left undefined so an absent flag is distinguishable from a chosen value; the default is
      // applied by the prompt instead.
      defaultValue: undefined,
    },
  ],
  // Prisma is not web-specific: the schema and the client are the same in Express, Nest or a
  // script with no HTTP layer at all.
  frameworks: [],
  languages: ['typescript'],
};

export const prismaGenerator: Generator<PrismaOptions> = {
  meta: META,

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.language !== 'typescript') {
      return {
        supported: false,
        reason: 'The prisma template is TypeScript, and this project is JavaScript.',
        hint: 'Add a tsconfig.json, or install typescript, and run this again.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<PrismaOptions> {
    const flags = readPrismaFlags(invocation.flags);

    return {
      directory: flags.directory ?? context.project.layout.sourceDir,
      provider: flags.provider ?? (await askProvider(context)),
    };
  },

  validate(options: PrismaOptions): void {
    validatePrismaOptions(options);
  },

  generate(options: PrismaOptions, context: GeneratorContext): Promise<GenerationPlan> {
    return buildPrismaPlan(options, context);
  },
};

function askProvider(context: GeneratorContext): Promise<PrismaProvider> {
  return context.prompts.select<PrismaProvider>({
    message: 'Which database will Prisma connect to?',
    choices: [
      {
        label: 'PostgreSQL',
        value: 'postgresql',
        description: 'Works with Supabase, Neon, RDS and a local postgres.',
      },
      {
        label: 'MySQL',
        value: 'mysql',
        description: 'Also covers MariaDB and PlanetScale.',
      },
      {
        label: 'SQLite',
        value: 'sqlite',
        description: 'A local file. Handy for prototypes; no array or enum columns.',
      },
    ],
    defaultValue: DEFAULT_PROVIDER,
  });
}
