import { posix } from 'node:path';

import { TOKENS } from '../../constants/tokens.js';
import { PlanBuilder } from '../../engine/plan-builder.js';
import { buildTokenTable } from '../../engine/template/token-table.js';
import type { GenerationPlan } from '../../types/generation-plan.js';
import type { GeneratorContext } from '../../types/generator.js';

import type { PrismaOptions, PrismaProvider } from './prisma.schema.js';

const TEMPLATE_NAME = 'prisma';

const SCHEMA_PATH = 'prisma/schema.prisma';

/**
 * Destinations that must NOT be prefixed with the chosen source directory. The Prisma CLI looks
 * for `prisma/schema.prisma` from the project root, so the schema cannot live under `src/`.
 */
const PROJECT_ROOT_PREFIXES: readonly string[] = ['prisma/'];

/** Shown in `.env` above the placeholder, so the shape of the URL is not a guessing game. */
const EXAMPLE_URLS: Readonly<Record<PrismaProvider, string>> = {
  postgresql: 'postgresql://user:password@localhost:5432/mydb?schema=public',
  mysql: 'mysql://user:password@localhost:3306/mydb',
  sqlite: 'file:./dev.db',
};

/**
 * Builds the prisma plan.
 *
 * Written by hand rather than through `buildPlanFromTemplate` for two reasons that helper cannot
 * express: the schema has to skip the source-directory prefix, and `.prisma` has to skip the
 * formatter, which prettier has no parser for.
 */
export async function buildPrismaPlan(
  options: PrismaOptions,
  context: GeneratorContext,
): Promise<GenerationPlan> {
  const template = await context.templates.load(TEMPLATE_NAME);

  // `__DATABASE__` otherwise carries what detection found, which is what the project uses today,
  // not the provider the user asked for.
  const tokens = buildTokenTable({
    project: context.project,
    extra: { [TOKENS.database]: options.provider },
  });

  const rendered = await context.templates.render(template, tokens);
  const builder = new PlanBuilder({ generator: TEMPLATE_NAME, root: context.project.root });

  for (const file of rendered) {
    builder.addFile(destinationFor(file.destination, options.directory), file.contents, {
      format: file.destination.endsWith('.ts'),
      label: file.destination,
    });
  }

  for (const [name, range] of Object.entries(template.manifest.dependencies)) {
    builder.addDependency(name, range);
  }

  for (const [name, range] of Object.entries(template.manifest.devDependencies)) {
    builder.addDependency(name, range, { dev: true });
  }

  const example = EXAMPLE_URLS[options.provider];

  builder.addEnv('DATABASE_URL', example, {
    comment: `Prisma connection string, e.g. ${example}`,
    // A connection string carries the database password, so it is written as a placeholder.
    secret: true,
  });

  for (const note of notesFor(options, await hasExistingSchema(context))) {
    builder.addNote(note);
  }

  return builder.build();
}

function destinationFor(destination: string, directory: string): string {
  const normalized = destination.split('\\').join('/');

  if (PROJECT_ROOT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return normalized;
  }

  if (directory === '' || directory === '.') {
    return normalized;
  }

  return posix.join(directory, normalized);
}

/**
 * Reported rather than prevented.
 *
 * The engine's conflict resolution already owns the decision about an existing file; all this
 * adds is a note, because someone whose whole data model lives in that file needs to be told
 * before they pick "overwrite".
 */
async function hasExistingSchema(context: GeneratorContext): Promise<boolean> {
  return (await context.readFile(context.resolve('prisma', 'schema.prisma'))) !== undefined;
}

function notesFor(options: PrismaOptions, schemaExists: boolean): readonly string[] {
  const notes: string[] = [
    `DATABASE_URL is a placeholder in .env — replace it with your real ${options.provider} connection string.`,
    'Create the database and the first migration with: npx prisma migrate dev --name init',
    'Re-run `npx prisma generate` after every schema change, or the client types go stale.',
    "Import the client with `import { prisma } from './db/index.js'` (drop the extension under CommonJS).",
  ];

  if (options.provider === 'sqlite') {
    notes.push('SQLite keeps the database in a file, so DATABASE_URL is a path: file:./dev.db');
  }

  if (schemaExists) {
    notes.push(
      `${SCHEMA_PATH} already exists. Keep yours and copy across only the datasource block if it ` +
        'differs — overwriting it would take your models with it.',
    );
  }

  return notes;
}
