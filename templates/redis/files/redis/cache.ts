/**
 * JSON cache helpers over the shared client. Values are stored as JSON, so anything
 * `JSON.stringify` handles round-trips; a `Date` comes back as a string.
 */
import { redis, redisConfig } from './client__IMPORT_SUFFIX__';

export async function get<T>(key: string): Promise<T | undefined> {
  const raw = await redis.get(key);
  if (raw === null) return undefined;

  try {
    return JSON.parse(raw) as T;
  } catch {
    // A cache is not a source of truth, so a corrupt entry is just a miss.
    return undefined;
  }
}

export async function set<T>(
  key: string,
  value: T,
  ttlSeconds: number = redisConfig.defaultTtlSeconds,
): Promise<void> {
  // JSON.stringify(undefined) is not a string, so there is nothing to store.
  if (value === undefined) return;

  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function del(key: string): Promise<void> {
  await redis.del(key);
}

/** Read-through cache: return the cached value, or compute it, store it and return it. */
export async function wrap<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const cached = await get<T>(key);
  if (cached !== undefined) return cached;

  const value = await produce();
  await set(key, value, ttlSeconds);

  return value;
}
