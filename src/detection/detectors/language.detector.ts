import { join } from 'node:path';

import type { FileSystemService } from '../../services/filesystem.service.js';
import type { Language, PackageManifest, TypeScriptInfo } from '../../types/project-context.js';
import { hasDependency, isJsonObject, parseJsonObject } from '../manifest-reader.js';

const TSCONFIG_FILE_NAME = 'tsconfig.json';

/** Matched against the raw text when the file is too malformed to parse. */
const STRICT_PATTERN = /"strict"\s*:\s*true/u;

export interface LanguageDetection {
  readonly language: Language;
  readonly typescript: TypeScriptInfo;
}

/** A `tsconfig.json` as found on disk: parsed when possible, raw text always. */
export interface TsconfigProbe {
  readonly path: string;
  readonly text: string;
  /** Undefined when the file could not be parsed, or declares no `compilerOptions`. */
  readonly compilerOptions: Readonly<Record<string, unknown>> | undefined;
}

/**
 * A `tsconfig.json` is authoritative, but a `typescript` dependency alone is enough: the
 * config may be one directory up in a monorepo, or supplied by a framework's build step,
 * and generating JavaScript into a project that compiles TypeScript is the worse mistake.
 */
export async function detectLanguage(
  fs: FileSystemService,
  root: string,
  manifest: PackageManifest | undefined,
): Promise<LanguageDetection> {
  const tsconfig = await readTsconfig(fs, root);
  const present = tsconfig !== undefined || hasDependency(manifest, 'typescript');

  return {
    language: present ? 'typescript' : 'javascript',
    typescript: {
      present,
      configPath: tsconfig?.path,
      strict: tsconfig !== undefined && isStrict(tsconfig),
    },
  };
}

/**
 * Reads `<root>/tsconfig.json`, keeping the raw text alongside the parse result.
 *
 * Exported because the module-system detector needs `compilerOptions.module` from the same
 * file, and there should be exactly one place that knows how to survive reading it.
 */
export async function readTsconfig(
  fs: FileSystemService,
  root: string,
): Promise<TsconfigProbe | undefined> {
  const path = join(root, TSCONFIG_FILE_NAME);
  const text = await fs.readTextIfExists(path);
  if (text === undefined) return undefined;

  const compilerOptions = parseJsonObject(stripJsonComments(text))?.['compilerOptions'];

  return {
    path,
    text,
    compilerOptions: isJsonObject(compilerOptions) ? compilerOptions : undefined,
  };
}

/**
 * `strict` decides whether generated code may rely on `strictNullChecks` narrowing, so
 * answering "no" for a strict project produces code that does not compile. Real configs
 * also carry trailing commas that survive comment stripping, so an unparseable file falls
 * back to a text search instead of quietly reporting the permissive default.
 */
function isStrict(tsconfig: TsconfigProbe): boolean {
  if (tsconfig.compilerOptions !== undefined) return tsconfig.compilerOptions['strict'] === true;

  return STRICT_PATTERN.test(tsconfig.text);
}

/**
 * Removes `//` and block comments from JSONC.
 *
 * String literals are tracked rather than regex-replaced, because `"url": "https://x"` and
 * Windows paths in `"paths"` both contain sequences that a naive replace would eat.
 */
function stripJsonComments(source: string): string {
  let output = '';
  let index = 0;
  let inString = false;

  while (index < source.length) {
    if (inString) {
      if (source.startsWith('\\', index)) {
        output += source.slice(index, index + 2);
        index += 2;
        continue;
      }

      if (source.startsWith('"', index)) inString = false;
      output += source[index] ?? '';
      index += 1;
      continue;
    }

    if (source.startsWith('"', index)) {
      inString = true;
      output += '"';
      index += 1;
      continue;
    }

    if (source.startsWith('//', index)) {
      const lineEnd = source.indexOf('\n', index);
      if (lineEnd === -1) break;
      // Leaves the newline in place so parse error positions still line up with the file.
      index = lineEnd;
      continue;
    }

    if (source.startsWith('/*', index)) {
      const blockEnd = source.indexOf('*/', index + 2);
      index = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }

    output += source[index] ?? '';
    index += 1;
  }

  return output;
}
