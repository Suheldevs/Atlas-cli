import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import { closestMatch } from '../utils/text.js';

/**
 * The shape of `atlas.config.*`, and of the `package.json` `"atlas"` key.
 *
 * Every field is absent-able, because a config file exists to override a handful of
 * decisions rather than to restate the defaults. Absent has to keep meaning "let detection
 * decide", which is why the scalars are `T | undefined` instead of being pre-filled with
 * something opinionated.
 */
export interface AtlasConfig {
  /** Directory new source goes in, overriding detection. */
  readonly sourceDir: string | undefined;
  /** Extra plugin package names or paths to load. */
  readonly plugins: readonly string[];
  /** Generator names to hide from `atlas list` and refuse to run. */
  readonly disabledGenerators: readonly string[];
  /** Run the target project's formatter over generated files. */
  readonly format: boolean | undefined;
  /** Per-generator default options, keyed by generator name. */
  readonly generators: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * A presence map rather than a hand-written list of names: adding a field to `AtlasConfig`
 * without teaching the validator about it becomes a compile error, instead of a key the
 * loader then rejects as unknown.
 */
const RECOGNISED_KEYS: Readonly<Record<keyof AtlasConfig, true>> = {
  sourceDir: true,
  plugins: true,
  disabledGenerators: true,
  format: true,
  generators: true,
};

/** Recognised top-level keys, in declaration order, for user-facing messages. */
export const ATLAS_CONFIG_KEYS: readonly string[] = Object.freeze(Object.keys(RECOGNISED_KEYS));

/**
 * Turns an untrusted value into an `AtlasConfig`, or explains why it cannot.
 *
 * Unknown top-level keys are rejected rather than ignored. A config file is committed and
 * shared, so a typo that is silently dropped becomes a setting the whole team believes is
 * in effect, with the only symptom being Atlas quietly doing something else. Failing once
 * at load time costs the author seconds; ignoring it costs every teammate an afternoon.
 *
 * Problems are collected and reported together, because fixing a shared config one error
 * per run is a bad loop to put someone in.
 *
 * @param source Where the value came from, quoted back in the failure so the user knows
 *   which file to edit.
 */
export function parseAtlasConfig(value: unknown, source: string): AtlasConfig {
  if (!isPlainObject(value)) {
    throw invalidConfig(source, [
      `Expected an object of options, received ${describeType(value)}.`,
    ]);
  }

  const problems: string[] = [];
  const unknownKeys = Object.keys(value).filter((key) => !Object.hasOwn(RECOGNISED_KEYS, key));

  for (const key of unknownKeys) {
    const suggestion = closestMatch(key, ATLAS_CONFIG_KEYS);
    problems.push(
      suggestion === undefined
        ? `Unknown key "${key}".`
        : `Unknown key "${key}". Did you mean "${suggestion}"?`,
    );
  }

  const config: AtlasConfig = {
    sourceDir: readString(value, 'sourceDir', problems),
    plugins: readStringArray(value, 'plugins', problems),
    disabledGenerators: readStringArray(value, 'disabledGenerators', problems),
    format: readBoolean(value, 'format', problems),
    generators: readGenerators(value, 'generators', problems),
  };

  if (problems.length > 0) {
    throw invalidConfig(
      source,
      // The list of valid names only earns its space when a name was actually wrong.
      unknownKeys.length === 0
        ? problems
        : [...problems, `Recognised keys: ${ATLAS_CONFIG_KEYS.join(', ')}.`],
    );
  }

  return freezeConfig(config);
}

/**
 * Deep-freezes a config.
 *
 * One `AtlasConfig` is shared by every generator in a run, so a generator that mutated its
 * own option bag would change what the next one sees.
 */
export function freezeConfig(config: AtlasConfig): AtlasConfig {
  return Object.freeze({
    sourceDir: config.sourceDir,
    plugins: Object.freeze([...config.plugins]),
    disabledGenerators: Object.freeze([...config.disabledGenerators]),
    format: config.format,
    generators: freezeGenerators(config.generators),
  });
}

function freezeGenerators(
  generators: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const frozen: Record<string, Readonly<Record<string, unknown>>> = {};

  for (const [name, options] of Object.entries(generators)) {
    frozen[name] = Object.freeze({ ...options });
  }

  return Object.freeze(frozen);
}

/**
 * `undefined` counts as absent, not as a wrong type: a JavaScript config commonly writes
 * `sourceDir: process.env['SRC']` and means "leave it to detection" when that is unset.
 */
function readString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;

  if (typeof value !== 'string') {
    problems.push(`${key}: expected a string, received ${describeType(value)}.`);
    return undefined;
  }

  // An empty directory name silently means "the project root", which is never what the
  // author of `sourceDir: ''` meant.
  if (value.trim().length === 0) {
    problems.push(`${key}: expected a non-empty string.`);
    return undefined;
  }

  return value;
}

function readBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;

  if (typeof value !== 'boolean') {
    problems.push(`${key}: expected true or false, received ${describeType(value)}.`);
    return undefined;
  }

  return value;
}

function readStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
): readonly string[] {
  const value = record[key];
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    problems.push(`${key}: expected an array of strings, received ${describeType(value)}.`);
    return [];
  }

  const entries: string[] = [];

  for (const [index, entry] of (value as readonly unknown[]).entries()) {
    if (typeof entry !== 'string') {
      problems.push(
        `${key}[${String(index)}]: expected a string, received ${describeType(entry)}.`,
      );
      continue;
    }

    if (entry.trim().length === 0) {
      problems.push(`${key}[${String(index)}]: expected a non-empty string.`);
      continue;
    }

    entries.push(entry);
  }

  return entries;
}

/**
 * Option values stay `unknown`: which options a generator accepts is the generator's own
 * schema to enforce, and this loader has no way to know them.
 */
function readGenerators(
  record: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const value = record[key];
  if (value === undefined) return {};

  if (!isPlainObject(value)) {
    problems.push(
      `${key}: expected an object keyed by generator name, received ${describeType(value)}.`,
    );
    return {};
  }

  const generators: Record<string, Readonly<Record<string, unknown>>> = {};

  for (const [name, options] of Object.entries(value)) {
    if (!isPlainObject(options)) {
      problems.push(
        `${key}.${name}: expected an object of options, received ${describeType(options)}.`,
      );
      continue;
    }

    generators[name] = options;
  }

  return generators;
}

/** Arrays are excluded: every config value read as an object is a keyed record. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';

  const type = typeof value;
  return type === 'object' ? 'an object' : `a ${type}`;
}

function invalidConfig(source: string, details: readonly string[]): AtlasError {
  return new AtlasError({
    code: ErrorCode.InvalidUsage,
    message: `${source} is not a valid Atlas configuration.`,
    hint: 'Every key is optional, so deleting the offending one is always a valid fix.',
    details,
  });
}
