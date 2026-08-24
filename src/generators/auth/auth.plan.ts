import { posix } from 'node:path';

import { PlanBuilder } from '../../engine/plan-builder.js';
import { buildTokenTable } from '../../engine/template/token-table.js';
import { MARKERS } from '../../constants/markers.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { GenerationPlan } from '../../types/generation-plan.js';
import type { GeneratorContext } from '../../types/generator.js';
import type { LoadedTemplate, RenderedFile } from '../../types/template-manifest.js';

import type { AuthOptions } from './auth.schema.js';

const TEMPLATE_NAME = 'auth';

/**
 * Destinations that must NOT be prefixed with the project's source directory.
 *
 * The Prisma schema fragment belongs beside the project's existing schema, not inside `src/`.
 */
const PROJECT_ROOT_PREFIXES: readonly string[] = ['prisma/'];

/** Files generated only for a particular database choice. */
const DATABASE_FILES: Readonly<Record<AuthOptions['database'], readonly string[]>> = {
  mongoose: [
    'auth/repositories/mongoose-user-repository.ts',
    'auth/repositories/mongoose-refresh-token-repository.ts',
  ],
  prisma: [
    'auth/repositories/prisma-user-repository.ts',
    'auth/repositories/prisma-refresh-token-repository.ts',
    'prisma/auth.prisma',
  ],
};

/**
 * Packages required by each choice.
 *
 * Only *names* appear here. Every version range still comes from `templates/auth/template.json`,
 * so bumping a dependency stays a data change — the rule is that no version literal lives in
 * code, not that the set of packages can never depend on an option.
 */
const DATABASE_DEPENDENCIES: Readonly<Record<AuthOptions['database'], readonly string[]>> = {
  mongoose: ['mongoose'],
  prisma: ['@prisma/client'],
};

const DATABASE_DEV_DEPENDENCIES: Readonly<Record<AuthOptions['database'], readonly string[]>> = {
  mongoose: [],
  prisma: ['prisma'],
};

const ALWAYS_DEPENDENCIES: readonly string[] = ['jsonwebtoken', 'bcryptjs', 'cookie-parser'];

const ALWAYS_DEV_DEPENDENCIES: readonly string[] = ['@types/jsonwebtoken', '@types/cookie-parser'];

/**
 * Builds the auth plan.
 *
 * The template ships both database adapters and this decides which one reaches the project.
 * Rendering everything and then filtering keeps the alternatives in one template directory where
 * they can be reviewed side by side, rather than duplicating the shared four-fifths of the module
 * across two near-identical templates.
 */
export async function buildAuthPlan(
  options: AuthOptions,
  context: GeneratorContext,
): Promise<GenerationPlan> {
  const template = await context.templates.load(TEMPLATE_NAME);
  const tokens = buildTokenTable({ project: context.project });
  const rendered = await context.templates.render(template, tokens);

  const builder = new PlanBuilder({ generator: 'auth', root: context.project.root });

  for (const file of selectFiles(rendered, options)) {
    builder.addFile(destinationFor(file.destination, options.directory), file.contents, {
      // Prettier has no parser for `.prisma`, and the loader cannot know that.
      format: file.destination.endsWith('.ts'),
      label: file.destination,
    });
  }

  addDependencies(builder, template, options);
  addEnvironment(builder, tokens);
  addWiring(builder, options, context);

  for (const note of notesFor(options)) {
    builder.addNote(note);
  }

  return builder.build();
}

/** Drops the variants this project did not choose. */
function selectFiles(
  rendered: readonly RenderedFile[],
  options: AuthOptions,
): readonly RenderedFile[] {
  const excluded = new Set<string>();

  for (const [database, files] of Object.entries(DATABASE_FILES)) {
    if (database !== options.database) {
      for (const file of files) {
        excluded.add(file);
      }
    }
  }

  const selected = rendered.filter((file) => !excluded.has(normalizeSeparators(file.destination)));

  // A template restructured without updating the tables above would silently ship both
  // adapters, so the arithmetic is checked rather than assumed.
  const expectedRemoved = excluded.size;
  const actualRemoved = rendered.length - selected.length;

  if (actualRemoved !== expectedRemoved) {
    throw new AtlasError({
      code: ErrorCode.PlanInvalid,
      message: 'The auth template no longer matches the generator’s variant map.',
      details: [
        `expected to exclude ${String(expectedRemoved)} file(s), excluded ${String(actualRemoved)}`,
        ...[...excluded].sort(),
      ],
      hint: 'A template file was renamed or removed. Update DATABASE_FILES.',
    });
  }

  return selected;
}

function normalizeSeparators(path: string): string {
  return path.split('\\').join('/');
}

function destinationFor(destination: string, directory: string): string {
  const normalized = normalizeSeparators(destination);

  if (PROJECT_ROOT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return normalized;
  }

  if (directory === '' || directory === '.') {
    return normalized;
  }

  return posix.join(directory, normalized);
}

function addDependencies(
  builder: PlanBuilder,
  template: LoadedTemplate,
  options: AuthOptions,
): void {
  const production = [...ALWAYS_DEPENDENCIES, ...DATABASE_DEPENDENCIES[options.database]];

  const development = [...ALWAYS_DEV_DEPENDENCIES, ...DATABASE_DEV_DEPENDENCIES[options.database]];

  for (const name of production) {
    builder.addDependency(name, rangeFor(template, name, false));
  }

  for (const name of development) {
    builder.addDependency(name, rangeFor(template, name, true), { dev: true });
  }
}

/** A package the generator asks for but the manifest never declared is a packaging bug. */
function rangeFor(template: LoadedTemplate, name: string, dev: boolean): string {
  const source = dev ? template.manifest.devDependencies : template.manifest.dependencies;
  const range = source[name];

  if (range === undefined) {
    throw new AtlasError({
      code: ErrorCode.TemplateManifestInvalid,
      message: `templates/auth/template.json does not declare a version for "${name}".`,
      hint: 'Dependencies must be declared in template.json, never in generator code.',
    });
  }

  return range;
}

function addEnvironment(builder: PlanBuilder, tokens: Readonly<Record<string, string>>): void {
  const secret = tokens['__JWT_SECRET__'];

  builder.addEnv('JWT_SECRET', secret ?? '', {
    comment: 'Signing key for access and refresh tokens. Rotate this and every session ends.',
    secret: true,
  });
  builder.addEnv('JWT_ISSUER', 'atlas-auth', {
    comment: 'The `iss` claim, verified on every token.',
  });
  builder.addEnv('JWT_AUDIENCE', 'atlas-api', {
    comment: 'The `aud` claim, verified on every token.',
  });
  builder.addEnv('ACCESS_TOKEN_TTL_SECONDS', '900');
  builder.addEnv('REFRESH_TOKEN_TTL_SECONDS', '2592000');
  builder.addEnv('AUTH_COOKIE_NAME', 'refresh_token');
  builder.addEnv('AUTH_COOKIE_SECURE', 'true', {
    comment: 'Set to false only for local development over plain HTTP.',
  });
  builder.addEnv('BCRYPT_ROUNDS', '10', {
    comment:
      'bcryptjs is pure JavaScript and slower than the native binding, so 10 rather than 12. ' +
      'Raising it also means regenerating TIMING_DECOY_HASH in auth-service.ts.',
  });
}

/**
 * Requests the one edit to a file Atlas did not author.
 *
 * Applied at the marker when present; otherwise the engine reports it as manual work with the
 * exact line, because guessing where a router should mount in someone else's app file is how a
 * generator corrupts a project.
 */
function addWiring(builder: PlanBuilder, options: AuthOptions, context: GeneratorContext): void {
  const appFile = posix.join(context.project.layout.sourceDir, 'app.ts');
  const routerPath = destinationFor('auth/http/auth-routes.ts', options.directory);
  const specifier = `./${posix.relative(
    posix.dirname(normalizeSeparators(appFile)),
    routerPath.replace(/\.ts$/u, ''),
  )}${context.project.importSuffix}`;

  builder.addInjection({
    path: appFile,
    marker: MARKERS.routes,
    snippet: `app.use('/auth', createAuthRouter(authService));`,
    manualHint: `Mount the auth router: app.use('/auth', createAuthRouter(authService)) — createAuthRouter comes from '${specifier}'.`,
  });
}

function notesFor(options: AuthOptions): readonly string[] {
  const notes: string[] = [
    // `.env.example` is committed, so the engine writes a placeholder rather than a real value for
    // anything marked secret. Saying otherwise would be worse than saying nothing: a user who
    // believed a usable secret had been generated would ship the placeholder.
    "JWT_SECRET is a placeholder in .env.example. Generate one per environment with: node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\"",
    'JWT_SECRET must be at least 32 characters. The module refuses to start without a valid one, by design.',
    'The refresh token is issued as an httpOnly, SameSite=strict cookie scoped to /auth — it is deliberately not in the response body.',
    'Refresh tokens rotate on every use. Presenting a rotated token revokes the whole family and forces a re-login.',
    'Signup always creates a "user". Promote your first admin directly in the database — a role accepted from a request body is a privilege-escalation bug.',
    'Passwords are capped at 72 bytes, which is bcrypt’s hard limit. Anything longer would be silently truncated, so it is rejected instead.',
    'Assemble the module by wiring your chosen repositories — see the comment block in auth/index.ts.',
  ];

  if (options.database === 'prisma') {
    notes.push(
      'Merge prisma/auth.prisma into your schema, then run `prisma generate` and create a migration.',
    );
  } else {
    notes.push(
      'The refresh-token collection uses a TTL index, so MongoDB expires old rows itself.',
    );
  }

  return notes;
}
