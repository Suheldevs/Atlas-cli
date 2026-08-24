import type { AnyGenerator } from '../types/generator.js';

import { authGenerator } from './auth/auth.generator.js';
import { crudGenerator } from './crud/crud.generator.js';
import { loggerGenerator } from './logger/logger.generator.js';
import { prismaGenerator } from './prisma/prisma.generator.js';
import { redisGenerator } from './redis/redis.generator.js';
import { socketGenerator } from './socket/socket.generator.js';
import { uploadGenerator } from './upload/upload.generator.js';

/**
 * Static manifest of the generators Atlas ships with.
 *
 * Deliberately a hand-maintained list rather than a filesystem scan of this directory.
 * Globbing at startup costs 20–40 ms on every invocation, breaks once the CLI is bundled
 * (there are no separate files left to find), and defeats tree-shaking. Third-party
 * generators *are* discovered dynamically, because there is no alternative there — see
 * `src/plugins/`.
 *
 * Generators are plain values, not factories: everything one needs at runtime arrives through
 * `GeneratorContext`, which is what lets them be listed here without wiring.
 *
 * Order is irrelevant — the registry sorts by name for display — so this stays alphabetical.
 */
export const BUILTIN_GENERATORS: readonly AnyGenerator[] = [
  authGenerator,
  crudGenerator,
  loggerGenerator,
  prismaGenerator,
  redisGenerator,
  socketGenerator,
  uploadGenerator,
];

export { authGenerator } from './auth/auth.generator.js';
export { crudGenerator } from './crud/crud.generator.js';
export { loggerGenerator } from './logger/logger.generator.js';
export { prismaGenerator } from './prisma/prisma.generator.js';
export { redisGenerator } from './redis/redis.generator.js';
export { socketGenerator } from './socket/socket.generator.js';
export { uploadGenerator } from './upload/upload.generator.js';

export { buildPlanFromTemplate, type TemplatePlanRequest } from './template-plan.js';
