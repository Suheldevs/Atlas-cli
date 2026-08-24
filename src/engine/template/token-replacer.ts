import { findTokens } from '../../constants/tokens.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { TokenValues } from '../../types/template-manifest.js';

export interface ReplaceOptions {
  readonly strict?: boolean | undefined;
}

/** Escapes a literal so it can be embedded in a pattern. Tokens are tame, callers may not be. */
function escapeForPattern(literal: string): string {
  return literal.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

/**
 * One alternation over every supplied key, longest first.
 *
 * Longest-first matters if two tokens ever share a prefix: alternation is ordered, so
 * `__ENTITY__` listed before `__ENTITY_NAME__` would claim the first ten characters of the
 * longer token and leave `_NAME__` behind as garbage.
 */
function buildPattern(keys: readonly string[]): RegExp {
  const ordered = [...keys].sort((a, b) => b.length - a.length);
  return new RegExp(ordered.map(escapeForPattern).join('|'), 'gu');
}

function substitute(subject: string, tokens: TokenValues): string {
  const keys = Object.keys(tokens);
  if (keys.length === 0) return subject;

  // A single pass with a callback, never a loop of `replace` calls. `String#replace` with a
  // function does not rescan what the callback returns, so a value that happens to look like a
  // token — an entity name containing `__ENTITY_NAME__`, a secret containing `__`, an env value
  // pasted from another template — is emitted verbatim instead of being substituted again.
  // That property is what makes substitution total and predictable: every token in the input is
  // replaced exactly once, and no output can depend on the order the keys were declared in.
  return subject.replace(buildPattern(keys), (match) => tokens[match] ?? match);
}

/**
 * Replaces every token in `contents` with its value.
 *
 * In strict mode an unresolved token is an error, listing the leftovers. That is the check that
 * turns a template typo into a clear failure at generation time rather than a `__ENTITY_NAM__`
 * discovered weeks later in a user's repository.
 */
export function replaceTokens(
  contents: string,
  tokens: TokenValues,
  options: ReplaceOptions = {},
): string {
  const result = substitute(contents, tokens);

  if (options.strict === true) {
    // Scanning the *input* rather than the output, so the diagnostic can only ever blame the
    // template. A replacement value containing token-like text is legal and already final.
    const unresolved = findTokens(contents).filter((token) => !Object.hasOwn(tokens, token));

    if (unresolved.length > 0) {
      throw new AtlasError({
        code: ErrorCode.GenerationFailed,
        message: 'A template referenced tokens that have no value.',
        hint: 'Check the spelling against the vocabulary in src/constants/tokens.ts.',
        details: unresolved,
      });
    }
  }

  return result;
}

/**
 * The same substitution for a destination path, so a template can name files after the entity it
 * generates (`src/services/__ENTITY_KEBAB__.service.ts`).
 *
 * Never strict: a path is not the place to discover a typo, and the file's contents are checked in
 * the same render anyway.
 */
export function replaceTokensInPath(path: string, tokens: TokenValues): string {
  return substitute(path, tokens);
}
