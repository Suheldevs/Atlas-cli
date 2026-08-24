import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';

import { TOKENS } from '../../constants/tokens.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { ProjectContext } from '../../types/project-context.js';
import type { TokenValues } from '../../types/template-manifest.js';
import {
  pluralize,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toScreamingSnakeCase,
  toSnakeCase,
  toTitleCase,
} from '../../utils/casing.js';

export interface TokenTableInput {
  readonly project: ProjectContext;
  /** The raw entity name a user typed, e.g. `user profile`. Absent for entity-less templates. */
  readonly entity?: string | undefined;
  /** Extra or overriding token values a generator supplies. */
  readonly extra?: TokenValues | undefined;
}

/**
 * Reserved words, plus the primitive type names and globals that a generated declaration would
 * shadow. An entity called `string` produces `class String`, which compiles and then confuses
 * every reader of the file — cheaper to refuse at the command line than to explain later.
 */
const RESERVED_WORDS = new Set([
  'any',
  'as',
  'async',
  'await',
  'bigint',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'constructor',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'let',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'string',
  'super',
  'switch',
  'symbol',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'unknown',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/u;

const NAME_HINT = 'Use letters and digits, starting with a letter — for example `user` or `order`.';

/**
 * Rejects an entity name that cannot become a TypeScript identifier.
 *
 * Checked once, at the boundary, because every downstream form — class name, file name, constant —
 * is derived from this string. A name that survives here cannot produce unparseable output later.
 */
export function assertValidEntityName(entity: string): void {
  const trimmed = entity.trim();

  if (trimmed === '') {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: 'An entity name is required.',
      hint: NAME_HINT,
    });
  }

  const identifier = toPascalCase(trimmed);

  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: `'${trimmed}' cannot be turned into a TypeScript identifier.`,
      hint: NAME_HINT,
      details: [`It converts to '${identifier}', which is not a valid name.`],
    });
  }

  if (RESERVED_WORDS.has(toCamelCase(trimmed))) {
    throw new AtlasError({
      code: ErrorCode.InvalidUsage,
      message: `'${trimmed}' is a reserved word and cannot be used as an entity name.`,
      hint: NAME_HINT,
    });
  }
}

function entityTokens(entity: string): TokenValues {
  const name = toPascalCase(entity);
  const plural = pluralize(name);

  return {
    [TOKENS.entityName]: name,
    [TOKENS.entityCamel]: toCamelCase(name),
    [TOKENS.entityKebab]: toKebabCase(name),
    [TOKENS.entitySnake]: toSnakeCase(name),
    [TOKENS.entityConstant]: toScreamingSnakeCase(name),
    [TOKENS.entityTitle]: toTitleCase(name),
    [TOKENS.entityPlural]: plural,
    [TOKENS.entityPluralCamel]: toCamelCase(plural),
    [TOKENS.entityPluralKebab]: toKebabCase(plural),
    [TOKENS.entityPluralConstant]: toScreamingSnakeCase(plural),
  };
}

/**
 * The secret written into generated auth code.
 *
 * This is the one token that must never be predictable. A fixed placeholder, a timestamp, or
 * anything derived from the project name is a real vulnerability the moment a user forgets to
 * replace it — and users do forget, which is why the generated default is already safe. 48 bytes
 * exceeds the block size of the HMAC families used for JWTs, so the key is never the weak link.
 */
function generateSecret(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * Every token value a template render may need.
 *
 * Entity tokens are derived from the single name the user typed, so `User`, `users`, `user-profile`
 * and `USER_PROFILE` can never disagree with each other. When no entity is given they are omitted
 * rather than blanked: an unresolved `__ENTITY_NAME__` must surface as a strict-mode failure, not
 * as an empty string silently welded into somebody's source file.
 */
export function buildTokenTable(input: TokenTableInput): TokenValues {
  const { project } = input;

  // Before anything is derived or generated, so a bad name fails as usage rather than half-way
  // through a render.
  if (input.entity !== undefined) {
    assertValidEntityName(input.entity);
  }

  const projectTokens: TokenValues = {
    [TOKENS.projectName]: project.manifest?.name ?? basename(project.root),
    [TOKENS.sourceDir]: project.layout.sourceDir,
    [TOKENS.importSuffix]: project.importSuffix,
    [TOKENS.moduleSystem]: project.moduleSystem,
    [TOKENS.packageManager]: project.packageManager,
    [TOKENS.database]: project.database,
    [TOKENS.framework]: project.framework,
    [TOKENS.jwtSecret]: generateSecret(),
  };

  return {
    ...projectTokens,
    ...(input.entity === undefined ? {} : entityTokens(input.entity.trim())),
    // Last, so a generator that knows better than the defaults wins.
    ...input.extra,
  };
}
