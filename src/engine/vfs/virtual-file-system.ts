import { sep } from 'node:path';

import type { FileSystemService } from '../../services/filesystem.service.js';

export interface StagedWrite {
  readonly kind: 'write';
  readonly path: string;
  readonly contents: string;
}

export interface StagedDelete {
  readonly kind: 'delete';
  readonly path: string;
}

export interface StagedCopy {
  readonly kind: 'copy';
  readonly from: string;
  readonly to: string;
}

/** One buffered mutation. Discriminated on `kind` so `commit` and `--dry-run` share one walk. */
export type StagedOperation = StagedWrite | StagedDelete | StagedCopy;

/**
 * A copy is resolved lazily: `stageCopy` is synchronous and cannot read the source, so the
 * overlay remembers where to look and defers to read time.
 */
type OverlayEntry =
  | { readonly kind: 'write'; readonly contents: string }
  | { readonly kind: 'delete' }
  | { readonly kind: 'copy'; readonly from: string };

/**
 * Map keys are compared, so a path reached as `src\a.ts` must hash the same as `src/a.ts`.
 * Only done on Windows, where a backslash cannot be part of a filename.
 */
function toKey(path: string): string {
  return sep === '\\' ? path.split('\\').join('/') : path;
}

/**
 * Staging area in front of a `FileSystemService`.
 *
 * Nothing reaches disk until `commitStagedOperations` flushes it, which is what lets Atlas ask
 * every conflict question before doing any work and roll the whole run back afterwards. Reads
 * are layered over the staged state so a generator that writes a file and then reads it back
 * sees its own write, exactly as it would against a real filesystem.
 */
export class VirtualFileSystem {
  readonly #fs: FileSystemService;
  readonly #operations: StagedOperation[] = [];
  readonly #overlay = new Map<string, OverlayEntry>();
  /** Position of the outstanding write for a path, so re-staging replaces rather than appends. */
  readonly #writeIndex = new Map<string, number>();

  constructor(fs: FileSystemService) {
    this.#fs = fs;
  }

  /**
   * Staging the same path twice replaces the earlier write in place. A generator that revises
   * a file it already staged means one write, and `pending()` is rendered to the user by
   * `--dry-run`, where listing a file twice reads as a bug.
   */
  stageWrite(path: string, contents: string): void {
    const key = toKey(path);
    const operation: StagedWrite = { kind: 'write', path, contents };
    const index = this.#writeIndex.get(key);

    if (index === undefined) {
      this.#writeIndex.set(key, this.#operations.length);
      this.#operations.push(operation);
    } else {
      this.#operations[index] = operation;
    }

    this.#overlay.set(key, { kind: 'write', contents });
  }

  stageDelete(path: string): void {
    const key = toKey(path);
    // A later delete supersedes the pending write, so that write must stay where it is in the
    // sequence rather than being replaced by the next `stageWrite` for the same path.
    this.#writeIndex.delete(key);
    this.#operations.push({ kind: 'delete', path });
    this.#overlay.set(key, { kind: 'delete' });
  }

  stageCopy(from: string, to: string): void {
    const key = toKey(to);
    this.#writeIndex.delete(key);
    this.#operations.push({ kind: 'copy', from, to });
    this.#overlay.set(key, { kind: 'copy', from });
  }

  /** Ordered: the sequence `commit` will apply, and the sequence `--dry-run` renders. */
  pending(): readonly StagedOperation[] {
    return [...this.#operations];
  }

  isStaged(path: string): boolean {
    return this.#overlay.has(toKey(path));
  }

  exists(path: string): Promise<boolean> {
    const entry = this.#overlay.get(toKey(path));
    if (entry === undefined) return this.#fs.exists(path);
    if (entry.kind === 'delete') return Promise.resolve(false);
    if (entry.kind === 'write') return Promise.resolve(true);
    return this.#fs.exists(entry.from);
  }

  readTextIfExists(path: string): Promise<string | undefined> {
    return this.#read(path, new Set<string>());
  }

  clear(): void {
    this.#operations.length = 0;
    this.#overlay.clear();
    this.#writeIndex.clear();
  }

  #read(path: string, seen: Set<string>): Promise<string | undefined> {
    const key = toKey(path);
    const entry = this.#overlay.get(key);

    if (entry === undefined) return this.#fs.readTextIfExists(path);

    switch (entry.kind) {
      case 'write':
        return Promise.resolve(entry.contents);
      case 'delete':
        return Promise.resolve(undefined);
      case 'copy':
        // Copies chain (a backup of a file that is itself staged as a copy), so a cycle is
        // reachable through mis-staging and must not become an infinite recursion.
        if (seen.has(key)) return Promise.resolve(undefined);
        seen.add(key);
        return this.#read(entry.from, seen);
    }
  }
}
