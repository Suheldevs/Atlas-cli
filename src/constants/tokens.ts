/**
 * The token vocabulary templates may use.
 *
 * Substitution is plain string replacement — there is no template engine here and adding one is a
 * deliberate non-goal. What replaces an engine's validation is this file: one canonical list, so a
 * token can be spelled once and checked everywhere, and a template referring to something outside
 * the list is a bug Atlas can name rather than a stray `__ENTITY_NAM__` shipped into a user's
 * source file.
 *
 * Tokens are `__UPPER_SNAKE__` because that form is a valid TypeScript identifier: a template can
 * write `class __ENTITY_NAME__Service` and still parse, type-check and format before generation.
 * That is why the vocabulary is a closed set of names rather than an expression syntax.
 */

export const TOKENS = {
  /** Project-level facts, resolved from the detected `ProjectContext`. */
  projectName: '__PROJECT_NAME__',
  sourceDir: '__SOURCE_DIR__',
  importSuffix: '__IMPORT_SUFFIX__',
  moduleSystem: '__MODULE_SYSTEM__',
  packageManager: '__PACKAGE_MANAGER__',
  database: '__DATABASE__',
  framework: '__FRAMEWORK__',

  /** Every casing of the entity a generator was invoked for, derived from one user-typed name. */
  entityName: '__ENTITY_NAME__',
  entityCamel: '__ENTITY_CAMEL__',
  entityKebab: '__ENTITY_KEBAB__',
  entitySnake: '__ENTITY_SNAKE__',
  entityConstant: '__ENTITY_CONSTANT__',
  entityTitle: '__ENTITY_TITLE__',
  entityPlural: '__ENTITY_PLURAL__',
  entityPluralCamel: '__ENTITY_PLURAL_CAMEL__',
  entityPluralKebab: '__ENTITY_PLURAL_KEBAB__',
  entityPluralConstant: '__ENTITY_PLURAL_CONSTANT__',

  /** Generated secrets. Never a literal default; see `token-table.ts`. */
  jwtSecret: '__JWT_SECRET__',
} as const;

/** A key of `TOKENS`, for call sites that name a token symbolically. */
export type TokenKey = keyof typeof TOKENS;

/** The literal token string of any known token. */
export type KnownToken = (typeof TOKENS)[TokenKey];

export const KNOWN_TOKENS: readonly string[] = Object.values(TOKENS);

const KNOWN_TOKEN_SET = new Set<string>(KNOWN_TOKENS);

/**
 * Matches any `__UPPER_SNAKE__` token, known or not.
 *
 * Global on purpose — every consumer scans whole files — and only ever used through `matchAll`,
 * which works on a copy and so cannot leak `lastIndex` between callers.
 */
export const TOKEN_PATTERN = /__[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*__/gu;

/** Distinct tokens appearing in `contents`, in order of first appearance. */
export function findTokens(contents: string): readonly string[] {
  const found = new Set<string>();

  for (const match of contents.matchAll(TOKEN_PATTERN)) {
    found.add(match[0]);
  }

  return [...found];
}

/**
 * Tokens in `contents` that are not part of the vocabulary.
 *
 * This is the function that makes a misspelled token a CI failure instead of a mystery in
 * somebody's generated code: `__ENTITY_NAM__` has no value to substitute, so without this check it
 * would survive substitution silently and be written to disk verbatim.
 */
export function findUnknownTokens(contents: string): readonly string[] {
  return findTokens(contents).filter((token) => !KNOWN_TOKEN_SET.has(token));
}
