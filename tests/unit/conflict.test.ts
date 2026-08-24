import { describe, expect, it } from 'vitest';

import { backupPathFor, isBackupPath } from '../../src/engine/conflict/backup-strategy.js';
import {
  detectConflicts,
  requiresDecision,
  type FileConflict,
} from '../../src/engine/conflict/conflict-detector.js';
import {
  ConflictResolver,
  outcomeForDecision,
  type ConflictChoice,
} from '../../src/engine/conflict/conflict-resolver.js';
import { renderUnifiedDiff } from '../../src/engine/conflict/diff-renderer.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { FileOperation } from '../../src/types/generation-plan.js';
import { FixedClock, InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const ESC = String.fromCharCode(0x1b);
const ROUTER = '/project/src/router.ts';
const SERVICE = '/project/src/service.ts';
const NEW_FILE = '/project/src/new.ts';

/** The `FixedClock` default, spelled out so the expected backup name is readable. */
const FIXED_TIMESTAMP = 1767225600000;

function file(path: string, contents: string): FileOperation {
  return { path, contents, format: true, label: undefined };
}

function conflict(kind: FileConflict['kind'], path: string): FileConflict {
  return {
    path,
    kind,
    existing: kind === 'absent' ? undefined : 'existing\n',
    incoming: 'incoming\n',
  };
}

interface ResolverHarness {
  readonly resolver: ConflictResolver;
  readonly asked: string[];
  readonly output: () => string;
}

function resolverHarness(answers: readonly ConflictChoice[] = []): ResolverHarness {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const asked: string[] = [];
  const queue = [...answers];

  const resolver = new ConflictResolver({
    reporter: new Reporter({ stdout, stderr, color: false }),
    clock: new FixedClock(),
    ask: (received) => {
      asked.push(received.path);
      return Promise.resolve(queue.shift() ?? 'skip');
    },
  });

  return { resolver, asked, output: () => stdout.text + stderr.text };
}

describe('detectConflicts', () => {
  it('classifies absent, identical and differing targets in one pass', async () => {
    const fs = new InMemoryFileSystem({
      [ROUTER]: 'export const router = 1;\n',
      [SERVICE]: 'export const service = 1;\n',
    });

    const conflicts = await detectConflicts(fs, [
      file(ROUTER, 'export const router = 1;\n'),
      file(SERVICE, 'export const service = 2;\n'),
      file(NEW_FILE, 'export const fresh = 1;\n'),
    ]);

    expect(conflicts.map((entry) => entry.kind)).toEqual(['identical', 'differs', 'absent']);
    expect(conflicts[0]?.existing).toBe('export const router = 1;\n');
    expect(conflicts[2]?.existing).toBeUndefined();
    expect(conflicts[1]?.incoming).toBe('export const service = 2;\n');
    // Detection is read-only: the questions are asked before anything is touched.
    expect(fs.operations).toEqual([]);
  });

  it('treats a CRLF checkout of identical content as identical, not a conflict', async () => {
    const fs = new InMemoryFileSystem({ [ROUTER]: 'import x;\r\nexport default x;\r\n' });

    const conflicts = await detectConflicts(fs, [file(ROUTER, 'import x;\nexport default x;\n')]);

    expect(conflicts[0]?.kind).toBe('identical');
  });

  it('asks for a decision only about files that differ', () => {
    expect(requiresDecision(conflict('differs', ROUTER))).toBe(true);
    expect(requiresDecision(conflict('identical', ROUTER))).toBe(false);
    expect(requiresDecision(conflict('absent', ROUTER))).toBe(false);
  });
});

describe('ConflictResolver', () => {
  it('does not ask about a file that is not there', async () => {
    const h = resolverHarness();

    const resolution = await h.resolver.resolve([conflict('absent', NEW_FILE)], {
      assumeYes: false,
    });

    expect(h.asked).toEqual([]);
    expect(resolution.decisions[0]?.choice).toBe('overwrite');
    expect(resolution.decisions[0]?.backupPath).toBeUndefined();
  });

  it('skips an identical file silently', async () => {
    const h = resolverHarness();

    const resolution = await h.resolver.resolve([conflict('identical', ROUTER)], {
      assumeYes: false,
    });

    expect(h.asked).toEqual([]);
    expect(resolution.decisions[0]?.choice).toBe('skip');
    expect(h.output()).toBe('');
  });

  it('resolves --yes to a backup rather than an overwrite', async () => {
    const h = resolverHarness();

    const resolution = await h.resolver.resolve([conflict('differs', ROUTER)], {
      assumeYes: true,
    });

    expect(h.asked).toEqual([]);
    expect(resolution.decisions[0]?.choice).toBe('backup');
    expect(resolution.decisions[0]?.backupPath).toBe(
      `${ROUTER}.${String(FIXED_TIMESTAMP)}.atlas-backup`,
    );
  });

  it('honours each interactive answer', async () => {
    const h = resolverHarness(['overwrite', 'skip', 'backup']);

    const resolution = await h.resolver.resolve(
      [conflict('differs', ROUTER), conflict('differs', SERVICE), conflict('differs', NEW_FILE)],
      { assumeYes: false },
    );

    expect(h.asked).toEqual([ROUTER, SERVICE, NEW_FILE]);
    expect(resolution.decisions.map((decision) => decision.choice)).toEqual([
      'overwrite',
      'skip',
      'backup',
    ]);
    expect(resolution.decisions[0]?.backupPath).toBeUndefined();
    expect(resolution.decisions[2]?.backupPath).toContain('atlas-backup');
  });

  it('keys decisions by path for the commit walk', async () => {
    const h = resolverHarness(['overwrite']);

    const resolution = await h.resolver.resolve(
      [conflict('absent', NEW_FILE), conflict('differs', ROUTER)],
      { assumeYes: false },
    );

    expect(resolution.byPath.get(ROUTER)?.choice).toBe('overwrite');
    expect(resolution.byPath.get(NEW_FILE)?.kind).toBe('absent');
    expect(resolution.byPath.size).toBe(2);
  });

  it('fails with ATLAS_3002 and lists every conflict when the user aborts', async () => {
    const h = resolverHarness(['abort']);

    const error = await h.resolver
      .resolve([conflict('differs', ROUTER), conflict('differs', SERVICE)], { assumeYes: false })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AtlasError);
    expect((error as AtlasError).code).toBe('ATLAS_3002');
    expect((error as AtlasError).details).toEqual([ROUTER, SERVICE]);
    // The second file was never reached: aborting stops the questioning immediately.
    expect(h.asked).toEqual([ROUTER]);
  });
});

describe('outcomeForDecision', () => {
  it('maps each decision onto the outcome the run reports', async () => {
    const h = resolverHarness(['overwrite', 'skip', 'backup']);

    const resolution = await h.resolver.resolve(
      [
        conflict('absent', NEW_FILE),
        conflict('identical', '/project/src/same.ts'),
        conflict('differs', ROUTER),
        conflict('differs', SERVICE),
        conflict('differs', '/project/src/third.ts'),
      ],
      { assumeYes: false },
    );

    expect(resolution.decisions.map(outcomeForDecision)).toEqual([
      'created',
      'skipped',
      'overwritten',
      'skipped',
      'backed-up',
    ]);
  });
});

describe('backupPathFor', () => {
  it('keeps the original extension visible and is deterministic under a fixed clock', () => {
    expect(backupPathFor(ROUTER, new FixedClock())).toBe(
      `${ROUTER}.${String(FIXED_TIMESTAMP)}.atlas-backup`,
    );
  });

  it('recognises the names it produces', () => {
    expect(isBackupPath(backupPathFor(ROUTER, new FixedClock()))).toBe(true);
    expect(isBackupPath(ROUTER)).toBe(false);
  });
});

describe('renderUnifiedDiff', () => {
  const before = "import a from 'a';\nconst x = 1;\nexport default x;\n";
  const inserted = "import a from 'a';\nconst x = 1;\nconst y = 2;\nexport default x;\n";

  it('reports an inserted line as an addition and leaves the rest as context', () => {
    const diff = renderUnifiedDiff(before, inserted, { color: false });

    expect(diff.split('\n')).toEqual([
      '--- existing',
      '+++ incoming',
      '@@ -1,3 +1,4 @@',
      " import a from 'a';",
      ' const x = 1;',
      '+const y = 2;',
      ' export default x;',
    ]);
  });

  it('reports a removed line as a deletion', () => {
    const diff = renderUnifiedDiff(inserted, before, { color: false });

    expect(diff).toContain('-const y = 2;');
    expect(diff).not.toContain('+const y = 2;');
  });

  it('emits no ANSI when colour is off and green and red when it is on', () => {
    expect(renderUnifiedDiff(before, inserted, { color: false })).not.toContain(ESC);

    const coloured = renderUnifiedDiff(before, inserted, { color: true });
    expect(coloured).toContain(`${ESC}[32m+const y = 2;${ESC}[39m`);
    expect(renderUnifiedDiff(inserted, before, { color: true })).toContain(
      `${ESC}[31m-const y = 2;${ESC}[39m`,
    );
  });

  it('returns nothing at all when the two sides match, line endings aside', () => {
    expect(renderUnifiedDiff(before, before, { color: true })).toBe('');
    expect(renderUnifiedDiff('a\r\nb\r\n', 'a\nb\n', { color: false })).toBe('');
  });

  it('honours the custom labels used to name the two sides', () => {
    const diff = renderUnifiedDiff(before, inserted, {
      color: false,
      existingLabel: 'src/index.ts (yours)',
      incomingLabel: 'src/index.ts (atlas)',
    });

    expect(diff.startsWith('--- src/index.ts (yours)\n+++ src/index.ts (atlas)\n')).toBe(true);
  });

  it('shows three lines of context and no more', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${String(index)}`);
    const changed = [...lines];
    changed[10] = 'line ten, edited';

    const diff = renderUnifiedDiff(`${lines.join('\n')}\n`, `${changed.join('\n')}\n`, {
      color: false,
    });

    expect(diff).toContain('@@ -8,7 +8,7 @@');
    expect(diff).toContain(' line 7');
    expect(diff).toContain('-line 10');
    expect(diff).toContain('+line ten, edited');
    expect(diff).toContain(' line 13');
    expect(diff).not.toContain('line 6');
    expect(diff).not.toContain('line 14');
  });

  it('aligns a whole-file rewrite without pretending unrelated lines survived', () => {
    const diff = renderUnifiedDiff('one\ntwo\n', 'alpha\nbeta\n', { color: false });

    expect(diff).toContain('-one');
    expect(diff).toContain('-two');
    expect(diff).toContain('+alpha');
    expect(diff).toContain('+beta');
  });
});
