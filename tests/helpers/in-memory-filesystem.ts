import { dirname, posix, sep } from 'node:path';

import type { Clock } from '../../src/services/clock.service.js';
import type { FileStat, FileSystemService } from '../../src/services/filesystem.service.js';

/** Paths are normalised to forward slashes so the same test passes on Windows and POSIX. */
function normalize(path: string): string {
  return path.split(sep).join(posix.sep);
}

/**
 * Complete in-memory `FileSystemService`.
 *
 * Lets the generation pipeline be tested without temp directories, and — more usefully —
 * lets a write be made to fail on demand, which is the only practical way to prove the
 * engine's rollback actually rolls back.
 */
export class InMemoryFileSystem implements FileSystemService {
  readonly #files = new Map<string, string>();
  readonly #directories = new Set<string>(['/']);
  readonly #modified = new Map<string, Date>();

  /**
   * Absolute paths whose write throws, to simulate a mid-commit failure.
   *
   * Entries are compared after normalisation, so a caller may add either separator style.
   */
  readonly failWrites = new Set<string>();

  /** Ordered log of mutations, so tests can assert on commit ordering. */
  readonly operations: string[] = [];

  constructor(initialFiles: Readonly<Record<string, string>> = {}) {
    for (const [path, contents] of Object.entries(initialFiles)) {
      this.setFile(path, contents);
    }
  }

  /** Seeds a file without recording an operation. */
  setFile(path: string, contents: string): void {
    const key = normalize(path);
    this.#files.set(key, contents);
    this.#modified.set(key, new Date(0));
    this.#addDirectories(dirname(key));
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.#files.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  async exists(path: string): Promise<boolean> {
    const key = normalize(path);
    return this.#files.has(key) || this.#directories.has(key);
  }

  async readText(path: string): Promise<string> {
    const contents = this.#files.get(normalize(path));
    if (contents === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
    }
    return contents;
  }

  async readTextIfExists(path: string): Promise<string | undefined> {
    return this.#files.get(normalize(path));
  }

  async readJson(path: string): Promise<unknown> {
    return JSON.parse(await this.readText(path));
  }

  async writeText(path: string, contents: string): Promise<void> {
    const key = normalize(path);
    if ([...this.failWrites].some((entry) => normalize(entry) === key)) {
      throw new Error(`Simulated write failure: ${path}`);
    }
    this.#addDirectories(dirname(key));
    this.#files.set(key, contents);
    this.#modified.set(key, new Date());
    this.operations.push(`write ${key}`);
  }

  async remove(path: string): Promise<void> {
    const key = normalize(path);
    this.#files.delete(key);
    this.#directories.delete(key);
    for (const existing of [...this.#files.keys()]) {
      if (existing.startsWith(`${key}/`)) this.#files.delete(existing);
    }
    this.operations.push(`remove ${key}`);
  }

  async ensureDir(path: string): Promise<void> {
    this.#addDirectories(normalize(path));
  }

  async copyFile(from: string, to: string): Promise<void> {
    await this.writeText(to, await this.readText(from));
  }

  async listDir(path: string): Promise<readonly string[]> {
    const prefix = `${normalize(path).replace(/\/$/u, '')}/`;
    const entries = new Set<string>();

    for (const key of [...this.#files.keys(), ...this.#directories]) {
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      if (remainder.length === 0) continue;
      entries.add(remainder.split('/')[0] ?? remainder);
    }

    return [...entries].sort();
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.#directories.has(normalize(path));
  }

  async stat(path: string): Promise<FileStat | undefined> {
    const key = normalize(path);

    if (this.#directories.has(key)) {
      return { size: 0, modifiedAt: this.#modified.get(key) ?? new Date(0), isDirectory: true };
    }

    const contents = this.#files.get(key);
    if (contents === undefined) return undefined;

    return {
      size: contents.length,
      modifiedAt: this.#modified.get(key) ?? new Date(0),
      isDirectory: false,
    };
  }

  #addDirectories(path: string): void {
    let current = normalize(path);
    while (current.length > 0 && !this.#directories.has(current)) {
      this.#directories.add(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

/** Clock that never moves, so timestamped output is stable across runs. */
export class FixedClock implements Clock {
  readonly #fixed: Date;

  constructor(isoDate = '2026-01-01T00:00:00.000Z') {
    this.#fixed = new Date(isoDate);
  }

  now(): Date {
    return new Date(this.#fixed);
  }

  timestamp(): number {
    return this.#fixed.getTime();
  }
}
