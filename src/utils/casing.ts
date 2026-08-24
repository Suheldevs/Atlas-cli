/**
 * Case conversion and English inflection. Pure functions, no dependencies.
 *
 * Every generated class, file name, route segment and constant name is derived here, so a wrong
 * answer ends up in somebody's repository permanently. The converters therefore accept any input
 * shape — `user profile`, `user-profile`, `USER_PROFILE`, `userHTTPRequest` — and all normalise
 * through the single `splitWords` helper, so they can never disagree about where a word ends.
 *
 * The inflection rules are a pragmatic subset of English, not a full inflector. Two kinds of rule
 * live here and the distinction is deliberate:
 *
 * - Genuinely regular, computed from the spelling: `-y` → `-ies`, sibilants → `-es`, default `-s`.
 * - Lexically conditioned, and therefore table-driven: `-f` → `-ves` (`leaf`/`leaves` but
 *   `roof`/`roofs`), `-o` → `-oes` (`hero`/`heroes` but `photo`/`photos`), and singulars ending
 *   in `-ie` (`movie`/`movies`, which the `-ies` → `-y` rule would otherwise mangle into `movy`).
 *
 * English has more counter-examples than rules in those three cases, so guessing is worse than a
 * list. The tables below are the escape hatch: anything Atlas gets wrong is fixed by adding a row,
 * which is a cheaper and more honest answer than shipping a dictionary inside a code generator.
 */

/** Anything that is not part of an identifier is a word boundary. */
const SEPARATOR_PATTERN = /[^A-Za-z0-9]+/u;

/**
 * One word inside a single delimiter-free segment.
 *
 * The second alternative is what makes acronym runs work: `[A-Z]+(?![a-z])` consumes `HTTP` out of
 * `userHTTPRequest` but stops before the `R` of `Request`, because that `R` begins the next word.
 * Without it, splitting on every case change yields `u-s-e-r-h-t-t-p`-style nonsense. It is tried
 * second so that an ordinary capitalised word — including one ending in digits, as in `apiV2Route`
 * — is preferred over reading its single leading capital as a one-letter acronym.
 */
const WORD_PATTERN = /[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])|[0-9]+/gu;

const ACRONYM_PATTERN = /^[A-Z]{2,}$/u;

const ALL_CAPS_PATTERN = /^[A-Z][A-Z0-9]*$/u;

/**
 * Splits any input into its constituent words.
 *
 * Words come back lower case except for acronym runs, which keep their capitals so that
 * `toPascalCase('userHTTPRequest')` can return `UserHTTPRequest` rather than `UserHttpRequest`.
 */
function splitWords(input: string): readonly string[] {
  const words: string[] = [];

  for (const segment of input.split(SEPARATOR_PATTERN)) {
    if (segment === '') continue;

    // A wholly upper-case segment came from SCREAMING_SNAKE_CASE, where the capitals carry no
    // information: `USER_PROFILE` has to yield `user`, `profile`, not two shouted words that
    // would then concatenate into `USERPROFILE`.
    if (ALL_CAPS_PATTERN.test(segment)) {
      words.push(segment.toLowerCase());
      continue;
    }

    for (const word of segment.match(WORD_PATTERN) ?? []) {
      words.push(ACRONYM_PATTERN.test(word) ? word : word.toLowerCase());
    }
  }

  return words;
}

/** Upper-cases the first character only, so an acronym run survives intact. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** `user profile`, `user_profile`, `USER_PROFILE` → `UserProfile`. */
export function toPascalCase(input: string): string {
  return splitWords(input).map(capitalize).join('');
}

/** `user profile` → `userProfile`. A leading acronym is lowered whole: `HTTPProxy` → `httpProxy`. */
export function toCamelCase(input: string): string {
  const [first, ...rest] = splitWords(input);
  if (first === undefined) return '';
  return first.toLowerCase() + rest.map(capitalize).join('');
}

/** `userHTTPRequest` → `user-http-request`. */
export function toKebabCase(input: string): string {
  return splitWords(input)
    .map((word) => word.toLowerCase())
    .join('-');
}

/** `user profile` → `user_profile`. */
export function toSnakeCase(input: string): string {
  return splitWords(input)
    .map((word) => word.toLowerCase())
    .join('_');
}

/** `user profile` → `USER_PROFILE`. */
export function toScreamingSnakeCase(input: string): string {
  return splitWords(input)
    .map((word) => word.toUpperCase())
    .join('_');
}

/** `user_profile` → `User Profile`. For prose in comments, docs and log lines. */
export function toTitleCase(input: string): string {
  return splitWords(input).map(capitalize).join(' ');
}

/** Singular → plural for forms no spelling rule can predict. */
const IRREGULAR_PLURALS = new Map<string, string>([
  ['person', 'people'],
  ['child', 'children'],
  ['man', 'men'],
  ['woman', 'women'],
  ['tooth', 'teeth'],
  ['foot', 'feet'],
  ['mouse', 'mice'],
  ['goose', 'geese'],
  ['datum', 'data'],
  ['index', 'indices'],
  ['matrix', 'matrices'],
  ['analysis', 'analyses'],
  ['status', 'statuses'],
]);

/** Singulars whose plural replaces a trailing `f`/`fe` with `ves`. */
const F_TO_VES = new Set([
  'calf',
  'elf',
  'half',
  'knife',
  'leaf',
  'life',
  'loaf',
  'scarf',
  'self',
  'sheaf',
  'shelf',
  'thief',
  'wharf',
  'wife',
  'wolf',
]);

/** Singulars ending in a consonant plus `o` that take `-oes`. Everything else takes `-s`. */
const O_TO_OES = new Set([
  'buffalo',
  'domino',
  'echo',
  'embargo',
  'hero',
  'mosquito',
  'potato',
  'tomato',
  'tornado',
  'torpedo',
  'veto',
  'volcano',
]);

/** Singulars ending in `-ie`, listed so `movies` singularises to `movie` and not `movy`. */
const IE_SINGULARS = new Set([
  'calorie',
  'cookie',
  'genie',
  'movie',
  'pie',
  'rookie',
  'selfie',
  'tie',
  'zombie',
]);

/**
 * Singulars that already end in `s`, so their plural adds `-es` and stripping `-es` is the only
 * correct way back: `bus`/`buses`, versus `house`/`houses` which loses a single `s`.
 */
const S_SINGULARS = new Set([
  'alias',
  'atlas',
  'bias',
  'bonus',
  'bus',
  'campus',
  'canvas',
  'focus',
  'gas',
  'iris',
  'lens',
  'plus',
  'radius',
  'virus',
]);

/** Words that are their own plural. */
const UNCOUNTABLE = new Set(['data', 'equipment', 'info', 'media', 'news', 'series', 'species']);

/**
 * Every singular whose plural is fixed by a table rather than a rule, resolved once at module
 * load so both directions read from the same data and cannot drift apart.
 */
const LEXICAL_PLURALS = new Map<string, string>([
  ...IRREGULAR_PLURALS,
  ...[...F_TO_VES].map((word): [string, string] => [word, `${word.replace(/fe?$/u, '')}ves`]),
  ...[...O_TO_OES].map((word): [string, string] => [word, `${word}es`]),
  ...[...IE_SINGULARS].map((word): [string, string] => [word, `${word}s`]),
]);

const LEXICAL_SINGULARS = new Map<string, string>(
  [...LEXICAL_PLURALS].map(([singular, plural]) => [plural, singular]),
);

/**
 * Splits off the trailing word so inflection never disturbs the rest of the string.
 *
 * `UserProfile` must pluralise to `UserProfiles` and `user_profile` to `user_profiles`; both fall
 * out of transforming only the final word and re-attaching the head verbatim.
 */
const TAIL_BOUNDARY_PATTERN =
  /(?<=[^A-Za-z0-9])(?=[A-Za-z0-9])|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/gu;

function splitTail(word: string): readonly [string, string] {
  let start = 0;

  for (const match of word.matchAll(TAIL_BOUNDARY_PATTERN)) {
    start = match.index ?? start;
  }

  return [word.slice(0, start), word.slice(start)];
}

/** Re-applies the source word's case style to a transformed copy of it. */
function restoreCase(source: string, transformed: string): string {
  if (source.length > 1 && source === source.toUpperCase()) return transformed.toUpperCase();

  const first = source.charAt(0);
  if (first !== first.toLowerCase()) return capitalize(transformed);

  return transformed;
}

function pluralizeWord(word: string): string {
  if (UNCOUNTABLE.has(word)) return word;

  const lexical = LEXICAL_PLURALS.get(word);
  if (lexical !== undefined) return lexical;

  // Already plural. Pluralising twice is always a caller mistake, but `people` is a far less
  // damaging answer than `peoples`.
  if (LEXICAL_SINGULARS.has(word)) return word;

  if (/[^aeiou]y$/u.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:s|sh|ch|x|z)$/u.test(word)) return `${word}es`;

  return `${word}s`;
}

function singularizeWord(word: string): string {
  // The table wins over `UNCOUNTABLE` here: `data` pluralises to itself, but asked for *the*
  // singular of `data` the only useful answer is `datum`.
  const lexical = LEXICAL_SINGULARS.get(word);
  if (lexical !== undefined) return lexical;

  if (LEXICAL_PLURALS.has(word) || UNCOUNTABLE.has(word)) return word;

  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|z|o)es$/u.test(word)) return word.slice(0, -2);
  if (word.endsWith('es') && S_SINGULARS.has(word.slice(0, -2))) return word.slice(0, -2);
  if (word.endsWith('ss') || !word.endsWith('s')) return word;

  return word.slice(0, -1);
}

/**
 * English plural of the final word, preserving the input's case style and everything before it.
 *
 * `category` → `categories`, `box` → `boxes`, `leaf` → `leaves`, `User` → `Users`.
 */
export function pluralize(word: string): string {
  const [head, tail] = splitTail(word);
  if (tail === '') return word;

  return head + restoreCase(tail, pluralizeWord(tail.toLowerCase()));
}

/** Inverse of `pluralize`, sharing its tables so the pair round-trips. */
export function singularize(word: string): string {
  const [head, tail] = splitTail(word);
  if (tail === '') return word;

  return head + restoreCase(tail, singularizeWord(tail.toLowerCase()));
}
