/**
 * Names and URLs that appear in user-facing output.
 *
 * Centralised because they are printed in dozens of places and a rename must not
 * require a codebase-wide search. This module deliberately imports nothing, so it can
 * be depended on from anywhere without creating a cycle.
 */

/** The binary users type. Not the same as the npm package name. */
export const CLI_NAME = 'atlas';

export const PACKAGE_NAME = '@mohdsuhel/atlas';

export const REPOSITORY_URL = 'https://github.com/Suheldevs/Atlas-cli';

export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

export const DOCS_BASE_URL = `${REPOSITORY_URL}/blob/main/docs`;

/**
 * Minimum supported Node.js version.
 *
 * 22.13 is not an arbitrary floor: Node 20 reached end of life in April 2026, and the
 * pinned dependencies already demand it. `@inquirer/prompts` sets the exact number with
 * `>=23.5.0 || ^22.13.0 || ^20.17.0`; commander 15 wants `>=22.12.0`, chalk 6 and execa 10
 * want `>=22`. Claiming support for anything lower would be a lie the first time someone
 * ran an install.
 *
 * `bin/atlas.js` repeats these numbers as literals on purpose: it has to reject an old
 * runtime *before* importing anything from `dist/`, so it cannot read them from here.
 * Change both together.
 */
export const MINIMUM_NODE_VERSION = { major: 22, minor: 13, patch: 0 } as const;

export const SUPPORTED_NODE_RANGE = `>=${String(MINIMUM_NODE_VERSION.major)}.${String(
  MINIMUM_NODE_VERSION.minor,
)}.${String(MINIMUM_NODE_VERSION.patch)}`;

/** Package managers Atlas knows how to drive, in the order it prefers them. */
export const SUPPORTED_PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

export type SupportedPackageManager = (typeof SUPPORTED_PACKAGE_MANAGERS)[number];
