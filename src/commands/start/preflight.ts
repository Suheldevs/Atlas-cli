import { isAbsolute } from 'node:path';

import { CLI_NAME } from '../../constants/branding.js';
import { AtlasError } from '../../errors/atlas-error.js';
import { ErrorCode } from '../../errors/error-catalog.js';
import type { FileSystemService } from '../../services/filesystem.service.js';

/** npm's own ceiling for a package name, and this name becomes one. */
const MAX_PROJECT_NAME_LENGTH = 214;

/**
 * Names Windows refuses to create a file or directory under, in any casing and with any
 * extension.
 *
 * Checked on every platform, not only Windows. A repository scaffolded on Linux gets cloned on
 * Windows, and a `con/` directory that cannot be checked out is a far worse failure than a
 * rejected name — it happens to somebody else, later, with no message that explains it.
 */
const WINDOWS_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_unused, index) => `com${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_unused, index) => `lpt${String(index + 1)}`),
]);

/** Directory entries that do not make a directory "occupied". */
const IGNORED_ENTRIES: ReadonlySet<string> = new Set(['.git', '.DS_Store', 'Thumbs.db']);

/** Entries listed in the error before the rest are summarised. */
const LISTED_ENTRIES = 5;

/** One rule, its test, and what to say when it is the one that was broken. */
interface NameRule {
  readonly broken: (name: string) => boolean;
  readonly message: (name: string) => string;
  readonly hint: (name: string) => string;
}

/**
 * Ordered most-specific first, so the reported reason is the interesting one.
 *
 * `My App/x` breaks four rules at once; being told it contains a path separator is more useful
 * than being told it has an uppercase letter, and far more useful than "invalid name".
 */
const NAME_RULES: readonly NameRule[] = [
  {
    broken: (name) => name.trim() === '',
    message: () => 'A project name is required.',
    hint: () => `Try \`${CLI_NAME} start my-app\`.`,
  },
  {
    broken: (name) => isAbsolute(name),
    message: (name) => `'${name}' is an absolute path, not a project name.`,
    hint: () => 'Pass a bare name, and use --cwd to choose which directory it is created in.',
  },
  {
    broken: (name) => name.includes('/') || name.includes('\\'),
    message: (name) => `'${name}' contains a path separator.`,
    hint: () =>
      `\`${CLI_NAME} start\` creates one directory in the current one. Use --cwd for a different parent.`,
  },
  {
    broken: (name) => name.includes('..') || name === '.',
    message: (name) => `'${name}' refers to a relative directory rather than naming a new one.`,
    hint: () => 'Pick a name for the project, such as `my-app`.',
  },
  {
    broken: (name) => name.startsWith('.') || name.startsWith('_'),
    message: (name) => `'${name}' starts with '${name.charAt(0)}', which npm does not allow.`,
    hint: () => 'Start the name with a letter or a digit.',
  },
  {
    broken: (name) => name !== name.toLowerCase(),
    message: (name) => `'${name}' contains uppercase letters, which npm package names cannot.`,
    hint: (name) => `Try \`${CLI_NAME} start ${name.toLowerCase()}\` instead.`,
  },
  {
    broken: (name) => WINDOWS_DEVICE_NAMES.has(stripExtension(name).toLowerCase()),
    message: (name) => `'${name}' is a reserved device name on Windows.`,
    hint: () => 'Windows cannot create a directory with this name, so Atlas refuses it everywhere.',
  },
  {
    broken: (name) => name.length > MAX_PROJECT_NAME_LENGTH,
    message: (name) =>
      `The name is ${String(name.length)} characters long, which is more than npm allows.`,
    hint: () => `Keep it to ${String(MAX_PROJECT_NAME_LENGTH)} characters or fewer.`,
  },
  {
    broken: (name) => !/^[a-z0-9][a-z0-9._-]*$/u.test(name),
    message: (name) => `'${name}' contains characters that are not safe in a directory name.`,
    hint: () => 'Use lower-case letters, digits, dots, dashes and underscores only.',
  },
];

/**
 * Rejects a name that cannot be both a directory and an npm package name.
 *
 * Runs before anything else `start` does, because this one string becomes a path on three
 * operating systems, a manifest `name`, and a line of shell Atlas prints for the user to paste.
 * Every rule reports itself: "invalid name" tells the user they were wrong without telling them
 * how, which means guessing, and guessing on the command line is what this check exists to
 * prevent.
 */
export function assertValidProjectName(name: string): void {
  const rule = NAME_RULES.find((candidate) => candidate.broken(name));

  if (rule === undefined) {
    return;
  }

  throw new AtlasError({
    code: ErrorCode.InvalidProjectName,
    message: rule.message(name),
    hint: rule.hint(name),
  });
}

/**
 * Confirms the target is either absent or an empty directory.
 *
 * Merging into an occupied directory is never offered. `start` writes upwards of fifty files
 * across two package roots, and there is no answer to "what should happen to the `src/` you
 * already had" that is better than not asking the question.
 *
 * `.git` is ignored on purpose: `git init && atlas start .`-shaped workflows are common, and an
 * empty repository is not somebody's work. `.DS_Store` and `Thumbs.db` are ignored because no
 * user put them there.
 */
export async function assertTargetIsUsable(fs: FileSystemService, root: string): Promise<void> {
  if (!(await fs.exists(root))) {
    return;
  }

  if (!(await fs.isDirectory(root))) {
    throw new AtlasError({
      code: ErrorCode.TargetNotADirectory,
      message: `${root} already exists and is a file.`,
      hint: 'Remove or rename it, or choose a different project name.',
    });
  }

  const entries = (await fs.listDir(root)).filter((entry) => !IGNORED_ENTRIES.has(entry));

  if (entries.length === 0) {
    return;
  }

  const listed = entries.slice(0, LISTED_ENTRIES);
  const remaining = entries.length - listed.length;

  throw new AtlasError({
    code: ErrorCode.TargetNotEmpty,
    message: `${root} already exists and is not empty.`,
    hint: 'Choose a different name, or move the directory aside first. Atlas will not merge into it.',
    details: [...listed, ...(remaining > 0 ? [`and ${String(remaining)} more`] : [])],
  });
}

/** `nul.txt` is as reserved as `nul` on Windows, so the extension is dropped before comparing. */
function stripExtension(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}
