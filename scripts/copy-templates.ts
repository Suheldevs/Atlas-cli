/**
 * Copies `templates/` into a build output, byte for byte.
 *
 * `package.json#files` already lists `templates`, so publishing from the repository root does not
 * need this. It exists for build layouts that stage a directory instead — a container image, a
 * monorepo release step, anything that assembles a package from `dist/` rather than from the
 * working tree — where the assets have to be placed next to the bundle explicitly.
 *
 * Copying rather than bundling is the whole point. A template is the source a template author
 * wrote, and it is what a user ends up reading in their own repository; putting it through a
 * bundler, a transpiler or a formatter would mean the code Atlas generates is not the code anyone
 * reviewed. Tokens have to survive intact too, and `./formats__IMPORT_SUFFIX__` inside an import
 * specifier is exactly the sort of thing a transform would try to resolve and fail on.
 *
 * Run with: npx tsx scripts/copy-templates.ts [outputDir]   (outputDir defaults to dist)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SOURCE = join(ROOT, 'templates');
const DIRECTORY_NAME = 'templates';

/**
 * Copies a directory tree and returns the number of files written.
 *
 * Idempotent: destinations are overwritten, so re-running after a partial build converges rather
 * than duplicating or failing. Nothing is filtered — dotfiles included — because a template
 * directory holds only files that are meant to ship, and a filter here would silently drop one.
 */
function copyDirectory(from: string, to: string): number {
  mkdirSync(to, { recursive: true });

  // Sorted so two runs produce the same order, which makes a build log diffable.
  const entries = readdirSync(from, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  let copied = 0;

  for (const entry of entries) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);

    if (entry.isDirectory()) copied += copyDirectory(source, target);
    else {
      copyFileSync(source, target);
      copied += 1;
    }
  }

  return copied;
}

function main(): void {
  if (!existsSync(SOURCE)) {
    console.error(`No ${DIRECTORY_NAME} directory at ${SOURCE}.`);
    process.exitCode = 1;
    return;
  }

  const outputRoot = resolve(ROOT, process.argv[2] ?? 'dist');
  const destination = join(outputRoot, DIRECTORY_NAME);
  const copied = copyDirectory(SOURCE, destination);

  const noun = copied === 1 ? 'file' : 'files';
  const where = relative(ROOT, destination).replaceAll('\\', '/');
  console.log(`Copied ${String(copied)} template ${noun} to ${where}`);
}

main();
