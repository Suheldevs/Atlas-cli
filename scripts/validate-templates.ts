/**
 * The template validation gate.
 *
 * "Templates are always valid TypeScript" is only true if something checks it. Templates are
 * excluded from this repository's tsconfig, ESLint and Prettier — deliberately, because they
 * import packages Atlas does not depend on and are formatted with the target project's config,
 * not ours. This script is what stands in for all three.
 *
 * The manifest checks here are deliberately independent of `src/engine/template/`. A gate that
 * shares its parser with the thing it guards fails the same way the thing does: refactor a bug
 * into the loader and the check that should have caught it agrees with it instead.
 *
 * The token vocabulary is the one exception, and it is imported rather than re-derived. It is
 * data with exactly one correct copy: a second hand-maintained list — or a regex that scrapes the
 * first one — can fall out of step, and a stale vocabulary is precisely the failure this script
 * exists to catch. Importing it means adding a token to `src/constants/tokens.ts` is immediately
 * and unavoidably reflected here, and that a broken import fails loudly instead of quietly
 * validating against yesterday's list.
 *
 * Run with: npx tsx scripts/validate-templates.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_TOKENS } from '../src/constants/tokens.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TEMPLATES_DIR = join(ROOT, 'templates');

const MANIFEST_NAME = 'template.json';
const FILES_DIR_NAME = 'files';

/** Directory under `templates/` that holds CI-only type shims rather than a template. */
const SHIMS_DIR_NAME = '@types';

/** Any `__UPPER_SNAKE__` sequence, whether or not it is a token Atlas knows. */
const TOKEN_PATTERN = /__[A-Z][A-Z0-9_]*__/g;

interface Vocabulary {
  readonly tokens: ReadonlySet<string>;
  readonly source: string;
}

/** The vocabulary, straight from its single source of truth. */
function loadVocabulary(): Vocabulary {
  return { tokens: new Set(KNOWN_TOKENS), source: 'src/constants/tokens.ts' };
}

/** Repository-relative and POSIX-separated, so a failure reads the same on every platform. */
function display(path: string): string {
  return relative(ROOT, path).replaceAll('\\', '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(path);
    else yield path;
  }
}

/**
 * Every field of a manifest, checked here rather than through the loader's parser.
 *
 * The duplication is the point: two independent statements of the same contract disagree loudly,
 * where one statement used twice cannot disagree at all.
 */
function checkManifest(
  manifest: Record<string, unknown>,
  templateName: string,
  filesRoot: string,
  errors: string[],
): void {
  const { name, version, description, files, requires } = manifest;

  if (!isNonEmptyString(name)) errors.push('"name" must be a non-empty string');
  else if (name !== templateName) {
    errors.push(`"name" is "${name}" but the directory is "${templateName}"`);
  }

  if (!isNonEmptyString(version)) errors.push('"version" must be a non-empty string');
  else if (!/^\d+\.\d+\.\d+/.test(version)) {
    errors.push(`"version" must start with a semver triple; found "${version}"`);
  }

  if (!isNonEmptyString(description)) errors.push('"description" must be a non-empty string');

  checkStringMap(manifest, 'dependencies', 'dependencies', errors);
  checkStringMap(manifest, 'devDependencies', 'devDependencies', errors);
  checkStringMap(manifest, 'scripts', 'scripts', errors);

  checkFiles(files, filesRoot, errors);

  if (!isRecord(requires)) {
    errors.push('"requires" must be an object');
    return;
  }

  const { frameworks, language } = requires;

  if (!isArray(frameworks) || frameworks.some((entry) => typeof entry !== 'string')) {
    errors.push('"requires.frameworks" must be an array of strings (empty means any)');
  }

  if (language !== null && language !== undefined && typeof language !== 'string') {
    errors.push('"requires.language" must be a string, null, or absent');
  }

  checkStringMap(requires, 'dependencies', 'requires.dependencies', errors);
}

function checkStringMap(
  owner: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
): void {
  const value = owner[key];

  if (!isRecord(value)) {
    errors.push(`"${label}" must be an object`);
    return;
  }

  for (const [entry, range] of Object.entries(value)) {
    if (typeof range !== 'string') errors.push(`"${label}.${entry}" must be a string`);
  }
}

/**
 * An empty `files` array is legal and normal: it tells the loader to mirror `files/` recursively,
 * so adding a file to a template is not also a chore of registering it. A non-empty array is an
 * explicit list, and every path in it has to exist or generation fails on a user's machine.
 */
function checkFiles(files: unknown, filesRoot: string, errors: string[]): void {
  if (!isArray(files)) {
    errors.push('"files" must be an array (empty mirrors files/ recursively)');
    return;
  }

  files.forEach((entry, index) => {
    const at = `"files[${String(index)}]"`;

    if (!isRecord(entry)) {
      errors.push(`${at} must be an object`);
      return;
    }

    const { source, destination, format } = entry;

    if (typeof format !== 'boolean') errors.push(`${at}.format must be a boolean`);
    if (!isNonEmptyString(destination)) errors.push(`${at}.destination must be a non-empty string`);

    if (!isNonEmptyString(source)) {
      errors.push(`${at}.source must be a non-empty string`);
      return;
    }

    if (!existsSync(join(filesRoot, source))) {
      errors.push(`${at}.source is not in the package: ${FILES_DIR_NAME}/${source}`);
    }
  });
}

/**
 * Fails on any token outside the vocabulary.
 *
 * This is the check the whole script is built around. Substitution is plain string replacement,
 * so `__ENTITY_NAM__` has nothing to replace it with: it survives generation and is written into
 * somebody's source file verbatim, in code that still compiles. Reported once per token per file,
 * because one misspelling repeated twenty times is one mistake.
 */
function checkTokens(
  files: readonly string[],
  vocabulary: ReadonlySet<string>,
  errors: string[],
): void {
  for (const file of files) {
    const seen = new Set<string>();
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      for (const match of line.matchAll(TOKEN_PATTERN)) {
        const token = match[0];
        if (vocabulary.has(token) || seen.has(token)) continue;
        seen.add(token);
        errors.push(`unknown token ${token} at ${display(file)}:${String(index + 1)}`);
      }
    });
  }
}

function validateTemplate(
  templateName: string,
  vocabulary: ReadonlySet<string>,
): readonly string[] {
  const errors: string[] = [];
  const root = join(TEMPLATES_DIR, templateName);
  const manifestPath = join(root, MANIFEST_NAME);
  const filesRoot = join(root, FILES_DIR_NAME);

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(`${MANIFEST_NAME} is not valid JSON: ${reason}`);
  }

  if (manifest !== undefined) {
    if (isRecord(manifest)) checkManifest(manifest, templateName, filesRoot, errors);
    else errors.push(`${MANIFEST_NAME} must contain a JSON object`);
  }

  const hasFilesDir = existsSync(filesRoot);
  if (!hasFilesDir) errors.push(`missing ${FILES_DIR_NAME}/ directory`);

  // The manifest is scanned too: a destination may carry tokens so a template can name a file
  // after the entity it generates, and a typo there is as bad as one in the source.
  const scanned = [manifestPath, ...(hasFilesDir ? walkFiles(filesRoot) : [])];
  checkTokens(scanned, vocabulary, errors);

  if (hasFilesDir && scanned.length === 1) errors.push(`${FILES_DIR_NAME}/ is empty`);

  return errors;
}

interface Discovery {
  readonly templates: readonly string[];
  /** Directories that are neither a template nor the shims directory. */
  readonly skipped: readonly string[];
}

function discover(): Discovery {
  if (!existsSync(TEMPLATES_DIR)) return { templates: [], skipped: [] };

  const templates: string[] = [];
  const skipped: string[] = [];

  for (const entry of readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === SHIMS_DIR_NAME) continue;
    if (existsSync(join(TEMPLATES_DIR, entry.name, MANIFEST_NAME))) templates.push(entry.name);
    else skipped.push(entry.name);
  }

  return {
    templates: templates.sort((a, b) => a.localeCompare(b)),
    skipped,
  };
}

function main(): void {
  const vocabulary = loadVocabulary();
  const { templates, skipped } = discover();

  console.log(`Templates root:    ${display(TEMPLATES_DIR)}`);
  console.log(`Token vocabulary:  ${String(vocabulary.tokens.size)} from ${vocabulary.source}`);
  console.log('');

  if (templates.length === 0) {
    console.error(`No template contained a ${MANIFEST_NAME}. Nothing was validated.`);
    process.exitCode = 1;
    return;
  }

  let failures = 0;

  for (const name of templates) {
    const errors = validateTemplate(name, vocabulary.tokens);

    if (errors.length === 0) {
      console.log(`  PASS  ${name}`);
      continue;
    }

    failures += 1;
    console.log(`  FAIL  ${name}`);
    for (const error of errors) console.log(`        - ${error}`);
  }

  for (const name of skipped) {
    console.log(`  SKIP  ${name} (no ${MANIFEST_NAME}, not treated as a template)`);
  }

  console.log('');

  const noun = templates.length === 1 ? 'template' : 'templates';
  const counted = `${String(templates.length)} ${noun}`;

  if (failures === 0) {
    console.log(`Validated ${counted}: manifests and tokens are sound.`);
    console.log('Compilation is checked by scripts/check-generated-output.ts.');
    return;
  }

  const failed = failures;
  console.error(
    `${String(failed)} of ${String(templates.length + 1)} checks failed over ${counted}.`,
  );
  process.exitCode = 1;
}

main();
