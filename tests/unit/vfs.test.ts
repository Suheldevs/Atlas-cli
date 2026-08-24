import { describe, expect, it } from 'vitest';

import { commitStagedOperations } from '../../src/engine/vfs/commit.js';
import { RollbackJournal } from '../../src/engine/vfs/rollback.js';
import { VirtualFileSystem } from '../../src/engine/vfs/virtual-file-system.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { Reporter } from '../../src/services/reporter.service.js';
import { InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const A = '/project/src/a.ts';
const B = '/project/src/b.ts';
const C = '/project/src/c.ts';
const KEEP = '/project/src/keep.ts';

interface Harness {
  readonly fs: InMemoryFileSystem;
  readonly vfs: VirtualFileSystem;
  readonly journal: RollbackJournal;
  readonly reporter: Reporter;
  readonly stdout: MemoryStream;
  readonly stderr: MemoryStream;
}

function harness(initial: Readonly<Record<string, string>> = {}): Harness {
  const fs = new InMemoryFileSystem(initial);
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false });

  return {
    fs,
    vfs: new VirtualFileSystem(fs),
    journal: new RollbackJournal({ fs }),
    reporter,
    stdout,
    stderr,
  };
}

function commit(h: Harness, dryRun = false): Promise<readonly string[]> {
  return commitStagedOperations({
    vfs: h.vfs,
    fs: h.fs,
    journal: h.journal,
    reporter: h.reporter,
    dryRun,
  });
}

describe('VirtualFileSystem', () => {
  it('shows a staged write to a reader before anything is committed', async () => {
    const h = harness();

    h.vfs.stageWrite(A, 'export const a = 1;\n');

    await expect(h.vfs.readTextIfExists(A)).resolves.toBe('export const a = 1;\n');
    await expect(h.vfs.exists(A)).resolves.toBe(true);
    expect(h.fs.snapshot()).toEqual({});
    expect(h.fs.operations).toEqual([]);
  });

  it('layers a staged write over the real contents of an existing file', async () => {
    const h = harness({ [A]: 'old\n' });

    h.vfs.stageWrite(A, 'new\n');

    await expect(h.vfs.readTextIfExists(A)).resolves.toBe('new\n');
    await expect(h.fs.readText(A)).resolves.toBe('old\n');
  });

  it('falls through to disk for paths it has not staged', async () => {
    const h = harness({ [KEEP]: 'kept\n' });

    await expect(h.vfs.readTextIfExists(KEEP)).resolves.toBe('kept\n');
    await expect(h.vfs.readTextIfExists(B)).resolves.toBeUndefined();
    expect(h.vfs.isStaged(KEEP)).toBe(false);
  });

  it('hides a staged delete from reads', async () => {
    const h = harness({ [A]: 'doomed\n' });

    h.vfs.stageDelete(A);

    await expect(h.vfs.readTextIfExists(A)).resolves.toBeUndefined();
    await expect(h.vfs.exists(A)).resolves.toBe(false);
    expect(h.vfs.isStaged(A)).toBe(true);
  });

  it('resolves a staged copy through to the source contents, including staged sources', async () => {
    const h = harness({ [A]: 'on disk\n' });

    h.vfs.stageCopy(A, `${A}.backup`);
    h.vfs.stageCopy(KEEP, `${KEEP}.backup`);
    h.vfs.stageWrite(KEEP, 'staged source\n');

    await expect(h.vfs.readTextIfExists(`${A}.backup`)).resolves.toBe('on disk\n');
    await expect(h.vfs.readTextIfExists(`${KEEP}.backup`)).resolves.toBe('staged source\n');
  });

  it('keeps pending operations in staging order', () => {
    const h = harness();

    h.vfs.stageCopy(A, `${A}.backup`);
    h.vfs.stageWrite(A, 'first\n');
    h.vfs.stageDelete(B);

    expect(h.vfs.pending()).toEqual([
      { kind: 'copy', from: A, to: `${A}.backup` },
      { kind: 'write', path: A, contents: 'first\n' },
      { kind: 'delete', path: B },
    ]);
  });

  it('collapses a re-staged write so a file is listed once', () => {
    const h = harness();

    h.vfs.stageWrite(A, 'first\n');
    h.vfs.stageWrite(B, 'b\n');
    h.vfs.stageWrite(A, 'revised\n');

    expect(h.vfs.pending()).toEqual([
      { kind: 'write', path: A, contents: 'revised\n' },
      { kind: 'write', path: B, contents: 'b\n' },
    ]);
  });

  it('does not let a write staged after a delete jump back before it', () => {
    const h = harness();

    h.vfs.stageWrite(A, 'first\n');
    h.vfs.stageDelete(A);
    h.vfs.stageWrite(A, 'recreated\n');

    expect(h.vfs.pending().map((operation) => operation.kind)).toEqual([
      'write',
      'delete',
      'write',
    ]);
  });

  it('drops every staged operation on clear', async () => {
    const h = harness();

    h.vfs.stageWrite(A, 'x\n');
    h.vfs.clear();

    expect(h.vfs.pending()).toEqual([]);
    expect(h.vfs.isStaged(A)).toBe(false);
    await expect(h.vfs.readTextIfExists(A)).resolves.toBeUndefined();
  });
});

describe('commitStagedOperations', () => {
  it('applies operations to disk in staging order', async () => {
    const h = harness({ [A]: 'old\n' });

    h.vfs.stageCopy(A, `${A}.backup`);
    h.vfs.stageWrite(A, 'new\n');
    h.vfs.stageWrite(C, 'c\n');

    const applied = await commit(h);

    expect(h.fs.operations).toEqual([`write ${A}.backup`, `write ${A}`, `write ${C}`]);
    expect(applied).toEqual([`${A}.backup`, A, C]);
    expect(h.fs.snapshot()).toEqual({
      [A]: 'new\n',
      [`${A}.backup`]: 'old\n',
      [C]: 'c\n',
    });
  });

  it('applies a staged delete', async () => {
    const h = harness({ [A]: 'doomed\n', [KEEP]: 'kept\n' });

    h.vfs.stageDelete(A);
    await commit(h);

    expect(h.fs.snapshot()).toEqual({ [KEEP]: 'kept\n' });
  });

  it('clears the staging area once the work has been flushed', async () => {
    const h = harness();

    h.vfs.stageWrite(A, 'a\n');
    await commit(h);

    expect(h.vfs.pending()).toEqual([]);
  });

  it('writes nothing on a dry run but reports what it would have done', async () => {
    const h = harness({ [A]: 'old\n' });
    const before = h.fs.snapshot();

    h.vfs.stageWrite(A, 'new\n');
    h.vfs.stageWrite(B, 'b\n');
    h.vfs.stageDelete(KEEP);

    const applied = await commit(h, true);

    expect(applied).toEqual([A, B, KEEP]);
    expect(h.fs.operations).toEqual([]);
    expect(h.fs.snapshot()).toEqual(before);
    // A dry run must be repeatable, so it leaves the staged work exactly where it found it.
    expect(h.vfs.pending()).toHaveLength(3);
  });

  it('leaves the project byte-identical when a write fails part-way through', async () => {
    const h = harness({ [KEEP]: 'kept\n' });
    const before = h.fs.snapshot();

    h.fs.failWrites.add(B);
    h.vfs.stageWrite(A, 'a\n');
    h.vfs.stageWrite(B, 'b\n');
    h.vfs.stageWrite(C, 'c\n');

    await expect(commit(h)).rejects.toMatchObject({ code: ErrorCode.GenerationFailed });

    expect(h.fs.snapshot()).toEqual(before);
  });

  it('restores the previous contents of files it had already modified', async () => {
    const h = harness({ [A]: 'original a\n', [B]: 'original b\n', [KEEP]: 'kept\n' });
    const before = h.fs.snapshot();

    h.fs.failWrites.add(C);
    h.vfs.stageWrite(A, 'rewritten a\n');
    h.vfs.stageWrite(B, 'rewritten b\n');
    h.vfs.stageWrite(C, 'c\n');

    await expect(commit(h)).rejects.toThrow(AtlasError);

    expect(h.fs.snapshot()).toEqual(before);
  });

  it('reports the failure as ATLAS_3001 and keeps the original error as the cause', async () => {
    const h = harness();

    h.fs.failWrites.add(A);
    h.vfs.stageWrite(A, 'a\n');

    const error = await commit(h).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AtlasError);
    expect((error as AtlasError).code).toBe('ATLAS_3001');
    expect((error as AtlasError).message).toContain('no changes were kept');
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(h.stderr.text).toContain('Rolling back');
  });

  it('reverses a re-staged path back to the state it had before the run', async () => {
    const h = harness({ [A]: 'original\n' });
    const before = h.fs.snapshot();

    h.vfs.stageWrite(A, 'first\n');
    h.vfs.stageDelete(A);
    h.vfs.stageWrite(B, 'b\n');
    h.fs.failWrites.add(B);

    await expect(commit(h)).rejects.toThrow(AtlasError);

    expect(h.fs.snapshot()).toEqual(before);
  });
});

describe('RollbackJournal', () => {
  it('records a removal for a file that did not exist and a restore for one that did', async () => {
    const fs = new InMemoryFileSystem({ [A]: 'original\n' });
    const journal = new RollbackJournal({ fs });

    await journal.capture(A);
    await journal.capture(B);

    expect(journal.entries()).toEqual([
      { kind: 'restore', path: A, contents: 'original\n' },
      { kind: 'remove', path: B },
    ]);
    expect(journal.size).toBe(2);
  });

  it('reverses entries newest first so the oldest recorded state wins', async () => {
    const fs = new InMemoryFileSystem({ [A]: 'original\n' });
    const journal = new RollbackJournal({ fs });

    await journal.capture(A);
    await fs.writeText(A, 'mid\n');
    await journal.capture(A);
    await fs.writeText(A, 'latest\n');

    await journal.restore();

    await expect(fs.readText(A)).resolves.toBe('original\n');
  });

  it('empties itself after a successful restore', async () => {
    const fs = new InMemoryFileSystem({ [A]: 'original\n' });
    const journal = new RollbackJournal({ fs });

    await journal.capture(A);
    await journal.restore();

    expect(journal.entries()).toEqual([]);
  });

  it('attempts every entry and lists all unrestorable paths in one ATLAS_3004', async () => {
    const fs = new InMemoryFileSystem({ [A]: 'original a\n', [B]: 'original b\n', [C]: 'c\n' });
    const journal = new RollbackJournal({ fs });

    await journal.capture(A);
    await journal.capture(B);
    await journal.capture(C);
    await fs.writeText(C, 'changed c\n');

    fs.failWrites.add(A);
    fs.failWrites.add(B);

    const error = await journal.restore().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AtlasError);
    expect((error as AtlasError).code).toBe('ATLAS_3004');
    expect((error as AtlasError).details.join('\n')).toContain(A);
    expect((error as AtlasError).details.join('\n')).toContain(B);
    expect((error as AtlasError).details).toHaveLength(2);
    // The entries that could be reversed were still reversed, rather than abandoned at the
    // first failure.
    await expect(fs.readText(C)).resolves.toBe('c\n');
  });

  it('clears without touching disk', async () => {
    const fs = new InMemoryFileSystem({ [A]: 'original\n' });
    const journal = new RollbackJournal({ fs });

    await journal.capture(A);
    journal.clear();
    await journal.restore();

    expect(fs.operations).toEqual([]);
  });
});
