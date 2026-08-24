import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type { AnyGenerator } from '../types/generator.js';
import type { AtlasPlugin } from '../types/plugin.js';

/**
 * Validates that an imported module really satisfies the plugin contract.
 *
 * A plugin is arbitrary third-party code loaded into Atlas's process, so it gets checked at
 * the boundary and rejected with a precise complaint. The alternative is a `TypeError` deep
 * inside the engine that looks like an Atlas bug and gets reported as one.
 */

const REQUIRED_GENERATOR_METHODS = ['detect', 'prompt', 'validate', 'generate'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFunction(value: unknown): boolean {
  return typeof value === 'function';
}

function describeGeneratorProblems(candidate: unknown, index: number): readonly string[] {
  const label = `generators[${String(index)}]`;

  if (!isRecord(candidate)) {
    return [`${label} is not an object`];
  }

  const problems: string[] = [];
  const meta = candidate['meta'];

  if (!isRecord(meta)) {
    problems.push(`${label}.meta is missing`);
  } else {
    if (typeof meta['name'] !== 'string' || meta['name'].length === 0) {
      problems.push(`${label}.meta.name must be a non-empty string`);
    }
    if (typeof meta['summary'] !== 'string') {
      problems.push(`${label}.meta.summary must be a string`);
    }
    if (!Array.isArray(meta['aliases'])) {
      problems.push(`${label}.meta.aliases must be an array`);
    }
    if (!Array.isArray(meta['frameworks'])) {
      problems.push(`${label}.meta.frameworks must be an array`);
    }
  }

  for (const method of REQUIRED_GENERATOR_METHODS) {
    if (!isFunction(candidate[method])) {
      problems.push(`${label}.${method}() is missing`);
    }
  }

  return problems;
}

/** Narrows an imported module's export to `AtlasPlugin`, or throws explaining exactly why not. */
export function assertIsPlugin(candidate: unknown, specifier: string): AtlasPlugin {
  const problems: string[] = [];

  if (!isRecord(candidate)) {
    throw new AtlasError({
      code: ErrorCode.PluginInvalid,
      message: `${specifier} does not export an Atlas plugin.`,
      hint: 'A plugin must default-export an object with { name, version, generators }.',
    });
  }

  if (typeof candidate['name'] !== 'string' || candidate['name'].length === 0) {
    problems.push('name must be a non-empty string');
  }

  if (typeof candidate['version'] !== 'string') {
    problems.push('version must be a string');
  }

  const generators = candidate['generators'];

  if (!Array.isArray(generators)) {
    problems.push('generators must be an array');
  } else {
    generators.forEach((generator, index) => {
      problems.push(...describeGeneratorProblems(generator, index));
    });
  }

  if (problems.length > 0) {
    throw new AtlasError({
      code: ErrorCode.PluginInvalid,
      message: `${specifier} is not a valid Atlas plugin.`,
      details: problems,
      hint: 'See docs/plugin-development.md for the expected shape.',
    });
  }

  return candidate as unknown as AtlasPlugin;
}

/** Same checks, applied to a single generator registered directly rather than via a plugin. */
export function assertIsGenerator(candidate: unknown, specifier: string): AnyGenerator {
  const problems = describeGeneratorProblems(candidate, 0);

  if (problems.length > 0) {
    throw new AtlasError({
      code: ErrorCode.PluginInvalid,
      message: `${specifier} does not satisfy the generator contract.`,
      details: problems,
    });
  }

  return candidate as AnyGenerator;
}
