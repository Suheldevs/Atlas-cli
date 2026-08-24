import { describe, expect, it } from 'vitest';

import { AtlasError } from '../../src/errors/atlas-error.js';
import { InteractivePromptRunner, ScriptedPromptRunner } from '../../src/prompts/prompt-runner.js';
import { Reporter } from '../../src/services/reporter.service.js';
import { MemoryStream } from '../helpers/memory-stream.js';

function nonInteractiveRunner(): { runner: InteractivePromptRunner; output: () => string } {
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false, verbose: true });

  return {
    runner: new InteractivePromptRunner({ reporter, assumeYes: true, interactive: false }),
    output: () => stdout.text + stderr.text,
  };
}

describe('InteractivePromptRunner when nothing can be asked', () => {
  it('reports itself as non-interactive', () => {
    expect(nonInteractiveRunner().runner.interactive).toBe(false);
  });

  it('takes the default for a text question', async () => {
    const { runner } = nonInteractiveRunner();

    expect(
      await runner.text({ message: 'Entity name?', defaultValue: 'User', validate: undefined }),
    ).toBe('User');
  });

  it('falls back to an empty string when a text question has no default', async () => {
    const { runner } = nonInteractiveRunner();

    expect(
      await runner.text({ message: 'Anything?', defaultValue: undefined, validate: undefined }),
    ).toBe('');
  });

  it('takes the default for a confirmation', async () => {
    const { runner } = nonInteractiveRunner();

    expect(await runner.confirm({ message: 'Overwrite?', defaultValue: false })).toBe(false);
    expect(await runner.confirm({ message: 'Continue?', defaultValue: true })).toBe(true);
  });

  it('takes the declared default for a selection', async () => {
    const { runner } = nonInteractiveRunner();

    const chosen = await runner.select({
      message: 'Database?',
      choices: [
        { label: 'Prisma', value: 'prisma', description: undefined },
        { label: 'Mongoose', value: 'mongoose', description: undefined },
      ],
      defaultValue: 'mongoose',
    });

    expect(chosen).toBe('mongoose');
  });

  it('falls back to the first choice when a selection has no default', async () => {
    const { runner } = nonInteractiveRunner();

    const chosen = await runner.select({
      message: 'Database?',
      choices: [
        { label: 'Prisma', value: 'prisma', description: undefined },
        { label: 'Mongoose', value: 'mongoose', description: undefined },
      ],
      defaultValue: undefined,
    });

    expect(chosen).toBe('prisma');
  });

  it('refuses to invent an answer when a selection has no choices at all', async () => {
    const { runner } = nonInteractiveRunner();

    await expect(
      runner.select({ message: 'Impossible?', choices: [], defaultValue: undefined }),
    ).rejects.toBeInstanceOf(AtlasError);
  });

  it('records the answers it chose, so --verbose can explain the outcome', async () => {
    const { runner, output } = nonInteractiveRunner();

    await runner.confirm({ message: 'Include refresh tokens?', defaultValue: true });

    expect(output()).toContain('Include refresh tokens?');
    expect(output()).toContain('default');
  });
});

describe('ScriptedPromptRunner', () => {
  it('returns answers in order', async () => {
    const runner = new ScriptedPromptRunner(['Order', true]);

    expect(
      await runner.text({ message: 'Entity?', defaultValue: 'User', validate: undefined }),
    ).toBe('Order');
    expect(await runner.confirm({ message: 'Sure?', defaultValue: false })).toBe(true);
  });

  it('falls back to defaults once the script runs out', async () => {
    const runner = new ScriptedPromptRunner([]);

    expect(await runner.confirm({ message: 'Sure?', defaultValue: true })).toBe(true);
  });

  it('never claims to be interactive', () => {
    expect(new ScriptedPromptRunner().interactive).toBe(false);
  });
});
