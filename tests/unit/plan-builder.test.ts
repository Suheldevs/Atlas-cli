import { describe, expect, it } from 'vitest';

import { assertPlanIsApplicable, PlanBuilder } from '../../src/engine/plan-builder.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';

const ROOT = process.platform === 'win32' ? 'C:\\project' : '/project';

function builder(): PlanBuilder {
  return new PlanBuilder({ generator: 'test', root: ROOT });
}

describe('PlanBuilder', () => {
  it('rejects a relative root, because every path decision depends on it', () => {
    expect(() => new PlanBuilder({ generator: 'test', root: 'relative' })).toThrow(AtlasError);
  });

  it('resolves project-relative paths to absolute', () => {
    const plan = builder().addFile('src/a.ts', 'export const a = 1;').build();

    expect(plan.files[0]?.path.startsWith(ROOT)).toBe(true);
    expect(plan.files[0]?.path).toContain('a.ts');
  });

  it('defaults files to being formatted', () => {
    const plan = builder().addFile('src/a.ts', 'const a = 1;').build();

    expect(plan.files[0]?.format).toBe(true);
  });

  it('honours format: false for files prettier must not touch', () => {
    const plan = builder().addFile('.env', 'A=1', { format: false }).build();

    expect(plan.files[0]?.format).toBe(false);
  });

  it('fails loudly when the same file is queued twice', () => {
    const subject = builder().addFile('src/a.ts', 'first');

    expect(() => subject.addFile('src/a.ts', 'second')).toThrow(/queued the same file twice/u);
  });

  it('collapses a repeated dependency at the same range', () => {
    const plan = builder().addDependency('zod', '^3.23.0').addDependency('zod', '^3.23.0').build();

    expect(plan.dependencies).toHaveLength(1);
  });

  it('rejects a repeated dependency at a different range', () => {
    const subject = builder().addDependency('zod', '^3.23.0');

    expect(() => subject.addDependency('zod', '^4.0.0')).toThrow(/two different versions/u);
  });

  it('keeps prod and dev requests for one package separate', () => {
    const plan = builder()
      .addDependency('typescript', '^6.0.0', { dev: true })
      .addDependency('typescript', '^6.0.0')
      .build();

    expect(plan.dependencies).toHaveLength(2);
  });

  it('sorts files, dependencies, scripts and env for deterministic output', () => {
    const plan = builder()
      .addFile('src/z.ts', 'z')
      .addFile('src/a.ts', 'a')
      .addDependency('zod', '^3.0.0')
      .addDependency('bcrypt', '^5.0.0')
      .addScript('start', 'node .')
      .addScript('build', 'tsc')
      .addEnv('Z_KEY', '1')
      .addEnv('A_KEY', '2')
      .build();

    expect(plan.files.map((file) => file.path.endsWith('a.ts'))).toEqual([true, false]);
    expect(plan.dependencies.map((dependency) => dependency.name)).toEqual(['bcrypt', 'zod']);
    expect(plan.scripts.map((script) => script.name)).toEqual(['build', 'start']);
    expect(plan.env.map((entry) => entry.key)).toEqual(['A_KEY', 'Z_KEY']);
  });

  it('lists prod dependencies before dev ones', () => {
    const plan = builder()
      .addDependency('a-dev', '^1.0.0', { dev: true })
      .addDependency('z-prod', '^1.0.0')
      .build();

    expect(plan.dependencies.map((dependency) => dependency.dev)).toEqual([false, true]);
  });

  it('preserves the declared order of injections, where sequence is meaningful', () => {
    const plan = builder()
      .addInjection({ path: 'src/app.ts', marker: '// m', snippet: 'first', manualHint: 'h' })
      .addInjection({ path: 'src/app.ts', marker: '// m', snippet: 'second', manualHint: 'h' })
      .build();

    expect(plan.injections.map((injection) => injection.snippet)).toEqual(['first', 'second']);
  });

  it('marks secrets so nobody ships a generated one', () => {
    const plan = builder().addEnv('JWT_SECRET', 'change-me', { secret: true }).build();

    expect(plan.env[0]?.secret).toBe(true);
  });
});

describe('assertPlanIsApplicable', () => {
  it('accepts a plan confined to the project', () => {
    const plan = builder().addFile('src/a.ts', 'const a = 1;').build();

    expect(() => {
      assertPlanIsApplicable(plan);
    }).not.toThrow();
  });

  it('refuses to write outside the project root', () => {
    const plan = builder().addFile('../escape.ts', 'const a = 1;').build();

    try {
      assertPlanIsApplicable(plan);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(AtlasError.isAtlasError(error)).toBe(true);
      expect((error as AtlasError).code).toBe(ErrorCode.PlanInvalid);
    }
  });

  it('treats an empty generated file as a failed template load', () => {
    const plan = builder().addFile('src/empty.ts', '   \n').build();

    expect(() => {
      assertPlanIsApplicable(plan);
    }).toThrow(/empty files/u);
  });
});
