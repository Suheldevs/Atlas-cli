/**
 * Public surface. The cache helpers are namespaced because `get` and `set` are far too
 * generic to sit loose in an import list: `cache.get(key)`, `cache.wrap(key, ttl, load)`.
 */
export * as cache from './cache__IMPORT_SUFFIX__';
export {
  checkRedis,
  connectRedis,
  disconnectRedis,
  redis,
  redisConfig,
  type RedisHealth,
} from './client__IMPORT_SUFFIX__';
