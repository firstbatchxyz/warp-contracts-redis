import type { Redis } from "ioredis";

/**
 * Redis client options.
 * - `url` Redis URL
 * - `client` provide the RedisClient yourself, internally disables `open` and `close` calls
 * and expects you to do them outside to your client manually.
 */
export type RedisOptions = {
  url?: string;
  maxEntriesPerContract?: number;
  minEntriesPerContract?: number;
  client?: Redis;
};
