import { describe, expect, it } from 'vitest';

import type { FileConflict } from '../../src/engine/conflict/index.js';
import {
  createConflictPrompt,
  nonInteractiveConflictAsk,
} from '../../src/prompts/conflict.prompt.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { PromptRunner, SelectQuestion } from '../../src/types/prompts.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const CONFLICT: FileConflict = {
  path: '/project/src/app.ts',
  kind: 'differs',
  existing: 'const app = 1;\nconst keep = true;\n',
  incoming: 'const app = 1;\nconst added = 2;\nconst keep = true;\n',
};

/**
 * Answers the menu from a script and records the options it was offered, which is how the
 * diff-then-re-ask loop becomes observable.
 */
class ScriptedMenu implements PromptRunner {
  readonly interactive = true;
  readonly offered: string[][] = [];
  #answers: unknown[];

  constructor(answers: readonly unknown[]) {
    this.#answers = [...answers];
  }

  async text(): Promise<string> {
    throw new Error('not used');
  }

  async confirm(): Promise<boolean> {
    throw new Error('not used');
  }

  async select<TValue>(question: SelectQuestion<TValue>): Promise<TValue> {
    this.offered.push(question.choices.map((choice) => String(choice.value)));
    const next = this.#answers.shift();
    if (next === undefined) {
      throw new Error('menu asked more times than the script had answers');
    }
    return next as TValue;
  }

  async multiSelect<TValue>(): Promise<readonly TValue[]> {
    throw new Error('not used');
  }
}

function harness(answers: readonly unknown[]): {
  ask: ReturnType<typeof createConflictPrompt>;
  menu: ScriptedMenu;
  output: () => string;
} {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false, verbose: false });
  const menu = new ScriptedMenu(answers);

  return {
    ask: createConflictPrompt({ reporter, prompts: menu, color: false }),
    menu,
    output: () => stdout.text + stderr.text,
  };
}

describe('createConflictPrompt', () => {
  it('offers all five options the spec requires', async () => {
    const subject = harness(['skip']);
    await subject.ask(CONFLICT);

    expect(subject.menu.offered[0]).toEqual(['skip', 'backup', 'diff', 'overwrite', 'abort']);
  });

  it('defaults to the least destructive answer', async () => {
    const subject = harness(['skip']);
    await subject.ask(CONFLICT);

    // `skip` is listed first so a reflexive Enter keeps the user's file.
    expect(subject.menu.offered[0]?.[0]).toBe('skip');
  });

  it('returns the chosen decision straight through', async () => {
    for (const choice of ['skip', 'backup', 'overwrite', 'abort'] as const) {
      expect(await harness([choice]).ask(CONFLICT)).toBe(choice);
    }
  });

  it('names the conflicting file before asking', async () => {
    const subject = harness(['skip']);
    await subject.ask(CONFLICT);

    expect(subject.output()).toContain('/project/src/app.ts');
  });

  it('renders a diff and then asks again', async () => {
    const subject = harness(['diff', 'skip']);

    const choice = await subject.ask(CONFLICT);

    expect(choice).toBe('skip');
    expect(subject.menu.offered).toHaveLength(2);

    const output = subject.output();
    expect(output).toContain('+const added = 2;');
    expect(output).toContain('(yours)');
    expect(output).toContain('(Atlas)');
  });

  it('allows repeated diffs before deciding', async () => {
    const subject = harness(['diff', 'diff', 'overwrite']);

    expect(await subject.ask(CONFLICT)).toBe('overwrite');
    expect(subject.menu.offered).toHaveLength(3);
  });

  it('emits no ANSI escapes when colour is disabled', async () => {
    const subject = harness(['diff', 'skip']);
    await subject.ask(CONFLICT);

    expect(subject.output()).not.toContain(String.fromCharCode(0x1b));
  });

  it('handles a conflict whose existing contents could not be read', async () => {
    const subject = harness(['diff', 'skip']);

    await subject.ask({ ...CONFLICT, existing: undefined });

    expect(subject.output()).toContain('+const app = 1;');
  });
});

describe('nonInteractiveConflictAsk', () => {
  it('always answers backup, never overwrite', async () => {
    expect(await nonInteractiveConflictAsk(CONFLICT)).toBe('backup');
  });
});
