import { PlanBuilder } from '../../src/engine/plan-builder.js';
import type { AnyGenerator, GeneratorMeta } from '../../src/types/generator.js';
import type { Framework, Language } from '../../src/types/project-context.js';

export interface FakeGeneratorOptions {
  readonly name: string;
  readonly summary?: string;
  readonly aliases?: readonly string[];
  readonly frameworks?: readonly Framework[];
  readonly languages?: readonly Language[];
  /** Files the generator's plan will contain, keyed by project-relative path. */
  readonly files?: Readonly<Record<string, string>>;
  readonly supported?: boolean;
}

/** Minimal generator satisfying the contract, for registry and engine tests. */
export function fakeGenerator(options: FakeGeneratorOptions): AnyGenerator {
  const meta: GeneratorMeta = {
    name: options.name,
    summary: options.summary ?? `The ${options.name} generator`,
    aliases: options.aliases ?? [],
    version: '1.0.0',
    argument: undefined,
    flags: [],
    frameworks: options.frameworks ?? [],
    languages: options.languages ?? [],
  };

  return {
    meta,
    detect: () => ({
      supported: options.supported ?? true,
      reason: (options.supported ?? true) ? undefined : 'not supported here',
      hint: undefined,
    }),
    prompt: async () => ({}),
    validate: () => undefined,
    generate: (_options, context) => {
      const builder = new PlanBuilder({ generator: meta.name, root: context.project.root });

      for (const [path, contents] of Object.entries(options.files ?? {})) {
        builder.addFile(path, contents);
      }

      return builder.build();
    },
  };
}
