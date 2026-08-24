import type { GenerationPlan } from '../../types/generation-plan.js';
import type {
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from '../../types/generator.js';
import { buildPlanFromTemplate } from '../template-plan.js';

import { readLoggerOptions, validateLoggerOptions, type LoggerOptions } from './logger.schema.js';

const META: GeneratorMeta = {
  name: 'logger',
  summary: 'Structured Winston logging with redaction and HTTP request middleware.',
  aliases: [],
  version: '1.0.0',
  argument: undefined,
  flags: [
    {
      flag: '--dir <path>',
      description: "Where to write the module. Defaults to the project's source directory.",
      defaultValue: undefined,
    },
  ],
  // Framework-agnostic: the logger itself is plain Winston, and the Express middleware is a
  // separate file a non-Express project simply does not import.
  frameworks: [],
  // The template is TypeScript, so `atlas list` can mark this inapplicable to a JavaScript
  // project without having to run the detector.
  languages: ['typescript'],
};

const NOTES: readonly string[] = [
  'Import the logger with `import { logger } from "./logger/index.js"` (drop the extension under CommonJS).',
  'Mount the request logger early in your middleware chain, before your routes.',
  'Set LOG_LEVEL to control verbosity. Production defaults to JSON on stdout; development to a readable line format.',
  'Logging is silenced when NODE_ENV is "test", so test output stays clean.',
];

/**
 * The logger generator.
 *
 * Deliberately the simplest possible real generator: no prompts, one flag, one template. It
 * exists as much to prove the whole path — template → tokens → plan → engine → disk — as to
 * ship a logger.
 */
export const loggerGenerator: Generator<LoggerOptions> = {
  meta: META,

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.language !== 'typescript') {
      return {
        supported: false,
        reason: 'The logger template is TypeScript, and this project is JavaScript.',
        hint: 'Add a tsconfig.json, or install typescript, and run this again.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<LoggerOptions> {
    // Nothing to ask: the one option has a good default derived from detection, and inventing
    // a question just to look interactive wastes the user's time.
    return readLoggerOptions(invocation.flags, context.project.layout.sourceDir);
  },

  validate(options: LoggerOptions): void {
    validateLoggerOptions(options);
  },

  generate(options: LoggerOptions, context: GeneratorContext): Promise<GenerationPlan> {
    return buildPlanFromTemplate({
      context,
      generator: META.name,
      template: 'logger',
      destinationPrefix: options.directory,
      notes: NOTES,
    });
  },
};
