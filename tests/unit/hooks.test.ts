import { describe, expect, it } from 'vitest';

import {
  HookRunner,
  LIFECYCLE_STAGES,
  LifecycleStage,
  lifecycleStageIndex,
} from '../../src/engine/hooks/index.js';

/** A payload map, which is how callers get stage-specific types out of the runner. */
interface TestPayloads {
  readonly detect: { readonly root: string };
  readonly prompt: unknown;
  readonly validate: unknown;
  readonly plan: unknown;
  readonly 'resolve-conflicts': unknown;
  readonly write: readonly string[];
  readonly install: unknown;
  readonly format: unknown;
  readonly inject: unknown;
  readonly 'post-generate': unknown;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('lifecycle stages', () => {
  it('lists every stage exactly once, in run order', () => {
    expect(LIFECYCLE_STAGES).toEqual([
      'detect',
      'prompt',
      'validate',
      'plan',
      'resolve-conflicts',
      'write',
      'install',
      'format',
      'inject',
      'post-generate',
    ]);
    expect(new Set(LIFECYCLE_STAGES).size).toBe(LIFECYCLE_STAGES.length);
    expect(LIFECYCLE_STAGES.length).toBe(Object.keys(LifecycleStage).length);
  });

  it('orders install after write, so an install hook sees the files', () => {
    expect(lifecycleStageIndex(LifecycleStage.Install)).toBeGreaterThan(
      lifecycleStageIndex(LifecycleStage.Write),
    );
    expect(lifecycleStageIndex(LifecycleStage.PostGenerate)).toBe(LIFECYCLE_STAGES.length - 1);
  });
});

describe('HookRunner', () => {
  it('runs handlers in registration order', async () => {
    const runner = new HookRunner<TestPayloads>();
    const calls: string[] = [];

    runner.register(LifecycleStage.Write, () => {
      calls.push('first');
    });
    runner.register(LifecycleStage.Write, () => {
      calls.push('second');
    });
    runner.register(LifecycleStage.Write, () => {
      calls.push('third');
    });

    await runner.run(LifecycleStage.Write, []);

    expect(calls).toEqual(['first', 'second', 'third']);
  });

  it('runs handlers sequentially, not concurrently', async () => {
    const runner = new HookRunner<TestPayloads>();
    const calls: string[] = [];

    // A hook that yields to the event loop between its two writes. Under `Promise.all` the
    // second hook's entry would land in the gap; sequential execution keeps the pairs intact.
    runner.register(LifecycleStage.Write, async () => {
      calls.push('slow:start');
      await tick();
      calls.push('slow:end');
    });
    runner.register(LifecycleStage.Write, () => {
      calls.push('fast');
    });

    await runner.run(LifecycleStage.Write, []);

    expect(calls).toEqual(['slow:start', 'slow:end', 'fast']);
  });

  it('lets a later hook observe an earlier hook side effect', async () => {
    const runner = new HookRunner<TestPayloads>();
    const state = { ready: false };
    let observed: boolean | undefined;

    runner.register(LifecycleStage.Install, async () => {
      await tick();
      state.ready = true;
    });
    runner.register(LifecycleStage.Install, () => {
      observed = state.ready;
    });

    await runner.run(LifecycleStage.Install, undefined);

    expect(observed).toBe(true);
  });

  it('propagates a throwing hook and stops the stage', async () => {
    const runner = new HookRunner<TestPayloads>();
    const calls: string[] = [];

    runner.register(LifecycleStage.Format, () => {
      calls.push('before');
    });
    runner.register(LifecycleStage.Format, () => {
      throw new Error('hook exploded');
    });
    runner.register(LifecycleStage.Format, () => {
      calls.push('after');
    });

    await expect(runner.run(LifecycleStage.Format, undefined)).rejects.toThrow('hook exploded');
    expect(calls).toEqual(['before']);
  });

  it('propagates a rejected async hook', async () => {
    const runner = new HookRunner<TestPayloads>();

    runner.register(LifecycleStage.Inject, async () => {
      await tick();
      throw new Error('async hook exploded');
    });

    await expect(runner.run(LifecycleStage.Inject, undefined)).rejects.toThrow(
      'async hook exploded',
    );
  });

  it('reports which stages have handlers', () => {
    const runner = new HookRunner<TestPayloads>();

    expect(runner.has(LifecycleStage.Detect)).toBe(false);

    runner.register(LifecycleStage.Detect, () => {
      /* registration is all this test needs */
    });

    expect(runner.has(LifecycleStage.Detect)).toBe(true);
    expect(runner.has(LifecycleStage.Prompt)).toBe(false);
  });

  it('is a no-op for a stage with no handlers', async () => {
    const runner = new HookRunner<TestPayloads>();

    await expect(runner.run(LifecycleStage.PostGenerate, undefined)).resolves.toBeUndefined();
  });

  it('passes the stage payload to every handler', async () => {
    const runner = new HookRunner<TestPayloads>();
    const seen: string[] = [];

    runner.register(LifecycleStage.Detect, (payload) => {
      seen.push(payload.root);
    });
    runner.register(LifecycleStage.Detect, (payload) => {
      seen.push(payload.root.toUpperCase());
    });

    await runner.run(LifecycleStage.Detect, { root: '/project' });

    expect(seen).toEqual(['/project', '/PROJECT']);
  });
});
