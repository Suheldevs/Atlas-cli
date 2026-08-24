import type { FileSystemService } from '../../services/filesystem.service.js';
import type { ModuleSystem, PackageManifest, TypeScriptInfo } from '../../types/project-context.js';

import { readTsconfig, type TsconfigProbe } from './language.detector.js';

/**
 * `module` values that emit ES modules. `es2015` and every later year behave identically,
 * so they are matched by pattern rather than enumerated as TypeScript adds them.
 */
const ESM_MODULE_VALUES = new Set(['nodenext', 'node16', 'node18', 'node20', 'esnext', 'es6']);

const ESM_MODULE_YEAR_PATTERN = /^es20\d\d$/u;

/** Read from the raw text when the config is too malformed to parse. */
const MODULE_VALUE_PATTERN = /"module"\s*:\s*"([^"]*)"/u;

/**
 * Decides which module system generated code must target.
 *
 * This is the single most consequential thing detection produces: it sets the `.js` suffix
 * on every relative import in every generated file. Under `nodenext` a missing suffix is a
 * compile error, and under CommonJS a present one resolves to nothing — so a wrong answer
 * here does not degrade the output, it means none of it works.
 */
export async function detectModuleSystem(
  manifest: PackageManifest | undefined,
  typescript: TypeScriptInfo,
  fs: FileSystemService,
  root: string,
): Promise<ModuleSystem> {
  // `type` is the only one of these signals Node itself acts on at runtime, so it wins
  // outright — including when it says `commonjs` while tsconfig asks for ESM output.
  if (manifest?.type === 'module') return 'esm';
  if (manifest?.type === 'commonjs') return 'cjs';

  if (typescript.configPath !== undefined) {
    const tsconfig = await readTsconfig(fs, root);
    const declared = tsconfig === undefined ? undefined : classify(tsconfig);
    if (declared !== undefined) return declared;
  }

  // Node's own default for a `.js` file with no `type` field.
  return 'cjs';
}

function classify(tsconfig: TsconfigProbe): ModuleSystem | undefined {
  const declared = readModuleValue(tsconfig)?.toLowerCase();
  if (declared === undefined) return undefined;
  if (declared === 'commonjs') return 'cjs';

  return ESM_MODULE_VALUES.has(declared) || ESM_MODULE_YEAR_PATTERN.test(declared)
    ? 'esm'
    : undefined;
}

function readModuleValue(tsconfig: TsconfigProbe): string | undefined {
  if (tsconfig.compilerOptions !== undefined) {
    const declared = tsconfig.compilerOptions['module'];
    return typeof declared === 'string' ? declared : undefined;
  }

  return MODULE_VALUE_PATTERN.exec(tsconfig.text)?.[1];
}
