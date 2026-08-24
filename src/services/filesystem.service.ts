import { dirname } from 'node:path';

import fsExtra from 'fs-extra';

const { copy, ensureDir, pathExists, readdir, readFile, remove, stat, writeFile } = fsExtra;

export interface FileStat {
  readonly size: number;
  readonly modifiedAt: Date;
  readonly isDirectory: boolean;
}

/**
 * Every filesystem read and write in Atlas goes through this interface.
 *
 * It exists to be replaced: swapping an in-memory implementation in lets the whole
 * generation pipeline — plan building, conflict detection, commit, rollback — run in a unit
 * test with no temp directories and no cleanup.
 */
export interface FileSystemService {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  /** Returns undefined instead of throwing when the file is absent. */
  readTextIfExists(path: string): Promise<string | undefined>;
  readJson(path: string): Promise<unknown>;
  writeText(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  listDir(path: string): Promise<readonly string[]>;
  isDirectory(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | undefined>;
}

/** Real filesystem, backed by fs-extra for its recursive helpers. */
export class NodeFileSystemService implements FileSystemService {
  async exists(path: string): Promise<boolean> {
    return pathExists(path);
  }

  async readText(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async readTextIfExists(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return undefined;
    }
  }

  async readJson(path: string): Promise<unknown> {
    const text = await this.readText(path);
    return JSON.parse(text);
  }

  async writeText(path: string, contents: string): Promise<void> {
    await ensureDir(dirname(path));
    await writeFile(path, contents, 'utf8');
  }

  async remove(path: string): Promise<void> {
    await remove(path);
  }

  async ensureDir(path: string): Promise<void> {
    await ensureDir(path);
  }

  async copyFile(from: string, to: string): Promise<void> {
    await ensureDir(dirname(to));
    await copy(from, to, { overwrite: true });
  }

  async listDir(path: string): Promise<readonly string[]> {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    return (await this.stat(path))?.isDirectory ?? false;
  }

  async stat(path: string): Promise<FileStat | undefined> {
    try {
      const stats = await stat(path);
      return {
        size: stats.size,
        modifiedAt: stats.mtime,
        isDirectory: stats.isDirectory(),
      };
    } catch {
      return undefined;
    }
  }
}

export { fingerprint } from '../utils/fingerprint.js';
