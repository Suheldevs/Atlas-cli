import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PACKAGE_NAME } from '../constants/branding.js';
import { MANIFEST_FILE_NAME, TEMPLATES_DIR_NAME } from '../constants/paths.js';
import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';

export interface PackageMeta {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  /** Absolute path to the directory containing Atlas's own `package.json`. */
  readonly packageRoot: string;
}

let cachedMeta: PackageMeta | undefined;

/**
 * Reads Atlas's own manifest.
 *
 * Atlas runs from three different layouts — `tsx src/cli.ts` in development, the bundled
 * `dist/cli.js`, and a package-manager store for a global install — and the number of
 * `..` segments between the running module and the package root differs in each. So walk
 * upwards until a `package.json` claiming to be Atlas turns up, rather than guessing a
 * fixed depth. The name check matters: without it, a shallower manifest belonging to a
 * host project could be picked up instead.
 */
export function getPackageMeta(): PackageMeta {
  cachedMeta ??= readPackageMeta(import.meta.dirname);
  return cachedMeta;
}

export function resolveTemplatesRoot(): string {
  return join(getPackageMeta().packageRoot, TEMPLATES_DIR_NAME);
}

function readPackageMeta(startDirectory: string): PackageMeta {
  const visited: string[] = [];

  let current = startDirectory;
  for (;;) {
    const manifestPath = join(current, MANIFEST_FILE_NAME);

    if (existsSync(manifestPath)) {
      visited.push(manifestPath);
      const manifest = parseManifest(manifestPath);

      if (manifest?.name === PACKAGE_NAME) {
        return {
          name: manifest.name,
          version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
          description: typeof manifest.description === 'string' ? manifest.description : '',
          packageRoot: current,
        };
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new AtlasError({
        code: ErrorCode.Internal,
        message: `Could not locate the ${PACKAGE_NAME} package manifest.`,
        hint: 'The installation looks incomplete. Reinstalling Atlas should fix it.',
        details: visited.length > 0 ? [`Inspected: ${visited.join(', ')}`] : [],
      });
    }

    current = parent;
  }
}

interface RawManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
}

/**
 * Returns undefined for unreadable or malformed manifests rather than throwing: an
 * unrelated broken `package.json` somewhere above us must not stop the search.
 */
function parseManifest(manifestPath: string): RawManifest | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
