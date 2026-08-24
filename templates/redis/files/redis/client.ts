/**
 * The Redis connection: config from the environment, one shared client, lifecycle helpers.
 */
import { Redis } from 'ioredis';

const DEFAULT_URL = 'redis://127.0.0.1:6379';
const DEFAULT_TTL_SECONDS = 300;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function readSeconds(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;

  const parsed = Number(raw);

  // Fail here rather than let a NaN TTL through, which Redis would accept as "no expiry".
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number of seconds, got "${raw}".`);
  }

  return parsed;
}

export const redisConfig = {
  url: readEnv('REDIS_URL') ?? DEFAULT_URL,
  keyPrefix: readEnv('REDIS_KEY_PREFIX') ?? '__PROJECT_NAME__:',
  tls: readEnv('REDIS_TLS') === 'true',
  defaultTtlSeconds: readSeconds('REDIS_DEFAULT_TTL_SECONDS', DEFAULT_TTL_SECONDS),
} as const;

export const redis = new Redis(redisConfig.url, {
  // Set on the client so no caller can forget it.
  keyPrefix: redisConfig.keyPrefix,
  // Importing this file must not open a socket, or every test needs a live Redis.
  lazyConnect: true,
  // ioredis retries forever by default, which turns a dead Redis into hanging requests.
  maxRetriesPerRequest: 3,
  retryStrategy: (attempt) => (attempt > 5 ? null : Math.min(attempt * 200, 2000)),
  tls: redisConfig.tls ? {} : undefined,
});

// Without a listener an 'error' event is an uncaught exception and takes the process down.
redis.on('error', (error: Error) => {
  console.error(`[redis] ${error.message}`);
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'ready' || redis.status === 'connecting') return;
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'end') return;

  try {
    // quit() waits for in-flight commands; disconnect() drops them.
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

export interface RedisHealth {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** Bounded so a hanging Redis cannot hang a readiness probe. */
export async function checkRedis(timeoutMs = 1000): Promise<RedisHealth> {
  const startedAt = Date.now();

  try {
    await Promise.race([redis.ping(), timeout(timeoutMs)]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    // unref so a pending timer never holds the process open.
    setTimeout(() => {
      reject(new Error(`Redis did not respond within ${String(ms)}ms.`));
    }, ms).unref();
  });
}
