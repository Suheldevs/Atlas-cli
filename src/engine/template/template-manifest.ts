import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { Framework, Language, ProjectContext } from '../../types/project-context.js';
import type {
  TemplateFileEntry,
  TemplateManifest,
  TemplateRequirements,
} from '../../types/template-manifest.js';

/**
 * Every key a `template.json` may declare.
 *
 * The set is closed and unknown keys are rejected rather than ignored: a misspelled
 * `devDependencies` would otherwise parse cleanly and ship a template whose dependencies are
 * never installed, which surfaces much later as a broken build in the user's project.
 */
const KNOWN_KEYS = [
  'name',
  'version',
  'description',
  'dependencies',
  'devDependencies',
  'scripts',
  'files',
  'requires',
] as const;

const KNOWN_REQUIRES_KEYS = ['frameworks', 'language', 'dependencies'] as const;

const KNOWN_FILE_ENTRY_KEYS = ['source', 'destination', 'format'] as const;

/**
 * Written as an exhaustive record rather than an array so that adding a member to the
 * `Framework` union fails to compile here until it is listed — a validator that silently
 * falls behind the union would reject a framework Atlas genuinely supports.
 */
const FRAMEWORKS: Readonly<Record<Framework, true>> = {
  express: true,
  nest: true,
  fastify: true,
  next: true,
  react: true,
  unknown: true,
};

const LANGUAGES: Readonly<Record<Language, true>> = {
  typescript: true,
  javascript: true,
};

const EMPTY_REQUIREMENTS: TemplateRequirements = {
  frameworks: [],
  language: undefined,
  dependencies: {},
};

export interface RequirementCheck {
  readonly satisfied: boolean;
  /** One human-readable sentence per unmet requirement. Empty when satisfied. */
  readonly reasons: readonly string[];
}

/**
 * Parses and validates a `template.json`.
 *
 * Only `name`, `version` and `description` are required, so a template that just mirrors its
 * `files/` directory needs a three-line manifest. Every problem found is collected and
 * reported together: fixing a manifest one error per run is a miserable loop, and the errors
 * are almost always independent.
 */
export function parseTemplateManifest(value: unknown, source: string): TemplateManifest {
  if (!isRecord(value)) {
    throw invalidManifest(source, [
      `Expected a JSON object, got ${describeType(value)}.`,
      `Recognised keys: ${KNOWN_KEYS.join(', ')}.`,
    ]);
  }

  const problems: string[] = [];

  const name = readRequiredString(value, 'name', problems, { nonEmpty: true });
  const version = readRequiredString(value, 'version', problems);
  const description = readRequiredString(value, 'description', problems);
  const dependencies = readStringRecord(value, 'dependencies', 'dependencies', problems);
  const devDependencies = readStringRecord(value, 'devDependencies', 'devDependencies', problems);
  const scripts = readStringRecord(value, 'scripts', 'scripts', problems);
  const files = readFiles(value, problems);
  const requires = readRequires(value, problems);

  const unknownKeys = Object.keys(value).filter((key) => !isKnownKey(KNOWN_KEYS, key));
  if (unknownKeys.length > 0) {
    problems.push(
      `Unknown ${unknownKeys.length === 1 ? 'key' : 'keys'}: ${unknownKeys.join(', ')}. ` +
        `Recognised keys: ${KNOWN_KEYS.join(', ')}.`,
    );
  }

  if (problems.length > 0) throw invalidManifest(source, problems);

  return {
    name,
    version,
    description,
    dependencies,
    devDependencies,
    scripts,
    files,
    requires,
  };
}

/**
 * Compares a manifest's `requires` block against a detected project.
 *
 * Deliberately total: it reports what does not match and leaves the verdict to the caller,
 * because the same mismatch is fatal for `atlas add` and merely informational when listing
 * which templates are available.
 */
export function checkRequirements(
  manifest: TemplateManifest,
  project: ProjectContext,
): RequirementCheck {
  const reasons: string[] = [];
  const { frameworks, language, dependencies } = manifest.requires;

  if (frameworks.length > 0 && !frameworks.includes(project.framework)) {
    reasons.push(
      `Template "${manifest.name}" targets ${frameworks.join(' or ')}, ` +
        `but this project looks like ${project.framework}.`,
    );
  }

  if (language !== undefined && language !== project.language) {
    reasons.push(
      `Template "${manifest.name}" targets ${language}, but this project is ${project.language}.`,
    );
  }

  for (const [dependency, range] of Object.entries(dependencies)) {
    if (!isDependencyPresent(project, dependency)) {
      reasons.push(
        `Template "${manifest.name}" needs ${dependency}@${range}, ` +
          'which this project does not depend on.',
      );
    }
  }

  return { satisfied: reasons.length === 0, reasons };
}

function readRequiredString(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  problems: string[],
  options: { readonly nonEmpty?: boolean } = {},
): string {
  const value = raw[key];

  if (typeof value !== 'string') {
    problems.push(`"${key}" is required and must be a string, got ${describeType(value)}.`);
    return '';
  }

  if (options.nonEmpty === true && value.trim().length === 0) {
    problems.push(`"${key}" must not be empty.`);
    return '';
  }

  return value;
}

function readStringRecord(
  raw: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
  problems: string[],
): Readonly<Record<string, string>> {
  const value = raw[key];
  if (value === undefined) return {};

  if (!isRecord(value)) {
    problems.push(
      `"${label}" must be an object mapping names to strings, got ${describeType(value)}.`,
    );
    return {};
  }

  const result: Record<string, string> = {};

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== 'string') {
      problems.push(`"${label}.${entryKey}" must be a string, got ${describeType(entryValue)}.`);
      continue;
    }
    result[entryKey] = entryValue;
  }

  return result;
}

function readFiles(
  raw: Readonly<Record<string, unknown>>,
  problems: string[],
): readonly TemplateFileEntry[] {
  const value = raw['files'];
  if (value === undefined) return [];

  if (!isUnknownArray(value)) {
    problems.push(`"files" must be an array, got ${describeType(value)}.`);
    return [];
  }

  const entries: TemplateFileEntry[] = [];

  for (const [index, item] of value.entries()) {
    const entry = readFileEntry(item, `files[${index}]`, problems);
    if (entry !== undefined) entries.push(entry);
  }

  return entries;
}

/**
 * Accepts both the shorthand (`"src/user.ts"`) and the long form. The shorthand covers the
 * common case where the destination mirrors the source, which is most entries in most
 * templates.
 */
function readFileEntry(
  item: unknown,
  label: string,
  problems: string[],
): TemplateFileEntry | undefined {
  if (typeof item === 'string') {
    if (item.trim().length === 0) {
      problems.push(`"${label}" must not be empty.`);
      return undefined;
    }
    return { source: item, destination: item, format: true };
  }

  if (!isRecord(item)) {
    problems.push(
      `"${label}" must be a source path or an object with a "source", got ${describeType(item)}.`,
    );
    return undefined;
  }

  const unknownKeys = Object.keys(item).filter((key) => !isKnownKey(KNOWN_FILE_ENTRY_KEYS, key));
  if (unknownKeys.length > 0) {
    problems.push(
      `"${label}" has unknown ${unknownKeys.length === 1 ? 'key' : 'keys'}: ` +
        `${unknownKeys.join(', ')}. Recognised keys: ${KNOWN_FILE_ENTRY_KEYS.join(', ')}.`,
    );
  }

  const source = item['source'];
  if (typeof source !== 'string' || source.trim().length === 0) {
    problems.push(`"${label}.source" is required and must be a non-empty string.`);
    return undefined;
  }

  const destination = item['destination'];
  if (destination !== undefined && typeof destination !== 'string') {
    problems.push(`"${label}.destination" must be a string, got ${describeType(destination)}.`);
    return undefined;
  }

  const format = item['format'];
  if (format !== undefined && typeof format !== 'boolean') {
    problems.push(`"${label}.format" must be a boolean, got ${describeType(format)}.`);
    return undefined;
  }

  return {
    source,
    destination: destination ?? source,
    format: format ?? true,
  };
}

function readRequires(
  raw: Readonly<Record<string, unknown>>,
  problems: string[],
): TemplateRequirements {
  const value = raw['requires'];
  if (value === undefined) return EMPTY_REQUIREMENTS;

  if (!isRecord(value)) {
    problems.push(`"requires" must be an object, got ${describeType(value)}.`);
    return EMPTY_REQUIREMENTS;
  }

  const unknownKeys = Object.keys(value).filter((key) => !isKnownKey(KNOWN_REQUIRES_KEYS, key));
  if (unknownKeys.length > 0) {
    problems.push(
      `"requires" has unknown ${unknownKeys.length === 1 ? 'key' : 'keys'}: ` +
        `${unknownKeys.join(', ')}. Recognised keys: ${KNOWN_REQUIRES_KEYS.join(', ')}.`,
    );
  }

  return {
    frameworks: readFrameworks(value, problems),
    language: readLanguage(value, problems),
    dependencies: readStringRecord(value, 'dependencies', 'requires.dependencies', problems),
  };
}

function readFrameworks(
  raw: Readonly<Record<string, unknown>>,
  problems: string[],
): readonly Framework[] {
  const value = raw['frameworks'];
  if (value === undefined) return [];

  if (!isUnknownArray(value)) {
    problems.push(`"requires.frameworks" must be an array, got ${describeType(value)}.`);
    return [];
  }

  const frameworks: Framework[] = [];

  for (const [index, item] of value.entries()) {
    const label = `requires.frameworks[${index}]`;

    if (typeof item !== 'string') {
      problems.push(`"${label}" must be a string, got ${describeType(item)}.`);
      continue;
    }

    if (!isFramework(item)) {
      problems.push(
        `"${label}" is "${item}", which is not a framework Atlas knows. ` +
          `Valid frameworks: ${Object.keys(FRAMEWORKS).join(', ')}.`,
      );
      continue;
    }

    frameworks.push(item);
  }

  return frameworks;
}

function readLanguage(
  raw: Readonly<Record<string, unknown>>,
  problems: string[],
): Language | undefined {
  const value = raw['language'];
  if (value === undefined) return undefined;

  if (typeof value !== 'string') {
    problems.push(`"requires.language" must be a string, got ${describeType(value)}.`);
    return undefined;
  }

  if (!isLanguage(value)) {
    problems.push(
      `"requires.language" is "${value}", which is not a language Atlas knows. ` +
        `Valid languages: ${Object.keys(LANGUAGES).join(', ')}.`,
    );
    return undefined;
  }

  return value;
}

function isDependencyPresent(project: ProjectContext, dependency: string): boolean {
  const manifest = project.manifest;
  if (manifest === undefined) return false;

  return (
    Object.hasOwn(manifest.dependencies, dependency) ||
    Object.hasOwn(manifest.devDependencies, dependency) ||
    Object.hasOwn(manifest.peerDependencies, dependency)
  );
}

function invalidManifest(source: string, problems: readonly string[]): AtlasError {
  return new AtlasError({
    code: ErrorCode.TemplateManifestInvalid,
    message: `Template manifest ${source} is invalid.`,
    hint: 'Fix the reported fields. Every problem found is listed, not just the first.',
    details: problems,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `Array.isArray` narrows `unknown` to `any[]`; this keeps the elements `unknown`. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isKnownKey(known: readonly string[], key: string): boolean {
  return known.includes(key);
}

function isFramework(value: string): value is Framework {
  return Object.hasOwn(FRAMEWORKS, value);
}

function isLanguage(value: string): value is Language {
  return Object.hasOwn(LANGUAGES, value);
}

/** Type names as a manifest author thinks of them, so `[]` reads as "array", not "object". */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}
