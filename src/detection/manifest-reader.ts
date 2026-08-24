import { join } from 'node:path';

import { MANIFEST_FILE_NAME } from '../constants/paths.js';
import type { FileSystemService } from '../services/filesystem.service.js';
import type { PackageManifest } from '../types/project-context.js';

const EMPTY_RECORD: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Reads and normalises the target project's `package.json`.
 *
 * `undefined` covers both "absent" and "malformed", deliberately: `atlas info` has to be
 * able to describe a directory that is not a project at all, and a manifest a human has
 * hand-edited into invalid JSON is something to report calmly rather than crash on.
 */
export async function readManifest(
  fs: FileSystemService,
  root: string,
): Promise<PackageManifest | undefined> {
  const path = join(root, MANIFEST_FILE_NAME);
  const text = await fs.readTextIfExists(path);
  if (text === undefined) return undefined;

  const raw = parseJsonObject(text);
  if (raw === undefined) return undefined;

  return {
    path,
    name: asString(raw['name']),
    version: asString(raw['version']),
    type: asString(raw['type']),
    dependencies: asStringRecord(raw['dependencies']),
    devDependencies: asStringRecord(raw['devDependencies']),
    peerDependencies: asStringRecord(raw['peerDependencies']),
    scripts: asStringRecord(raw['scripts']),
    raw,
  };
}

/**
 * True when `name` appears in any dependency block.
 *
 * Detectors deliberately do not care which block it came from: a service using Fastify
 * lists it under `dependencies`, a Fastify plugin under `peerDependencies`, and a project
 * that only tests against it under `devDependencies`. All three are Fastify projects.
 */
export function hasDependency(manifest: PackageManifest | undefined, name: string): boolean {
  if (manifest === undefined) return false;

  return (
    name in manifest.dependencies ||
    name in manifest.devDependencies ||
    name in manifest.peerDependencies
  );
}

/**
 * Parses JSON that Atlas did not write, returning `undefined` rather than throwing.
 *
 * Shared with the `tsconfig.json` reader, which faces the same problem: the file belongs
 * to the user, so being unparseable is an expected state and not an exception.
 */
export function parseJsonObject(text: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonObject(parsed) ? Object.freeze(parsed) : undefined;
  } catch {
    return undefined;
  }
}

/** Arrays are excluded: every field Atlas reads this way is a keyed object or nothing. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Frozen and always present, so detectors and generators can read
 * `manifest.dependencies[name]` without first proving the block exists.
 */
function asStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isJsonObject(value)) return EMPTY_RECORD;

  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') record[key] = entry;
  }

  return Object.freeze(record);
}
