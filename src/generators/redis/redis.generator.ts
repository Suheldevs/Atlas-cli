import type { GenerationPlan } from '../../types/generation-plan.js';
import type {
  DetectionVerdict,
  Generator,
  GeneratorContext,
  GeneratorInvocation,
  GeneratorMeta,
} from '../../types/generator.js';
import { buildPlanFromTemplate } from '../template-plan.js';

import { readRedisOptions, validateRedisOptions, type RedisOptions } from './redis.schema.js';

const META: GeneratorMeta = {
  name: 'redis',
  summary: 'An ioredis client with env-driven config, graceful shutdown and cache helpers.',
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
  // Framework-agnostic: a Redis client is not web-specific, and nothing in the template touches
  // a request or a response.
  frameworks: [],
  // The template is TypeScript, so `atlas list` can mark this inapplicable to a JavaScript
  // project without having to run the detector.
  languages: ['typescript'],
};

const NOTES: readonly string[] = [
  'Import the client with `import { redis, cache } from "./redis/index.js"` (drop the extension under CommonJS).',
  'Set REDIS_URL (defaults to redis://127.0.0.1:6379). Optional: REDIS_KEY_PREFIX, REDIS_TLS=true, REDIS_DEFAULT_TTL_SECONDS (defaults to 300).',
  'The connection is lazy, so importing the module does not open a socket. Call connectRedis() at startup if you want to fail fast.',
  'Call disconnectRedis() on SIGTERM so in-flight commands finish before the process exits.',
  'checkRedis() returns a small ok/latency result for a readiness endpoint.',
];

/**
 * The redis generator.
 *
 * Structurally identical to the logger generator: one template, one flag, nothing to prompt for.
 */
export const redisGenerator: Generator<RedisOptions> = {
  meta: META,

  detect(context: GeneratorContext): DetectionVerdict {
    if (context.project.language !== 'typescript') {
      return {
        supported: false,
        reason: 'The redis template is TypeScript, and this project is JavaScript.',
        hint: 'Add a tsconfig.json, or install typescript, and run this again.',
      };
    }

    return { supported: true, reason: undefined, hint: undefined };
  },

  async prompt(invocation: GeneratorInvocation, context: GeneratorContext): Promise<RedisOptions> {
    // Nothing worth asking: the URL and prefix are environment concerns, not generation-time
    // choices, so the only option is where the files land — and that has a good default.
    return readRedisOptions(invocation.flags, context.project.layout.sourceDir);
  },

  validate(options: RedisOptions): void {
    validateRedisOptions(options);
  },

  generate(options: RedisOptions, context: GeneratorContext): Promise<GenerationPlan> {
    return buildPlanFromTemplate({
      context,
      generator: META.name,
      template: 'redis',
      destinationPrefix: options.directory,
      notes: NOTES,
    });
  },
};
