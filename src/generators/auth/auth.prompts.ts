import type { GeneratorContext, GeneratorInvocation } from '../../types/generator.js';

import { readAuthFlags, type AuthDatabase, type AuthOptions } from './auth.schema.js';

/**
 * Resolves the generator's options.
 *
 * Each question is only asked when the flag was absent, and each has a default drawn from
 * detection — so `--yes`, CI and a piped stdin all produce the same result as pressing Enter.
 */
export async function resolveAuthOptions(
  invocation: GeneratorInvocation,
  context: GeneratorContext,
): Promise<AuthOptions> {
  const flags = readAuthFlags(invocation.flags);

  const database = flags.database ?? (await askDatabase(context));

  return {
    directory: flags.directory ?? context.project.layout.sourceDir,
    database,
  };
}

/**
 * Defaults to whatever the project already uses. A project with Prisma installed almost
 * certainly wants the Prisma repositories, and asking it to confirm is friction.
 */
async function askDatabase(context: GeneratorContext): Promise<AuthDatabase> {
  const detected: AuthDatabase | undefined =
    context.project.database === 'prisma'
      ? 'prisma'
      : context.project.database === 'mongoose'
        ? 'mongoose'
        : undefined;

  if (detected !== undefined) {
    context.reporter.debug(`using detected database adapter: ${detected}`);
    return detected;
  }

  return context.prompts.select<AuthDatabase>({
    message: 'Which database adapter should the token store use?',
    choices: [
      {
        label: 'Mongoose (MongoDB)',
        value: 'mongoose',
        description: 'Schemas and models, with a TTL index expiring refresh tokens.',
      },
      {
        label: 'Prisma',
        value: 'prisma',
        description: 'Typed client; a schema fragment is generated for you to merge.',
      },
    ],
    defaultValue: 'mongoose',
  });
}
